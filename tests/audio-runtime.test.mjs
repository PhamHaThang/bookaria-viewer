import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { buildScene } from '../src/scene-core/buildScene.ts';
import { SceneObjectSchema } from '../src/shared/contracts/scene.schema.ts';

class AudioMock extends EventTarget {
    paused = true;
    ended = false;
    currentTime = 0;
    duration = 30;
    error = null;
    playCalls = 0;
    failure = false;
    async play() {
        this.playCalls++;
        if (this.failure) throw Error('blocked');
        this.paused = false;
        this.dispatchEvent(new Event('playing'));
    }
    pause() {
        this.paused = true;
        this.dispatchEvent(new Event('pause'));
    }
    load() {
        this.error = null;
    }
    removeAttribute() {}
}
test('Viewer audio card toggles, resumes, faces the camera, handles blocked media and stops on leave/dispose', async () => {
    const keys = [
        'document',
        'fetch',
        'ImageBitmap',
        'createImageBitmap',
        'Audio',
        'HTMLAudioElement',
    ];
    const saved = new Map(keys.map((k) => [k, globalThis[k]]));
    const ctx = new Proxy(
        { measureText: (text) => ({ width: text.length * 16 }) },
        { get: (t, k) => t[k] ?? (() => {}) },
    );
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
    globalThis.fetch = async () => new Response(new Uint8Array([1]));
    globalThis.ImageBitmap = class {
        width = 1;
        height = 1;
        close() {}
    };
    globalThis.createImageBitmap = async () => new ImageBitmap();
    globalThis.Audio = AudioMock;
    globalThis.HTMLAudioElement = AudioMock;
    let runtime;
    try {
        const assetId = '11111111-1111-4111-8111-111111111111',
            notices = [];
        const spec = SceneObjectSchema.parse({
            id: 'audio',
            type: 'audio',
            audioKind: 'SFX',
            assetId,
            name: 'Âm thanh thử',
            billboard: false,
            autoplay: false,
            visible: true,
            transform: { position: [0.2, 0.1, 0.3] },
        });
        runtime = await buildScene(
            {
                imageUrl: 'https://example.com/page.png',
                aspect: 1.4,
                settings: {},
                scene: {
                    schemaVersion: 1,
                    objects: [spec],
                    interactions: [
                        {
                            id: 'leave-audio',
                            enabled: true,
                            trigger: { type: 'onPageLeave' },
                            actions: [
                                {
                                    type: 'playAudio',
                                    assetId,
                                    loop: false,
                                    volume: 0.5,
                                    delayMsSchema: 0,
                                },
                            ],
                            onRetrigger: 'ignore',
                        },
                    ],
                },
            },
            {
                [assetId]: {
                    type: 'AUDIO',
                    url: 'https://example.com/audio.mp3',
                    meta: { durationSec: 30 },
                },
            },
            new AbortController().signal,
            { notice: (m) => notices.push(m), link() {}, log() {} },
        );
        const node = runtime.nodes.get('audio'),
            audio = node.audio;
        assert.ok(node.root.getObjectByName('audio-card'));
        runtime.start();
        assert.equal(audio.playCalls, 0);
        runtime.tap('audio');
        await Promise.resolve();
        assert.equal(audio.paused, false);
        audio.currentTime = 8;
        runtime.tap('audio');
        assert.equal(audio.paused, true);
        assert.equal(audio.currentTime, 8);
        runtime.tap('audio', { x: 72 / 768, y: 1 - 273 / 360 });
        await Promise.resolve();
        assert.equal(audio.paused, false);
        assert.equal(audio.currentTime, 8);
        const camera = new PerspectiveCamera(40, 1, 0.01, 100);
        camera.up.set(0, 0, 1);
        for (const position of [
            [1, -2, 3],
            [-2, 1, 2],
        ]) {
            camera.position.fromArray(position);
            camera.lookAt(0, 0, 0);
            camera.updateMatrixWorld();
            runtime.update(0.016, camera);
            runtime.group.updateMatrixWorld(true);
            const normal = new Vector3(0, 0, 1).transformDirection(
                node.root.getObjectByName('audio-card').matrixWorld,
            );
            assert.ok(
                normal.dot(new Vector3(0, 0, 1).applyQuaternion(camera.quaternion)) > 0.999999,
            );
        }
        runtime.mute(true);
        assert.equal(audio.muted, true);
        runtime.mute(false);
        assert.equal(audio.muted, false);
        runtime.tap('audio');
        audio.failure = true;
        runtime.tap('audio');
        await new Promise((r) => setImmediate(r));
        assert.equal(notices.length, 1);
        audio.failure = false;
        runtime.retryMedia();
        await Promise.resolve();
        assert.equal(audio.paused, false);
        audio.pause();
        await runtime.runner.fire({ type: 'onPageLeave' });
        assert.equal(audio.paused, false, 'playAudio actions should drive the card player');
        await runtime.leave();
        assert.equal(audio.paused, true);
        assert.equal(audio.currentTime, 0);
        node.root.visible = false;
        const calls = audio.playCalls;
        runtime.tap('audio');
        assert.equal(audio.playCalls, calls);
        runtime.dispose();
        runtime.tap('audio');
        assert.equal(audio.playCalls, calls);
        assert.equal(runtime.group.children.length, 0);
        const hidden = SceneObjectSchema.parse({
            ...spec,
            visible: false,
            autoplay: true,
        });
        runtime = await buildScene(
            {
                imageUrl: 'https://example.com/page.png',
                aspect: 1.4,
                settings: {},
                scene: { schemaVersion: 1, objects: [hidden], interactions: [] },
            },
            {
                [assetId]: { type: 'AUDIO', url: 'https://example.com/audio.mp3', meta: {} },
            },
            new AbortController().signal,
            { notice() {}, link() {}, log() {} },
        );
        const hiddenNode = runtime.nodes.get('audio');
        assert.equal(hiddenNode.root.visible, false);
        runtime.start();
        await Promise.resolve();
        assert.equal(
            hiddenNode.audio.paused,
            false,
            'hiding a card must not mute background playback',
        );
        const attempts = hiddenNode.audio.playCalls;
        runtime.tap('audio');
        assert.equal(hiddenNode.audio.playCalls, attempts, 'hidden players cannot be clicked');
        await runtime.leave();
        assert.equal(hiddenNode.audio.paused, true);
    } finally {
        runtime?.dispose();
        for (const [k, v] of saved) {
            if (v === undefined) delete globalThis[k];
            else globalThis[k] = v;
        }
    }
});
