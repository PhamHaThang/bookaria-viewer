import assert from 'node:assert/strict';
import { test } from 'node:test';
import { audioPlaybackSlots } from '../src/scene-core/audio-slots.ts';
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

test('a camera-entry gesture primes narration before the asynchronous page is created', async () => {
    let gesture = false;
    const instances = [];
    class GestureAudio extends FakeAudio {
        permitted = false;
        constructor() {
            super();
            instances.push(this);
        }
        async play() {
            if (gesture) this.permitted = true;
            if (!this.permitted) throw new DOMException('Gesture required', 'NotAllowedError');
            return super.play();
        }
    }
    await withAudio(GestureAudio, async (create) => {
        const pool = new MediaElementPool();
        gesture = true;
        pool.primeAudio(audioPlaybackSlots([page]));
        assert.equal(instances[0].playCalls, 1, 'play must run before the gesture handler returns');
        gesture = false;
        await flush();
        assert.equal(instances[0].paused, true, 'priming must not keep playing during scanning');
        const notices = [];
        const first = await create(pool, notices);
        first.start();
        await flush();
        assert.equal(instances[0].paused, false);
        first.dispose();
        const second = await create(pool, notices);
        second.start();
        await flush();
        assert.equal(instances.length, 1);
        assert.equal(instances[0].paused, false);
        assert.deepEqual(notices, []);
        second.dispose();
        pool.dispose();
    });
});

test('late priming completion cannot pause narration after a page takes over the element', async () => {
    let complete;
    let instance;
    class PendingPrimeAudio extends FakeAudio {
        constructor() {
            super();
            instance = this;
        }
        play() {
            if (this.src.startsWith('data:')) return new Promise((resolve) => (complete = resolve));
            return super.play();
        }
    }
    await withAudio(PendingPrimeAudio, async (create) => {
        const pool = new MediaElementPool();
        pool.primeAudio(['narration']);
        const scene = await create(pool);
        scene.start();
        await flush();
        assert.equal(instance.paused, false);
        const pauses = instance.pauseCalls;
        complete();
        await flush();
        assert.equal(instance.paused, false);
        assert.equal(instance.pauseCalls, pauses);
        assert.equal(instance.src, assets[assetId].url);
        scene.dispose();
        pool.dispose();
    });
});

test('disposing an idle pending prime cancels its cleanup and frees its media source', async () => {
    let complete;
    let instance;
    class PendingPrimeAudio extends FakeAudio {
        constructor() {
            super();
            instance = this;
        }
        play() {
            return new Promise((resolve) => (complete = resolve));
        }
    }
    await withAudio(PendingPrimeAudio, async () => {
        const pool = new MediaElementPool();
        pool.primeAudio(['narration']);
        pool.dispose();
        assert.equal(instance.paused, true);
        assert.equal(instance.loadCalls, 1);
        complete();
        await flush();
        assert.equal(instance.loadCalls, 1);
    });
});

test('rejected priming leaves the actual playback warning and explicit retry available', async () => {
    let permitted = false;
    const instances = [];
    class BlockedAudio extends FakeAudio {
        constructor() {
            super();
            instances.push(this);
        }
        play() {
            if (!permitted) throw new DOMException('Blocked', 'NotAllowedError');
            return super.play();
        }
    }
    await withAudio(BlockedAudio, async (create) => {
        const pool = new MediaElementPool();
        assert.doesNotThrow(() => pool.primeAudio(['narration']));
        const notices = [];
        const scene = await create(pool, notices);
        scene.start();
        await flush();
        assert.equal(notices.length, 1);
        assert.match(notices[0], /Chạm để cho phép/);
        permitted = true;
        pool.primeAudio(['narration']);
        assert.equal(instances[0].src, assets[assetId].url, 'never replace a leased scene source');
        scene.retryMedia();
        await flush();
        assert.equal(instances[0].paused, false);
        scene.dispose();
        pool.dispose();
    });
});

test('audio channel planning covers page settings, objects and unique workflow sounds across pages', () => {
    const complexPage = {
        settings: { backgroundAudioAssetId: 'bg' },
        scene: {
            objects: [
                { type: 'audio', assetId: 'shared' },
                { type: 'audio', assetId: 'shared' },
                { type: 'image', assetId: 'image' },
            ],
            interactions: [
                {
                    actions: [
                        { type: 'playAudio', assetId: 'shared' },
                        { type: 'playAudio', assetId: 'extra' },
                        { type: 'playAudio', assetId: 'extra' },
                        { type: 'openUrl', url: 'https://example.com' },
                    ],
                },
            ],
        },
    };
    assert.deepEqual([...audioPlaybackSlots([page, complexPage, complexPage])].sort(), [
        'audio:0',
        'audio:1',
        'audio:2',
        'background',
        'narration',
    ]);
    assert.deepEqual(
        [...audioPlaybackSlots([{ settings: {}, scene: { objects: [], interactions: [] } }])],
        [],
    );
});
