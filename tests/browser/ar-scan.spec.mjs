import { expect, test } from '@playwright/test';
import { installMarkerRoutes, markerFixture } from './marker-fixture.mjs';

let fixture;
test.beforeAll(async () => {
    fixture = await markerFixture();
});
test.beforeEach(async ({ page }) => {
    await installMarkerRoutes(page, fixture);
});

for (const groupCount of [2, 1]) {
    test(`${groupCount} groups: 20 real markers, identity, cross-group search, loss, reacquisition and disposal`, async ({
        page,
    }, testInfo) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto('/');
        await page.evaluate(async (groupCount) => {
            window.__arWrong = [];
            window.__arGroupCount = groupCount;
            window.__arLastPose = null;
            window.__arFoundAt = 0;
            const { startTracking } = await import('/src/tracker/mindar.ts');
            window.__arAbort = new AbortController();
            window.__arSession = await startTracking(
                document.createElement('div'),
                groupCount === 1
                    ? [{ group: 0, url: '/ar-test/group/2.mind' }]
                    : [0, 1].map((group) => ({ group, url: `/ar-test/group/${group}.mind` })),
                0,
                window.__arAbort.signal,
                {
                    resize() {},
                    searching() {
                        window.__arLastPose = null;
                    },
                    issue(message) {
                        window.__arWrong.push({ error: message });
                    },
                    update(group, target, matrix) {
                        window.__arLastPose = matrix ? { group, target } : null;
                        const number = group * 10 + target + 1;
                        if (matrix && number === window.__arExpected && !window.__arFoundAt)
                            window.__arFoundAt = performance.now();
                        if (matrix && window.__arExpected && number !== window.__arExpected)
                            window.__arWrong.push({
                                expected: window.__arExpected,
                                actual: number,
                            });
                    },
                },
            );
        }, groupCount);
        const results = [];
        // Start with group 1 while group 0 is loaded. Then visit both groups and all 20 IDs.
        const order = [20, 1, 11, 10, 2, 12, 3, 13, 4, 14, 5, 15, 6, 16, 7, 17, 8, 18, 9, 19];
        try {
            for (const number of order) {
                await page.evaluate(() => {
                    window.__arExpected = 0;
                    window.__arMarker = 0;
                });
                await expect.poll(() => page.evaluate(() => window.__arLastPose)).toBeNull();
                await page.evaluate((number) => {
                    window.__arExpected = number;
                    window.__arAngle = number % 2 ? 10 : -10;
                    window.__arScale = number % 3 ? 1 : 0.85;
                    window.__arMarker = number;
                    window.__arStarted = performance.now();
                    window.__arFoundAt = 0;
                    if (number !== 20 && number % 3 === 0)
                        window.__arSession.prefer(
                            window.__arGroupCount === 1 ? 0 : Math.floor((number - 1) / 10),
                        );
                }, number);
                await expect
                    .poll(() => page.evaluate(() => window.__arLastPose))
                    .toEqual({
                        group: groupCount === 1 ? 0 : Math.floor((number - 1) / 10),
                        target: groupCount === 1 ? number - 1 : (number - 1) % 10,
                    });
                results.push(
                    await page.evaluate(
                        (number) => ({
                            marker: number,
                            ms: Math.round(window.__arFoundAt - window.__arStarted),
                            angle: window.__arAngle,
                            scale: window.__arScale,
                        }),
                        number,
                    ),
                );
                // Keep the pose visible through several subsequent frame callbacks.
                await page.waitForTimeout(250);
                expect(await page.evaluate(() => window.__arWrong)).toEqual([]);
            }
            expect(await page.evaluate(() => window.__arCameraCalls)).toBe(1);
            expect(await page.evaluate(() => window.__arControllers.length)).toBe(1);
        } finally {
            await page.evaluate(() => {
                window.__arExpected = 0;
                window.__arAbort.abort();
                window.__arSession.stop();
            });
            console.info(
                `AR ${groupCount} groups marker times (synthetic camera):`,
                JSON.stringify(results),
            );
            await testInfo.attach('marker-times', {
                body: JSON.stringify(results, null, 2),
                contentType: 'application/json',
            });
        }
        await expect
            .poll(() =>
                page.evaluate(() =>
                    window.__arControllers.every((controller) =>
                        controller.__arTargets.every((tracker) =>
                            [
                                ...tracker.featurePointsListT,
                                ...tracker.imagePixelsListT,
                                ...tracker.imagePropertiesListT,
                            ].every((tensor) => tensor.isDisposedInternal),
                        ),
                    ),
                ),
            )
            .toBe(true);
        expect(await page.evaluate(() => window.__arCameraStops)).toBe(1);
        expect(errors).toEqual([]);
    });
}

