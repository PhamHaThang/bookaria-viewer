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
        window.addEventListener('pageshow', (event) => {
            if (!event.persisted || !this.loadedToken) return;
            const path = this.router.getCurrentMatch()?.path;
            this.cleanupIfLeft();
            if (path) void this.router.replace(path);
        });
    }

    private clearTimers() {
        if (this.expiryTimer) clearTimeout(this.expiryTimer);
        this.expiryTimer = null;
        if (this.availabilityTimer) clearInterval(this.availabilityTimer);
        this.availabilityTimer = null;
    }

    private expire() {
        this.viewer.clearBook();
        this.viewer.status('Bản xem trước không còn khả dụng.');
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

    async ensureLoaded(token: string, _signal?: AbortSignal): Promise<boolean> {
        if (_signal?.aborted) return false;
        if (!token || !tokenPattern.test(token)) {
            this.viewer.getUI().loading();
            this.viewer.status('Liên kết xem trước không hợp lệ.');
            return false;
        }
        if (this.loadedToken === token && this.viewer.getBook()) {
            return true;
        }
        if (this.loadPromise) {
            return this.loadPromise;
        }

        this.loadPromise = (async () => {
            this.request?.abort();
            const abort = new AbortController();
            this.request = abort;

            this.viewer.status('Đang tải bản xem trước…');
            this.viewer.notice('');
            get('retry').hidden = true;
            this.viewer.getUI().loading('Đang mở bản xem trước…');

            try {
                const result = await loadPreview(token, abort.signal);
                if (abort.signal.aborted) return false;

                this.loadedToken = token;
                this.viewer.setPublicToken(token);
                this.viewer.install(result.manifest, {
                    isPreview: true,
                    scanEntry: this.viewer.getUI().scanEntry,
                });
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
                            if (
                                this.loadedToken === token &&
                                error instanceof PreviewUnavailableError
                            )
                                this.expire();
                        })
                        .finally(() => clearTimeout(deadline));
                }, 60000);

                return true;
            } catch (error) {
                if (abort.signal.aborted) return false;
                this.viewer.clearBook();
                this.viewer.status('Chưa tải được bản xem trước.');
                this.loadedToken = null;
                this.viewer.setPublicToken(null);
                get('controls').hidden = true;
                this.viewer.notice(
                    error instanceof Error ? error.message : 'Lỗi tải bản xem trước.',
                );
                get('retry').hidden = false;
                return false;
            } finally {
                if (this.request === abort) this.loadPromise = null;
            }
        })();

        return this.loadPromise;
    }

    getLoadedToken(): string | null {
        return this.loadedToken;
    }

    cleanupIfLeft() {
        this.request?.abort();
        this.request = null;
        this.loadPromise = null;
        this.clearTimers();
        this.loadedToken = null;
        this.viewer.setPublicToken(null);
    }

    getRoutes(): RouteDefinition[] {
        const handleOverview: RouteHandler = async (match, signal) => {
            const token = match.params.token;
            const ok = await this.ensureLoaded(token, signal);
            if (!ok || signal.aborted) return;

            const book = this.viewer.getBook();
            if (book) this.viewer.getUI().ready(book);
            this.viewer.showOverview();
        };

        const handlePage: RouteHandler = async (match, signal) => {
            const token = match.params.token;
            const pageNum = Number(match.params.page);
            const ok = await this.ensureLoaded(token, signal);
            if (!ok || signal.aborted) return;

            const book = this.viewer.getBook();
            if (!book) return;

            const pageIndex = Number.isSafeInteger(pageNum) && pageNum > 0 ? pageNum - 1 : 0;
            const clampedIndex = Math.max(0, Math.min(book.pages.length - 1, pageIndex));

            if (!/^[1-9]\d*$/.test(match.params.page) || clampedIndex !== pageIndex) {
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

            const pageNum = match.params.page ? Number(match.params.page) : undefined;
            const preferredIndex =
                pageNum !== undefined && Number.isSafeInteger(pageNum) && pageNum > 0
                    ? pageNum - 1
                    : undefined;

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
