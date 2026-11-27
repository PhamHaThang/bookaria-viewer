import { expect, test } from '@playwright/test';
import { installViewerMocks } from './helpers/mock-viewer-api.mjs';

test.use({
    launchOptions: { args: ['--autoplay-policy=document-user-activation-required'] },
});

test.describe('Viewer: Camera Permission, MindAR Tracking, Media Autoplay & Interactions', () => {
    test('camera permission timing: no getUserMedia until allowed; denied recovery & fallback to screen reading', async ({
        page,
    }) => {
        await installViewerMocks(page, {
            arEnabled: true,
            mockArRuntime: true,
            denyCamera: true,
        });

        // 1. Entering welcome page must NOT trigger camera permission
        await page.goto('/b/sach-kham-pha');
        await expect(page.locator('#welcome-camera')).toBeVisible();
        expect(await page.evaluate(() => window.__mockArCameraCalls)).toBe(0);

        // 2. Clicking "Quét sách" opens permission screen, still 0 camera calls
        await page.locator('#welcome-camera').click();
        await expect(page.locator('#main')).toHaveAttribute('data-view', 'camera-access');
        expect(await page.evaluate(() => window.__mockArCameraCalls)).toBe(0);

        // 3. Clicking "Cho phép camera" calls getUserMedia -> denied -> shows instructions & retry button
        await page.locator('#camera-access-allow').click();
        await expect(page.locator('#main')).toHaveAttribute('data-camera-permission', 'denied');
        await expect(page.locator('#camera-access-title')).toHaveText('Camera chưa được cho phép');
        await expect(page.locator('#camera-access-help')).toBeVisible();
        await expect(page.locator('#camera-access-allow')).toHaveText('Thử lại');
        expect(await page.evaluate(() => window.__mockArCameraCalls)).toBe(1);

        // 4. Grant permission & enter AR tracking -> find marker -> short loss (<450ms) vs long loss (>450ms) -> return home stops camera
        await page.evaluate(() => {
            window.__mockArDenyCamera = false;
        });
        await page.locator('#camera-access-allow').click();
        await expect(page.locator('#main')).toHaveAttribute('data-view', 'ar');

        // Simulate MindAR detecting target 0 (Page 1)
        await page.evaluate(() => {
            window.__mockArTarget = 0;
        });
        await expect(page.locator('#reader-context')).toContainText('Trang 1');

        // Simulate engine holding stale matrix with isTracking=false (>450ms should hide scene & show scan guide)
        await page.evaluate(() => {
            window.__mockArTarget = null;
            window.__mockArHoldStaleMatrix = true;
        });
        await page.waitForTimeout(600);
        await expect(page.locator('#scan-guide')).toBeVisible();

        // Return to cover stops camera stream and disposes controller cleanly
        await page.locator('#home-link').click();
        await expect(page.locator('#main')).toHaveAttribute('data-view', 'welcome');
        await expect
            .poll(() => page.evaluate(() => window.__mockArCameraStops))
            .toBeGreaterThanOrEqual(1);
    });

    test('primes audio on entry click, supports mute toggle, and shows retry-media if unprimed', async ({
        page,
    }) => {
        await installViewerMocks(page, {
            arEnabled: false,
            withNarration: true,
        });

        await page.addInitScript(() => {
            window.__audioPlayCalls = [];
            const origPlay = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function () {
                if (this instanceof HTMLAudioElement) {
                    window.__audioPlayCalls.push({ src: this.src, muted: this.muted });
                    if (window.__forceAudioAutoplayBlock && !this.src.startsWith('data:audio/')) {
                        return Promise.reject(
                            new DOMException('Autoplay blocked', 'NotAllowedError'),
                        );
                    }
                }
                return origPlay.call(this);
            };
        });

        await page.goto('/b/sach-kham-pha');
        await expect(page.locator('#start')).toBeEnabled();
        await page.locator('#start').click();
        await expect(page.locator('#main')).toHaveAttribute('data-view', 'read');

        await expect
            .poll(() => page.evaluate(() => window.__audioPlayCalls.length))
            .toBeGreaterThan(0);

        // Mute & unmute toggle updates aria-pressed
        const muteBtn = page.locator('#mute');
        await muteBtn.click();
        await expect(muteBtn).toHaveAttribute('aria-pressed', 'true');
        await muteBtn.click();
        await expect(muteBtn).toHaveAttribute('aria-pressed', 'false');

        // Test autoplay block recovery UI (#retry-media) on reload when browser blocks playback
        await page.evaluate(() => {
            window.__forceAudioAutoplayBlock = true;
        });
        await page.locator('#reader-menu summary').click();
        await page.locator('#restart').click();
        await expect(page.locator('#retry-media')).toBeVisible();
        await page.evaluate(() => {
            window.__forceAudioAutoplayBlock = false;
        });
        await page.locator('#retry-media').click();
        await expect(page.locator('#retry-media')).toBeHidden();
    });

    test('external link confirmation dialog (openUrl action) blocks automatic redirect and opens safe tab', async ({
        page,
    }) => {
        await installViewerMocks(page, {
            arEnabled: false,
            withExternalLinkOnEnter: true,
            externalUrl: 'https://learn.example.com/bookaria/safe-destination',
        });

        await page.goto('/b/sach-kham-pha');
        await expect(page.locator('#start')).toBeEnabled();
        await page.locator('#start').click();

        const extDialog = page.getByRole('dialog', { name: 'Mở liên kết bên ngoài?', exact: true });
        await expect(extDialog).toBeVisible();
        await expect(extDialog).toContainText('learn.example.com');
        const linkEl = extDialog.getByRole('link', { name: /Mở liên kết|Tiếp tục/i });
        await expect(linkEl).toHaveAttribute('rel', /noopener/);
        await expect(linkEl).toHaveAttribute('target', '_blank');
    });
});