for (const presentation of [
    {
        name: 'desktop-light',
        viewport: { width: 1280, height: 800 },
        colorScheme: 'light',
        reducedMotion: 'no-preference',
    },
    {
        name: 'mobile-dark',
        viewport: { width: 390, height: 664 },
        colorScheme: 'dark',
        reducedMotion: 'reduce',
    },
]) {
    test(`reader: ${presentation.name} permission, AR loading, render, exit and denied recovery`, async ({
        page,
        baseURL,
    }, testInfo) => {
        await page.setViewportSize(presentation.viewport);
        await page.emulateMedia({
            colorScheme: presentation.colorScheme,
            reducedMotion: presentation.reducedMotion,
        });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const id = (number) => `22222222-2222-4222-8222-${String(number).padStart(12, '0')}`;
        const time = '2026-11-03T00:00:00.000Z';
        const assetId = id(50);
        const slowA = id(51);
        const slowB = id(52);
        const pages = Array.from({ length: 20 }, (_, index) => ({
            pageId: id(index + 1),
            title: `Marker ${index + 1}`,
            aspect: 1,
            imageUrl: `${baseURL}/ar-test/paper/${index + 1}.png`,
            thumbnailUrl: `${baseURL}/ar-test/marker/${index + 1}.png`,
            group: Math.floor(index / 10),
            targetIndex: index % 10,
            marker: { mode: 'CUSTOM_MARKER' },
            settings: {},
            scene: {
                schemaVersion: 1,
                objects: [
                    {
                        id: 'ar-visible-image',
                        name: 'Visible AR content',
                        type: 'image',
                        assetId: index === 2 ? slowA : index === 1 ? slowB : assetId,
                        visible: true,
                        opacity: 1,
                        transform: {
                            position: [0, 0, 0.05],
                            rotation: [0, 0, 0],
                            scale: [0.3, 0.3, 0.3],
                        },
                    },
                ],
                interactions: [],
            },
        }));
        const manifest = {
            schemaVersion: 1,
            bookId: id(90),
            version: 1,
            title: 'AR regression',
            trackerEngine: 'mindar',
            generatedAt: time,
            pages,
            credits: [],
            assets: {
                [assetId]: { type: 'IMAGE', url: `${baseURL}/ar-test/red.png`, size: 100 },
                [slowA]: { type: 'IMAGE', url: `${baseURL}/ar-test/slow-3.png`, size: 100 },
                [slowB]: { type: 'IMAGE', url: `${baseURL}/ar-test/slow-2.png`, size: 100 },
            },
            targetGroups: [0, 1].map((group) => ({
                group,
                mindUrl: `${baseURL}/ar-test/group/${group}.mind`,
                pageIds: pages.slice(group * 10, group * 10 + 10).map((page) => page.pageId),
            })),
        };
        const info = {
            slug: 'ar-regression',
            title: manifest.title,
            description: null,
            author: { id: id(91), displayName: 'AR test' },
            coverUrl: null,
            language: 'vi',
            ageMin: null,
            ageMax: null,
            version: { id: id(92), versionNo: 1, publishedAt: time },
            manifestUrl: `${baseURL}/ar-test/manifest.json`,
            pageCount: 20,
            arPageCount: 20,
            downloadBytes: 0,
            printPdfUrl: null,
        };
        await page.route('**/ar-test/manifest.json', (route) => route.fulfill({ json: manifest }));
        await page.route('**/api/v1/**', (route) =>
            route.request().method() === 'GET'
                ? route.fulfill({ json: { data: info } })
                : route.fulfill({ status: 204 }),
        );
        let paperRequests = 0;
        let sharedImageRequests = 0;
        let delayImage = false;
        let imagePending = false;
        let releaseImage;
        await page.route('**/ar-test/paper/*.png', (route) => {
            paperRequests++;
            return route.fulfill({ status: 404 });
        });
        await page.route(/\/ar-test\/(?:red|slow-[23])\.png$/, async (route) => {
            const shared = new URL(route.request().url()).pathname.endsWith('/red.png');
            if (shared) sharedImageRequests++;
            if (delayImage && !shared) {
                imagePending = true;
                await new Promise((resolve) => {
                    releaseImage = resolve;
                });
                imagePending = false;
            }
            await route
                .fulfill({
                    contentType: 'image/png',
                    body: Buffer.from(
                        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
                        'base64',
                    ),
                })
                .catch(() => {}); // A cancelled page request may finish after its camera session ended.
        });
        await page.route('**/src/scene-core/Stage.ts*', async (route) => {
            const response = await route.fetch();
            await route.fulfill({
                response,
                body: (await response.text()).replace(
                    'this.renderer.setAnimationLoop(',
                    'window.__arStage=this;this.renderer.setAnimationLoop(',
                ),
            });
        });
        await page.goto('/b/ar-regression?mode=ar');
        await expect(page.locator('#start')).toBeEnabled();
        expect(await page.evaluate(() => window.__arCameraCalls)).toBe(0);
        await page.locator('#start').click();
        await expect(page.locator('#camera-access')).toBeVisible();
        expect(await page.evaluate(() => window.__arCameraCalls)).toBe(0);
        await page.evaluate(() => {
            window.__arMarker = 20;
        });
        await page.locator('#camera-access-allow').click();
        await expect(page.locator('#reader-context')).toHaveText('Trang 20 — Đã nhận diện');
        await expect(page.locator('#reader-loading')).toBeHidden();
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const stage = window.__arStage;
                    const object = stage?.anchor.getObjectByName('ar-visible-image');
                    if (!object || !stage.anchor.visible) return false;
                    stage.renderer.render(stage.scene, stage.camera);
                    const projected = object
                        .getWorldPosition(stage.camera.position.clone())
                        .project(stage.camera);
                    const gl = stage.renderer.getContext(),
                        canvas = stage.renderer.domElement;
                    const pixel = new Uint8Array(4);
                    gl.readPixels(
                        Math.round(((projected.x + 1) * canvas.width) / 2),
                        Math.round(((projected.y + 1) * canvas.height) / 2),
                        1,
                        1,
                        gl.RGBA,
                        gl.UNSIGNED_BYTE,
                        pixel,
                    );
                    return pixel[0] > 200 && pixel[1] < 60 && pixel[2] < 60 && pixel[3] > 200;
                }),
            )
            .toBe(true);
        await page.waitForTimeout(2000);
        await expect(page.locator('#reader-context')).toHaveText('Trang 20 — Đã nhận diện');
        const grace = await page.evaluate(async () => {
            const controller = window.__arControllers[0];
            const update = controller.onUpdate;
            const root = window.__arStage.anchor.children[0];
            const runtime = window.__arStage.runtime;
            const calls = { start: 0, resume: 0, markerFound: 0, markerLost: 0 };
            const methods = Object.fromEntries(
                Object.keys(calls).map((key) => [key, runtime[key]]),
            );
            for (const key of Object.keys(calls))
                runtime[key] = (...args) => {
                    calls[key]++;
                    return methods[key].apply(runtime, args);
                };
            const before = window.__arStage.anchor.matrix.toArray();
            controller.onUpdate = (data) => {
                if (data.type !== 'updateMatrix') return update(data);
                const state = controller.trackingStates[9];
                const tracking = state.isTracking;
                state.isTracking = false;
                try {
                    update({ ...data, targetIndex: 9, worldMatrix: state.trackingMatrix });
                } finally {
                    state.isTracking = tracking;
                }
            };
            try {
                controller.onUpdate({ type: 'updateMatrix', targetIndex: 9 });
                await new Promise((resolve) => setTimeout(resolve, 220));
                const held = {
                    visible: window.__arStage.anchor.visible,
                    found: document.getElementById('main').dataset.tracking,
                    sameScene: window.__arStage.anchor.children[0] === root,
                    samePose:
                        JSON.stringify(before) ===
                        JSON.stringify(window.__arStage.anchor.matrix.toArray()),
                };
                controller.onUpdate = update;
                await new Promise((resolve) => setTimeout(resolve, 100));
                return { ...held, calls };
            } finally {
                controller.onUpdate = update;
                for (const key of Object.keys(calls)) runtime[key] = methods[key];
            }
        });
        expect(grace).toEqual({
            visible: true,
            found: 'found',
            sameScene: true,
            samePose: true,
            calls: { start: 0, resume: 0, markerFound: 0, markerLost: 0 },
        });
        await expect(page.locator('#reader-context')).toHaveText('Trang 20 — Đã nhận diện');
        const realLoss = await page.evaluate(async () => {
            const controller = window.__arControllers[0];
            const update = controller.onUpdate;
            controller.onUpdate = (data) => {
                if (data.type !== 'updateMatrix') return update(data);
                const state = controller.trackingStates[9];
                const tracking = state.isTracking;
                state.isTracking = false;
                try {
                    update({ ...data, targetIndex: 9, worldMatrix: state.trackingMatrix });
                } finally {
                    state.isTracking = tracking;
                }
            };
            try {
                controller.onUpdate({ type: 'updateMatrix', targetIndex: 9 });
                await new Promise((resolve) => setTimeout(resolve, 550));
                return window.__arStage.anchor.visible;
            } finally {
                controller.onUpdate = update;
            }
        });
        expect(realLoss).toBe(false);
        await expect(page.locator('#reader-context')).toHaveText('Trang 20 — Đã nhận diện');

        expect(await page.evaluate(() => window.__arCameraCalls)).toBe(1);
        expect(await page.evaluate(() => window.__arControllers.length)).toBe(1);
        expect(paperRequests).toBe(0);
        await page.evaluate(() => {
            window.__arCanvas = window.__arStage.renderer.domElement;
            window.__arBlockingLoads = [];
            const main = document.getElementById('main');
            window.__arLoadingObserver = new MutationObserver((records) => {
                for (const record of records)
                    if (record.attributeName === 'data-loading' && main.dataset.loading === 'true')
                        window.__arBlockingLoads.push(true);
            });
            window.__arLoadingObserver.observe(main, { attributes: true });
            window.__arMarker = 0;
        });
        await expect(page.locator('#scan-guide')).toBeVisible();
        delayImage = true;
        await page.evaluate(() => {
            window.__arMarker = 3;
        });
        await expect.poll(() => imagePending).toBe(true);
        await expect(page.locator('#page-loading')).toBeVisible();
        await expect(page.locator('#main')).toHaveAttribute('data-loading', 'false');
        await expect(page.locator('.camera-video')).toBeVisible();
        await expect(page.locator('#reader-menu')).toBeVisible();
        await expect(page.locator('#status')).toHaveText('');
        expect(await page.evaluate(() => window.__arBlockingLoads)).toEqual([]);
        const screenshot = testInfo.outputPath('loading-on-camera.png');
        await page.screenshot({ path: screenshot });
        await testInfo.attach('loading-on-camera', { path: screenshot, contentType: 'image/png' });
        expect(
            await page.evaluate(() => ({
                overflowX: document.documentElement.scrollWidth > innerWidth,
                overflowY: document.documentElement.scrollHeight > innerHeight,
            })),
        ).toEqual({ overflowX: false, overflowY: false });
        delayImage = false;
        releaseImage();
        await expect(page.locator('#reader-context')).toHaveText('Trang 3 — Đã nhận diện');
        await expect(page.locator('#page-loading')).toBeHidden();
        expect(
            await page.evaluate(() => window.__arStage.renderer.domElement === window.__arCanvas),
        ).toBe(true);
        expect(paperRequests).toBe(0);
        if (presentation.reducedMotion === 'reduce')
            expect(
                await page.evaluate(
                    () => window.__arStage.renderer.domElement.getAnimations().length,
                ),
            ).toBe(0);
        await page.evaluate(() => {
            window.__arMarker = 0;
        });
        await expect(page.locator('#scan-guide')).toBeVisible();
        await page.evaluate(() => {
            window.__arMarker = 20;
        });
        await expect(page.locator('#reader-context')).toHaveText('Trang 20 — Đã nhận diện');
        await expect(page.locator('#page-loading')).toBeHidden();
        expect(sharedImageRequests).toBe(1);
        await page.evaluate(() => {
            window.__arMarker = 0;
        });
        await expect(page.locator('#scan-guide')).toBeVisible();
        delayImage = true;
        await page.evaluate(() => {
            window.__arMarker = 2;
        });
        await expect.poll(() => imagePending).toBe(true);
        await expect(page.locator('#page-loading')).toBeVisible();
        await page.locator('#home-link').click();
        await expect(page.locator('#main')).toHaveAttribute('data-view', 'welcome');
        await expect(page.locator('.camera-video')).toHaveCount(0);
        expect(await page.evaluate(() => window.__arCameraStops)).toBe(1);
        delayImage = false;
        releaseImage();
        await expect(page.locator('#page-loading')).toBeHidden();
        await page.waitForTimeout(300);
        await expect(page.locator('#main')).toHaveAttribute('data-view', 'welcome');
        expect(await page.evaluate(() => window.__arBlockingLoads)).toEqual([]);
        await page.evaluate(() => window.__arLoadingObserver.disconnect());

        await page.evaluate(() => {
            window.__arDenyCamera = true;
        });
        await page.locator('#start').click();
        await page.locator('#camera-access-allow').click();
        await expect(page.locator('#main')).toHaveAttribute('data-camera-permission', 'denied');
        await page.locator('#camera-access-back').click();
        await expect(page.locator('#main')).toHaveAttribute('data-view', 'welcome');
        info.version = { id: id(93), versionNo: 2, publishedAt: time };
        manifest.version = 2;
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await expect(page.locator('#retry')).toBeVisible();
        await page.locator('#retry').click();
        await expect(page.locator('#start')).toBeEnabled();
        await page.evaluate(() => {
            window.__arDenyCamera = false;
            window.__arMarker = 20;
        });
        await page.locator('#start').click();
        await page.locator('#camera-access-allow').click();
        await expect(page.locator('#reader-context')).toHaveText('Trang 20 — Đã nhận diện');
        await expect(page.locator('#page-loading')).toBeHidden();
        expect(sharedImageRequests).toBe(2);
        await page.locator('#home-link').click();
        console.info(
            'Asset cache network requests:',
            JSON.stringify({
                sharedImageRequestsBeforeNewVersion: 1,
                sharedImageRequestsAfterNewVersion: sharedImageRequests,
            }),
        );
        expect(errors).toEqual([]);
    });
}

