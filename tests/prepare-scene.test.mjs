import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { nextFrame, prepareScene } from '../src/scene-core/prepare-scene.ts';

const content = () => {
    const group = new THREE.Group();
    const texture = new THREE.Texture();
    const mesh = () =>
        new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ map: texture }));
    group.add(mesh(), mesh());
    return { group, texture };
};

test('AR preparation compiles off-scene and uploads a shared texture once without changing authored opacity', async () => {
    const { group, texture } = content();
    const calls = [];
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const renderer = {
        async compileAsync(object, passedCamera, lights) {
            assert.equal(object.parent, null);
            assert.equal(object, group);
            assert.equal(passedCamera, camera);
            assert.equal(lights, scene);
            calls.push('compile');
        },
        initTexture(map) {
            assert.equal(map, texture);
            calls.push('texture');
        },
    };
    await prepareScene(renderer, group, camera, scene, new AbortController().signal);
    assert.deepEqual(calls, ['compile', 'texture']);
    assert.ok(group.children.every((mesh) => mesh.material.opacity === 1));
    assert.equal(group.parent, null);
});

test('cancelling while shaders compile does not upload textures or attach stale content', async () => {
    const { group } = content();
    const abort = new AbortController();
    let complete;
    let uploads = 0;
    const pending = prepareScene(
        {
            compileAsync: () =>
                new Promise((resolve) => {
                    complete = resolve;
                }),
            initTexture() {
                uploads++;
            },
        },
        group,
        new THREE.PerspectiveCamera(),
        new THREE.Scene(),
        abort.signal,
    );
    abort.abort();
    const rejected = assert.rejects(pending);
    complete();
    await rejected;
    assert.equal(uploads, 0);
    assert.equal(group.parent, null);
});

test('waiting for a preparation frame can be cancelled without waiting for a background tab', async () => {
    const saved = ['requestAnimationFrame', 'cancelAnimationFrame'].map((key) => [
        key,
        globalThis[key],
    ]);
    let cancelled;
    globalThis.requestAnimationFrame = () => 7;
    globalThis.cancelAnimationFrame = (id) => {
        cancelled = id;
    };
    try {
        const abort = new AbortController();
        const pending = nextFrame(abort.signal);
        const rejected = assert.rejects(pending);
        abort.abort();
        await rejected;
        assert.equal(cancelled, 7);
    } finally {
        for (const [key, value] of saved) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    }
});
