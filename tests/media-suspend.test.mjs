import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScene } from '../src/scene-core/buildScene.ts';
import { SceneObjectSchema } from '../src/shared/contracts/scene.schema.ts';
import { FakeAudio } from './helpers/fake-audio.mjs';

test('tracking loss pauses only playing media; reacquisition resumes its position without replaying page-enter rules', async () => {
    const keys = [
        'document',
        'fetch',
        'ImageBitmap',
        'createImageBitmap',
        'Audio',
        'HTMLAudioElement',
    ];
    const saved = new Map(keys.map((key) => [key, globalThis[key]]));
    const canvas = new Proxy(
        { measureText: (text) => ({ width: text.length * 16 }) },
        { get: (target, key) => target[key] ?? (() => {}) },
    );
    globalThis.document = {
        createElement: () => ({ width: 0, height: 0, getContext: () => canvas }),
    };
    globalThis.fetch = async () => new Response(new Uint8Array([1]));
    globalThis.ImageBitmap = class {
        width = 1;
        height = 1;
        close() {}
    };
    globalThis.createImageBitmap = async () => new ImageBitmap();
    globalThis.Audio = FakeAudio;
    globalThis.HTMLAudioElement = FakeAudio;
    let runtime;
    try {
        const aid = '11111111-1111-4111-8111-111111111111';
        const playing = SceneObjectSchema.parse({
            id: 'music',
            type: 'audio',
            assetId: aid,
            autoplay: true,
            transform: {},
        });
        const paused = SceneObjectSchema.parse({
            id: 'voice',
            type: 'audio',
            assetId: aid,
            autoplay: false,
            transform: {},
        });
        runtime = await buildScene(
            {
                imageUrl: 'https://example.com/page.png',
                aspect: 1.4,
                settings: {},
                scene: { schemaVersion: 1, objects: [playing, paused], interactions: [] },
            },
            {
                [aid]: {
                    type: 'AUDIO',
                    url: 'https://example.com/audio.mp3',
                    meta: { durationSec: 42 },
                },
            },
            new AbortController().signal,
            { notice() {}, link() {}, log() {} },
        );
        let enters = 0;
        const fire = runtime.runner.fire.bind(runtime.runner);
        runtime.runner.fire = (trigger) => {
            if (trigger.type === 'onPageEnter') enters++;
            return fire(trigger);
        };
        runtime.start();
        await Promise.resolve();
        const music = runtime.nodes.get('music').audio,
            voice = runtime.nodes.get('voice').audio;
        music.currentTime = 12;
        runtime.suspend();
        runtime.suspend();
        assert.equal(music.paused, true);
        assert.equal(music.currentTime, 12);
        runtime.resume();
        runtime.resume();
        await Promise.resolve();
        assert.equal(music.paused, false);
        assert.equal(music.currentTime, 12);
        assert.equal(music.playCalls, 2);
        assert.equal(voice.paused, true);
        assert.equal(voice.playCalls, 0);
        assert.equal(enters, 1);
        runtime.suspend();
        await runtime.leave();
        runtime.resume();
        await Promise.resolve();
        assert.equal(music.paused, true);
        assert.equal(music.currentTime, 0, 'Leaving a page still resets its media');
        runtime.dispose();
        runtime.resume();
        assert.equal(music.paused, true);
    } finally {
        runtime?.dispose();
        for (const [key, value] of saved) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    }
});
