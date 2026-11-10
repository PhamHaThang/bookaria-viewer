import { expect, test } from '@playwright/test';

const token = 'r'.repeat(32);
const id = (n) => `77777777-7777-4777-8777-${String(n).padStart(12, '0')}`;
const time = '2026-11-10T00:00:00.000Z';

function manifest(origin, name, n = 0) {
    return {
        schemaVersion: 1,
        bookId: id(90 + n),
        version: 1,
        title: name,
        trackerEngine: 'mindar',
        generatedAt: time,
        assets: {},
        targetGroups: [],
        credits: [],
        pages: [1, 2].map((i) => ({
            pageId: id(n * 10 + i),
            title: `Trang ${i}`,
            aspect: 1.4,
            imageUrl: `${origin}/router-fixture/paper.png`,
            thumbnailUrl: `${origin}/router-fixture/paper.png`,
            marker: { mode: 'NONE' },
            settings: {},
            scene: { schemaVersion: 1, objects: [], interactions: [] },
        })),
    };
}

async function install(page, baseURL, options = {}) {
    const counts = {};
    let release;
    let waiting = false;
    await page.route('**/api/v1/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (route.request().method() !== 'GET') return route.fulfill({ status: 204 });
        if (path.includes('/previews/'))
            return route.fulfill({
                json: { data: manifest(baseURL, 'Preview', 2) },
                headers: {
                    Expires: new Date(Date.now() + (options.expiresIn ?? 60000)).toUTCString(),
                },
            });
        const slug = path.split('/').at(-1);
        const n = slug === 'beta' ? 1 : 0;
        return route.fulfill({
            json: {
                data: {
                    slug,
                    title: slug,
                    description: null,
                    author: { id: id(95), displayName: 'Bookaria' },
                    coverUrl: null,
                    language: 'vi',
                    ageMin: null,
                    ageMax: null,
                    version: { id: id(96 + n), versionNo: 1, publishedAt: time },
                    manifestUrl: `${baseURL}/router-fixture/${slug}.json`,
                    pageCount: 2,
                    arPageCount: 0,
                    downloadBytes: 0,
                    printPdfUrl: null,
                },
            },
        });
    });
    await page.route('**/router-fixture/*.json', async (route) => {
        const slug = new URL(route.request().url()).pathname.split('/').at(-1).replace('.json', '');
        counts[slug] = (counts[slug] || 0) + 1;
        if (options.hold === slug) {
            waiting = true;
            await new Promise((resolve) => {
                release = resolve;
            });
        }
        try {
            await route.fulfill({ json: manifest(baseURL, slug, slug === 'beta' ? 1 : 0) });
        } catch {
            /* A superseded route may have aborted the request. */
        }
    });
    await page.route('**/router-fixture/paper.png', (route) =>
        route.fulfill({
            contentType: 'image/png',
            body: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
                'base64',
            ),
        }),
    );
    return { counts, waiting: () => waiting, release: () => release?.() };
}

async function navigate(page, href) {
    await page.evaluate((to) => {
        document.getElementById('fixture-nav')?.remove();
        const link = document.createElement('a');
        link.id = 'fixture-nav';
        link.textContent = 'Đi tới fixture';
        link.href = to;
        link.style.cssText =
            'position:fixed;top:100px;left:0;z-index:99999;background:white;color:black';
        document.body.append(link);
    }, href);
    await page.locator('#fixture-nav').click();
    await page.locator('#fixture-nav').evaluate((link) => link.remove());
}

test('direct page links, page selection, back/forward and reload retain the requested page', async ({
    page,
    baseURL,
}) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const fixture = await install(page, baseURL);
    await page.goto('/b/alpha/p/2');
    await expect(page.locator('#reader-context')).toHaveText('Trang 2 / 2');
    await expect(page.locator('#main')).toHaveAttribute('data-view', 'read');
    await expect(page.locator('#reader-loading')).toBeHidden();
    await page.locator('#page-strip [data-page="0"]').click();
    await expect(page).toHaveURL(/\/b\/alpha\/p\/1$/);
    await page.goBack();
    await expect(page.locator('#reader-context')).toHaveText('Trang 2 / 2');
    await page.goForward();
    await expect(page.locator('#reader-context')).toHaveText('Trang 1 / 2');
    expect(fixture.counts.alpha).toBe(1);
    await page.reload();
    await expect(page.locator('#reader-context')).toHaveText('Trang 1 / 2');
    await navigate(page, '/b/alpha/p/99');
    await expect(page).toHaveURL(/\/b\/alpha\/p\/2$/);
    await navigate(page, '/b/alpha/p/1.5');
    await expect(page).toHaveURL(/\/b\/alpha\/p\/1$/);
    await navigate(page, '/b/alpha/read');
    await expect(page).toHaveURL(/\/b\/alpha\/p\/1$/);
    expect(errors).toEqual([]);
});

