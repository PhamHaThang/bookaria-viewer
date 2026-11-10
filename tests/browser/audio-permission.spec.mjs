import { expect, test } from '@playwright/test';

test.use({
    launchOptions: { args: ['--autoplay-policy=document-user-activation-required'] },
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
});

async function install(page, baseURL, denyPrime = false) {
    await page.addInitScript((deny) => {
        window.testAudio = [];
        window.testPlays = [];
        window.testCameraCalls = 0;
        window.testDenyPrime = deny;
        let inClick = false;
        document.addEventListener(
            'click',
            () => {
                inClick = true;
            },
            true,
        );
        window.addEventListener('click', () => {
            inClick = false;
        });
        const permitted = new WeakSet();
        const nativePlay = HTMLMediaElement.prototype.play;
        // Model a per-element permission policy, while retaining native audio decoding/playback.
        HTMLMediaElement.prototype.play = function () {
            if (!(this instanceof HTMLAudioElement)) return nativePlay.call(this);
            const prime = this.src.startsWith('data:audio/');
            window.testPlays.push({
                prime,
                inClick,
                cameras: window.testCameraCalls,
                muted: this.muted,
            });
            if (inClick && (!prime || !window.testDenyPrime)) permitted.add(this);
            if (!this.muted && !permitted.has(this))
                return Promise.reject(new DOMException('Gesture required', 'NotAllowedError'));
            return nativePlay.call(this);
        };
        const NativeAudio = window.Audio;
        window.Audio = new Proxy(NativeAudio, {
            construct(target, args) {
                const audio = Reflect.construct(target, args);
                window.testAudio.push(audio);
                return audio;
            },
        });
        navigator.mediaDevices.getUserMedia = async () => {
            window.testCameraCalls++;
            await new Promise((resolve) => {
                window.testReleaseCamera = resolve;
            });
            const track = {
                readyState: 'live',
                stop() {
                    this.readyState = 'ended';
                },
            };
            return { getTracks: () => [track] };
        };
    }, denyPrime);
    // Tracking is controlled here: the test targets permission timing, not image recognition.
    await page.route('**/src/tracker/mindar.ts*', (route) =>
        route.fulfill({
            contentType: 'text/javascript',
            body: `export async function startTracking(container, groups, preferred, signal, hooks, acquire) {
            const stream = await acquire(signal);
            window.testFind = (target) => hooks.update(0, target,
                [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,-3,1], [100,100]);
            return {
                projection: [1,0,0,0, 0,1,0,0, 0,0,-1,-1, 0,0,-.2,0],
                width: 640, height: 480, prefer() {},
                stop() { for (const track of stream.getTracks()) track.stop(); }
            };
        }`,
        }),
    );
    const id = (n) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;
    const assetId = id(50);
    const pages = [1, 2].map((n) => ({
        pageId: id(n),
        title: `Trang ${n}`,
        aspect: 1.4,
        imageUrl: `${baseURL}/audio-test/paper.png`,
        thumbnailUrl: `${baseURL}/audio-test/paper.png`,
        marker: { mode: 'CUSTOM_MARKER' },
        group: 0,
        targetIndex: n - 1,
        settings: { narrationAssetId: assetId },
        scene: { schemaVersion: 1, objects: [], interactions: [] },
    }));
    const time = '2026-11-07T00:00:00.000Z';
    const manifest = {
        schemaVersion: 1,
        bookId: id(90),
        version: 1,
        title: 'Sách âm thanh',
        trackerEngine: 'mindar',
        generatedAt: time,
        pages,
        assets: {
            [assetId]: { type: 'AUDIO', url: `${baseURL}/audio-test/narration.wav`, size: 64044 },
        },
        targetGroups: [
            {
                group: 0,
                mindUrl: `${baseURL}/audio-test/group.mind`,
                pageIds: pages.map((p) => p.pageId),
            },
        ],
        credits: [],
    };
    const info = {
        slug: 'audio-test',
        title: manifest.title,
        description: null,
        author: { id: id(91), displayName: 'Bookaria' },
        coverUrl: null,
        language: 'vi',
        ageMin: null,
        ageMax: null,
        version: { id: id(92), versionNo: 1, publishedAt: time },
        manifestUrl: `${baseURL}/audio-test/manifest.json`,
        pageCount: 2,
        arPageCount: 2,
        downloadBytes: 0,
        printPdfUrl: null,
    };
    await page.route('**/api/v1/**', (route) =>
        route.request().method() === 'GET'
            ? route.fulfill({ json: { data: info } })
            : route.fulfill({ status: 204 }),
    );
    await page.route('**/audio-test/manifest.json', (route) => route.fulfill({ json: manifest }));
    await page.route('**/audio-test/paper.png', (route) =>
        route.fulfill({
            contentType: 'image/png',
            body: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
                'base64',
            ),
        }),
    );
    const wav = Buffer.alloc(64044);
    wav.write('RIFF');
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(wav.length - 44, 40);
    await page.route('**/audio-test/narration.wav', (route) =>
        route.fulfill({ contentType: 'audio/wav', body: wav }),
    );
    await page.goto('/b/audio-test?mode=ar');
    await expect(page.locator('#start')).toBeEnabled();
    await page.locator('#start').click();
    await expect(page.locator('#camera-access')).toBeVisible();
}

