import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/browser',
    testMatch: '**/*.spec.mjs',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list'], ['json', { outputFile: 'test-results/ar-report.json' }]],
    timeout: 180000,
    expect: { timeout: 20000 },
    use: {
        baseURL: 'https://localhost:5184',
        ignoreHTTPSErrors: true,
        viewport: { width: 800, height: 600 },
        channel: process.env.AR_BROWSER_CHANNEL || 'chrome',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: {
        command: 'pnpm dev --port 5184',
        url: 'https://localhost:5184',
        ignoreHTTPSErrors: true,
        reuseExistingServer: !process.env.CI,
    },
});
