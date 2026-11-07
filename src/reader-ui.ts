import {
    BookOpen,
    Camera,
    CameraOff,
    CircleHelp,
    createElement,
    Download,
    Ellipsis,
    Flag,
    Focus,
    Hand,
    Info,
    LayoutGrid,
    Moon,
    RefreshCw,
    RotateCcw,
    Scan,
    ScanLine,
    Sun,
    Volume2,
    VolumeX,
    X,
} from 'lucide';
import { type ReaderNoticeOptions, readerFeedback } from './reader-feedback';
import type { PublicBook } from './shared/contracts/dto.schema';
import type { ManifestPage } from './shared/contracts/manifest.schema';

const icons = {
    BookOpen,
    Camera,
    CameraOff,
    CircleHelp,
    Download,
    Ellipsis,
    Focus,
    Flag,
    Hand,
    Info,
    LayoutGrid,
    Moon,
    RefreshCw,
    RotateCcw,
    Scan,
    ScanLine,
    Volume2,
    VolumeX,
    X,
};
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function paintIcons() {
    for (const item of document.querySelectorAll<HTMLElement>('[data-icon]')) {
        const icon = icons[item.dataset.icon as keyof typeof icons];
        if (icon) item.replaceWith(createElement(icon, { 'aria-hidden': 'true' }));
    }
}
export function setMuteIcon(muted: boolean) {
    const button = element<HTMLButtonElement>('mute');
    const label = muted ? 'Bật tiếng' : 'Tắt tiếng';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.replaceChildren(createElement(muted ? VolumeX : Volume2, { 'aria-hidden': 'true' }));
}
function setButtonIcon(buttonId: string, icon: typeof BookOpen) {
    element<HTMLButtonElement>(buttonId)
        .querySelector('svg')
        ?.replaceWith(createElement(icon, { 'aria-hidden': 'true' }));
}
export function createReaderUI(choose: (index: number) => void) {
    paintIcons();
    const scanner = createElement(ScanLine, {
        'aria-hidden': 'true',
        class: 'scan-outline absolute inset-0 size-full overflow-visible',
        // Fit Lucide's 3–21 artwork to the scanner area without scaling its stroke.
        viewBox: '3 3 18 18',
    });
    scanner.querySelector('path:last-of-type')?.classList.add('scan-sweep');
    element('scan-frame').replaceChildren(scanner);
    const main = element('main');
    const menu = element<HTMLDetailsElement>('reader-menu');
    let pageLoadingTimer: ReturnType<typeof setTimeout> | undefined;
    function pageLoading(message?: string) {
        clearTimeout(pageLoadingTimer);
        element('page-loading').hidden = true;
        element('viewport').setAttribute('aria-busy', String(message !== undefined));
        if (message !== undefined) {
            element('page-loading-message').textContent = message;
            pageLoadingTimer = setTimeout(() => {
                element('page-loading').hidden = false;
            }, 250);
        }
    }
    function loading(message?: string) {
        const active = message !== undefined;
        main.dataset.loading = String(active);
        element('reader-loading').hidden = !active;
        element('reader-loading').setAttribute('aria-busy', String(active));
        if (active) {
            pageLoading();
            element('reader-loading-message').textContent = message;
            menu.open = false;
            for (const modal of document.querySelectorAll<HTMLDialogElement>('dialog[open]'))
                modal.close();
        }
    }
    let bookPages: ManifestPage[] = [];
    let activeIndex = 0;
    let lastHighlighted = -1;
    let view: 'welcome' | 'read' | 'ar' | 'camera-access' = 'welcome';
    let statusTimer: ReturnType<typeof setTimeout> | undefined;
    let introductoryHint = false;
    element('viewport').addEventListener(
        'pointerdown',
        () => {
            if (view !== 'read' || !introductoryHint) return;
            clearTimeout(statusTimer);
            introductoryHint = false;
            element('reading-status').hidden = true;
        },
        { capture: true },
    );
    function updateContext() {
        element('reader-context').textContent =
            view === 'ar'
                ? main.dataset.tracking === 'found'
                    ? `Trang ${activeIndex + 1} — Đã nhận diện`
                    : 'Đang tìm trang sách'
                : view === 'read'
                  ? `Trang ${activeIndex + 1} / ${bookPages.length}`
                  : bookPages.length
                    ? `${bookPages.length} trang`
                    : 'Sách tương tác';
    }

    const scanEntry =
        location.pathname !== '/embed' && new URLSearchParams(location.search).get('mode') === 'ar';
    const isPreview = location.pathname.startsWith('/preview/') || location.pathname === '/embed';
    element('preview-badge').hidden = !isPreview;
    let helpReturnFocus: HTMLElement | null = null;
    function dialog(id: string) {
        if (id === 'help-dialog') {
            const active = document.activeElement as HTMLElement | null;
            helpReturnFocus = active?.closest('#reader-menu')
                ? menu.querySelector('summary')
                : active;
            const touch = matchMedia('(pointer: coarse)').matches;
            element('help-touch-controls').hidden = !touch;
            element('help-mouse-controls').hidden = touch;
            element('read-fallback').hidden = view !== 'ar';
        }
        menu.open = false;
        const modal = element<HTMLDialogElement>(id);
        if (!modal.open) modal.showModal();
        if (id === 'help-dialog') {
            element('help-title').focus({ preventScroll: true });
            modal.scrollTop = 0;
        }
    }
    element<HTMLDialogElement>('help-dialog').addEventListener('close', () => {
        if (
            helpReturnFocus?.isConnected &&
            helpReturnFocus.getClientRects().length &&
            getComputedStyle(helpReturnFocus).visibility !== 'hidden'
        )
            helpReturnFocus.focus({ preventScroll: true });
        helpReturnFocus = null;
    });
    for (const button of document.querySelectorAll<HTMLElement>('[data-close-dialog]'))
        button.addEventListener('click', () => button.closest('dialog')?.close());
    for (const modal of document.querySelectorAll('dialog'))
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                const box = modal.getBoundingClientRect();
                if (
                    event.clientX < box.left ||
                    event.clientX > box.right ||
                    event.clientY < box.top ||
                    event.clientY > box.bottom
                )
                    modal.close();
            }
        });
    element('book-info').addEventListener('click', () => dialog('info-dialog'));
    element('info-menu').addEventListener('click', () => dialog('info-dialog'));
    element('report-menu').addEventListener('click', () => dialog('report-dialog'));
    for (const id of ['help-menu', 'scan-help-button'])
        element(id).addEventListener('click', () => dialog('help-dialog'));
    const contents = () => {
        element('contents-hint').textContent =
            view === 'ar'
                ? 'Chọn trang để ưu tiên nhận diện. Camera vẫn tiếp tục hoạt động.'
                : `${bookPages.length} trang. Chọn trang bạn muốn đọc.`;
        dialog('contents-dialog');
        element('page-grid')
            .querySelector<HTMLElement>('[aria-current="page"]')
            ?.focus({ preventScroll: true });
    };
    element('contents').addEventListener('click', contents);
    document.addEventListener('pointerdown', (event) => {
        if (!menu.contains(event.target as Node)) menu.open = false;
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && menu.open) {
            menu.open = false;
            menu.querySelector('summary')?.focus();
        }
    });
    menu.addEventListener('click', (event) => {
        if ((event.target as Element).closest('button')) menu.open = false;
    });
    const themeMedia = matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = (dark: boolean) => {
        const root = document.documentElement;
        const label = dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';
        const welcomeToggle = element<HTMLButtonElement>('welcome-theme');
        welcomeToggle.title = label;
        welcomeToggle.setAttribute('aria-label', label);
        welcomeToggle.setAttribute('aria-pressed', String(dark));
        const toggle = element<HTMLButtonElement>('theme');
        toggle.title = dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';
        toggle.setAttribute('aria-pressed', String(dark));
        toggle.replaceChildren(
            createElement(dark ? Sun : Moon, { 'aria-hidden': 'true' }),
            document.createTextNode('Đổi sáng / tối'),
        );
        if (root.classList.contains('dark') === dark) return;
        root.dataset.themeSwitching = 'true';
        root.classList.toggle('dark', dark);
        requestAnimationFrame(() =>
            requestAnimationFrame(() => {
                delete root.dataset.themeSwitching;
            }),
        );
    };
    const syncTheme = () => {
        let saved: string | null = null;
        try {
            saved = localStorage.getItem('bookaria.theme');
        } catch {}
        applyTheme(saved === 'dark' || (saved !== 'light' && themeMedia.matches));
    };
    syncTheme();
    themeMedia.addEventListener('change', syncTheme);
    window.addEventListener('storage', syncTheme);
    const toggleTheme = () => {
        const dark = !document.documentElement.classList.contains('dark');
        applyTheme(dark);
        try {
            localStorage.setItem('bookaria.theme', dark ? 'dark' : 'light');
        } catch {}
    };
    element('theme').addEventListener('click', toggleTheme);
    element('welcome-theme').addEventListener('click', toggleTheme);
    document.addEventListener('keydown', (event) => {
        const target = event.target as HTMLElement;
        if (
            view !== 'read' ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            target.closest('input, textarea, select, dialog, [contenteditable="true"]') ||
            document.querySelector('dialog[open]') ||
            menu.open
        )
            return;
        const next =
            event.key === 'ArrowRight'
                ? activeIndex + 1
                : event.key === 'ArrowLeft'
                  ? activeIndex - 1
                  : -1;
        if (next >= 0 && next < bookPages.length) {
            event.preventDefault();
            choose(next);
        }
    });
    element('cover').addEventListener('error', () => {
        element('cover').hidden = true;
        element('cover-fallback').hidden = false;
    });
    element('page-strip').addEventListener(
        'wheel',
        (event) => {
            const strip = event.currentTarget as HTMLElement;
            if (
                Math.abs(event.deltaY) > Math.abs(event.deltaX) &&
                strip.scrollWidth > strip.clientWidth
            ) {
                event.preventDefault();
                strip.scrollLeft += event.deltaY;
            }
        },
        { passive: false },
    );
    function thumbnail(page: ManifestPage, index: number, grid: boolean) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = grid
            ? 'reader-button grid-page min-w-0 flex-col gap-2 rounded-xl p-2 aria-[current=page]:outline-2 aria-[current=page]:-outline-offset-1 aria-[current=page]:outline-reader-ink'
            : 'reader-button page-thumb relative h-[54px] min-h-[54px] w-[46px] shrink-0 overflow-hidden rounded-xl border-reader-line bg-white p-[5px] text-[#1c2024] hover:border-reader-muted hover:bg-white aria-[current=page]:outline-2 aria-[current=page]:-outline-offset-1 aria-[current=page]:outline-reader-ink min-[601px]:h-[58px] min-[601px]:min-h-[58px] min-[601px]:w-[52px]';
        button.setAttribute(
            'aria-label',
            `Trang ${index + 1}${page.title ? `: ${page.title}` : ''}`,
        );
        button.dataset.page = String(index);
        const image = document.createElement('img');
        image.className = grid
            ? 'block h-[110px] w-full rounded-md bg-white object-contain min-[601px]:h-[130px]'
            : 'size-full min-h-0 min-w-0 rounded-[5px] object-contain';
        image.src = page.thumbnailUrl;
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.addEventListener(
            'error',
            () => {
                image.hidden = true;
            },
            { once: true },
        );
        const label = document.createElement('span');
        label.className = grid
            ? 'block max-w-full text-xs wrap-anywhere'
            : 'absolute right-[3px] bottom-0.5 min-w-3.5 rounded-[3px] bg-white/95 px-0.5 text-center text-[10px] leading-snug';
        label.textContent = grid
            ? `${index + 1}. ${page.title || 'Trang sách'}`
            : String(index + 1);
        button.append(image, label);
        button.addEventListener('click', () => {
            element<HTMLDialogElement>('contents-dialog').close();
            choose(index);
        });
        return button;
    }
    return {
        scanEntry,
        loading,
        pageLoading,
        empty() {
            loading();
            main.dataset.entry = 'empty';
            element('empty-entry').hidden = false;
            element('welcome').hidden = true;
            menu.open = false;
        },
        ready(book: { title: string; pages: ManifestPage[] }) {
            loading();
            delete main.dataset.entry;
            element('empty-entry').hidden = true;
            element('welcome').hidden = view !== 'welcome';
            bookPages = book.pages;
            activeIndex = 0;
            updateContext();
            lastHighlighted = -1;
            main.dataset.ready = 'true';
            element('reader-title').textContent = book.title;
            element('info-book-title').textContent = book.title;
            element('book-count').textContent = `${book.pages.length} trang`;
            element('book-count').hidden = false;
            element<HTMLButtonElement>('start').disabled = false;
            const ar =
                location.pathname !== '/embed' &&
                book.pages.some((page) => page.marker.mode !== 'NONE');
            element('welcome-camera').hidden = !ar;
            element('camera').hidden = !ar;
            const scanFirst = scanEntry && ar;
            setButtonIcon('start', scanFirst ? ScanLine : BookOpen);
            (element('start').querySelector('span') as HTMLSpanElement).textContent = scanFirst
                ? 'Quét sách'
                : 'Bắt đầu đọc';
            setButtonIcon('welcome-camera', scanFirst ? BookOpen : ScanLine);
            (element('welcome-camera').querySelector('span') as HTMLSpanElement).textContent =
                scanFirst ? 'Đọc trên màn hình' : 'Quét sách';
            element('welcome-hint').hidden = !scanFirst;
            element('welcome-hint').textContent = scanFirst
                ? 'Cho phép camera khi bạn chọn quét trang sách hoặc marker đã in.'
                : '';
            element('welcome-kind').textContent = isPreview
                ? 'Bản xem trước'
                : 'Sách tương tác Bookaria';
            element('welcome-kind').hidden = !isPreview;
            element('page-strip').replaceChildren(
                ...book.pages.map((page, index) => thumbnail(page, index, false)),
            );
            element('page-grid').replaceChildren(
                ...book.pages.map((page, index) => thumbnail(page, index, true)),
            );
        },
        metadata(info: PublicBook) {
            element('subtitle').textContent = info.author.displayName;
            element('info-author').textContent =
                `${info.author.displayName} — Phiên bản ${info.version.versionNo}`;
            if (info.coverUrl) {
                element<HTMLImageElement>('cover').src = info.coverUrl;
                element('cover').hidden = false;
                element('cover-fallback').hidden = true;
            }
        },
        cameraPermission(state: 'intro' | 'requesting' | 'denied' | 'error', message?: string) {
            main.dataset.cameraPermission = state;
            const pending = state === 'requesting';
            const denied = state === 'denied';
            const title = element('camera-access-title');
            title.textContent = pending
                ? 'Đang chờ quyền camera'
                : denied
                  ? 'Camera chưa được cho phép'
                  : state === 'error'
                    ? 'Chưa mở được camera'
                    : 'Mở camera để quét sách';
            element('camera-access-description').textContent =
                message ||
                (pending
                    ? 'Xác nhận quyền trong thông báo của trình duyệt để tiếp tục quét sách.'
                    : denied
                      ? 'Bạn có thể cấp lại quyền camera hoặc quay lại màn bắt đầu.'
                      : 'Cho phép camera để nhận diện trang sách hoặc marker và hiển thị nội dung AR.');
            const icon = element('camera-access-icon');
            icon.replaceChildren(
                createElement(denied || state === 'error' ? CameraOff : Camera, {
                    'aria-hidden': 'true',
                }),
            );
            icon.classList.toggle('text-reader-danger', denied || state === 'error');
            icon.classList.toggle('text-reader-ink', !denied && state !== 'error');
            element('camera-access-options').hidden = state !== 'intro';
            element('camera-access-help').hidden = !denied;
            element('camera-access-status').hidden = !pending;
            const allow = element<HTMLButtonElement>('camera-access-allow');
            allow.disabled = pending;
            allow.textContent = pending
                ? 'Đang chờ cấp quyền…'
                : state === 'intro'
                  ? 'Cho phép camera'
                  : 'Thử lại';
            element<HTMLInputElement>('camera-access-sound').disabled = pending;
            if (!pending) title.focus({ preventScroll: true });
        },
        view(next: typeof view) {
            view = next;
            menu.open = false;
            main.dataset.view = next;
            if (next === 'ar') main.dataset.tracking = 'searching';
            else delete main.dataset.tracking;
            updateContext();
            element('welcome').hidden = next !== 'welcome';
            element('camera-access').hidden = next !== 'camera-access';
            if (next === 'camera-access') element('reading-status').hidden = true;
            element('reader-bottom').hidden = next === 'welcome' || next === 'camera-access';
            element('scan-guide').hidden = next !== 'ar';
            element('scan-help').hidden = next !== 'ar';
        },
        navigation(index: number, ar: boolean, tracked: boolean) {
            activeIndex = index;
            main.dataset.pageIndex = String(index);
            if (view === 'ar') main.dataset.tracking = tracked ? 'found' : 'searching';
            updateContext();
            for (const button of document.querySelectorAll<HTMLButtonElement>('[data-page]')) {
                if (Number(button.dataset.page) === index)
                    button.setAttribute('aria-current', 'page');
                else button.removeAttribute('aria-current');
                button.disabled =
                    ar && bookPages[Number(button.dataset.page)]?.marker.mode === 'NONE';
            }
            if (lastHighlighted !== index) {
                lastHighlighted = index;
                const strip = element('page-strip');
                const thumb = strip.querySelector<HTMLElement>(`[data-page="${index}"]`);
                if (thumb)
                    strip.scrollTo({
                        left: thumb.offsetLeft - strip.clientWidth / 2 + thumb.clientWidth / 2,
                        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
                            ? 'instant'
                            : 'smooth',
                    });
            }
        },
        scan(found: boolean) {
            main.dataset.tracking = found ? 'found' : 'searching';
            element('scan-guide').hidden = view !== 'ar' || found;
            element('scan-help').hidden = view !== 'ar';
            updateContext();
        },
        readingHint(hasModelControls: boolean) {
            const touch = matchMedia('(pointer: coarse)').matches;
            this.status(
                hasModelControls
                    ? touch
                        ? 'Kéo joystick để di chuyển, chạm để tương tác.'
                        : 'Dùng WASD hoặc phím mũi tên để di chuyển mô hình.'
                    : touch
                      ? 'Chạm để tương tác. Kéo để xoay, chụm để thu phóng.'
                      : 'Nhấp để tương tác. Kéo để xoay, cuộn để thu phóng.',
            );
            introductoryHint = true;
        },
        status(message: string, options?: { persistent?: boolean }) {
            introductoryHint = false;
            clearTimeout(statusTimer);
            element('status').textContent = message;
            element('reading-status').hidden = !message;
            const busy = /Đang (tải|chuẩn bị|mở|chờ)/.test(message);
            element('busy-indicator').hidden = !busy;
            if (
                !options?.persistent &&
                !busy &&
                (view === 'read' || (view === 'ar' && main.dataset.tracking === 'found'))
            )
                statusTimer = setTimeout(() => {
                    element('reading-status').hidden = true;
                    introductoryHint = false;
                }, 4000);
        },
        notice(message: string, options?: ReaderNoticeOptions) {
            const feedback = readerFeedback(message, options);
            element('error').textContent = message;
            element('error').setAttribute('role', feedback.role);
            element('feedback').hidden = !feedback.visible;
            element('retry-media').hidden = !feedback.media;
            element('retry-media').textContent = feedback.mediaLabel;
            element('feedback-retry').hidden = !feedback.retry;
            element('feedback-retry').textContent =
                main.dataset.ready === 'false' ? 'Thử tải lại' : 'Thử lại';
        },
    };
}
