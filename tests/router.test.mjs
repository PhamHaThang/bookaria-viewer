import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Router } from '../src/router/router.ts';
import { ROUTE_IDS, routePaths } from '../src/router/routes.ts';

test('router matches routes and extracts parameters correctly', () => {
    const router = new Router();
    router
        .register({ id: ROUTE_IDS.HOME, pattern: '/', handler: () => {} })
        .register({ id: ROUTE_IDS.EMBED, pattern: '/embed', handler: () => {} })
        .register({ id: ROUTE_IDS.PUBLISHED_OVERVIEW, pattern: '/b/:slug', handler: () => {} })
        .register({ id: ROUTE_IDS.PUBLISHED_PAGE, pattern: '/b/:slug/p/:page', handler: () => {} })
        .register({ id: ROUTE_IDS.PUBLISHED_CAMERA, pattern: '/b/:slug/camera', handler: () => {} })
        .register({ id: ROUTE_IDS.PUBLISHED_AR, pattern: '/b/:slug/ar', handler: () => {} })
        .register({
            id: ROUTE_IDS.PUBLISHED_AR_PAGE,
            pattern: '/b/:slug/ar/p/:page',
            handler: () => {},
        })
        .register({ id: ROUTE_IDS.PREVIEW_OVERVIEW, pattern: '/preview/:token', handler: () => {} })
        .register({
            id: ROUTE_IDS.PREVIEW_PAGE,
            pattern: '/preview/:token/p/:page',
            handler: () => {},
        });

    // Root
    const home = router.match('/');
    assert.equal(home?.route.id, ROUTE_IDS.HOME);
    assert.deepEqual(home?.match.params, {});

    // Embed
    const embed = router.match('/embed');
    assert.equal(embed?.route.id, ROUTE_IDS.EMBED);

    // Published overview (handles trailing slash too)
    const pubOverview = router.match('/b/mat-biec/');
    assert.equal(pubOverview?.route.id, ROUTE_IDS.PUBLISHED_OVERVIEW);
    assert.equal(pubOverview?.match.params.slug, 'mat-biec');

    // Published page
    const pubPage = router.match('/b/mat-biec/p/3');
    assert.equal(pubPage?.route.id, ROUTE_IDS.PUBLISHED_PAGE);
    assert.equal(pubPage?.match.params.slug, 'mat-biec');
    assert.equal(pubPage?.match.params.page, '3');

    // Published camera
    const pubCamera = router.match('/b/mat-biec/camera');
    assert.equal(pubCamera?.route.id, ROUTE_IDS.PUBLISHED_CAMERA);
    assert.equal(pubCamera?.match.params.slug, 'mat-biec');

    // Published AR
    const pubAr = router.match('/b/mat-biec/ar');
    assert.equal(pubAr?.route.id, ROUTE_IDS.PUBLISHED_AR);
    assert.equal(pubAr?.match.params.slug, 'mat-biec');

    // Published AR page
    const pubArPage = router.match('/b/mat-biec/ar/p/2');
    assert.equal(pubArPage?.route.id, ROUTE_IDS.PUBLISHED_AR_PAGE);
    assert.equal(pubArPage?.match.params.slug, 'mat-biec');
    assert.equal(pubArPage?.match.params.page, '2');

    // Preview
    const preview = router.match('/preview/abc123def456');
    assert.equal(preview?.route.id, ROUTE_IDS.PREVIEW_OVERVIEW);
    assert.equal(preview?.match.params.token, 'abc123def456');

    // Preview page
    const prevPage = router.match('/preview/abc123def456/p/4');
    assert.equal(prevPage?.route.id, ROUTE_IDS.PREVIEW_PAGE);
    assert.equal(prevPage?.match.params.token, 'abc123def456');
    assert.equal(prevPage?.match.params.page, '4');

    // Unmatched
    const notFound = router.match('/random/unknown/path');
    assert.equal(notFound, null);
});

test('routePaths generates expected URL strings', () => {
    assert.equal(routePaths.home(), '/');
    assert.equal(routePaths.embed(), '/embed');
    assert.equal(routePaths.published('de-men'), '/b/de-men');
    assert.equal(routePaths.publishedRead('de-men'), '/b/de-men/read');
    assert.equal(routePaths.publishedPage('de-men', 5), '/b/de-men/p/5');
    assert.equal(routePaths.publishedCamera('de-men'), '/b/de-men/camera');
    assert.equal(routePaths.publishedAr('de-men'), '/b/de-men/ar');
    assert.equal(routePaths.publishedAr('de-men', 3), '/b/de-men/ar/p/3');
    assert.equal(routePaths.preview('tok123'), '/preview/tok123');
    assert.equal(routePaths.previewPage('tok123', 2), '/preview/tok123/p/2');
    assert.equal(routePaths.previewCamera('tok123'), '/preview/tok123/camera');
    assert.equal(routePaths.previewAr('tok123'), '/preview/tok123/ar');
    assert.equal(routePaths.previewAr('tok123', 7), '/preview/tok123/ar/p/7');
});

test('router executes route handlers and cancels previous executions on navigation', async () => {
    const router = new Router();
    let handledSlug = '';
    let handledPage = '';
    let abortedPrevious = false;

    router.register({
        id: 'page',
        pattern: '/b/:slug/p/:page',
        handler: async (match, signal) => {
            handledSlug = match.params.slug;
            handledPage = match.params.page;

            await new Promise((resolve) => setTimeout(resolve, 50));
            if (signal.aborted) {
                abortedPrevious = true;
            }
        },
    });

    // Mock history and location for Node environment
    globalThis.window = {
        history: {
            pushState: () => {},
            replaceState: () => {},
        },
        location: {
            origin: 'http://localhost:5174',
            href: 'http://localhost:5174/b/book-1/p/1',
        },
    };

    const firstNav = router.navigate('/b/book-1/p/1');
    const secondNav = router.navigate('/b/book-1/p/2');

    await Promise.all([firstNav, secondNav]);

    assert.equal(handledSlug, 'book-1');
    assert.equal(handledPage, '2');
    assert.equal(abortedPrevious, true);
});