async function allowCamera(page) {
    await page.locator('#camera-access-allow').tap();
    await expect.poll(() => page.evaluate(() => window.testCameraCalls)).toBe(1);
    await page.evaluate(() => window.testReleaseCamera());
    await expect(page.locator('#main')).toHaveAttribute('data-view', 'ar');
    await expect(page.locator('#reader-loading')).toBeHidden();
}

test('camera click primes audio before the permission wait; both scans play without another tap', async ({
    page,
    baseURL,
}) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await install(page, baseURL);
    await allowCamera(page);
    expect(await page.evaluate(() => window.testPlays)).toEqual([
        { prime: true, inClick: true, cameras: 0, muted: false },
    ]);
    await expect
        .poll(() => page.evaluate(() => window.testAudio.every((audio) => audio.paused)))
        .toBe(true);
    await page.evaluate(() => window.testFind(0));
    await expect.poll(() => page.evaluate(() => window.testAudio[0].paused)).toBe(false);
    await expect(page.locator('#retry-media')).toBeHidden();
    await page.evaluate(() => window.testFind(1));
    await expect(page.locator('#reader-context')).toHaveText('Trang 2 — Đã nhận diện');
    await expect.poll(() => page.evaluate(() => window.testAudio[0].paused)).toBe(false);
    expect(await page.evaluate(() => window.testAudio.length)).toBe(1);
    expect(await page.evaluate(() => window.testPlays.filter((play) => !play.prime).length)).toBe(
        2,
    );
    await expect(page.locator('#retry-media')).toBeHidden();
    await page.locator('#home-link').click();
    expect(await page.evaluate(() => window.testAudio.every((audio) => audio.paused))).toBe(true);
    expect(errors).toEqual([]);
});

test('sound disabled skips priming and plays the scanned page muted', async ({ page, baseURL }) => {
    await install(page, baseURL);
    await page.locator('#camera-access-sound').uncheck();
    await allowCamera(page);
    expect(await page.evaluate(() => window.testPlays)).toEqual([]);
    await page.evaluate(() => window.testFind(0));
    await expect.poll(() => page.evaluate(() => window.testAudio[0].paused)).toBe(false);
    expect(await page.evaluate(() => window.testAudio[0].muted)).toBe(true);
    await expect(page.locator('#retry-media')).toBeHidden();
});

for (const recovery of ['retry', 'unmute']) {
    test(`a browser that rejects priming allows ${recovery} and reuses permission on the next scan`, async ({
        page,
        baseURL,
    }) => {
        await install(page, baseURL, true);
        await allowCamera(page);
        await expect(page.locator('#retry-media')).toBeHidden();
        await page.evaluate(() => window.testFind(0));
        await expect(page.locator('#retry-media')).toBeVisible();
        if (recovery === 'retry') await page.locator('#retry-media').tap();
        else {
            await page.locator('#mute').tap();
            await page.locator('#mute').tap();
        }
        await expect.poll(() => page.evaluate(() => window.testAudio[0].paused)).toBe(false);
        await expect(page.locator('#retry-media')).toBeHidden();
        await page.evaluate(() => window.testFind(1));
        await expect(page.locator('#reader-context')).toHaveText('Trang 2 — Đã nhận diện');
        await expect.poll(() => page.evaluate(() => window.testAudio[0].paused)).toBe(false);
        expect(await page.evaluate(() => window.testAudio.length)).toBe(1);
        await expect(page.locator('#retry-media')).toBeHidden();
    });
}
