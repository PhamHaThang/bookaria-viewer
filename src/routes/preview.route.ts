import type { Router } from '../router/router';
import { ROUTE_IDS, routePaths } from '../router/routes';
import type { RouteDefinition, RouteHandler } from '../router/types';
import { loadPreview, PreviewUnavailableError, tokenPattern } from '../shared/api';
import type { BookViewer } from '../viewer/book-viewer';

const get = <T extends HTMLElement>(id: string) => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing ${id}`);
    return element as T;
};

export class PreviewRouteManager {
    private viewer: BookViewer;
    private router: Router;

    private loadedToken: string | null = null;
    private request: AbortController | null = null;
    private expiryTimer: ReturnType<typeof setTimeout> | null = null;
    private availabilityTimer: ReturnType<typeof setInterval> | null = null;
    private loadPromise: Promise<boolean> | null = null;

    constructor(viewer: BookViewer, router: Router) {
        this.viewer = viewer;
        this.router = router;

        window.addEventListener('pagehide', () => {
            this.request?.abort();
            this.clearTimers();
        });
    }

    private clearTimers() {
        if (this.expiryTimer) clearTimeout(this.expiryTimer);
        this.expiryTimer = null;
        if (this.availabilityTimer) clearInterval(this.availabilityTimer);
        this.availabilityTimer = null;
    }

    private expire() {
        this.viewer.stop('Bản xem trước không còn khả dụng.');
        this.loadedToken = null;
        this.viewer.setPublicToken(null);

        get('main').dataset.ready = 'false';
        get<HTMLButtonElement>('start').disabled = true;
        get('controls').hidden = true;
        this.viewer.notice(
            'Liên kết đã hết hạn hoặc không còn khả dụng. Hãy tạo liên kết mới từ Studio.',
        );
        this.clearTimers();
    }

    async ensureLoaded(token: string, signal?: AbortSignal): Promise<boolean> {
        if (this.loadedToken === token && this.viewer.getBook()) {
            return true;
        }
        if (this.loadPromise) {
            return this.loadPromise;
        }

        this.loadPromise = (async () => {
            if (!token || !tokenPattern.test(token)) {
                this.viewer.getUI().loading();
                this.viewer.status('Liên kết xem trước không hợp lệ.');
                return false;
            }

            this.request?.abort();
            const abort = new AbortController();
            this.request = abort;

            this.viewer.status('Đang tải bản xem trước…');
            this.viewer.notice('');
            get('retry').hidden = true;
            this.viewer.getUI().loading('Đang mở bản xem trước…');

            try {
                const combinedSignal = signal;
                const result = await loadPreview(token, abort.signal);
                if (abort.signal.aborted || combinedSignal?.aborted) return false;

                this.loadedToken = token;
                this.viewer.setPublicToken(token);
                this.viewer.install(result.manifest, { isPreview: true });
                this.viewer.status('');

                get('subtitle').textContent = result.expiresAt
                    ? `Bản xem trước tạm thời · Hết hạn ${new Date(result.expiresAt).toLocaleString('vi-VN')}`
                    : 'Bản xem trước tạm thời, không phải bản xuất bản.';

                const remaining = result.expiresAt
                    ? new Date(result.expiresAt).getTime() - Date.now()
                    : Number.NaN;

                this.clearTimers();
                if (Number.isFinite(remaining)) {
                    this.expiryTimer = setTimeout(() => this.expire(), Math.max(0, remaining));
                }

                this.availabilityTimer = setInterval(() => {
                    if (!this.viewer.getBook()) return;
                    const pollAbort = new AbortController();
                    const deadline = setTimeout(() => pollAbort.abort(), 15000);
                    loadPreview(token, pollAbort.signal)
                        .catch((error) => {
                            if (error instanceof PreviewUnavailableError) this.expire();
                        })
                        .finally(() => clearTimeout(deadline));
                }, 60000);

                return true;
            } catch (error) {
                if (abort.signal.aborted || signal?.aborted) return false;
                this.viewer.stop('Chưa tải được bản xem trước.');
                this.loadedToken = null;
                this.viewer.setPublicToken(null);
                get('controls').hidden = true;
                this.viewer.notice(
                    error instanceof Error ? error.message : 'Lỗi tải bản xem trước.',
                );
                get('retry').hidden = false;
                return false;
            } finally {
                this.loadPromise = null;
            }
        })();

        return this.loadPromise;
    }

    getLoadedToken(): string | null {
        return this.loadedToken;
    }

    cleanupIfLeft() {
        this.clearTimers();
        this.loadedToken = null;
        this.viewer.setPublicToken(null);
    }

    getRoutes(): RouteDefinition[] {
        const handleOverview: RouteHandler = async (match, signal) => {
            const token = match.params.token;
            const ok = await this.ensureLoaded(token, signal);
            if (!ok || signal.aborted) return;

            const modeParam = match.query.get('mode');
            const book = this.viewer.getBook();
            const hasMarker = book?.pages.some((page) => page.marker.mode !== 'NONE');

            if (modeParam === 'ar' && hasMarker) {
                void this.router.replace(routePaths.previewCamera(token));
                return;
            }

            this.viewer.showOverview();
        };

        const handlePage: RouteHandler = async (match, signal) => {
            const token = match.params.token;
            const pageNum = Number.parseInt(match.params.page, 10);
            const ok = await this.ensureLoaded(token, signal);
            if (!ok || signal.aborted) return;

            const book = this.viewer.getBook();
            if (!book) return;

            const pageIndex = Number.isFinite(pageNum) ? pageNum - 1 : 0;
            const clampedIndex = Math.max(0, Math.min(book.pages.length - 1, pageIndex));

            if (clampedIndex !== pageIndex) {
                void this.router.replace(routePaths.previewPage(token, clampedIndex + 1));
                return;
            }

            await this.viewer.showPage(clampedIndex);
        };

        const handleCamera: RouteHandler = async (match, signal) => {
            const token = match.params.token;
            const ok = await this.ensureLoaded(token, signal);
            if (!ok || signal.aborted) return;

            this.viewer.showCamera();
        };

        const handleAr: RouteHandler = async (match, signal) => {
            const token = match.params.token;
            const ok = await this.ensureLoaded(token, signal);
            if (!ok || signal.aborted) return;

            const pageNum = match.params.page ? Number.parseInt(match.params.page, 10) : undefined;
            const preferredIndex =
                pageNum !== undefined && Number.isFinite(pageNum) ? pageNum - 1 : undefined;

            await this.viewer.showAr(preferredIndex);
        };

        const handleReadRedirect: RouteHandler = async (match) => {
            const token = match.params.token;
            void this.router.replace(routePaths.previewPage(token, 1));
        };

        return [
            {
                id: ROUTE_IDS.PREVIEW_OVERVIEW,
                pattern: '/preview/:token',
                handler: handleOverview,
            },
            {
                id: ROUTE_IDS.PREVIEW_READ,
                pattern: '/preview/:token/read',
                handler: handleReadRedirect,
            },
            {
                id: ROUTE_IDS.PREVIEW_PAGE,
                pattern: '/preview/:token/p/:page',
                handler: handlePage,
            },
            {
                id: ROUTE_IDS.PREVIEW_CAMERA,
                pattern: '/preview/:token/camera',
                handler: handleCamera,
            },
            {
                id: ROUTE_IDS.PREVIEW_AR,
                pattern: '/preview/:token/ar',
                handler: handleAr,
            },
            {
                id: ROUTE_IDS.PREVIEW_AR_PAGE,
                pattern: '/preview/:token/ar/p/:page',
                handler: handleAr,
            },
        ];
    }
}