test('benchmark one 20-target group versus two 10-target groups without changing publication', async ({
    page,
}, testInfo) => {
    await page.goto('/');
    const timings = await page.evaluate(async () => {
        const { startTracking } = await import('/src/tracker/mindar.ts');
        const results = [];
        window.__arMarker = 20;
        for (const groupCount of [2, 1, 1, 2]) {
            const groups =
                groupCount === 1
                    ? [{ group: 0, url: '/ar-test/group/2.mind' }]
                    : [0, 1].map((group) => ({ group, url: `/ar-test/group/${group}.mind` }));
            const abort = new AbortController();
            const started = performance.now();
            let resolve;
            const recognized = new Promise((done) => {
                resolve = done;
            });
            let matched;
            const session = await startTracking(
                document.createElement('div'),
                groups,
                0,
                abort.signal,
                {
                    resize() {},
                    searching() {},
                    issue(message) {
                        resolve({ error: message });
                    },
                    update(group, target, matrix) {
                        if (matrix && !matched) {
                            matched = { group, target, at: performance.now() };
                            resolve(matched);
                        }
                    },
                },
            );
            const ready = performance.now();
            let deadline;
            try {
                const pose = await Promise.race([
                    recognized,
                    new Promise((_, reject) => {
                        deadline = setTimeout(
                            () => reject(new Error('Benchmark recognition timed out')),
                            30000,
                        );
                    }),
                ]);
                if (pose.error) throw new Error(pose.error);
                if (
                    pose.group !== (groupCount === 1 ? 0 : 1) ||
                    pose.target !== (groupCount === 1 ? 19 : 9)
                )
                    throw new Error('Wrong marker in benchmark');
                results.push({
                    groups: groupCount,
                    readyMs: Math.round(ready - started),
                    searchMs: Math.round(pose.at - ready),
                    totalMs: Math.round(pose.at - started),
                    targetTensorBytes: window.__arControllers.at(-1).__arTargets.at(-1)
                        ? ['featurePointsListT', 'imagePixelsListT', 'imagePropertiesListT']
                              .flatMap((key) => window.__arControllers.at(-1).tracker[key])
                              .reduce(
                                  (bytes, tensor) =>
                                      bytes + tensor.size * (tensor.dtype === 'bool' ? 1 : 4),
                                  0,
                              )
                        : 0,
                });
            } finally {
                clearTimeout(deadline);
                abort.abort();
                session.stop();
                await new Promise((done) => setTimeout(done, 1500));
            }
        }
        return results;
    });
    console.info('AR group comparison (synthetic camera):', JSON.stringify(timings));
    await testInfo.attach('group-comparison', {
        body: JSON.stringify(timings, null, 2),
        contentType: 'application/json',
    });
    expect(timings).toHaveLength(4);
    expect(await page.evaluate(() => window.__arCameraCalls)).toBe(4);
    expect(await page.evaluate(() => window.__arCameraStops)).toBe(4);
});
