import { installReportForm } from '../report-form';
import type { Router } from '../router/router';
import { ROUTE_IDS, routePaths } from '../router/routes';
import type { RouteDefinition, RouteHandler } from '../router/types';
import { BookUnavailableError, loadPublicInfo, loadPublished } from '../shared/api';
import { SlugSchema } from '../shared/contracts/common.schema';
import { startReadingEvents } from '../shared/reading-events';
import type { BookViewer } from '../viewer/book-viewer';

const get = <T extends HTMLElement>(id: string) => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing ${id}`);
    return element as T;
};

export class PublishedRouteManager {
    private viewer: BookViewer;
    private router: Router;

    private loadedSlug: string | null = null;
    private versionId = '';
    private checking = false;
    private availability: ReturnType<typeof setInterval> | null = null;
    private readingEvents: ReturnType<typeof startReadingEvents> | null = null;
    private disposeReport: (() => void) | null = null;
    private request: AbortController | null = null;
    private loadPromise: Promise<boolean> | null = null;

    constructor(viewer: BookViewer, router: Router) {
        this.viewer = viewer;
        this.router = router;

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.loadedSlug) void this.checkAvailability();
        });

        window.addEventListener('pageshow', (event) => {
            if (event.persisted && this.loadedSlug) void this.ensureLoaded(this.loadedSlug);
        });

        window.addEventListener('pagehide', () => {
            this.request?.abort();
            if (this.availability) clearInterval(this.availability);
        });
    }

    private clearPublication(message: string) {
        this.readingEvents?.dispose();
        this.readingEvents = null;
        this.viewer.setReadingEvents(null);
        this.viewer.clearSceneBytes();

        this.disposeReport?.();
        this.disposeReport = null;

        this.viewer.stop(message);
        this.loadedSlug = null;
        this.versionId = '';

        get('main').dataset.ready = 'false';
        get<HTMLButtonElement>('start').disabled = true;
        get('controls').hidden = true;
        get('credits-section').hidden = true;
        get('publication-info').hidden = true;
        get('retry').hidden = false;

        if (this.availability) clearInterval(this.availability);
        this.availability = null;
    }

    private async checkAvailability() {
        if (this.checking || !this.versionId || !this.loadedSlug) return;
        this.checking = true;
        const abort = new AbortController();
        const deadline = setTimeout(() => abort.abort(), 15000);
        const expected = this.versionId;
        const slug = this.loadedSlug;

        try {
            const current = await loadPublicInfo(slug, abort.signal);
            if (this.versionId !== expected || this.loadedSlug !== slug) return;
            if (current.version.id !== expected) {
                this.clearPublication(
                    'Tác giả vừa xuất bản phiên bản mới. Bấm Thử tải lại để mở bản mới.',
                );
            }
        } catch (error) {
            if (this.versionId === expected && this.loadedSlug === slug) {
                this.clearPublication(
                    error instanceof BookUnavailableError
                        ? 'Sách không còn khả dụng.'
                        : 'Chưa kiểm tra được trạng thái sách. Bấm Thử tải lại để kết nối lại.',
                );
                this.viewer.notice(error instanceof Error ? error.message : 'Không tải được sách.');
            }
        } finally {
            clearTimeout(deadline);
            this.checking = false;
        }
    }

    async ensureLoaded(slug: string, signal?: AbortSignal): Promise<boolean> {
        if (this.loadedSlug === slug && this.viewer.getBook()) {
            return true;
        }
        if (this.loadPromise) {
            return this.loadPromise;
        }

        this.loadPromise = (async () => {
            if (!SlugSchema.safeParse(slug).success) {
                this.viewer.getUI().loading();
                this.viewer.status('Liên kết sách không hợp lệ.');
                return false;
            }

            this.request?.abort();
            const abort = new AbortController();
            this.request = abort;

            this.clearPublication('Đang tải sách đã xuất bản…');
            get('retry').hidden = true;
            this.viewer.notice('');
            this.viewer.getUI().loading('Đang mở sách…');

            try {
                const combinedSignal = signal;
                const { info, manifest } = await loadPublished(slug, abort.signal);
                if (abort.signal.aborted || combinedSignal?.aborted) return false;

                this.loadedSlug = slug;
                this.versionId = info.version.id;

                this.viewer.install(manifest, { isPreview: false, slug });
                this.readingEvents = startReadingEvents(info.version.id);
                this.viewer.setReadingEvents(this.readingEvents);
                this.disposeReport = installReportForm(slug, manifest.pages);

                this.viewer.getUI().metadata(info);
                get('publication-description').textContent = info.description || '';
                get('publication-description').hidden = !info.description;

                const pdf = get<HTMLAnchorElement>('published-pdf');
                pdf.hidden = !info.printPdfUrl;
                if (info.printPdfUrl) pdf.href = info.printPdfUrl;
                get('publication-info').hidden = false;
                this.viewer.status('');

                this.availability = setInterval(() => {
                    void this.checkAvailability();
                }, 60000);

                return true;
            } catch (error) {
                if (abort.signal.aborted || signal?.aborted) return false;
                this.clearPublication('Chưa mở được sách đã xuất bản.');
                this.viewer.notice(error instanceof Error ? error.message : 'Không tải được sách.');
                return false;
            } finally {
                this.loadPromise = null;
            }
        })();

        return this.loadPromise;
    }

    getLoadedSlug(): string | null {
        return this.loadedSlug;
    }

    cleanupIfLeft() {
        if (this.availability) {
            clearInterval(this.availability);
            this.availability = null;
        }
        this.readingEvents?.dispose();
        this.readingEvents = null;
        this.viewer.setReadingEvents(null);
        this.disposeReport?.();
        this.disposeReport = null;
        this.loadedSlug = null;
        this.versionId = '';
    }

    getRoutes(): RouteDefinition[] {
        const handleOverview: RouteHandler = async (match, signal) => {
            const slug = match.params.slug;
            const ok = await this.ensureLoaded(slug, signal);
            if (!ok || signal.aborted) return;

            const modeParam = match.query.get('mode');
            const book = this.viewer.getBook();
            const hasMarker = book?.pages.some((page) => page.marker.mode !== 'NONE');

            if (modeParam === 'ar' && hasMarker) {
                void this.router.replace(routePaths.publishedCamera(slug));
                return;
            }

            this.viewer.showOverview();
        };

        const handlePage: RouteHandler = async (match, signal) => {
            const slug = match.params.slug;
            const pageNum = Number.parseInt(match.params.page, 10);
            const ok = await this.ensureLoaded(slug, signal);
            if (!ok || signal.aborted) return;

            const book = this.viewer.getBook();
            if (!book) return;

            const pageIndex = Number.isFinite(pageNum) ? pageNum - 1 : 0;
            const clampedIndex = Math.max(0, Math.min(book.pages.length - 1, pageIndex));

            if (clampedIndex !== pageIndex) {
                void this.router.replace(routePaths.publishedPage(slug, clampedIndex + 1));
                return;
            }

            await this.viewer.showPage(clampedIndex);
        };

        const handleCamera: RouteHandler = async (match, signal) => {
            const slug = match.params.slug;
            const ok = await this.ensureLoaded(slug, signal);
            if (!ok || signal.aborted) return;

            this.viewer.showCamera();
        };

        const handleAr: RouteHandler = async (match, signal) => {
            const slug = match.params.slug;
            const ok = await this.ensureLoaded(slug, signal);
            if (!ok || signal.aborted) return;

            const pageNum = match.params.page ? Number.parseInt(match.params.page, 10) : undefined;
            const preferredIndex =
                pageNum !== undefined && Number.isFinite(pageNum) ? pageNum - 1 : undefined;

            await this.viewer.showAr(preferredIndex);
        };

        const handleReadRedirect: RouteHandler = async (match) => {
            const slug = match.params.slug;
            void this.router.replace(routePaths.publishedPage(slug, 1));
        };

        return [
            {
                id: ROUTE_IDS.PUBLISHED_OVERVIEW,
                pattern: '/b/:slug',
                handler: handleOverview,
            },
            {
                id: ROUTE_IDS.PUBLISHED_READ,
                pattern: '/b/:slug/read',
                handler: handleReadRedirect,
            },
            {
                id: ROUTE_IDS.PUBLISHED_PAGE,
                pattern: '/b/:slug/p/:page',
                handler: handlePage,
            },
            {
                id: ROUTE_IDS.PUBLISHED_CAMERA,
                pattern: '/b/:slug/camera',
                handler: handleCamera,
            },
            {
                id: ROUTE_IDS.PUBLISHED_AR,
                pattern: '/b/:slug/ar',
                handler: handleAr,
            },
            {
                id: ROUTE_IDS.PUBLISHED_AR_PAGE,
                pattern: '/b/:slug/ar/p/:page',
                handler: handleAr,
            },
        ];
    }
}
