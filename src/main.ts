import { CameraAccess, cameraError } from './camera-access';
import { createReaderUI, setMuteIcon } from './reader-ui';
import { installReportForm } from './report-form';
import type { PageRuntime } from './scene-core/buildScene';
import type { Stage } from './scene-core/Stage';
import {
    BookUnavailableError,
    loadPreview,
    loadPublicInfo,
    loadPublished,
    PreviewUnavailableError,
    previewGroupUrl,
    tokenPattern,
} from './shared/api';
import { SlugSchema } from './shared/contracts/common.schema';
import type { Manifest, ManifestPage } from './shared/contracts/manifest.schema';
import { PreviewMessageSchema, RunMessageSchema, trustedMessage } from './shared/protocol';
import { startReadingEvents } from './shared/reading-events';

const get = <T extends HTMLElement>(id: string) => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing ${id}`);
    return element as T;
};
const viewport = get<HTMLDivElement>('viewport'),
    select = get<HTMLSelectElement>('pages');
const ui = createReaderUI((next) => {
    if (!book?.pages[next]) return;
    if (mode === 'ar') {
        const page = book.pages[next];
        if (page.group !== undefined) tracker?.prefer(page.group);
        status(`Hướng camera vào trang ${next + 1}.`);
    } else if (stage) void activate(next);
    else {
        index = next;
        controls();
    }
});
const status = (message: string) => ui.status(message);
const notice = (message: string) => ui.notice(message);
const embedded = location.pathname === '/embed';
document.documentElement.classList.toggle('viewer-embedded', embedded);
const publicToken = location.pathname.match(/^\/preview\/([A-Za-z0-9_-]{32})\/?$/)?.[1];
const publicSlug = location.pathname.match(/^\/b\/([^/]+)\/?$/)?.[1];
const parameters = new URLSearchParams(location.hash.slice(1));
const parentOrigin = import.meta.env.VITE_STUDIO_ORIGIN || 'http://localhost:5173';
const nonce = parameters.get('nonce') || '';
const validEmbed =
    embedded &&
    window.parent !== window &&
    /^[0-9a-f-]{36}$/i.test(nonce) &&
    parameters.get('parent') === parentOrigin;
const reply = (state: string, requestId?: number) => {
    if (validEmbed)
        window.parent.postMessage(
            { type: 'BOOKARIA_STATUS', nonce, status: state, requestId },
            parentOrigin,
        );
};
type Book = Pick<Manifest, 'title' | 'pages' | 'assets' | 'targetGroups' | 'credits'>;
let book: Book | null = null,
    index = 0,
    mode: '3d' | 'ar' = '3d',
    stage: Stage | null = null,
    runtime: PageRuntime | null = null;
let loading: AbortController | null = null,
    cameraAbort: AbortController | null = null,
    generation = 0,
    muted = false,
    tracked = false,
    cameraGroup: number | null = null;
let tracker: Awaited<ReturnType<typeof import('./tracker/mindar').startTracking>> | null = null;
const cameraAccess = new CameraAccess();
const retiring = new Set<PageRuntime>();
const matrices = new Map<string, { world: number[]; dimensions: [number, number] }>();
let cameraTask: Promise<void> | null = null,
    scanTimer: ReturnType<typeof setTimeout> | null = null;
let lastRequestId = 0;
let readingEvents: ReturnType<typeof startReadingEvents> | null = null;
let disposeReport: (() => void) | null = null;
let cameraRecognized = false;
let runtimeStarted = false;
let lossTimer: ReturnType<typeof setTimeout> | null = null;
let targetToPageMatrix: typeof import('./scene-core/coords').targetToPageMatrix;
const log = (message: string) => {
    if (!embedded) return;
    const item = document.createElement('li');
    item.textContent = message;
    get('events').prepend(item);
    while (get('events').children.length > 20) get('events').lastElementChild?.remove();
};
function controls() {
    get<HTMLButtonElement>('reset').disabled = !stage || mode === 'ar';
    get<HTMLButtonElement>('retry-media').disabled = !runtime;
    get<HTMLButtonElement>('previous').disabled = !book || index === 0;
    get<HTMLButtonElement>('next').disabled = !book || index === book.pages.length - 1;
    get<HTMLButtonElement>('camera').disabled =
        embedded || !book?.pages.some((page) => page.marker.mode !== 'NONE');
    get<HTMLButtonElement>('restart').disabled = !runtime || (mode === 'ar' && !tracked);
    select.value = String(index);
    ui.navigation(index, mode === 'ar', tracked);
}
function clearCamera(keepPrepared = false) {
    if (!keepPrepared) cameraAccess.clear();
    if (lossTimer) clearTimeout(lossTimer);
    lossTimer = null;
    cameraAbort?.abort();
    cameraAbort = null;
    tracker?.stop();
    tracker = null;
    cameraTask = null;
    cameraGroup = null;
    matrices.clear();
    tracked = false;
    cameraRecognized = false;
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = null;
}
function stop(message = 'Đã dừng xem. Bấm Bắt đầu để xem lại.') {
    generation++;
    loading?.abort();
    loading = null;
    clearCamera();
    runtime?.dispose();
    for (const previous of retiring) previous.dispose();
    retiring.clear();
    runtime = null;
    stage?.dispose();
    stage = null;
    viewport.hidden = true;
    get('tap-section').hidden = true;
    get('rule-section').hidden = true;
    get('external-link').hidden = true;
    controls();
    ui.loading();
    ui.view('welcome');
    status(message);
    reply('stopped');
}
function install(value: Book) {
    book = value;
    index = 0;
    ui.ready(value);
    get('title').textContent = value.title;
    document.title = `${value.title} — Bookaria`;
    select.replaceChildren(
        ...value.pages.map((page, index) => {
            const option = document.createElement('option');
            option.value = String(index);
            option.textContent = `${index + 1}. ${page.title || 'Trang sách'}${page.marker.mode === 'NONE' ? ' · Không có marker AR' : ''}`;
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
    controls();
}
function buttons(page: ManifestPage) {
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
            if (mode === 'ar' && !tracked) {
                notice('Hướng camera vào trang trước khi tương tác.');
                return;
            }
            runtime?.tap(object.id);
        });
        get('tap-objects').append(button);
    }
    if (embedded)
        for (const rule of page.scene.interactions) {
            const button = document.createElement('button');
            button.className = 'reader-button';
            button.type = 'button';
            button.textContent = `Chạy: ${rule.name || 'Quy tắc chưa đặt tên'}`;
            button.disabled = !rule.enabled;
            button.addEventListener('click', () => {
                void runtime?.runner.run(rule.id);
            });
            get('rules').append(button);
        }
    get('tap-section').hidden = !targets.size;
    get('rule-section').hidden = !embedded || !page.scene.interactions.length;
    get('logs').hidden = !embedded;
}
function showTracked(world: number[], dimensions: [number, number], page: ManifestPage) {
    if (!runtime) return;
    stage?.track(targetToPageMatrix(world, ...dimensions, page));
    if (!tracked) {
        if (lossTimer) clearTimeout(lossTimer);
        lossTimer = null;
        tracked = true;
        readingEvents?.record({ type: 'PAGE_FOUND', pageId: page.pageId });
        if (runtimeStarted) runtime.resume();
        else {
            runtimeStarted = true;
            runtime.start();
        }
        ui.scan(true);
        controls();
        status(`Đã nhận diện trang ${index + 1}. Chạm để khám phá.`);
    }
}
function lostTarget() {
    if (!tracked) return;
    tracked = false;
    stage?.track(null);
    ui.scan(false);
    controls();
    status('Đưa camera trở lại trang sách.');
    if (lossTimer) clearTimeout(lossTimer);
    const previous = runtime;
    lossTimer = setTimeout(() => {
        if (!tracked && previous === runtime) runtime?.suspend();
    }, 600);
}
async function ensureCamera(page: ManifestPage) {
    if (!book || page.group === undefined || tracker) return;
    if (cameraTask) return cameraTask;
    const abort = new AbortController();
    cameraAbort = abort;
    const groups = book.targetGroups.map((group) => ({
        group: group.group,
        url: publicToken ? previewGroupUrl(publicToken, group.group) : group.mindUrl,
    }));
    cameraTask = (async () => {
        const [{ startTracking }, coords] = await Promise.all([
            import('./tracker/mindar'),
            import('./scene-core/coords'),
        ]);
        targetToPageMatrix = coords.targetToPageMatrix;
        abort.signal.throwIfAborted();
        ui.loading('Đang chuẩn bị camera…');
        const active = await startTracking(
            viewport,
            groups,
            page.group,
            abort.signal,
            {
                update: (group, target, world, dimensions) => {
                    if (abort.signal.aborted || !book || mode !== 'ar') return;
                    cameraGroup = group;
                    const key = `${group}:${target}`;
                    if (world) matrices.set(key, { world, dimensions });
                    else matrices.delete(key);
                    const found = book.pages.findIndex(
                        (item) => item.group === group && item.targetIndex === target,
                    );
                    if (world && found >= 0) cameraRecognized = true;
                    if (world && found >= 0 && found !== index) {
                        void activate(found);
                        return;
                    }
                    if (
                        book.pages[index]?.group !== group ||
                        book.pages[index]?.targetIndex !== target
                    )
                        return;
                    if (world) showTracked(world, dimensions, book.pages[index]);
                    else lostTarget();
                },
                resize: (projection, width, height) => {
                    if (!abort.signal.aborted) stage?.setAR(projection, width, height);
                },
                searching: () => {
                    if (abort.signal.aborted) return;
                    lostTarget();
                    matrices.clear();
                    cameraGroup = null;
                    if (!runtimeStarted) status('Đang tìm trang trong sách…');
                },
                issue: (message) => {
                    if (!abort.signal.aborted) notice(message);
                },
            },
            (signal) => cameraAccess.acquire(signal),
        );
        if (abort.signal.aborted) {
            active.stop();
            return;
        }
        tracker = active;
        stage?.setAR(active.projection, active.width, active.height);
        scanTimer = setTimeout(() => {
            if (!cameraRecognized && !abort.signal.aborted)
                readingEvents?.record({ type: 'SCAN_TIMEOUT' });
        }, 10000);
    })();
    try {
        await cameraTask;
    } catch (error) {
        if (!abort.signal.aborted) throw error;
    } finally {
        if (cameraAbort === abort) cameraTask = null;
    }
}
async function activate(next: number) {
    if (!book?.pages[next]) return;
    const sequence = ++generation;
    loading?.abort();
    const abort = new AbortController();
    loading = abort;
    ui.loading('Đang tải nội dung trang…');
    notice('');
    const old = runtime;
    if (lossTimer) clearTimeout(lossTimer);
    lossTimer = null;
    runtimeStarted = false;
    runtime = null;
    stage?.setRuntime(null);
    if (mode === 'ar') stage?.track(null);
    tracked = false;
    index = next;
    controls();
    if (mode === 'ar' && matrices.has(`${book.pages[next].group}:${book.pages[next].targetIndex}`))
        ui.scan(true);
    get('tap-section').hidden = true;
    get('rule-section').hidden = true;
    get('external-link').hidden = true;
    try {
        if (old) {
            retiring.add(old);
            try {
                await old.leave();
            } finally {
                old.dispose();
                retiring.delete(old);
            }
        }
        if (sequence !== generation || !book || abort.signal.aborted) return;
        const page = book.pages[index];
        await document.fonts.ready;
        const [{ Stage }, { buildScene }] = await Promise.all([
            import('./scene-core/Stage'),
            import('./scene-core/buildScene'),
        ]);
        abort.signal.throwIfAborted();
        viewport.hidden = false;
        if (!stage) stage = new Stage(viewport);
        if (mode === 'ar') {
            await ensureCamera(page);
            abort.signal.throwIfAborted();
            ui.loading('Đang tải nội dung trang…');
        }
        if (mode === 'ar' && page.marker.mode === 'NONE') {
            clearCamera();
            mode = '3d';
            stage.setAR(null);
            notice('Trang này không có marker; đang xem 3D.');
        }
        const created = await buildScene(page, book.assets, abort.signal, {
            notice,
            log,
            tap: (objectId) =>
                readingEvents?.record({ type: 'TAP', pageId: page.pageId, objectId }),
            link: (url) => {
                get<HTMLAnchorElement>('link').href = url;
                get<HTMLAnchorElement>('link').textContent =
                    `Mở liên kết: ${new URL(url).hostname}`;
                get('external-link').hidden = false;
            },
        });
        if (sequence !== generation || abort.signal.aborted) {
            created.dispose();
            return;
        }
        runtime = created;
        stage.setRuntime(created, page);
        runtime.mute(muted);
        buttons(page);
        if (mode === 'ar') {
            const matrix =
                page.targetIndex !== undefined && page.group === cameraGroup
                    ? matrices.get(`${page.group}:${page.targetIndex}`)
                    : undefined;
            if (matrix) showTracked(matrix.world, matrix.dimensions, page);
            else {
                ui.scan(false);
                status('Hướng camera vào trang sách hoặc marker đã in.');
            }
        } else {
            stage.setAR(null);
            runtimeStarted = true;
            runtime.start();
            status('Chạm để khám phá. Kéo để xoay, chụm hai ngón để thu phóng.');
        }
        // Let the render loop draw the prepared scene before revealing it.
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        if (sequence !== generation || abort.signal.aborted) return;
        ui.loading();
        controls();
        reply('started');
    } catch (error) {
        if (sequence !== generation || abort.signal.aborted) return;
        stop('Chưa mở được nội dung. Bạn có thể thử lại hoặc chọn xem 3D.');
        notice(
            error instanceof Error && /WebGL/i.test(error.message)
                ? 'Trình duyệt chưa tạo được WebGL. Hãy thử Chrome/Edge/Safari có tăng tốc đồ họa hoặc mở lại trình duyệt.'
                : error instanceof Error
                  ? error.message
                  : 'Không mở được trang.',
        );
        reply('error');
    }
}
function startReading() {
    if (!book) return;
    clearCamera();
    mode = '3d';
    stage?.setAR(null);
    ui.view('read');
    notice('');
    void activate(index);
}
function openScanner() {
    if (embedded || !book) return;
    clearCamera(true);
    mode = 'ar';
    ui.view('ar');
    notice('');
    const target =
        book.pages[index].marker.mode === 'NONE'
            ? book.pages.findIndex((page) => page.marker.mode !== 'NONE')
            : index;
    if (target < 0) {
        startReading();
        return;
    }
    void activate(target);
}
function startCamera() {
    if (embedded || !book?.pages.some((page) => page.marker.mode !== 'NONE')) return;
    stop('');
    notice('');
    get<HTMLInputElement>('camera-access-sound').checked = !muted;
    ui.view('camera-access');
    ui.cameraPermission('intro');
}
async function requestCamera() {
    if (
        embedded ||
        !book ||
        document.hidden ||
        get('main').dataset.view !== 'camera-access' ||
        get('main').dataset.cameraPermission === 'requesting'
    )
        return;
    const sequence = generation;
    ui.cameraPermission('requesting');
    try {
        await cameraAccess.prepare();
        if (
            sequence !== generation ||
            document.hidden ||
            get('main').dataset.view !== 'camera-access'
        )
            return;
        openScanner();
    } catch (error) {
        if (
            sequence !== generation ||
            get('main').dataset.view !== 'camera-access' ||
            (error instanceof Error && error.name === 'AbortError')
        )
            return;
        const denied =
            error instanceof DOMException &&
            ['NotAllowedError', 'PermissionDeniedError'].includes(error.name);
        ui.cameraPermission(
            denied ? 'denied' : 'error',
            denied ? undefined : cameraError(error).message,
        );
    }
}
get('camera-access-allow').addEventListener('click', () => {
    void requestCamera();
});
get('camera-access-back').addEventListener('click', () => {
    notice('');
    stop('');
});
function setMuted(value: boolean) {
    muted = value;
    get('mute').setAttribute('aria-pressed', String(muted));
    get<HTMLInputElement>('camera-access-sound').checked = !muted;
    setMuteIcon(muted);
    runtime?.mute(muted);
}
get('camera-access-sound').addEventListener('change', () => {
    setMuted(!get<HTMLInputElement>('camera-access-sound').checked);
});
get('start').addEventListener('click', () => {
    if (ui.scanEntry && book?.pages.some((page) => page.marker.mode !== 'NONE')) startCamera();
    else startReading();
});
get('welcome-camera').addEventListener('click', () =>
    ui.scanEntry ? startReading() : startCamera(),
);
get('camera').addEventListener('click', startCamera);
get('read-fallback').addEventListener('click', () => {
    get<HTMLDialogElement>('help-dialog').close();
    startReading();
});
get('restart').addEventListener('click', () => {
    if (runtime && (mode !== 'ar' || tracked)) runtime.start();
});
get('feedback-dismiss').addEventListener('click', () => notice(''));
get('feedback-retry').addEventListener('click', () => {
    if (book) {
        if (mode === 'ar') startCamera();
        else startReading();
    } else get('retry').click();
});
get('home-link').addEventListener('click', () => {
    notice('');
    stop('');
});
get('reset').addEventListener('click', () => stage?.resetView());
get('retry-media').addEventListener('click', () => {
    if (mode === 'ar' && !tracked) {
        notice('Hướng camera vào trang trước khi phát media.');
        return;
    }
    runtime?.retryMedia();
    notice('');
});
get('mute').addEventListener('click', () => setMuted(!muted));
select.addEventListener('change', () => {
    if (stage) void activate(Number(select.value));
    else {
        index = Number(select.value);
        controls();
    }
});
get('previous').addEventListener('click', () => {
    if (stage) void activate(index - 1);
    else {
        index = Math.max(0, index - 1);
        controls();
    }
});
get('next').addEventListener('click', () => {
    if (stage) void activate(index + 1);
    else {
        index = Math.min((book?.pages.length || 1) - 1, index + 1);
        controls();
    }
});
get('dismiss-link').addEventListener('click', () => {
    get('external-link').hidden = true;
});
viewport.addEventListener('ar-content-visibility', (event) => {
    if (mode !== 'ar' || !tracked || !runtime) return;
    const visibility = (event as CustomEvent<string>).detail;
    if (visibility === 'behind')
        ui.status('Đã nhận diện. Lùi camera ra xa để thấy nội dung AR.', { persistent: true });
    else if (visibility === 'outside')
        ui.status('Đã nhận diện. Hướng camera vào toàn trang để thấy nội dung AR.', {
            persistent: true,
        });
    else if (visibility === 'visible' || visibility === 'empty')
        status(`Đã nhận diện trang ${index + 1}. Chạm để khám phá.`);
});
viewport.addEventListener('stage-error', (event) => {
    stop('Đã dừng xem.');
    notice((event as CustomEvent<string>).detail);
});
window.addEventListener('pagehide', () => stop());
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (stage) stop('Đã dừng khi chuyển sang ứng dụng/tab khác. Bấm Bắt đầu để xem tiếp.');
        else {
            cameraAccess.clear();
            if (get('main').dataset.view === 'camera-access') {
                generation++;
                ui.cameraPermission('intro');
            }
        }
    }
});

if (embedded) {
    if (!validEmbed) {
        ui.loading();
        status('Không mở được bản xem nhúng.');
        notice('Hãy mở lại từ Studio đúng địa chỉ đã cấu hình.');
    } else {
        status('Đang chờ nội dung từ Studio…');
        ui.loading('Đang chờ nội dung từ Studio…');
        get('subtitle').textContent = 'Bản xem trước nội dung đang sửa; không thay đổi bản đã lưu.';
        get('camera-hint').hidden = true;
        window.addEventListener('message', (event) => {
            if (!trustedMessage(event, window.parent, parentOrigin) || event.data?.nonce !== nonce)
                return;
            const run = RunMessageSchema.safeParse(event.data);
            if (run.success) {
                void runtime?.runner.run(run.data.ruleId);
                return;
            }
            const parsed = PreviewMessageSchema.safeParse(event.data);
            if (!parsed.success || parsed.data.requestId <= lastRequestId) return;
            lastRequestId = parsed.data.requestId;
            const wasRunning = Boolean(stage);
            stop('Nội dung đã sẵn sàng. Bấm Bắt đầu xem 3D.');
            install({
                title: parsed.data.payload.title,
                pages: [parsed.data.payload.page],
                assets: parsed.data.payload.assets,
                targetGroups: [],
                credits: [],
            });
            reply('loaded', lastRequestId);
            if (wasRunning) {
                ui.view('read');
                void activate(0);
            }
        });
        window.parent.postMessage({ type: 'BOOKARIA_READY', nonce }, parentOrigin);
    }
} else if (publicSlug) {
    let request: AbortController | null = null;
    let availability: ReturnType<typeof setInterval> | null = null;
    let versionId = '';
    let checking = false;
    const clearPublication = (message: string) => {
        readingEvents?.dispose();
        readingEvents = null;
        disposeReport?.();
        disposeReport = null;
        stop(message);
        book = null;
        get('main').dataset.ready = 'false';
        get<HTMLButtonElement>('start').disabled = true;
        versionId = '';
        get('controls').hidden = true;
        get('credits-section').hidden = true;
        get('publication-info').hidden = true;
        get('retry').hidden = false;
        if (availability) clearInterval(availability);
        availability = null;
    };
    async function checkAvailability() {
        if (checking || !versionId) return;
        checking = true;
        const abort = new AbortController();
        const deadline = setTimeout(() => abort.abort(), 15000);
        const expected = versionId;
        try {
            const current = await loadPublicInfo(publicSlug || '', abort.signal);
            if (versionId !== expected) return;
            if (current.version.id !== expected) {
                clearPublication(
                    'Tác giả vừa xuất bản phiên bản mới. Bấm Thử tải lại để mở bản mới.',
                );
            }
        } catch (error) {
            if (versionId === expected) {
                clearPublication(
                    error instanceof BookUnavailableError
                        ? 'Sách không còn khả dụng.'
                        : 'Chưa kiểm tra được trạng thái sách. Bấm Thử tải lại để kết nối lại.',
                );
                notice(error instanceof Error ? error.message : 'Không tải được sách.');
            }
        } finally {
            clearTimeout(deadline);
            checking = false;
        }
    }
    async function load() {
        if (!SlugSchema.safeParse(publicSlug).success) {
            ui.loading();
            status('Liên kết sách không hợp lệ.');
            return;
        }
        request?.abort();
        const abort = new AbortController();
        request = abort;
        clearPublication('Đang tải sách đã xuất bản…');
        get('retry').hidden = true;
        notice('');
        ui.loading('Đang mở sách…');
        try {
            const { info, manifest } = await loadPublished(publicSlug || '', abort.signal);
            if (abort.signal.aborted) return;
            versionId = info.version.id;
            install(manifest);
            readingEvents = startReadingEvents(info.version.id);
            disposeReport = installReportForm(publicSlug || '', manifest.pages);
            ui.metadata(info);
            get('publication-description').textContent = info.description || '';
            get('publication-description').hidden = !info.description;
            const pdf = get<HTMLAnchorElement>('published-pdf');
            pdf.hidden = !info.printPdfUrl;
            if (info.printPdfUrl) pdf.href = info.printPdfUrl;
            get('publication-info').hidden = false;
            status('');
            availability = setInterval(() => {
                void checkAvailability();
            }, 60000);
        } catch (error) {
            if (abort.signal.aborted) return;
            clearPublication('Chưa mở được sách đã xuất bản.');
            notice(error instanceof Error ? error.message : 'Không tải được sách.');
        }
    }
    get('retry').addEventListener('click', () => {
        void load();
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) void checkAvailability();
    });
    window.addEventListener('pagehide', () => {
        request?.abort();
        if (availability) clearInterval(availability);
    });
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) void load();
    });
    void load();
} else {
    const token = location.pathname.match(/^\/preview\/([A-Za-z0-9_-]+)\/?$/)?.[1];
    let request: AbortController | null = null;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    let availabilityTimer: ReturnType<typeof setInterval> | null = null;
    function expire() {
        stop('Bản xem trước không còn khả dụng.');
        book = null;
        get('main').dataset.ready = 'false';
        get<HTMLButtonElement>('start').disabled = true;
        get('controls').hidden = true;
        notice('Liên kết đã hết hạn hoặc không còn khả dụng. Hãy tạo liên kết mới từ Studio.');
        if (expiryTimer) clearTimeout(expiryTimer);
        if (availabilityTimer) clearInterval(availabilityTimer);
    }
    async function load() {
        if (!token || !tokenPattern.test(token)) {
            ui.loading();
            if (location.pathname === '/') {
                ui.empty();
                status('');
            } else status('Liên kết xem trước không hợp lệ.');
            return;
        }
        request?.abort();
        request = new AbortController();
        status('Đang tải bản xem trước…');
        notice('');
        get('retry').hidden = true;
        ui.loading('Đang mở bản xem trước…');
        try {
            const result = await loadPreview(token, request.signal);
            install(result.manifest);
            status('');
            get('subtitle').textContent = result.expiresAt
                ? `Bản xem trước tạm thời · Hết hạn ${new Date(result.expiresAt).toLocaleString('vi-VN')}`
                : 'Bản xem trước tạm thời, không phải bản xuất bản.';
            const remaining = result.expiresAt
                ? new Date(result.expiresAt).getTime() - Date.now()
                : Number.NaN;
            if (expiryTimer) clearTimeout(expiryTimer);
            if (availabilityTimer) clearInterval(availabilityTimer);
            if (Number.isFinite(remaining))
                expiryTimer = setTimeout(expire, Math.max(0, remaining));
            availabilityTimer = setInterval(() => {
                if (!book) return;
                const abort = new AbortController();
                const deadline = setTimeout(() => abort.abort(), 15000);
                loadPreview(token || '', abort.signal)
                    .catch((error) => {
                        if (error instanceof PreviewUnavailableError) expire();
                    })
                    .finally(() => clearTimeout(deadline));
            }, 60000);
        } catch (error) {
            if (request.signal.aborted) return;
            stop('Chưa tải được bản xem trước.');
            book = null;
            get('controls').hidden = true;
            notice(error instanceof Error ? error.message : 'Lỗi tải bản xem trước.');
            get('retry').hidden = false;
        }
    }
    get('retry').addEventListener('click', () => {
        void load();
    });
    void load();
}
