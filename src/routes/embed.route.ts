import type { RouteHandler } from '../router/types';
import { PreviewMessageSchema, RunMessageSchema, trustedMessage } from '../shared/protocol';
import type { BookViewer } from '../viewer/book-viewer';

const get = <T extends HTMLElement>(id: string) => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing ${id}`);
    return element as T;
};

export function createEmbedRoute(viewer: BookViewer): RouteHandler {
    return (match, signal) => {
        if (signal.aborted) return;
        let lastRequestId = 0;

        const parentOrigin = import.meta.env.VITE_STUDIO_ORIGIN || 'http://localhost:5173';
        const hashParams = new URLSearchParams(match.hash.replace(/^#/, ''));
        const nonce = hashParams.get('nonce') || '';
        const validEmbed =
            window.parent !== window &&
            /^[0-9a-f-]{36}$/i.test(nonce) &&
            hashParams.get('parent') === parentOrigin;

        viewer.setEmbed(true, { nonce, parentOrigin });

        if (!validEmbed) {
            viewer.getUI().loading();
            viewer.status('Không mở được bản xem nhúng.');
            viewer.notice('Hãy mở lại từ Studio đúng địa chỉ đã cấu hình.');
            return;
        }

        viewer.status('Đang chờ nội dung từ Studio…');
        viewer.getUI().loading('Đang chờ nội dung từ Studio…');
        get('subtitle').textContent = 'Bản xem trước nội dung đang sửa; không thay đổi bản đã lưu.';
        get('camera-hint').hidden = true;

        const onMessage = (event: MessageEvent) => {
            if (
                signal.aborted ||
                !trustedMessage(event, window.parent, parentOrigin) ||
                event.data?.nonce !== nonce
            )
                return;
            const run = RunMessageSchema.safeParse(event.data);
            if (run.success) {
                void viewer.getRuntime()?.runner.run(run.data.ruleId);
                return;
            }
            const parsed = PreviewMessageSchema.safeParse(event.data);
            if (!parsed.success || parsed.data.requestId <= lastRequestId) return;
            lastRequestId = parsed.data.requestId;
            const wasRunning = Boolean(viewer.getStage());
            viewer.stop('Nội dung đã sẵn sàng. Bấm Bắt đầu xem 3D.');
            viewer.install(
                {
                    title: parsed.data.payload.title,
                    pages: [parsed.data.payload.page],
                    assets: parsed.data.payload.assets,
                    targetGroups: [],
                    credits: [],
                },
                { isPreview: true },
            );
            viewer.reply('loaded', lastRequestId);
            if (wasRunning) {
                viewer.getUI().view('read');
                void viewer.showPage(0);
            }
        };
        window.addEventListener('message', onMessage);
        signal.addEventListener('abort', () => window.removeEventListener('message', onMessage), {
            once: true,
        });
        window.parent.postMessage({ type: 'BOOKARIA_READY', nonce }, parentOrigin);
    };
}
