import { expect, test } from '@playwright/test';
import { installMarkerRoutes, markerFixture } from './marker-fixture.mjs';

test('tracking probe: stationary jitter and camera motion with real MindAR', async ({
    page,
}, testInfo) => {
    const fixture = await markerFixture();
    await installMarkerRoutes(page, fixture);
    await page.goto('/');
    const results = await page.evaluate(async () => {
        const { startTracking } = await import('/src/tracker/mindar.ts');
        const results = [];
        const wait = (ms) => new Promise((done) => setTimeout(done, ms));
        for (const beta of [1000, 0.3, 0.1]) {
            window.__arTrackingOverrides = { filterMinCF: 0.001, filterBeta: beta };
            window.__arMarker = 1;
            window.__arAngle = 0;
            window.__arScale = 1;
            let phase = 'warmup',
                started = 0,
                projection = [];
            let found = false,
                losses = 0;
            const samples = [];
            window.__arDrawFrame = () => {
                const time = performance.now() - started;
                window.__arOffsetX =
                    phase === 'motion'
                        ? 32 * Math.sin((time / 1000) * 1.6)
                        : 1.2 * Math.sin(time * 0.04);
                window.__arOffsetY = 0;
                window.__arAngle =
                    phase === 'motion' ? 3 * Math.sin(time / 1000) : 0.12 * Math.sin(time * 0.021);
            };
            const abort = new AbortController();
            const session = await startTracking(
                document.createElement('div'),
                [{ group: 0, url: '/ar-test/group/0.mind' }],
                0,
                abort.signal,
                {
                    resize(matrix) {
                        projection = matrix;
                    },
                    searching() {},
                    issue(message) {
                        throw Error(message);
                    },
                    update(_group, _target, matrix, dimensions) {
                        if (!matrix) {
                            if (found) losses++;
                            return;
                        }
                        found = true;
                        const project = (x, y) => {
                            const wx = matrix[0] * x + matrix[4] * y + matrix[12];
                            const wy = matrix[1] * x + matrix[5] * y + matrix[13];
                            const wz = matrix[2] * x + matrix[6] * y + matrix[14];
                            return [
                                320 + ((projection[0] * wx) / -wz) * 320,
                                240 - ((projection[5] * wy) / -wz) * 240,
                            ];
                        };
                        const angle = (window.__arAngle * Math.PI) / 180;
                        samples.push({
                            phase,
                            time: performance.now() - started,
                            center: project(dimensions[0] / 2, dimensions[1] / 2),
                            corner: project(dimensions[0], dimensions[1]),
                            expectedX: 320 + window.__arOffsetX,
                            expectedCorner: [
                                320 +
                                    window.__arOffsetX +
                                    200 * (Math.cos(angle) + Math.sin(angle)),
                                240 + 200 * (Math.sin(angle) - Math.cos(angle)),
                            ],
                        });
                    },
                },
            );
            try {
                for (let n = 0; n < 100 && !found; n++) await wait(50);
                if (!found) throw Error('Probe marker was not recognized');
                await wait(500);
                phase = 'stationary';
                started = performance.now();
                await wait(2500);
                phase = 'motion';
                started = performance.now();
                await wait(2500);
                const stationary = samples.filter((sample) => sample.phase === 'stationary');
                const moving = samples.filter((sample) => sample.phase === 'motion');
                const rms = (key) => {
                    const mean = [0, 1].map(
                        (axis) =>
                            stationary.reduce((sum, item) => sum + item[key][axis], 0) /
                            stationary.length,
                    );
                    return Math.sqrt(
                        stationary.reduce(
                            (sum, item) =>
                                sum +
                                item[key].reduce(
                                    (value, point, axis) => value + (point - mean[axis]) ** 2,
                                    0,
                                ),
                            0,
                        ) / stationary.length,
                    );
                };
                results.push({
                    beta,
                    stationaryFrames: stationary.length,
                    movingFrames: moving.length,
                    losses,
                    centerJitterPx: rms('center'),
                    cornerJitterPx: rms('corner'),
                    motionErrorPx:
                        moving.reduce(
                            (sum, sample) => sum + Math.abs(sample.center[0] - sample.expectedX),
                            0,
                        ) / moving.length,
                    motionCornerErrorPx:
                        moving.reduce(
                            (sum, sample) =>
                                sum +
                                Math.hypot(
                                    sample.corner[0] - sample.expectedCorner[0],
                                    sample.corner[1] - sample.expectedCorner[1],
                                ),
                            0,
                        ) / moving.length,
                    meanPoseIntervalMs: 2500 / moving.length,
                });
            } finally {
                abort.abort();
                session.stop();
                delete window.__arDrawFrame;
                await wait(1500);
            }
        }
        return results;
    });
    console.info('MindAR stability probe (synthetic camera):', JSON.stringify(results));
    await testInfo.attach('tracking-probe', {
        body: JSON.stringify(results, null, 2),
        contentType: 'application/json',
    });
    expect(results).toHaveLength(3);
    for (const result of results) {
        expect(result.stationaryFrames).toBeGreaterThan(5);
        expect(result.movingFrames).toBeGreaterThan(5);
        expect(Number.isFinite(result.cornerJitterPx)).toBe(true);
    }
});
