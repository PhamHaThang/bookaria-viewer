import { CameraAccess, cameraError } from '../camera-access';
import { createReaderUI, setMuteIcon } from '../reader-ui';
import type { PageRuntime } from '../scene-core/buildScene';
import type { Stage } from '../scene-core/Stage';
import { previewGroupUrl } from '../shared/api';
import type { Manifest, ManifestPage } from '../shared/contracts/manifest.schema';
import type { startReadingEvents } from '../shared/reading-events';

export type Book = Pick<Manifest, 'title' | 'pages' | 'assets' | 'targetGroups' | 'credits'>;

export interface BookViewerCallbacks {
    onPageChange?: (index: number) => void;
    onStartReading?: () => void;
    onStartCamera?: () => void;
    onCameraAccessBack?: () => void;
    onCameraAccessAllow?: () => void;
    onArPageDetected?: (index: number) => void;
    onNavigateHome?: () => void;
    onRetry?: () => void;
    onFallbackToReading?: () => void;
}

const get = <T extends HTMLElement>(id: string) => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing ${id}`);
    return element as T;
};

export class BookViewer {
    private viewport: HTMLDivElement;
    private select: HTMLSelectElement;
    private ui: ReturnType<typeof createReaderUI>;
    private callbacks: BookViewerCallbacks;

    private book: Book | null = null;
    private index = 0;
    private mode: '3d' | 'ar' = '3d';
    private stage: Stage | null = null;
    private runtime: PageRuntime | null = null;

    private loading: AbortController | null = null;
    private cameraAbort: AbortController | null = null;
    private generation = 0;
    private muted = false;
    private tracked = false;
    private cameraGroup: number | null = null;
    private tracker: Awaited<ReturnType<typeof import('../tracker/mindar').startTracking>> | null =
        null;
    private cameraAccess = new CameraAccess();
    private retiring = new Set<PageRuntime>();
    private matrices = new Map<string, { world: number[]; dimensions: [number, number] }>();
    private cameraTask: Promise<void> | null = null;
    private scanTimer: ReturnType<typeof setTimeout> | null = null;
    private readingEvents: ReturnType<typeof startReadingEvents> | null = null;
    private cameraRecognized = false;
    private runtimeStarted = false;
    private lossTimer: ReturnType<typeof setTimeout> | null = null;
    private targetToPageMatrix: typeof import('../scene-core/coords').targetToPageMatrix | null =
        null;

    private embedded = false;
    private embedNonce = '';
    private embedParentOrigin = '';
    private publicToken: string | null = null;

    private listeners: Array<() => void> = [];

    constructor(callbacks: BookViewerCallbacks = {}) {
        this.callbacks = callbacks;
        this.viewport = get<HTMLDivElement>('viewport');
        this.select = get<HTMLSelectElement>('pages');

        this.ui = createReaderUI((next) => {
            if (!this.book?.pages[next]) return;
            if (this.mode === 'ar') {
                const page = this.book.pages[next];
                if (page.group !== undefined) this.tracker?.prefer(page.group);
                this.status(`Hướng camera vào trang ${next + 1}.`);
                this.callbacks.onPageChange?.(next);
            } else {
                this.callbacks.onPageChange?.(next);
            }
        });

        this.attachDOMListeners();
    }

    getUI() {
        return this.ui;
    }

    getBook(): Book | null {
        return this.book;
    }

    getCurrentIndex(): number {
        return this.index;
    }

    getMode(): '3d' | 'ar' {
        return this.mode;
    }

    getRuntime(): PageRuntime | null {
        return this.runtime;
    }

    getStage(): Stage | null {
        return this.stage;
    }

    status(message: string, options?: { persistent?: boolean }) {
        this.ui.status(message, options);
    }

    notice(message: string) {
        this.ui.notice(message);
    }

    setReadingEvents(events: ReturnType<typeof startReadingEvents> | null) {
        this.readingEvents = events;
    }

    setPublicToken(token: string | null) {
        this.publicToken = token;
    }

    setEmbed(embedded: boolean, options?: { nonce: string; parentOrigin: string }) {
        this.embedded = embedded;
        document.documentElement.classList.toggle('viewer-embedded', embedded);
        if (options) {
            this.embedNonce = options.nonce;
            this.embedParentOrigin = options.parentOrigin;
        }
    }

    reply(state: string, requestId?: number) {
        const validEmbed =
            this.embedded &&
            window.parent !== window &&
            /^[0-9a-f-]{36}$/i.test(this.embedNonce) &&
            this.embedParentOrigin;
        if (validEmbed) {
            window.parent.postMessage(
                { type: 'BOOKARIA_STATUS', nonce: this.embedNonce, status: state, requestId },
                this.embedParentOrigin,
            );
        }
    }

    log(message: string) {
        if (!this.embedded) return;
        const item = document.createElement('li');
        item.textContent = message;
        get('events').prepend(item);
        while (get('events').children.length > 20) get('events').lastElementChild?.remove();
    }

    controls() {
        get<HTMLButtonElement>('reset').disabled = !this.stage || this.mode === 'ar';
        get<HTMLButtonElement>('retry-media').disabled = !this.runtime;
        get<HTMLButtonElement>('previous').disabled = !this.book || this.index === 0;
        get<HTMLButtonElement>('next').disabled =
            !this.book || this.index === this.book.pages.length - 1;
        get<HTMLButtonElement>('camera').disabled =
            this.embedded || !this.book?.pages.some((page) => page.marker.mode !== 'NONE');
        get<HTMLButtonElement>('restart').disabled =
            !this.runtime || (this.mode === 'ar' && !this.tracked);
        this.select.value = String(this.index);
        this.ui.navigation(this.index, this.mode === 'ar', this.tracked);
    }

    clearCamera(keepPrepared = false) {
        if (!keepPrepared) this.cameraAccess.clear();
        if (this.lossTimer) clearTimeout(this.lossTimer);
        this.lossTimer = null;
        this.cameraAbort?.abort();
        this.cameraAbort = null;
        this.tracker?.stop();
        this.tracker = null;
        this.cameraTask = null;
        this.cameraGroup = null;
        this.matrices.clear();
        this.tracked = false;
        this.cameraRecognized = false;
        if (this.scanTimer) clearTimeout(this.scanTimer);
        this.scanTimer = null;
    }

    stop(message = 'Đã dừng xem. Bấm Bắt đầu để xem lại.') {
        this.generation++;
        this.loading?.abort();
        this.loading = null;
        this.clearCamera();
        this.runtime?.dispose();
        for (const previous of this.retiring) previous.dispose();
        this.retiring.clear();
        this.runtime = null;
        this.stage?.dispose();
        this.stage = null;
        this.viewport.hidden = true;
        get('tap-section').hidden = true;
        get('rule-section').hidden = true;
        get('external-link').hidden = true;
        this.controls();
        this.ui.loading();
        this.ui.view('welcome');
        if (message) this.status(message);
        this.reply('stopped');
    }

    install(value: Book, options?: { isPreview?: boolean; scanEntry?: boolean }) {
        this.book = value;
        this.index = 0;
        this.ui.ready(value, options);
        get('title').textContent = value.title;
        document.title = `${value.title} — Bookaria`;
        this.select.replaceChildren(
            ...value.pages.map((page, idx) => {
                const option = document.createElement('option');
                option.value = String(idx);
                option.textContent = `${idx + 1}. ${page.title || 'Trang sách'}${page.marker.mode === 'NONE' ? ' · Không có marker AR' : ''}`;
                return option;
            }),
        );
        get('controls').hidden = false;
        get('credits').replaceChildren();
        for (const credit of value.credits) {
            const item = document.createElement('li');
            item.textContent = `${credit.name || 'Tài nguyên'} — ${credit.author} · ${credit.license}`;
            if (credit.sourceUrl) {
                const link = document.createElement('a');
                link.href = credit.sourceUrl;
                link.textContent = ' · Nguồn';
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                item.append(link);
            }
            get('credits').append(item);
        }
        get('credits-section').hidden = !value.credits.length;
        this.controls();
    }

    buttons(page: ManifestPage) {
        get('tap-objects').replaceChildren();
        get('rules').replaceChildren();
        const targets = new Set(
            page.scene.interactions
                .filter((rule) => rule.enabled && rule.trigger.type === 'onTap')
                .map((rule) => (rule.trigger.type === 'onTap' ? rule.trigger.objectId : '')),
        );
        for (const object of page.scene.objects.filter((object) => targets.has(object.id))) {
            const button = document.createElement('button');
            button.className = 'reader-button';
            button.type = 'button';
            button.textContent = object.name || `Đối tượng ${object.type}`;
            button.addEventListener('click', () => {
                if (this.mode === 'ar' && !this.tracked) {
                    this.notice('Hướng camera vào trang trước khi tương tác.');
                    return;
                }
                this.runtime?.tap(object.id);
            });
            get('tap-objects').append(button);
        }
        if (this.embedded) {
            for (const rule of page.scene.interactions) {
                const button = document.createElement('button');
                button.className = 'reader-button';
                button.type = 'button';
                button.textContent = `Chạy: ${rule.name || 'Quy tắc chưa đặt tên'}`;
                button.disabled = !rule.enabled;
                button.addEventListener('click', () => {
                    void this.runtime?.runner.run(rule.id);
                });
                get('rules').append(button);
            }
        }
        get('tap-section').hidden = !targets.size;
        get('rule-section').hidden = !this.embedded || !page.scene.interactions.length;
        get('logs').hidden = !this.embedded;
    }

    showTracked(world: number[], dimensions: [number, number], page: ManifestPage) {
        if (!this.runtime || !this.targetToPageMatrix) return;
        this.stage?.track(this.targetToPageMatrix(world, ...dimensions, page));
        if (!this.tracked) {
            if (this.lossTimer) clearTimeout(this.lossTimer);
            this.lossTimer = null;
            this.tracked = true;
            this.readingEvents?.record({ type: 'PAGE_FOUND', pageId: page.pageId });
            if (this.runtimeStarted) this.runtime.resume();
            else {
                this.runtimeStarted = true;
                this.runtime.start();
            }
            this.ui.scan(true);
            this.controls();
            this.status(`Đã nhận diện trang ${this.index + 1}. Chạm để khám phá.`);
        }
    }

    lostTarget() {
        if (!this.tracked) return;
        this.tracked = false;
        this.stage?.track(null);
        this.ui.scan(false);
        this.controls();
        this.status('Đưa camera trở lại trang sách.');
        if (this.lossTimer) clearTimeout(this.lossTimer);
        const previous = this.runtime;
        this.lossTimer = setTimeout(() => {
            if (!this.tracked && previous === this.runtime) this.runtime?.suspend();
        }, 600);
    }

    async ensureCamera(page: ManifestPage) {
        if (!this.book || page.group === undefined || this.tracker) return;
        if (this.cameraTask) return this.cameraTask;
        const abort = new AbortController();
        this.cameraAbort = abort;
        const groups = this.book.targetGroups.map((group) => ({
            group: group.group,
            url: this.publicToken ? previewGroupUrl(this.publicToken, group.group) : group.mindUrl,
        }));
        this.cameraTask = (async () => {
            const [{ startTracking }, coords] = await Promise.all([
                import('../tracker/mindar'),
                import('../scene-core/coords'),
            ]);
            this.targetToPageMatrix = coords.targetToPageMatrix;
            abort.signal.throwIfAborted();
            this.ui.loading('Đang chuẩn bị camera…');
            const active = await startTracking(
                this.viewport,
                groups,
                page.group,
                abort.signal,
                {
                    update: (group, target, world, dimensions) => {
                        if (abort.signal.aborted || !this.book || this.mode !== 'ar') return;
                        this.cameraGroup = group;
                        const key = `${group}:${target}`;
                        if (world) this.matrices.set(key, { world, dimensions });
                        else this.matrices.delete(key);
                        const found = this.book.pages.findIndex(
                            (item) => item.group === group && item.targetIndex === target,
                        );
                        if (world && found >= 0) this.cameraRecognized = true;
                        if (world && found >= 0 && found !== this.index) {
                            this.callbacks.onArPageDetected?.(found);
                            void this.activate(found);
                            return;
                        }
                        if (
                            this.book.pages[this.index]?.group !== group ||
                            this.book.pages[this.index]?.targetIndex !== target
                        )
                            return;
                        if (world) this.showTracked(world, dimensions, this.book.pages[this.index]);
                        else this.lostTarget();
                    },
                    resize: (projection, width, height) => {
                        if (!abort.signal.aborted) this.stage?.setAR(projection, width, height);
                    },
                    searching: () => {
                        if (abort.signal.aborted) return;
                        this.lostTarget();
                        this.matrices.clear();
                        this.cameraGroup = null;
                        if (!this.runtimeStarted) this.status('Đang tìm trang trong sách…');
                    },
                    issue: (message) => {
                        if (!abort.signal.aborted) this.notice(message);
                    },
                },
                (signal) => this.cameraAccess.acquire(signal),
            );
            if (abort.signal.aborted) {
                active.stop();
                return;
            }
            this.tracker = active;
            this.stage?.setAR(active.projection, active.width, active.height);
            this.scanTimer = setTimeout(() => {
                if (!this.cameraRecognized && !abort.signal.aborted)
                    this.readingEvents?.record({ type: 'SCAN_TIMEOUT' });
            }, 10000);
        })();
        try {
            await this.cameraTask;
        } catch (error) {
            if (!abort.signal.aborted) throw error;
        } finally {
            if (this.cameraAbort === abort) this.cameraTask = null;
        }
    }

    async activate(next: number) {
        if (!this.book?.pages[next]) return;
        const sequence = ++this.generation;
        this.loading?.abort();
        const abort = new AbortController();
        this.loading = abort;
        this.ui.loading('Đang tải nội dung trang…');
        this.notice('');
        const old = this.runtime;
        if (this.lossTimer) clearTimeout(this.lossTimer);
        this.lossTimer = null;
        this.runtimeStarted = false;
        this.runtime = null;
        this.stage?.setRuntime(null);
        if (this.mode === 'ar') this.stage?.track(null);
        this.tracked = false;
        this.index = next;
        this.controls();
        if (
            this.mode === 'ar' &&
            this.matrices.has(`${this.book.pages[next].group}:${this.book.pages[next].targetIndex}`)
        )
            this.ui.scan(true);
        get('tap-section').hidden = true;
        get('rule-section').hidden = true;
        get('external-link').hidden = true;
        try {
            if (old) {
                this.retiring.add(old);
                try {
                    await old.leave();
                } finally {
                    old.dispose();
                    this.retiring.delete(old);
                }
            }
            if (sequence !== this.generation || !this.book || abort.signal.aborted) return;
            const page = this.book.pages[this.index];
            await document.fonts.ready;
            const [{ Stage }, { buildScene }] = await Promise.all([
                import('../scene-core/Stage'),
                import('../scene-core/buildScene'),
            ]);
            abort.signal.throwIfAborted();
            this.viewport.hidden = false;
            if (!this.stage) this.stage = new Stage(this.viewport);
            if (this.mode === 'ar') {
                await this.ensureCamera(page);
                abort.signal.throwIfAborted();
                this.ui.loading('Đang tải nội dung trang…');
            }
            if (this.mode === 'ar' && page.marker.mode === 'NONE') {
                this.clearCamera();
                this.mode = '3d';
                this.stage.setAR(null);
                this.notice('Trang này không có marker; đang xem 3D.');
            }
            const created = await buildScene(page, this.book.assets, abort.signal, {
                notice: (msg) => this.notice(msg),
                log: (msg) => this.log(msg),
                tap: (objectId) =>
                    this.readingEvents?.record({ type: 'TAP', pageId: page.pageId, objectId }),
                link: (url) => {
                    get<HTMLAnchorElement>('link').href = url;
                    get<HTMLAnchorElement>('link').textContent =
                        `Mở liên kết: ${new URL(url).hostname}`;
                    get('external-link').hidden = false;
                },
            });
            if (sequence !== this.generation || abort.signal.aborted) {
                created.dispose();
                return;
            }
            this.runtime = created;
            this.stage.setRuntime(created, page);
            this.runtime.mute(this.muted);
            this.buttons(page);
            if (this.mode === 'ar') {
                const matrix =
                    page.targetIndex !== undefined && page.group === this.cameraGroup
                        ? this.matrices.get(`${page.group}:${page.targetIndex}`)
                        : undefined;
                if (matrix) this.showTracked(matrix.world, matrix.dimensions, page);
                else {
                    this.ui.scan(false);
                    this.status('Hướng camera vào trang sách hoặc marker đã in.');
                }
            } else {
                this.stage.setAR(null);
                this.runtimeStarted = true;
                this.runtime.start();
                this.status('Chạm để khám phá. Kéo để xoay, chụm hai ngón để thu phóng.');
            }
            await new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            );
            if (sequence !== this.generation || abort.signal.aborted) return;
            this.ui.loading();
            this.controls();
            this.reply('started');
        } catch (error) {
            if (sequence !== this.generation || abort.signal.aborted) return;
            this.stop('Chưa mở được nội dung. Bạn có thể thử lại hoặc chọn xem 3D.');
            this.notice(
                error instanceof Error && /WebGL/i.test(error.message)
                    ? 'Trình duyệt chưa tạo được WebGL. Hãy thử Chrome/Edge/Safari có tăng tốc đồ họa hoặc mở lại trình duyệt.'
                    : error instanceof Error
                      ? error.message
                      : 'Không mở được trang.',
            );
            this.reply('error');
        }
    }

    showOverview(message = '') {
        this.stop(message);
        this.notice('');
    }

    async showPage(pageIndex: number): Promise<void> {
        if (!this.book) return;
        this.clearCamera();
        this.mode = '3d';
        this.stage?.setAR(null);
        this.ui.view('read');
        this.notice('');
        await this.activate(pageIndex);
    }

    showCamera() {
        if (this.embedded || !this.book?.pages.some((page) => page.marker.mode !== 'NONE')) return;
        this.stop('');
        this.notice('');
        get<HTMLInputElement>('camera-access-sound').checked = !this.muted;
        this.ui.view('camera-access');
        this.ui.cameraPermission('intro');
    }

    async requestCamera(): Promise<boolean> {
        if (
            this.embedded ||
            !this.book ||
            document.hidden ||
            get('main').dataset.view !== 'camera-access' ||
            get('main').dataset.cameraPermission === 'requesting'
        )
            return false;
        const sequence = this.generation;
        this.ui.cameraPermission('requesting');
        try {
            await this.cameraAccess.prepare();
            if (
                sequence !== this.generation ||
                document.hidden ||
                get('main').dataset.view !== 'camera-access'
            )
                return false;
            return true;
        } catch (error) {
            if (
                sequence !== this.generation ||
                get('main').dataset.view !== 'camera-access' ||
                (error instanceof Error && error.name === 'AbortError')
            )
                return false;
            const denied =
                error instanceof DOMException &&
                ['NotAllowedError', 'PermissionDeniedError'].includes(error.name);
            this.ui.cameraPermission(
                denied ? 'denied' : 'error',
                denied ? undefined : cameraError(error).message,
            );
            return false;
        }
    }

    async showAr(preferredIndex?: number): Promise<void> {
        if (this.embedded || !this.book) return;
        this.clearCamera(true);
        this.mode = 'ar';
        this.ui.view('ar');
        this.notice('');

        const target =
            preferredIndex !== undefined && this.book.pages[preferredIndex]
                ? preferredIndex
                : this.book.pages[this.index]?.marker.mode === 'NONE'
                  ? this.book.pages.findIndex((page) => page.marker.mode !== 'NONE')
                  : this.index;

        if (target < 0) {
            await this.showPage(0);
            return;
        }
        await this.activate(target);
    }

    setMuted(value: boolean) {
        this.muted = value;
        get('mute').setAttribute('aria-pressed', String(this.muted));
        get<HTMLInputElement>('camera-access-sound').checked = !this.muted;
        setMuteIcon(this.muted);
        this.runtime?.mute(this.muted);
    }

    resetView() {
        this.stage?.resetView();
    }

    retryMedia() {
        if (this.mode === 'ar' && !this.tracked) {
            this.notice('Hướng camera vào trang trước khi phát media.');
            return;
        }
        this.runtime?.retryMedia();
        this.notice('');
    }

    restart() {
        if (this.runtime && (this.mode !== 'ar' || this.tracked)) this.runtime.start();
    }

    private attachDOMListeners() {
        const on = (el: HTMLElement, event: string, handler: EventListener) => {
            el.addEventListener(event, handler);
            this.listeners.push(() => el.removeEventListener(event, handler));
        };

        on(get('camera-access-allow'), 'click', () => {
            void (async () => {
                const granted = await this.requestCamera();
                if (granted) {
                    this.callbacks.onCameraAccessAllow?.();
                }
            })();
        });

        on(get('camera-access-back'), 'click', () => {
            this.notice('');
            this.stop('');
            this.callbacks.onCameraAccessBack?.();
        });

        on(get('camera-access-sound'), 'change', () => {
            this.setMuted(!get<HTMLInputElement>('camera-access-sound').checked);
        });

        on(get('start'), 'click', () => {
            if (this.ui.scanEntry && this.book?.pages.some((page) => page.marker.mode !== 'NONE')) {
                this.callbacks.onStartCamera?.();
            } else {
                this.callbacks.onStartReading?.();
            }
        });

        on(get('welcome-camera'), 'click', () => {
            if (this.ui.scanEntry) {
                this.callbacks.onStartReading?.();
            } else {
                this.callbacks.onStartCamera?.();
            }
        });

        on(get('camera'), 'click', () => {
            this.callbacks.onStartCamera?.();
        });

        on(get('read-fallback'), 'click', () => {
            get<HTMLDialogElement>('help-dialog').close();
            this.callbacks.onFallbackToReading?.();
        });

        on(get('restart'), 'click', () => {
            this.restart();
        });

        on(get('feedback-dismiss'), 'click', () => this.notice(''));

        on(get('feedback-retry'), 'click', () => {
            if (this.book) {
                if (this.mode === 'ar') this.callbacks.onStartCamera?.();
                else this.callbacks.onStartReading?.();
            } else {
                this.callbacks.onRetry?.();
            }
        });

        on(get('home-link'), 'click', () => {
            this.notice('');
            this.stop('');
            this.callbacks.onNavigateHome?.();
        });

        on(get('reset'), 'click', () => this.resetView());

        on(get('retry-media'), 'click', () => this.retryMedia());

        on(get('mute'), 'click', () => this.setMuted(!this.muted));

        on(this.select, 'change', () => {
            const next = Number(this.select.value);
            this.callbacks.onPageChange?.(next);
        });

        on(get('previous'), 'click', () => {
            const next = Math.max(0, this.index - 1);
            this.callbacks.onPageChange?.(next);
        });

        on(get('next'), 'click', () => {
            const next = Math.min((this.book?.pages.length || 1) - 1, this.index + 1);
            this.callbacks.onPageChange?.(next);
        });

        on(get('dismiss-link'), 'click', () => {
            get('external-link').hidden = true;
        });

        on(this.viewport, 'ar-content-visibility', ((event: CustomEvent<string>) => {
            if (this.mode !== 'ar' || !this.tracked || !this.runtime) return;
            const visibility = event.detail;
            if (visibility === 'behind')
                this.ui.status('Đã nhận diện. Lùi camera ra xa để thấy nội dung AR.', {
                    persistent: true,
                });
            else if (visibility === 'outside')
                this.ui.status('Đã nhận diện. Hướng camera vào toàn trang để thấy nội dung AR.', {
                    persistent: true,
                });
            else if (visibility === 'visible' || visibility === 'empty')
                this.status(`Đã nhận diện trang ${this.index + 1}. Chạm để khám phá.`);
        }) as EventListener);

        on(this.viewport, 'stage-error', ((event: CustomEvent<string>) => {
            this.stop('Đã dừng xem.');
            this.notice(event.detail);
        }) as EventListener);

        const onPageHide = () => this.stop();
        window.addEventListener('pagehide', onPageHide);
        this.listeners.push(() => window.removeEventListener('pagehide', onPageHide));

        const onVisibilityChange = () => {
            if (document.hidden) {
                if (this.stage)
                    this.stop(
                        'Đã dừng khi chuyển sang ứng dụng/tab khác. Bấm Bắt đầu để xem tiếp.',
                    );
                else {
                    this.cameraAccess.clear();
                    if (get('main').dataset.view === 'camera-access') {
                        this.generation++;
                        this.ui.cameraPermission('intro');
                    }
                }
            }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        this.listeners.push(() =>
            document.removeEventListener('visibilitychange', onVisibilityChange),
        );
    }

    dispose() {
        this.stop();
        for (const cleanup of this.listeners) cleanup();
        this.listeners = [];
    }
}
