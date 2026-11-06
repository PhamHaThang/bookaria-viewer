import { expect, test } from '@playwright/test';

async function installBook(page, baseURL) {
    const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const assetId = id(50),
        time = '2026-11-06T00:00:00.000Z';
    const pages = [1, 2].map((n) => ({
        pageId: id(n),
        title: `Trang thử ${n}`,
        aspect: 1.4,
        imageUrl: `${baseURL}/reader-layout/paper.png`,
        thumbnailUrl: `${baseURL}/reader-layout/paper.png`,
        marker: { mode: 'CUSTOM_MARKER' },
        group: 0,
        targetIndex: n - 1,
        settings: {},
        scene: {
            schemaVersion: 1,
            interactions: [],
            objects: [
                {
                    id: 'car',
                    name: 'Xe',
                    type: 'model',
                    assetId,
                    visible: true,
                    transform: { position: [0, 0, 0.1], rotation: [90, 0, 0], scale: [1, 1, 1] },
                    controls: { enabled: true, autoRotate: false },
                },
            ],
        },
    }));
    const manifest = {
        schemaVersion: 1,
        bookId: id(90),
        version: 1,
        title: 'Đọc sách tương tác',
        trackerEngine: 'mindar',
        generatedAt: time,
        pages,
        assets: {
            [assetId]: { type: 'MODEL', url: `${baseURL}/reader-layout/model.gltf`, size: 1000 },
        },
        targetGroups: [
            {
                group: 0,
                mindUrl: `${baseURL}/reader-layout/group.mind`,
                pageIds: pages.map((page) => page.pageId),
            },
        ],
        credits: [],
    };
    const info = {
        slug: 'mobile-layout',
        title: manifest.title,
        description: null,
        author: { id: id(91), displayName: 'Bookaria' },
        coverUrl: null,
        language: 'vi',
        ageMin: null,
        ageMax: null,
        version: { id: id(92), versionNo: 1, publishedAt: time },
        manifestUrl: `${baseURL}/reader-layout/manifest.json`,
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
    await page.route('**/reader-layout/manifest.json', (route) =>
        route.fulfill({ json: manifest }),
    );
    const data = Buffer.from(new Float32Array([-0.1, 0, 0, 0.1, 0, 0, 0, 0.2, 0.1]).buffer);
    const gltf = {
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
        materials: [{ doubleSided: true }],
        buffers: [
            {
                uri: `data:application/octet-stream;base64,${data.toString('base64')}`,
                byteLength: data.length,
            },
        ],
        bufferViews: [{ buffer: 0, byteLength: data.length, target: 34962 }],
        accessors: [
            {
                bufferView: 0,
                componentType: 5126,
                count: 3,
                type: 'VEC3',
                min: [-0.1, 0, 0],
                max: [0.1, 0.2, 0.1],
            },
        ],
    };
    await page.route('**/reader-layout/model.gltf', (route) => route.fulfill({ json: gltf }));
    const paper = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 2;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Missing canvas context');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, 2, 2);
        return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.route('**/reader-layout/paper.png', (route) =>
        route.fulfill({
            contentType: 'image/png',
            body: Buffer.from(paper, 'base64'),
        }),
    );
}
for (const setup of [
    { name: 'phone light', width: 390, height: 844, touch: true, theme: 'light' },
    { name: 'phone dark', width: 390, height: 844, touch: true, theme: 'dark' },
    { name: 'small phone', width: 320, height: 568, touch: true, theme: 'light' },
    { name: 'phone landscape', width: 844, height: 390, touch: true, theme: 'dark' },
    { name: 'desktop', width: 1440, height: 900, touch: false, theme: 'light' },
]) {
    test.describe(setup.name, () => {
        test.use({
            viewport: { width: setup.width, height: setup.height },
            hasTouch: setup.touch,
            isMobile: setup.touch,
        });
        test('reader layout keeps controls clear and contents navigation available', async ({
            page,
            baseURL,
        }, info) => {
            await page.addInitScript(
                (theme) => localStorage.setItem('bookaria.theme', theme),
                setup.theme,
            );
            await installBook(page, baseURL);
            await page.goto('/b/mobile-layout');
            await expect(page.locator('#main')).toHaveAttribute('data-ready', 'true');
            await page.locator('#start').click();
            await expect(page.locator('#main')).toHaveAttribute('data-view', 'read');
            await expect(page.locator('#reader-loading')).toBeHidden();
            const pad = page.getByRole('group', { name: 'Joystick di chuyển mô hình' });
            if (setup.touch) {
                await expect(page.locator('#page-strip')).toBeHidden();
                await expect(pad).toBeVisible();
                const box = await pad.boundingBox();
                expect(Math.abs(box.x + box.width / 2 - setup.width / 2)).toBeLessThan(1);
                expect(setup.height - box.y - box.height).toBeGreaterThanOrEqual(7);
                expect(setup.height - box.y - box.height).toBeLessThan(18);
                await expect(page.locator('#status')).toContainText('Kéo joystick');
                const hint = await page.locator('#reading-status').boundingBox();
                expect(hint.y + hint.height).toBeLessThanOrEqual(box.y - 8);
                const right = await page.locator('#camera').boundingBox();
                expect(right.x + right.width / 2).toBeGreaterThan(setup.width - 45);
                await page.screenshot({ path: info.outputPath('mobile-controls.png') });
                const touch = await page.context().newCDPSession(page);
                await touch.send('Input.dispatchTouchEvent', {
                    type: 'touchStart',
                    touchPoints: [{ x: box.x + box.width / 2 + 28, y: box.y + box.height / 2 }],
                });
                await expect(page.locator('#reading-status')).toBeHidden();
                await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            } else {
                await expect(page.locator('#page-strip')).toBeVisible();
                await expect(pad).toBeHidden();
                await expect(page.locator('#status')).toContainText('WASD');
                await page.screenshot({ path: info.outputPath('desktop-controls.png') });
            }
            await page.getByRole('button', { name: 'Mục lục', exact: true }).click();
            const contents = page.getByRole('dialog', { name: 'Mục lục', exact: true });
            await expect(contents).toBeVisible();
            await contents
                .getByRole('button', { name: 'Trang 2: Trang thử 2', exact: true })
                .click();
            await expect(page.locator('#reader-context')).toHaveText('Trang 2 / 2');
            await expect(page.locator('#reader-loading')).toBeHidden();
            expect(
                await page.evaluate(
                    () =>
                        document.documentElement.scrollWidth <= innerWidth &&
                        document.documentElement.scrollHeight <= innerHeight,
                ),
            ).toBe(true);
        });
    });
}