test('embedded Studio preview accepts only the current parent session and still renders and replies', async ({
    page,
    baseURL,
}) => {
    await page
        .context()
        .grantPermissions(['local-network-access'], { origin: 'http://localhost:5173' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await install(page, baseURL);
    const nonce = '88888888-8888-4888-8888-888888888888';
    await page.route('http://localhost:5173/router-studio', (route) =>
        route.fulfill({
            contentType: 'text/html',
            body: `<script>
            window.events=[];
            addEventListener('message', event => { if(event.origin === ${JSON.stringify(baseURL)}) events.push(event.data); });
        </script><iframe style="width:900px;height:700px" src="${baseURL}/embed#nonce=${nonce}&parent=http://localhost:5173"></iframe>`,
        }),
    );
    await page.goto('http://localhost:5173/router-studio');
    await expect
        .poll(() =>
            page.evaluate(() => window.events.some((event) => event.type === 'BOOKARIA_READY')),
        )
        .toBe(true);
    const book = manifest(baseURL, 'Studio preview');
    await page.evaluate(
        ({ origin, nonce, book }) => {
            document.querySelector('iframe').contentWindow.postMessage(
                {
                    type: 'BOOKARIA_PREVIEW',
                    nonce,
                    requestId: 1,
                    payload: { title: book.title, page: book.pages[0], assets: book.assets },
                },
                origin,
            );
        },
        { origin: baseURL, nonce, book },
    );
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('#start')).toBeEnabled();
    await frame.locator('#start').click();
    await expect(frame.locator('#main')).toHaveAttribute('data-view', 'read');
    await expect(frame.locator('#reader-loading')).toBeHidden();
    await expect
        .poll(() => page.evaluate(() => window.events.some((event) => event.status === 'started')))
        .toBe(true);
    await expect(frame.locator('#publication-info')).toBeHidden();
    expect(errors).toEqual([]);
});

test('navigation during one book load shares the load but renders the latest page', async ({
    page,
    baseURL,
}) => {
    const fixture = await install(page, baseURL, { hold: 'alpha' });
    await page.goto('/b/alpha/p/1');
    await expect.poll(fixture.waiting).toBe(true);
    await navigate(page, '/b/alpha/p/2');
    fixture.release();
    await expect(page.locator('#reader-context')).toHaveText('Trang 2 / 2');
    await expect(page.locator('#reader-loading')).toBeHidden();
    expect(fixture.counts.alpha).toBe(1);
});

test('changing book cancels the old load and leaving preview removes its expiration and publication controls', async ({
    page,
    baseURL,
}) => {
    const fixture = await install(page, baseURL, { hold: 'alpha', expiresIn: 1800 });
    await page.goto('/b/alpha/p/1');
    await expect.poll(fixture.waiting).toBe(true);
    await navigate(page, '/b/beta/p/2');
    await expect(page.locator('#reader-title')).toHaveText('beta');
    await expect(page.locator('#reader-context')).toHaveText('Trang 2 / 2');
    fixture.release();
    await navigate(page, `/preview/${token}/p/1`);
    await expect(page.locator('#reader-title')).toHaveText('Preview');
    await expect(page.locator('#publication-info')).toBeHidden();
    await expect(page.locator('#preview-badge')).toBeVisible();
    await navigate(page, '/b/beta/p/1');
    await expect(page.locator('#reader-title')).toHaveText('beta');
    await expect(page.locator('#preview-badge')).toBeHidden();
    await page.waitForTimeout(2000);
    await expect(page.locator('#main')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#reader-title')).toHaveText('beta');
    await navigate(page, '/');
    await expect(page.locator('#empty-entry')).toBeVisible();
    await expect(page.locator('#controls')).toBeHidden();
    await expect(page.locator('#viewport canvas')).toHaveCount(0);
});

test('preview expiration disables content and retry; malformed URL shows a controlled fallback', async ({
    page,
    baseURL,
}) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await install(page, baseURL, { expiresIn: 2200 });
    await page.goto(`/preview/${token}/p/2`);
    await expect(page.locator('#main')).toHaveAttribute('data-view', 'read');
    await expect(page.locator('#start')).toBeDisabled();
    await expect(page.locator('#main')).toHaveAttribute('data-ready', 'false');
    await expect(page.locator('#viewport canvas')).toHaveCount(0);
    // Vite rejects malformed percent encodings before serving the SPA; use an unknown app path.
    await page.goto('/unknown-route');
    await expect(page.locator('#reader-loading')).toBeHidden();
    await expect(page.locator('#status')).toContainText('Không tìm thấy');
    expect(errors).toEqual([]);
});
