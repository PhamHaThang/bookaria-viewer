import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScene } from '../src/scene-core/buildScene.ts';
import { MediaElementPool } from '../src/scene-core/MediaElementPool.ts';
import { FakeAudio } from './helpers/fake-audio.mjs';

const assetId = '11111111-1111-4111-8111-111111111111';
const assets = { [assetId]: { type: 'AUDIO', url: 'https://example.com/narration.mp3', meta: {} } };
const page = {
    imageUrl: 'https://example.com/page.png',
    aspect: 1.4,
    settings: { narrationAssetId: assetId },
    scene: { schemaVersion: 1, objects: [], interactions: [] },
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function withAudio(AudioClass, run) {
    const savedAudio = globalThis.Audio,
        savedElement = globalThis.HTMLAudioElement;
    globalThis.Audio = AudioClass;
    globalThis.HTMLAudioElement = AudioClass;
    const scenes = [];
    const create = async (pool, notices = []) => {
        const scene = await buildScene(
            page,
            assets,
            new AbortController().signal,
            { notice: (message) => notices.push(message), link() {}, log() {} },
            { background: false, ...(pool ? { mediaPool: pool } : {}) },
        );
        scenes.push(scene);
        return scene;
    };
    try {
        await run(create);
    } finally {
        for (const scene of scenes) scene.dispose();
        if (savedAudio === undefined) delete globalThis.Audio;
        else globalThis.Audio = savedAudio;
        if (savedElement === undefined) delete globalThis.HTMLAudioElement;
        else globalThis.HTMLAudioElement = savedElement;
    }
}

test('page changes retain the same narration element after the reader permits playback', async () => {
    const instances = [];
    class GestureAudio extends FakeAudio {
        permitted = false;
        constructor() {
            super();
            instances.push(this);
        }
        async play() {
            if (!this.permitted) throw new DOMException('Gesture required', 'NotAllowedError');
            return super.play();
        }
    }
    await withAudio(GestureAudio, async (create) => {
        const pool = new MediaElementPool(),
            notices = [];
        const first = await create(pool, notices);
        first.start();
        await flush();
        assert.equal(notices.length, 1);
        assert.match(notices[0], /Chạm để cho phép/);
        instances[0].permitted = true;
        first.retryMedia();
        await flush();
        assert.equal(instances[0].paused, false);
        await first.leave();
        first.dispose();
        const secondNotices = [],
            second = await create(pool, secondNotices);
        second.start();
        await flush();
        assert.equal(instances.length, 1, 'changing pages must not allocate another audio element');
        assert.equal(instances[0].paused, false);
        assert.deepEqual(secondNotices, []);
        instances[0].dispatchEvent(new Event('error'));
        assert.equal(notices.length, 1, 'released scenes must remove their error listeners');
        assert.equal(secondNotices.length, 1);
        second.dispose();
        pool.dispose();
    });
});

test('a cancelled play does not show the autoplay permission warning or retry stopped audio', async () => {
    let calls = 0;
    class CancelledAudio extends FakeAudio {
        async play() {
            calls++;
            throw new DOMException('Interrupted', 'AbortError');
        }
    }
    await withAudio(CancelledAudio, async (create) => {
        const notices = [],
            scene = await create(undefined, notices);
        scene.start();
        await flush();
        scene.retryMedia();
        await flush();
        assert.deepEqual(notices, []);
        assert.equal(calls, 1);
    });
});

test('late rejections after tracking loss or leaving a page cannot display a warning', async () => {
    const rejects = [];
    class PendingAudio extends FakeAudio {
        play() {
            return new Promise((_, reject) => rejects.push(reject));
        }
    }
    await withAudio(PendingAudio, async (create) => {
        const notices = [],
            scene = await create(undefined, notices);
        scene.start();
        scene.suspend();
        rejects.shift()(new DOMException('Interrupted', 'AbortError'));
        await flush();
        assert.deepEqual(notices, []);
        scene.resume();
        assert.equal(rejects.length, 1, 'pending playback resumes when the target is found');
        await scene.leave();
        rejects.shift()(new DOMException('Gesture required', 'NotAllowedError'));
        await flush();
        assert.deepEqual(notices, []);
    });
});

test('synchronous play failures are handled and genuine file failures remain visible', async () => {
    class BrokenAudio extends FakeAudio {
        play() {
            throw new DOMException('Bad codec', 'NotSupportedError');
        }
    }
    await withAudio(BrokenAudio, async (create) => {
        const notices = [],
            scene = await create(undefined, notices);
        assert.doesNotThrow(() => scene.start());
        await flush();
        assert.equal(notices.length, 1);
        assert.match(notices[0], /kiểm tra tệp/);
    });
});

test('the pool never shares a leased element and resets audio and video before reuse', () => {
    const originalAudio = globalThis.Audio,
        originalDocument = globalThis.document;
    globalThis.Audio = FakeAudio;
    globalThis.document = { createElement: () => new FakeAudio() };
    try {
        const pool = new MediaElementPool();
        const a = pool.audio('narration'),
            b = pool.audio('narration'),
            video = pool.video('video:0');
        assert.notEqual(a, b);
        assert.notEqual(a, video);
        a.volume = 0.2;
        a.muted = true;
        a.loop = true;
        pool.release(a);
        pool.release(a);
        assert.equal(pool.audio('narration'), a);
        assert.equal(a.volume, 1);
        assert.equal(a.muted, false);
        assert.equal(a.loop, false);
        pool.release(video);
        assert.equal(pool.video('video:0'), video);
        pool.dispose();
        assert.equal(a.paused, true);
        assert.equal(b.paused, true);
    } finally {
        if (originalAudio === undefined) delete globalThis.Audio;
        else globalThis.Audio = originalAudio;
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
    }
});
