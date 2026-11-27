import { defineConfig } from '@playwright/test';

const viewerBaseUrl = process.env.VIEWER_BASE_URL;
const isLocal = !viewerBaseUrl;

export default defineConfig({
    testDir: './tests/online',
    testMatch: '**/*.spec.mjs',
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    timeout: 90_000,
    expect: { timeout: 15_000 },
    reporter: [['list'], ['json', { outputFile: 'test-results/online-viewer-report.json' }]],
    use: {
        baseURL: viewerBaseUrl || 'https://localhost:5186',
        ignoreHTTPSErrors: isLocal || process.env.IGNORE_HTTPS_ERRORS === '1',
        viewport: { width: 1280, height: 800 },
        channel: process.env.AR_BROWSER_CHANNEL || 'chrome',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: isLocal
        ? {
              command: './node_modules/.bin/vite --port 5186',
              url: 'https://localhost:5186',
              ignoreHTTPSErrors: true,
              reuseExistingServer: !process.env.CI,
              timeout: 60_000,
          }
        : undefined,
});
