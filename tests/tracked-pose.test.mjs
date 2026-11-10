import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Matrix4 } from 'three';
import { TrackedPose } from '../src/tracker/tracked-pose.ts';
import { TRACKING_LOSS_GRACE_MS, TrackingLoss } from '../src/tracker/tracking-loss.ts';

const matrix = (x = 0) => new Matrix4().makeTranslation(x, 0, -1000).toArray();
function fixture() {
    let time = 0,
        id = 0;
    const timers = new Map(),
        events = [];
    const pose = new TrackedPose(
        (target, world) => events.push({ target, world, time }),
        new TrackingLoss(
            (run, ms) => {
                timers.set(++id, { at: time + ms, run });
                return id;
            },
            (key) => timers.delete(key),
        ),
        () => time,
    );
    const tick = (ms) => {
        const end = time + ms;
        for (;;) {
            const pending = [...timers]
                .filter(([, timer]) => timer.at <= end)
                .sort((a, b) => a[1].at - b[1].at)[0];
            if (!pending) break;
            time = pending[1].at;
            timers.delete(pending[0]);
            pending[1].run();
        }
        time = end;
    };
    return { pose, events, timers, tick };
}

test('held vendor matrices neither reach the filter nor restart the loss deadline', () => {
    const f = fixture();
    f.pose.update(0, matrix(), true);
    f.pose.update(0, matrix(100), false);
    for (let i = 0; i < 44; i++) {
        f.tick(10);
        f.pose.update(0, matrix(100), false);
    }
    assert.equal(f.events.length, 1);
    assert.equal(f.timers.size, 1);
    f.tick(10);
    assert.equal(f.events.length, 2);
    assert.equal(f.events[1].world, null);
    assert.equal(f.events[1].time, 450);
    f.pose.update(0, matrix(100), false);
    f.pose.update(0, null, false);
    f.tick(1000);
    assert.equal(f.events.length, 2, 'Only one confirmed loss per hold');
});

test('recovery within the hold has no loss/found transition and ignores stale movement', () => {
    const f = fixture();
    f.pose.update(0, matrix(), true);
    f.pose.update(0, matrix(100), false);
    f.tick(220);
    f.pose.update(0, matrix(1), true);
    assert.equal(f.timers.size, 0);
    assert.ok(f.events[1].world[12] >= 0 && f.events[1].world[12] <= 1);
    f.tick(1000);
    assert.ok(f.events.every((event) => event.world));
});

test('slow tracking has the same 450 ms deadline and reacquisition snaps to the new pose', () => {
    const f = fixture();
    f.pose.update(0, matrix(), true);
    f.tick(200);
    f.pose.update(0, matrix(), false);
    f.tick(TRACKING_LOSS_GRACE_MS - 1);
    assert.equal(f.events.length, 1);
    f.tick(1);
    assert.equal(f.events[1].time, 650);
    f.pose.update(0, matrix(500), true);
    assert.equal(f.events[2].world[12], 500);
});

test('a later vendor null does not add another grace period', () => {
    const f = fixture();
    f.pose.update(0, matrix(), true);
    f.pose.update(0, matrix(), false);
    f.tick(300);
    f.pose.update(0, null, false);
    f.tick(150);
    assert.equal(f.events.at(-1).world, null);
    assert.equal(f.events.at(-1).time, 450);
});

test('brief outliers are confirmed without resetting their pending candidate', () => {
    const f = fixture();
    f.pose.update(0, matrix(), true);
    f.tick(33);
    f.pose.update(0, matrix(300), true);
    assert.equal(f.events.length, 1);
    f.tick(33);
    f.pose.update(0, matrix(304), true);
    assert.ok(f.events[1].world[12] > 200);
    assert.equal(f.timers.size, 0);
});

test('target and group changes cancel old deadlines, and old target loss cannot hide the new one', () => {
    const f = fixture();
    f.pose.update(0, matrix(), true);
    f.pose.update(0, null, false);
    f.tick(100);
    f.pose.update(1, matrix(500), true);
    f.pose.update(0, null, false);
    f.tick(500);
    assert.equal(f.events.length, 2);
    assert.equal(f.events[1].world[12], 500);
    f.pose.update(1, null, false);
    f.pose.reset();
    f.tick(500);
    assert.equal(f.events.length, 2, 'Group change or stop cancels pending callbacks');
    f.pose.update(0, matrix(-500), true);
    assert.equal(f.events.at(-1).world[12], -500);
});

test('stale or invalid other targets cannot acquire or keep a previous target alive', () => {
    const f = fixture();
    f.pose.update(0, matrix(), false);
    assert.equal(f.events.length, 0);
    f.pose.update(0, matrix(), true);
    f.pose.update(0, null, false);
    f.tick(100);
    f.pose.update(1, matrix(500), false);
    f.pose.update(1, [], true);
    f.tick(350);
    assert.deepEqual(
        f.events.map((event) => [event.target, !!event.world]),
        [
            [0, true],
            [0, false],
        ],
    );
});
