import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ModelControls } from '../src/scene-core/ModelControls.ts';

const near = (actual, expected) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
function setup(config = {}, aspect = 1.5, busy = () => false) {
    const root = new THREE.Group();
    root.position.set(0, 0, 0.17);
    root.rotation.set(0.2, 0.1, 0.3);
    root.scale.set(0.3, 0.2, 0.1);
    const spec = {
        id: 'car',
        type: 'model',
        name: 'Xe',
        assetId: 'asset',
        billboard: false,
        transform: { position: [0, 0, 0.17], rotation: [10, 20, 30], scale: [0.3, 0.2, 0.1] },
        controls: { enabled: true, speed: 0.4, bounds: 'page', autoRotate: false, ...config },
    };
    const control = new ModelControls(new Map([['car', { root, spec }]]), aspect, busy);
    control.start();
    return { control, root, spec };
}
const advance = (control, frames = 50) => {
    for (let i = 0; i < frames; i++) control.update(0.02);
};

test('movement uses elapsed time on page X/Y and never changes authored data, height or scale', () => {
    const { control, root, spec } = setup();
    const original = JSON.stringify(spec),
        rotation = root.quaternion.clone();
    control.setMove(1, 0);
    advance(control);
    near(root.position.x, 0.4);
    near(root.position.y, 0);
    near(root.position.z, 0.17);
    assert.deepEqual(root.scale.toArray(), [0.3, 0.2, 0.1]);
    assert.ok(root.quaternion.equals(rotation));
    assert.equal(JSON.stringify(spec), original);
});
test('diagonal input has the same speed and resumed frames cannot teleport', () => {
    const { control, root } = setup({ bounds: 'free' });
    control.setMove(1, 1);
    advance(control);
    near(Math.hypot(root.position.x, root.position.y), 0.4);
    const x = root.position.x;
    control.setMove(1, 0);
    control.update(10);
    near(root.position.x - x, 0.02);
});
test('bounds use height/width aspect, free movement can leave the page', () => {
    const { control, root } = setup({ speed: 5 }, 2);
    control.setMove(1, 1);
    advance(control);
    near(root.position.x, 0.5);
    near(root.position.y, 1);
    const free = setup({ speed: 5, bounds: 'free' }, 0.5);
    free.control.setMove(0, 1);
    advance(free.control);
    near(free.root.position.y, 5);
});
test('pause, hidden ancestors and an active transform stop movement and discard held input', () => {
    let busy = false;
    const { control, root } = setup({}, 1, () => busy);
    control.setMove(1, 0);
    control.pause(true);
    advance(control);
    near(root.position.x, 0);
    control.pause(false);
    advance(control);
    near(root.position.x, 0);
    const group = new THREE.Group();
    group.add(root);
    group.visible = false;
    control.setMove(1, 0);
    advance(control);
    group.visible = true;
    advance(control);
    near(root.position.x, 0);
    busy = true;
    control.setMove(1, 0);
    advance(control);
    busy = false;
    advance(control);
    near(root.position.x, 0);
});
test('enable, disable and reset affect only their target, restarting restores configuration', () => {
    const { control, root } = setup({ enabled: false });
    control.setMove(1, 0);
    advance(control);
    near(root.position.x, 0);
    control.command('car', 'enable');
    control.setMove(1, 0);
    advance(control);
    near(root.position.x, 0.4);
    control.command('car', 'disable');
    control.setMove(1, 0);
    advance(control);
    near(root.position.x, 0.4);
    control.command('car', 'reset');
    near(root.position.x, 0);
    near(root.position.z, 0.17);
    control.command('car', 'enable');
    control.setMove(1, 0);
    advance(control);
    control.start();
    near(root.position.x, 0);
    control.setMove(1, 0);
    advance(control);
    near(root.position.x, 0);
    assert.throws(() => control.command('missing', 'enable'), /mô hình/);
});
test('all enabled models receive input with their own speed, bounds and height', () => {
    const a = setup(),
        b = setup({ speed: 0.2, bounds: 'free' }),
        c = setup({ enabled: false });
    a.root.position.x = 0.49;
    b.root.position.z = 0.4;
    b.spec.id = 'other';
    c.spec.id = 'disabled';
    const control = new ModelControls(
        new Map([
            ['car', { root: a.root, spec: a.spec }],
            ['other', { root: b.root, spec: b.spec }],
            ['disabled', { root: c.root, spec: c.spec }],
        ]),
        1,
    );
    control.start();
    control.setMove(1, 0);
    advance(control);
    near(a.root.position.x, 0.5);
    near(b.root.position.x, 0.2);
    near(c.root.position.x, 0);
    near(a.root.position.z, 0.17);
    near(b.root.position.z, 0.4);
    assert.equal(control.entries.get('car').motion, 'idle');
    assert.equal(control.entries.get('other').motion, 'moving');
    control.command('car', 'disable');
    advance(control);
    near(a.root.position.x, 0.5);
    near(b.root.position.x, 0.4);
    control.command('disabled', 'enable');
    advance(control);
    near(b.root.position.x, 0.6);
    near(c.root.position.x, 0.4);
});
test('a hidden or tweening model does not block other models and targeted reset preserves shared input', () => {
    const a = setup(),
        b = setup({ bounds: 'free' });
    b.spec.id = 'other';
    let busy = true;
    const control = new ModelControls(
        new Map([
            ['car', { root: a.root, spec: a.spec }],
            ['other', { root: b.root, spec: b.spec }],
        ]),
        1,
        (id) => id === 'car' && busy,
    );
    control.start();
    control.setMove(1, 0);
    advance(control);
    near(a.root.position.x, 0);
    near(b.root.position.x, 0.4);
    busy = false;
    a.root.visible = false;
    advance(control);
    near(a.root.position.x, 0);
    near(b.root.position.x, 0.8);
    a.root.visible = true;
    control.command('other', 'reset');
    advance(control);
    near(a.root.position.x, 0.4);
    near(b.root.position.x, 0.4);
    control.pause(true);
    advance(control);
    near(a.root.position.x, 0.4);
    near(b.root.position.x, 0.4);
    control.pause(false);
    advance(control);
    near(a.root.position.x, 0.4);
    near(b.root.position.x, 0.4);
});
test('heading aligns the configured model front after authored rotations, turning via shortest path', () => {
    for (const [axis, vector] of [
        ['+z', [0, 0, 1]],
        ['-z', [0, 0, -1]],
        ['+x', [1, 0, 0]],
        ['-x', [-1, 0, 0]],
    ]) {
        for (const [x, y] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [1, 1],
        ]) {
            const { control, root } = setup({
                autoRotate: true,
                forwardAxis: axis,
                bounds: 'free',
            });
            const initial = root.quaternion.clone();
            control.setMove(x, y);
            control.update(0.02);
            assert.ok(root.quaternion.angleTo(initial) <= 0.240001, 'no sudden half turn');
            advance(control);
            const forward = new THREE.Vector3(...vector).applyQuaternion(root.quaternion);
            const projected = new THREE.Vector2(forward.x, forward.y).normalize();
            const desired = new THREE.Vector2(x, y).normalize();
            assert.ok(
                projected.dot(desired) > 0.999999,
                `${axis}: front follows movement ${x},${y}`,
            );
            near(forward.z, new THREE.Vector3(...vector).applyQuaternion(initial).z);
            control.command('car', 'reset');
            assert.ok(root.quaternion.equals(initial));
        }
    }
    const facing = setup({ autoRotate: true });
    facing.spec.billboard = true;
    const before = facing.root.quaternion.clone();
    facing.control.setMove(1, 0);
    advance(facing.control);
    assert.ok(facing.root.quaternion.equals(before));
});
