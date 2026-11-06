import { Router } from './router/router';
import { ROUTE_IDS, routePaths } from './router/routes';
import { createEmbedRoute } from './routes/embed.route';
import { createHomeRoute } from './routes/home.route';
import { PreviewRouteManager } from './routes/preview.route';
import { PublishedRouteManager } from './routes/published.route';
import { BookViewer } from './viewer/book-viewer';

const get = <T extends HTMLElement>(id: string) => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing ${id}`);
    return element as T;
};

const router = new Router();

let publishedManager: PublishedRouteManager;
let previewManager: PreviewRouteManager;

const viewer = new BookViewer({
    onPageChange: (next) => {
        const publishedSlug = publishedManager.getLoadedSlug();
        const previewToken = previewManager.getLoadedToken();

        if (publishedSlug) {
            if (viewer.getMode() === 'ar') {
                void router.replace(routePaths.publishedAr(publishedSlug, next + 1));
            } else {
                void router.navigate(routePaths.publishedPage(publishedSlug, next + 1));
            }
        } else if (previewToken) {
            if (viewer.getMode() === 'ar') {
                void router.replace(routePaths.previewAr(previewToken, next + 1));
            } else {
                void router.navigate(routePaths.previewPage(previewToken, next + 1));
            }
        } else {
            void viewer.activate(next);
        }
    },

    onStartReading: () => {
        const publishedSlug = publishedManager.getLoadedSlug();
        const previewToken = previewManager.getLoadedToken();

        if (publishedSlug) {
            void router.navigate(routePaths.publishedPage(publishedSlug, 1));
        } else if (previewToken) {
            void router.navigate(routePaths.previewPage(previewToken, 1));
        } else {
            viewer.getUI().view('read');
            void viewer.showPage(0);
        }
    },

    onStartCamera: () => {
        const publishedSlug = publishedManager.getLoadedSlug();
        const previewToken = previewManager.getLoadedToken();

        if (publishedSlug) {
            void router.navigate(routePaths.publishedCamera(publishedSlug));
        } else if (previewToken) {
            void router.navigate(routePaths.previewCamera(previewToken));
        } else {
            viewer.showCamera();
        }
    },

    onCameraAccessBack: () => {
        const publishedSlug = publishedManager.getLoadedSlug();
        const previewToken = previewManager.getLoadedToken();

        if (publishedSlug) {
            void router.navigate(routePaths.published(publishedSlug));
        } else if (previewToken) {
            void router.navigate(routePaths.preview(previewToken));
        } else {
            viewer.showOverview();
        }
    },

    onArPageDetected: (foundIndex) => {
        const publishedSlug = publishedManager.getLoadedSlug();
        const previewToken = previewManager.getLoadedToken();

        if (publishedSlug) {
            void router.replace(routePaths.publishedAr(publishedSlug, foundIndex + 1));
        } else if (previewToken) {
            void router.replace(routePaths.previewAr(previewToken, foundIndex + 1));
        }
    },

    onNavigateHome: () => {
        const publishedSlug = publishedManager.getLoadedSlug();
        const previewToken = previewManager.getLoadedToken();

        if (publishedSlug) {
            void router.navigate(routePaths.published(publishedSlug));
        } else if (previewToken) {
            void router.navigate(routePaths.preview(previewToken));
        } else {
            void router.navigate(routePaths.home());
        }
    },

    onFallbackToReading: () => {
        const publishedSlug = publishedManager.getLoadedSlug();
        const previewToken = previewManager.getLoadedToken();
        const targetPage = viewer.getCurrentIndex() + 1;

        if (publishedSlug) {
            void router.navigate(routePaths.publishedPage(publishedSlug, targetPage));
        } else if (previewToken) {
            void router.navigate(routePaths.previewPage(previewToken, targetPage));
        } else {
            void viewer.showPage(viewer.getCurrentIndex());
        }
    },

    onRetry: () => {
        const match = router.getCurrentMatch();
        if (match) {
            void router.navigate(match.path, { replace: true });
        }
    },
});

publishedManager = new PublishedRouteManager(viewer, router);
previewManager = new PreviewRouteManager(viewer, router);

// Register routes
router.register({
    id: ROUTE_IDS.HOME,
    pattern: '/',
    handler: createHomeRoute(viewer),
});

router.register({
    id: ROUTE_IDS.EMBED,
    pattern: '/embed',
    handler: createEmbedRoute(viewer),
});

for (const route of publishedManager.getRoutes()) {
    router.register(route);
}

for (const route of previewManager.getRoutes()) {
    router.register(route);
}

router.setNotFound((match) => {
    viewer.getUI().loading();
    viewer.status('Không tìm thấy trang yêu cầu.');
    viewer.notice(`Đường dẫn "${match.pathname}" không tồn tại.`);
});

// Setup global retry button
get('retry').addEventListener('click', () => {
    const match = router.getCurrentMatch();
    if (match) {
        const slug = match.params.slug;
        const token = match.params.token;
        if (slug) {
            void publishedManager.ensureLoaded(slug);
        } else if (token) {
            void previewManager.ensureLoaded(token);
        } else {
            void router.navigate(match.path, { replace: true });
        }
    }
});

// Start router
void router.start();
