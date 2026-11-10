import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { PoseFilter } from '../src/tracker/pose-filter.ts';

function pose({ x = 0, y = 0, z = -1000, angle = 0, scale = 1 } = {}) {
    return new Matrix4()
        .compose(
            new Vector3(x, y, z),
            new Quaternion().setFromEuler(new Euler(0, 0, angle)),
            new Vector3(scale, scale, scale),
        )
        .toArray();
}
function rms(values) {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

test('first acquisition is placed immediately, without altering or reusing the input array', () => {
    const filter = new PoseFilter();
    const input = pose({ x: 80, angle: 0.1 });
    const saved = [...input];
    const first = filter.update(input, 0);
    assert.notEqual(first, input);
    first.forEach((value, index) => {
        assert.ok(Math.abs(value - input[index]) < 1e-9);
    });
    filter.update(pose({ x: 82 }), 33);
    assert.deepEqual(input, saved);
    assert.equal(first[12], 80, 'Cached poses must not mutate on the next update');
});

test('stationary position and orientation jitter are reduced while preserving rigid transforms', () => {
    const filter = new PoseFilter();
    filter.update(pose(), 0);
    const raw = [],
        positions = [],
        angles = [];
    const position = new Vector3(),
        rotation = new Quaternion(),
        scale = new Vector3();
    for (let frame = 1; frame <= 90; frame++) {
        const x = frame % 2 ? 1 : -1;
        const result = filter.update(pose({ x, angle: x * 0.002 }), frame * 33);
        assert.ok(result);
        new Matrix4().fromArray(result).decompose(position, rotation, scale);
        assert.ok(Math.abs(scale.x - 1) < 1e-9);
        if (frame > 10) {
            raw.push(x);
            positions.push(position.x);
            angles.push(new Euler().setFromQuaternion(rotation).z);
        }
    }
    assert.ok(rms(positions) < rms(raw) * 0.6);
    assert.ok(rms(angles) < rms(raw) * 0.002 * 0.6);
});

test('an isolated translation or rotation spike never reaches the displayed pose', () => {
    for (const spike of [pose({ x: 500 }), pose({ angle: Math.PI / 2 }), pose({ scale: 2 })]) {
        const filter = new PoseFilter();
        filter.update(pose(), 0);
        assert.equal(filter.update(spike, 33), null);
        const recovered = filter.update(pose({ x: 1 }), 66);
        assert.ok(recovered);
        assert.ok(recovered[12] >= 0 && recovered[12] <= 1);
    }
});

test('consistent large camera motion is confirmed quickly and does not lock to the old pose', () => {
    const filter = new PoseFilter();
    filter.update(pose(), 0);
    assert.equal(filter.update(pose({ x: 300, angle: 0.7 }), 33), null);
    assert.equal(filter.update(pose({ x: 302, angle: 0.71 }), 49), null);
    const moved = filter.update(pose({ x: 304, angle: 0.72 }), 66);
    assert.ok(moved && moved[12] > 200);
    let settled;
    for (let frame = 3; frame <= 10; frame++)
        settled = filter.update(pose({ x: 304, angle: 0.72 }), frame * 33);
    assert.ok(Math.abs(settled[12] - 304) < 2);
});

test('inconsistent outliers stay rejected instead of reviving a stale pose after a timeout', () => {
    const filter = new PoseFilter();
    filter.update(pose(), 0);
    for (let frame = 1; frame <= 40; frame++)
        assert.equal(filter.update(pose({ x: frame % 2 ? 500 : -500 }), frame * 33), null);
    assert.ok(filter.update(pose(), 1400));
});

test('large motion can still be confirmed when a slow camera produces five poses per second', () => {
    const filter = new PoseFilter();
    filter.update(pose(), 0);
    assert.equal(filter.update(pose({ x: 300 }), 200), null);
    assert.equal(filter.update(pose({ x: 304 }), 400)[12], 304);
});

test('brief loss resumes smoothing; prolonged loss and target reset start at the new pose', () => {
    const filter = new PoseFilter();
    filter.update(pose(), 0);
    filter.lost(20);
    const brief = filter.update(pose({ x: 10 }), 100);
    assert.ok(brief[12] > 0 && brief[12] < 10);
    filter.lost(130);
    assert.equal(filter.update(pose({ x: 500 }), 500)[12], 500);
    filter.reset();
    assert.equal(filter.update(pose({ x: -500 }), 533)[12], -500);
});

test('filtering is independent of target pixel dimensions and close across frame rates', () => {
    function motion(fps, units = 1) {
        const filter = new PoseFilter();
        let result;
        for (let frame = 0; frame <= fps; frame++)
            result = filter.update(
                pose({ x: ((60 * frame) / fps) * units, z: -1000 * units }),
                (1000 * frame) / fps,
            );
        return result[12] / units;
    }
    assert.ok(Math.abs(motion(30) - motion(60)) < 1);
    assert.ok(Math.abs(motion(30) - motion(30, 0.001)) < 1e-9);
    assert.ok(motion(30) > 55, 'Ordinary movement must stay responsive');
});

test('rotation smoothing uses the shortest path across the angle wrap', () => {
    const filter = new PoseFilter();
    filter.update(pose({ angle: (179 * Math.PI) / 180 }), 0);
    const result = filter.update(pose({ angle: (-179 * Math.PI) / 180 }), 33);
    assert.ok(result);
    const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().fromArray(result));
    assert.ok(rotation.angleTo(new Quaternion().setFromEuler(new Euler(0, 0, Math.PI))) < 0.02);
});

test('invalid, singular, reflected, non-affine and behind-camera poses are rejected', () => {
    const invalid = pose();
    invalid[12] = Number.NaN;
    const nonAffine = pose();
    nonAffine[3] = 0.2;
    const reflected = pose();
    reflected[0] = -1;
    const filter = new PoseFilter();
    for (const input of [
        [],
        invalid,
        nonAffine,
        reflected,
        Array(16).fill(0),
        pose({ z: 100 }),
        pose({ scale: 0 }),
    ])
        assert.equal(filter.update(input, 33), null);
    assert.ok(filter.update(pose(), 66));
});
