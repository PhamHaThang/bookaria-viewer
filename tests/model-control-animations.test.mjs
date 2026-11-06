import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ModelControlAnimations } from '../src/scene-core/ModelControlAnimations.ts';
import { ModelControls } from '../src/scene-core/ModelControls.ts';

function setup(controls = { idleClip: 'Idle', moveClip: 'Run' }) {
    const root = new THREE.Group();
    const mixer = new THREE.AnimationMixer(root);
    const clips = ['Idle', 'Run', 'Wave'].map(
        (name, index) =>
            new THREE.AnimationClip(name, 1, [
                new THREE.NumberKeyframeTrack('.position[z]', [0, 1], [index, index + 0.01]),
            ]),
    );
    const spec = {
        id: 'car',
        type: 'model',
        controls,
        animation: { clip: 'Wave', autoplay: true, loop: true },
    };
    const node = { root, mixer, clips, spec };
    const animations = new ModelControlAnimations(new Map([['car', node]]));
    const tick = () => {
        for (let i = 0; i < 12; i++) {
            animations.update(0.02);
            mixer.update(0.02);
        }
    };
    return {
        animations,
        node,
        tick,
        action: (name) => mixer.existingAction(clips.find((clip) => clip.name === name)),
    };
}
test('idle and moving clips crossfade, loop and release faded actions', () => {
    const { animations, node, tick, action } = setup();
    animations.set('car', 'idle');
    tick();
    assert.ok(action('Idle').isRunning());
    animations.set('car', 'moving');
    tick();
    assert.ok(action('Run').isRunning());
    assert.equal(action('Run').getEffectiveWeight(), 1);
    assert.equal(action('Run').loop, THREE.LoopRepeat);
    assert.equal(action('Idle').isRunning(), false);
    animations.set('car', 'idle');
    tick();
    assert.ok(action('Idle').isRunning());
    assert.equal(action('Run').isRunning(), false);
    animations.set('car', 'inactive');
    tick();
    assert.ok(action('Wave').isRunning());
    assert.equal(action('Idle').isRunning(), false);
    animations.dispose();
    node.mixer.stopAllAction();
});
test('one clip assigned to both states continues without restarting its clock', () => {
    const { animations, tick, action } = setup({ idleClip: 'Idle', moveClip: 'Idle' });
    animations.set('car', 'idle');
    tick();
    const time = action('Idle').time;
    animations.set('car', 'moving');
    assert.equal(action('Idle').time, time);
});
test('no locomotion configuration leaves existing autoplay untouched; missing clips do not crash', () => {
    const { animations, node, tick, action } = setup({});
    node.mixer.clipAction(node.clips[2]).play();
    animations.set('car', 'idle');
    tick();
    assert.ok(action('Wave').isRunning());
    node.spec.controls = { idleClip: 'missing' };
    assert.doesNotThrow(() => animations.set('car', 'idle'));
    tick();
    assert.equal(action('Wave').isRunning(), false);
});
test('manual animation cancels pending fade cleanup for the same clip', () => {
    const { animations, node, tick, action } = setup();
    animations.set('car', 'idle');
    tick();
    animations.set('car', 'moving');
    animations.release('car');
    node.mixer.stopAllAction();
    node.mixer.clipAction(node.clips[0]).reset().play();
    tick();
    assert.ok(action('Idle').isRunning());
});
test('motion notifications change only at start/stop, page bounds, pause and disable', () => {
    const root = new THREE.Group(),
        events = [];
    const spec = {
        id: 'car',
        type: 'model',
        controls: { enabled: true, speed: 0.4, bounds: 'page', autoRotate: false },
    };
    const controller = new ModelControls(
        new Map([['car', { root, spec }]]),
        1,
        () => false,
        (id, motion) => events.push([id, motion]),
    );
    controller.start();
    assert.deepEqual(events, [['car', 'idle']]);
    controller.setMove(1, 0);
    for (let i = 0; i < 10; i++) controller.update(0.02);
    assert.deepEqual(events, [
        ['car', 'idle'],
        ['car', 'moving'],
    ]);
    controller.setMove(0, 0);
    controller.update(0.02);
    assert.equal(events.at(-1)[1], 'idle');
    root.position.x = 0.5;
    controller.setMove(1, 0);
    controller.update(0.02);
    assert.equal(events.at(-1)[1], 'idle');
    controller.setMove(-1, 0);
    controller.update(0.02);
    controller.pause(true);
    assert.equal(events.at(-1)[1], 'idle');
    controller.command('car', 'disable');
    assert.equal(events.at(-1)[1], 'inactive');
});
