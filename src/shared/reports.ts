import { publicApiBase } from './api';
import {
    type ReportBookBody,
    ReportBookBodySchema,
    ReportReceivedSchema,
} from './contracts/api/public.schema';
import { SlugSchema } from './contracts/common.schema';
import { ApiErrorSchema, RateLimitedDetailsSchema } from './contracts/error.schema';

let fallbackId: string | null = null;
export function reportDeviceId(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    const key = 'bookaria.report-device';
    try {
        const saved = storage?.getItem(key);
        if (saved && /^[a-zA-Z0-9-]{8,100}$/.test(saved)) return saved;
    } catch {
        /* Storage can be disabled; reports still work in this document. */
    }
    fallbackId ??= crypto.randomUUID();
    try {
        storage?.setItem(key, fallbackId);
    } catch {
        /* Memory fallback. */
    }
    return fallbackId;
}

export async function reportBook(slug: string, input: ReportBookBody) {
    const body = ReportBookBodySchema.parse(input);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetch(
            `${publicApiBase}/public/books/${SlugSchema.parse(slug)}/reports`,
            {
                method: 'POST',
                body: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json' },
                credentials: 'omit',
                cache: 'no-store',
                referrerPolicy: 'no-referrer',
                signal: controller.signal,
            },
        );
        if (response.status === 201) {
            let receipt: unknown;
            try {
                receipt = (await response.json()).data;
            } catch {
                receipt = null;
            }
            if (!ReportReceivedSchema.safeParse(receipt).success)
                throw new Error(
                    'Máy chủ chưa xác nhận được báo cáo. Không tự gửi lại; hãy kiểm tra kết nối và thử lại sau.',
                );
            return;
        }
        if (response.status === 404 || response.status === 410)
            throw new Error('Sách không còn khả dụng. Hãy tải lại trang.');
        let raw: unknown;
        try {
            raw = await response.json();
        } catch {
            raw = null;
        }
        const parsed = ApiErrorSchema.safeParse(raw);
        if (response.status === 429) {
            const details = RateLimitedDetailsSchema.safeParse(
                parsed.success ? parsed.data.error.details : null,
            );
            throw new Error(
                details.success
                    ? `Bạn đã báo cáo hoặc thao tác quá nhanh. Thử lại sau ${details.data.retryAfterSeconds} giây.`
                    : 'Bạn đã báo cáo hoặc thao tác quá nhanh. Vui lòng chờ trước khi thử lại.',
            );
        }
        throw new Error(
            parsed.success
                ? parsed.data.error.message
                : 'Chưa gửi được báo cáo. Vui lòng thử lại sau.',
        );
    } catch (error) {
        if (error instanceof TypeError || controller.signal.aborted)
            throw new Error(
                'Chưa xác nhận được báo cáo đã gửi. Không tự gửi lại; hãy chờ rồi kiểm tra kết nối.',
            );
        throw error;
    } finally {
        clearTimeout(deadline);
    }
}
