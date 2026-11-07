import { expect, test } from '@playwright/test';

test.use({ launchOptions: { args: ['--autoplay-policy=document-user-activation-required'] } });

test('native audio keeps playing across page changes after a reader gesture', async ({
    page,
    baseURL,
}) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const wav = Buffer.alloc(44 + 16_000 * 2 * 3);
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
    await page.route('**/media-fixture/narration.wav', (route) =>
        route.fulfill({ contentType: 'audio/wav', body: wav }),
    );
    await page.goto('/');
    await page.evaluate(async (origin) => {
        const NativeAudio = window.Audio;
        window.testAudioElements = [];
        window.Audio = new Proxy(NativeAudio, {
            construct(target, args) {
                const element = Reflect.construct(target, args);
                window.testAudioElements.push(element);
                return element;
            },
        });
        const { MediaElementPool } = await import('/src/scene-core/MediaElementPool.ts');
        const { buildScene } = await import('/src/scene-core/buildScene.ts');
        window.testMediaPool = new MediaElementPool();
        window.testMediaNotices = [];
        const assetId = '11111111-1111-4111-8111-111111111111';
        window.makeAudioScene = () =>
            buildScene(
                {
                    pageId: 'page',
                    aspect: 1.4,
                    settings: { narrationAssetId: assetId },
                    scene: { schemaVersion: 1, objects: [], interactions: [] },
                },
                {
                    [assetId]: {
                        type: 'AUDIO',
                        url: `${origin}/media-fixture/narration.wav`,
                        meta: {},
                    },
                },
                new AbortController().signal,
                { notice: (message) => window.testMediaNotices.push(message), link() {}, log() {} },
                { background: false, mediaPool: window.testMediaPool },
            );
        window.testAudioScene = await window.makeAudioScene();
        window.testAudioScene.start();
        const button = document.createElement('button');
        button.textContent = 'Cho phép âm thanh thử';
        button.addEventListener('click', () => window.testAudioScene.retryMedia());
        document.body.append(button);
    }, baseURL);
    await page.getByRole('button', { name: 'Cho phép âm thanh thử' }).click();
    await expect.poll(() => page.evaluate(() => window.testAudioElements[0].paused)).toBe(false);
    await page.evaluate(async () => {
        await window.testAudioScene.leave();
        window.testAudioScene.dispose();
        window.testMediaNotices = [];
        window.testAudioScene = await window.makeAudioScene();
        window.testAudioScene.start();
    });
    await expect.poll(() => page.evaluate(() => window.testAudioElements[0].paused)).toBe(false);
    expect(await page.evaluate(() => window.testAudioElements.length)).toBe(1);
    expect(await page.evaluate(() => window.testMediaNotices)).toEqual([]);
    await page.evaluate(() => {
        window.testAudioScene.dispose();
        window.testMediaPool.dispose();
    });
    expect(errors).toEqual([]);
});
