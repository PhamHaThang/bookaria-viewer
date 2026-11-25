import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PerspectiveCamera } from 'three';
import { buildScene } from '../src/scene-core/buildScene.ts';
import { InteractionRuleSchema, SceneObjectSchema } from '../src/shared/contracts/scene.schema.ts';
import { FakeAudio } from './helpers/fake-audio.mjs';

const assetId = '11111111-1111-4111-8111-111111111111';
async function withVideo(interactions, run) {
    const saved = {
        document: globalThis.document,
        ImageBitmap: globalThis.ImageBitmap,
        HTMLVideoElement: globalThis.HTMLVideoElement,
    };
    class FakeVideo extends FakeAudio {
        videoWidth = 426;
        videoHeight = 240;
    }
    const video = new FakeVideo();
    globalThis.HTMLVideoElement = FakeVideo;
    globalThis.ImageBitmap = class {};
    globalThis.document = { createElement: () => video };
    let scene;
    try {
        scene = await buildScene(
            {
                aspect: 1.4,
                settings: {},
                scene: {
                    schemaVersion: 1,
                    interactions,
                    objects: [
                        SceneObjectSchema.parse({
                            id: 'video',
                            type: 'video',
                            assetId,
                            autoplay: false,
                            transform: {},
                        }),
                    ],
                },
            },
            {
                [assetId]: {
                    type: 'VIDEO',
                    url: 'https://example.test/video.mp4',
                    meta: { width: 426, height: 240 },
                },
            },
            new AbortController().signal,
            { notice() {}, link() {}, log() {} },
            { background: false },
        );
        await run(scene, video);
    } finally {
        scene?.dispose();
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    }
}

test('paused video has a play hint, taps toggle playback and idle scenes stop requesting frames', async () => {
    await withVideo([], async (scene, video) => {
        const camera = new PerspectiveCamera();
        const hint = scene.nodes.get('video').billboard.content.getObjectByName('video-play-hint');
        assert.ok(hint);
        assert.equal(hint.visible, true);
        assert.equal(video.playCalls, 0);
        scene.update(0, camera);
        assert.equal(scene.needsFrame(), false);
        scene.tap('video');
        await new Promise(setImmediate);
        assert.equal(video.paused, false);
        assert.equal(hint.visible, false);
        scene.update(0, camera);
        assert.equal(scene.needsFrame(), true);
        scene.tap('video');
        assert.equal(video.paused, true);
        assert.equal(hint.visible, true);
        scene.update(0, camera);
        assert.equal(scene.needsFrame(), false);
        video.dispatchEvent(new Event('loadeddata'));
        assert.equal(scene.needsFrame(), true);
        scene.dispose();
        assert.equal(scene.needsFrame(), false);
    });
});

test('an authored video tap flow keeps control of playback', async () => {
    const rule = InteractionRuleSchema.parse({
        id: 'tap',
        enabled: true,
        trigger: { type: 'onTap', objectId: 'video' },
        actions: [{ type: 'wait', ms: 1 }],
    });
    await withVideo([rule], async (scene, video) => {
        scene.tap('video');
        await new Promise(setImmediate);
        assert.equal(video.playCalls, 0);
    });
});
