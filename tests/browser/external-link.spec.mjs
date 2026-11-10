import { expect, test } from '@playwright/test';

const destination = `https://learn.example.com/tai-lieu/${'bai-hoc-dai-'.repeat(35)}?chuong=1#noi-dung`;

async function install(page, baseURL) {
    const id = (n) => `55555555-5555-4555-8555-${String(n).padStart(12, '0')}`;
    const time = '2026-11-07T00:00:00.000Z';
    const pages = [1, 2].map((n) => ({
        pageId: id(n),
        title: `Trang ${n}`,
        aspect: 1.4,
        imageUrl: `${baseURL}/external-test/paper.png`,
        thumbnailUrl: `${baseURL}/external-test/paper.png`,
        marker: { mode: 'NONE' },
        settings: {},
        scene: {
            schemaVersion: 1,
            objects: [],
            interactions:
                n === 1
                    ? [
                          {
                              id: 'open',
                              trigger: { type: 'onPageEnter' },
                              actions: [{ type: 'openUrl', url: destination }],
                          },
                      ]
                    : [],
        },
    }));
    const manifest = {
        schemaVersion: 1,
        bookId: id(90),
        version: 1,
        title: 'Sách có liên kết',
        trackerEngine: 'mindar',
        generatedAt: time,
        pages,
        assets: {},
        targetGroups: [],
        credits: [],
    };
    const info = {
        slug: 'external-test',
        title: manifest.title,
        description: null,
        author: { id: id(91), displayName: 'Bookaria' },
        coverUrl: null,
        language: 'vi',
        ageMin: null,
        ageMax: null,
        version: { id: id(92), versionNo: 1, publishedAt: time },
        manifestUrl: `${baseURL}/external-test/manifest.json`,
        pageCount: 2,
        arPageCount: 0,
        downloadBytes: 0,
        printPdfUrl: null,
    };
    await page.route('**/api/v1/**', (route) =>
        route.request().method() === 'GET'
            ? route.fulfill({ json: { data: info } })
            : route.fulfill({ status: 204 }),
    );
    await page.route('**/external-test/manifest.json', (route) =>
        route.fulfill({ json: manifest }),
    );
    await page.route('**/external-test/paper.png', (route) =>
        route.fulfill({
            contentType: 'image/png',
            body: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
                'base64',
            ),
        }),
    );
    await page.goto('/b/external-test');
    await expect(page.locator('#start')).toBeEnabled();
    await page.locator('#start').click();
    await expect(
        page.getByRole('dialog', { name: 'Mở liên kết bên ngoài?', exact: true }),
    ).toBeVisible();
}
async function reopen(page) {
    await page.locator('#reader-menu summary').click();
    await page.locator('#restart').click();
    await expect(page.locator('#external-link')).toBeVisible();
}

for (const setup of [
    { name: 'phone-light', width: 390, height: 844, theme: 'light' },
    { name: 'small-dark', width: 320, height: 568, theme: 'dark' },
    { name: 'landscape-dark', width: 844, height: 390, theme: 'dark' },
    { name: 'desktop-light', width: 1440, height: 900, theme: 'light' },
]) {
    test(`external link ${setup.name}: destination, long address, keyboard and native new tab`, async ({
        page,
        context,
        baseURL,
    }, info) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.setViewportSize({ width: setup.width, height: setup.height });
        await page.addInitScript(
            (theme) => localStorage.setItem('bookaria.theme', theme),
            setup.theme,
        );
        await context.route('https://learn.example.com/**', (route) =>
            route.fulfill({
                contentType: 'text/html',
                body: '<title>Trang đích thử</title><p>Đã mở liên kết thử.</p>',
            }),
        );
        await install(page, baseURL);
        const dialog = page.locator('#external-link');
        await expect(page.locator('#external-link-host')).toHaveText('learn.example.com');
        await expect(page.locator('#external-link-address')).toHaveText(destination);
        await expect(page.locator('#link')).toHaveText('Mở liên kết');
        await expect(page.locator('#dismiss-link')).toBeFocused();
        const geometry = await dialog.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const buttons = [...element.querySelectorAll('button,a')].map((button) =>
                button.getBoundingClientRect(),
            );
            return {
                horizontalOverflow: element.scrollWidth - element.clientWidth,
                insideViewport:
                    rect.left >= 0 &&
                    rect.top >= 0 &&
                    rect.right <= innerWidth &&
                    rect.bottom <= innerHeight,
                controlsInside: buttons.every(
                    (button) =>
                        button.left >= rect.left &&
                        button.right <= rect.right &&
                        button.bottom <= rect.bottom,
                ),
                touchTargets: buttons.every((button) => button.height >= 44),
                pageOverflow: document.documentElement.scrollWidth > innerWidth,
            };
        });
        expect(geometry).toEqual({
            horizontalOverflow: 0,
            insideViewport: true,
            controlsInside: true,
            touchTargets: true,
            pageOverflow: false,
        });
        await page.screenshot({ path: info.outputPath(`external-link-${setup.name}.png`) });
        await page.keyboard.press('Tab');
        await expect(page.locator('#link')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(page.locator('#viewport canvas')).toBeFocused();
        await reopen(page);
        await page.locator('#dismiss-link').click();
        await expect(dialog).toBeHidden();
        await reopen(page);
        await page.getByRole('button', { name: 'Đóng liên kết bên ngoài', exact: true }).click();
        await expect(dialog).toBeHidden();
        await reopen(page);
        await page.mouse.click(8, 8);
        await expect(dialog).toBeHidden();
        await reopen(page);
        const popupPromise = page.waitForEvent('popup');
        await page.locator('#link').click();
        const popup = await popupPromise;
        await popup.waitForLoadState();
        expect(popup.url()).toBe(destination);
        expect(await popup.evaluate(() => window.opener)).toBe(null);
        await expect(dialog).toBeHidden();
        await popup.close();
        expect(page.url()).toContain('/b/external-test');
        expect(errors).toEqual([]);
    });
}
