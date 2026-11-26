import { expect, test } from '@playwright/test';
import { installViewerMocks } from './helpers/mock-viewer-api.mjs';

const PREVIEW_TOKEN = 'p'.repeat(32);
const EMBED_PARENT_ORIGIN =
    process.env.EMBED_PARENT_ORIGIN ||
    (process.env.STUDIO_BASE_URL
        ? new URL(process.env.STUDIO_BASE_URL).origin
        : 'http://localhost:5173');

test.describe('Viewer: Published, 24h Preview, Embed Bridge, Telemetry & Reporting', () => {
    test('published overview, reading navigation, clamping, TOC, version mismatch detection & unavailable handling', async ({
        page,
    }) => {
        const mock = await installViewerMocks(page, { arEnabled: false });

        // 1. Open published overview
        await page.goto('/b/sach-kham-pha');
        await expect(page.locator('#title')).toHaveText('Sách Khám Phá Online');
        await expect(page.locator('#start')).toBeEnabled();

        // Check info dialog + credits + Print PDF link
        await page.locator('#book-info').click();
        const infoDialog = page.locator('#info-dialog');
        await expect(infoDialog).toBeVisible();
        await expect(infoDialog.locator('#credits')).toContainText('CC-BY-4.0');
        await expect(infoDialog.locator('#published-pdf')).toBeVisible();
        await infoDialog.locator('[data-close-dialog]').click();

        // 2. Start reading -> loads page 1 -> switch page via TOC & clamping
        await page.locator('#start').click();
        await expect(page.locator('#main')).toHaveAttribute('data-view', 'read');
        await expect(page.locator('#reader-context')).toHaveText('Trang 1 / 2');

        await page.locator('#contents').click();
        await expect(page.locator('#contents-dialog')).toBeVisible();
        await page.locator('#page-grid button').nth(1).click();
        await expect(page).toHaveURL(/\/b\/sach-kham-pha\/p\/2$/);
        await expect(page.locator('#reader-context')).toHaveText('Trang 2 / 2');

        // Out-of-bounds page clamps to page 2
        await page.goto('/b/sach-kham-pha/p/99');
        await expect(page).toHaveURL(/\/b\/sach-kham-pha\/p\/2$/);

        // 3. Author publishes a new version -> visibilitychange triggers availability recheck
        mock.bumpPublishedVersion(2);
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: false });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await expect(page.locator('#status')).toContainText('Tác giả vừa xuất bản phiên bản mới');

        // 4. Unavailable book (410) shows clear fallback notice
        await page.goto('/b/not-found');
        await expect(page.locator('#status')).toContainText('Chưa mở được sách đã xuất bản.');
        await expect(page.locator('#retry')).toBeVisible();
    });

    test('24h temporary preview: badge, page switching, automatic expiration mid-session, and 404 token', async ({
        page,
    }) => {
        const mock = await installViewerMocks(page, {
            arEnabled: false,
            previewExpiresInMs: 300_000,
        });

        await page.goto(`/preview/${PREVIEW_TOKEN}`);
        await expect(page.locator('#welcome-kind')).toHaveText('Bản xem trước');
        await expect(page.locator('#preview-badge')).toBeHidden();
        await expect(page.locator('#subtitle')).toContainText('Bản xem trước tạm thời');
        await expect(page.locator('#start')).toBeEnabled();

        // Enter read mode -> #preview-badge becomes visible on the top bar & switch to page 2
        await page.locator('#start').click();
        await expect(page.locator('#main')).toHaveAttribute('data-view', 'read');
        await expect(page.locator('#preview-badge')).toBeVisible();
        await expect(page.locator('#reader-context')).toHaveText('Trang 1 / 2');

        await page.locator('#page-strip [data-page="1"]').click();
        await expect(page).toHaveURL(new RegExp(`/preview/${PREVIEW_TOKEN}/p/2$`));
        await expect(page.locator('#reader-context')).toHaveText('Trang 2 / 2');

        // Re-open with short lifetime and wait for automatic client-side expiry timer
        mock.setPreviewExpiresInMs(2500);
        await page.goto(`/preview/${PREVIEW_TOKEN}`);
        await expect(page.locator('#start')).toBeEnabled();
        await expect(page.locator('#status')).toContainText('Bản xem trước không còn khả dụng.', {
            timeout: 10000,
        });
        await expect(page.locator('#start')).toBeDisabled();

        // Expired token on fresh load (404)
        mock.expirePreview();
        await page.goto(`/preview/${PREVIEW_TOKEN}`);
        await expect(page.locator('#status')).toContainText('Chưa tải được bản xem trước.');
        await expect(page.locator('#retry')).toBeVisible();
    });

    test('embed Studio bridge (/embed): rejects untrusted parent, performs READY handshake, filters stale requestId, runs rules', async ({
        page,
        baseURL,
    }) => {
        await page
            .context()
            .grantPermissions(['local-network-access'], { origin: EMBED_PARENT_ORIGIN });
        await installViewerMocks(page, { arEnabled: false });

        // 1. Untrusted parent origin is blocked immediately
        await page.goto(
            '/embed#nonce=88888888-8888-4888-8888-888888888888&parent=https://evil.example',
        );
        await expect(page.locator('#status')).toContainText('Không mở được bản xem nhúng.');

        // 2. Trusted parent origin (matching VITE_STUDIO_ORIGIN) receives BOOKARIA_READY & renders payload
        const nonce = '88888888-8888-4888-8888-888888888888';
        await page.route(`${EMBED_PARENT_ORIGIN}/embed-host`, (route) =>
            route.fulfill({
                contentType: 'text/html',
                body: `<!doctype html><html><body>
<script>
window.__embedReplies = [];
window.addEventListener('message', (e) => {
    window.__embedReplies.push(e.data);
});
</script>
<iframe id="viewer-frame" style="width:900px;height:700px" src="${baseURL}/embed#nonce=${nonce}&parent=${EMBED_PARENT_ORIGIN}"></iframe>
</body></html>`,
            }),
        );

        await page.goto(`${EMBED_PARENT_ORIGIN}/embed-host`);
        await expect
            .poll(() => page.evaluate(() => window.__embedReplies.map((r) => r.type)))
            .toContain('BOOKARIA_READY');

        // Send preview payload from parent -> Viewer installs & replies loaded
        const frame = page.frameLocator('#viewer-frame');
        await page.evaluate(
            ({ n, origin }) => {
                const iframe = document.getElementById('viewer-frame');
                const send = (requestId, title) => {
                    iframe.contentWindow.postMessage(
                        {
                            type: 'BOOKARIA_PREVIEW',
                            nonce: n,
                            requestId,
                            payload: {
                                title,
                                page: {
                                    pageId: '55555555-5555-4555-8555-000000000001',
                                    title: 'Trang nhúng 1',
                                    aspect: 1.4,
                                    imageUrl: 'https://mock-cdn.bookaria.test/media/page-1.png',
                                    thumbnailUrl: 'https://mock-cdn.bookaria.test/media/page-1.png',
                                    marker: { mode: 'NONE' },
                                    settings: {},
                                    scene: { schemaVersion: 1, objects: [], interactions: [] },
                                },
                                assets: {},
                            },
                        },
                        origin,
                    );
                };
                send(5, 'Trang xem nhúng Live');
                // Stale requestId (< 5) must be ignored
                send(3, 'Trang cũ bị bỏ qua');
            },
            { n: nonce, origin: new URL(baseURL).origin },
        );

        await expect(frame.locator('#title')).toHaveText('Trang xem nhúng Live');
        await expect
            .poll(() =>
                page.evaluate(() => window.__embedReplies.some((r) => r.status === 'loaded')),
            )
            .toBe(true);
    });

    test('anonymous reading telemetry flush on pagehide & violation report form (201 & 429)', async ({
        page,
    }) => {
        const mock = await installViewerMocks(page, { arEnabled: false });

        await page.goto('/b/sach-kham-pha');
        await page.locator('#start').click();
        await expect(page.locator('#main')).toHaveAttribute('data-view', 'read');

        // Trigger pagehide to flush queued OPEN event batch
        await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
        await expect.poll(() => mock.state.eventsBatches.length).toBeGreaterThanOrEqual(1);
        expect(mock.state.eventsBatches[0].events.some((e) => e.type === 'OPEN')).toBe(true);

        // Open violation report menu -> test 429 rate limit then 201 success
        await page.locator('#reader-menu summary').click();
        await page.locator('#report-menu').click();
        const reportDialog = page.locator('#report-dialog');
        await expect(reportDialog).toBeVisible();

        mock.injectFault({
            method: 'POST',
            match: /\/public\/books\/[^/]+\/reports$/,
            status: 429,
            code: 'RATE_LIMITED',
            message: 'Bạn gửi báo cáo quá nhanh.',
        });
        await reportDialog.locator('#report-reason').selectOption('COPYRIGHT');
        await reportDialog.locator('#report-note').fill('Kiểm thử báo cáo vi phạm.');
        await reportDialog.locator('#report-form button[type="submit"]').click();
        await expect(reportDialog.locator('#report-feedback')).toContainText(
            /quá nhanh|Chưa gửi được/i,
        );

        // Retry succeeds (201)
        await reportDialog.locator('#report-form button[type="submit"]').click();
        await expect(reportDialog.locator('#report-feedback')).toContainText('Đã nhận báo cáo');
        expect(mock.state.reports).toHaveLength(1);
        expect(mock.state.reports[0].reason).toBe('COPYRIGHT');
    });
});
