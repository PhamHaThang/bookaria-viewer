import { SlugSchema } from './contracts/common.schema';
import { PublicBookSchema } from './contracts/dto.schema';
import { ManifestSchema } from './contracts/manifest.schema';

export const tokenPattern = /^[A-Za-z0-9_-]{32}$/;
export class PreviewUnavailableError extends Error {}
export class BookUnavailableError extends Error {}
export const publicApiBase = (import.meta.env?.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');
const base = publicApiBase;
const publicOptions = (signal: AbortSignal): RequestInit => ({
    signal,
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
});
export async function loadPublicInfo(slug: string, signal: AbortSignal) {
    const response = await fetch(
        `${base}/public/books/${encodeURIComponent(SlugSchema.parse(slug))}`,
        publicOptions(signal),
    );
    if (response.status === 404 || response.status === 410)
        throw new BookUnavailableError(
            'Sách không còn khả dụng. Hãy liên hệ tác giả để lấy liên kết mới.',
        );
    if (!response.ok) throw new Error('Chưa tải được thông tin sách. Hãy thử lại.');
    const info = PublicBookSchema.parse((await response.json()).data);
    if (info.slug !== slug) throw new Error('Thông tin sách không khớp liên kết.');
    return info;
}
export async function loadPublished(slug: string, signal: AbortSignal) {
    const info = await loadPublicInfo(slug, signal);
    const bytes = await fetchBytes(info.manifestUrl, signal, 10 * 1024 * 1024);
    const manifest = ManifestSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    if (
        manifest.version !== info.version.versionNo ||
        manifest.pages.length !== info.pageCount ||
        manifest.pages.filter((p) => p.marker.mode !== 'NONE').length !== info.arPageCount
    )
        throw new Error('Dữ liệu phiên bản chưa khớp. Hãy tải lại sách.');
    // Check availability again after the immutable file download, before enabling the reader.
    const current = await loadPublicInfo(slug, signal);
    if (current.version.id !== info.version.id)
        throw new Error('Tác giả vừa xuất bản phiên bản mới. Hãy tải lại sách.');
    return { info: current, manifest };
}
export function previewGroupUrl(token: string, group: number) {
    if (!tokenPattern.test(token) || !Number.isInteger(group) || group < 0 || group > 9999)
        throw new Error('Nhóm xem trước không hợp lệ.');
    return `${base}/public/previews/${token}/groups/${group}`;
}
export async function loadPreview(token: string, signal: AbortSignal) {
    if (!tokenPattern.test(token)) throw new Error('Liên kết xem trước không hợp lệ.');
    const response = await fetch(`${base}/public/previews/${token}`, {
        signal,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
    });
    if (response.status === 404)
        throw new PreviewUnavailableError(
            'Liên kết đã hết hạn, bị thu hồi hoặc không tồn tại. Hãy tạo liên kết mới từ Studio.',
        );
    if (!response.ok) throw new Error('Chưa tải được bản xem trước. Hãy thử lại.');
    const body = await response.json();
    const parsed = ManifestSchema.safeParse(body.data);
    if (!parsed.success)
        throw new Error(
            'Bản xem trước không đúng phiên bản dữ liệu Viewer hỗ trợ. Hãy tạo lại liên kết hoặc cập nhật Viewer.',
        );
    return {
        manifest: parsed.data,
        expiresAt: response.headers.get('Expires'),
    };
}
export async function fetchBytes(url: string, signal: AbortSignal, maxBytes = 50 * 1024 * 1024) {
    const response = await fetch(url, {
        signal,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error('Không tải được tài nguyên của trang.');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Tài nguyên rỗng.');
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            signal.throwIfAborted();
            const part = await reader.read();
            if (part.done) break;
            total += part.value.byteLength;
            if (total > maxBytes) throw new Error('Tài nguyên vượt giới hạn tải.');
            chunks.push(part.value);
        }
    } finally {
        await reader.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    return bytes.buffer;
}
