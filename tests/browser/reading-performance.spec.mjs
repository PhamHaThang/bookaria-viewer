import { expect, test } from '@playwright/test';

async function install(page) {
    await page.goto('/');
    await page.evaluate(async () => {
        const { Stage } = await import('/src/scene-core/Stage.ts');
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;inset:0;width:390px;height:600px';
        document.body.append(host);
        const stage = new Stage(host);
        window.__perfStage = stage;
        window.__draws = 0;
        window.__active = false;
        const render = stage.renderer.render.bind(stage.renderer);
        stage.renderer.render = (...args) => {
            window.__draws++;
            return render(...args);
        };
        const group = stage.anchor.clone();
        stage.setRuntime(
            {
                group,
                attachControls() {},
                tap() {},
                update() {},
                advanceHiddenAnimations() {},
                needsFrame() {
                    return window.__active;
                },
            },
            { aspect: 1.4, settings: { lighting: 'neutral' } },
        );
    });
    await expect.poll(() => page.evaluate(() => window.__draws)).toBeGreaterThan(0);
}

test('reading renders when changed, caps active work and leaves a static page idle', async ({
    page,
}) => {
    await install(page);
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => window.__draws);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__draws)).toBe(before);
    await page.evaluate(() => window.__perfStage.resetView());
    await expect.poll(() => page.evaluate(() => window.__draws)).toBeGreaterThan(before);
    const afterReset = await page.evaluate(() => window.__draws);
    await page.evaluate(() => {
        window.__perfStage.controls.target.x += 0.1;
        window.__perfStage.controls.update();
    });
    await expect.poll(() => page.evaluate(() => window.__draws)).toBeGreaterThan(afterReset);
    await page.evaluate(() => {
        window.__active = true;
        window.__draws = 0;
    });
    await page.waitForTimeout(1000);
    const active = await page.evaluate(() => window.__draws);
    expect(active).toBeGreaterThan(0);
    expect(active).toBeLessThanOrEqual(35);
    await page.evaluate(() => {
        window.__active = false;
    });
    await page.waitForTimeout(100);
    const stopped = await page.evaluate(() => window.__draws);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__draws)).toBe(stopped);
    await page.evaluate(() => window.__perfStage.dispose());
});

test('AR keeps rendering tracked poses and idles after losing the anchor', async ({ page }) => {
    await install(page);
    await page.evaluate(() => {
        const stage = window.__perfStage;
        stage.setAR(stage.camera.projectionMatrix.toArray());
        stage.track(stage.anchor.matrix.clone().makeTranslation(0, 0, -1));
        window.__draws = 0;
    });
    await page.waitForTimeout(1000);
    const tracked = await page.evaluate(() => window.__draws);
    expect(tracked).toBeGreaterThan(0);
    expect(tracked).toBeLessThanOrEqual(35);
    await page.evaluate(() => window.__perfStage.track(null));
    await page.waitForTimeout(150);
    const lost = await page.evaluate(() => window.__draws);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__draws)).toBe(lost);
    await page.evaluate(() => window.__perfStage.dispose());
});
