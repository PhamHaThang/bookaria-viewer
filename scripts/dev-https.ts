import { createPrivateKey, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ServerOptions } from 'node:https';
import { resolve } from 'node:path';

/** Server-only configuration; never expose certificate paths through VITE_* variables. */
export function readDevHttps(
    env: Record<string, string | undefined>,
    root = process.cwd(),
): ServerOptions | undefined {
    const certFile = env.VIEWER_HTTPS_CERT_FILE?.trim();
    const keyFile = env.VIEWER_HTTPS_KEY_FILE?.trim();
    if (!certFile && !keyFile) return undefined;
    if (!certFile || !keyFile)
        throw new Error('HTTPS: cần cấu hình cả VIEWER_HTTPS_CERT_FILE và VIEWER_HTTPS_KEY_FILE.');
    try {
        const cert = readFileSync(resolve(root, certFile));
        const key = readFileSync(resolve(root, keyFile));
        const certificate = new X509Certificate(cert);
        if (!certificate.checkPrivateKey(createPrivateKey(key)))
            throw new Error('Certificate/key mismatch');
        if (
            Date.parse(certificate.validTo) <= Date.now() ||
            Date.parse(certificate.validFrom) > Date.now()
        )
            throw new Error('Certificate validity');
        return { cert, key };
    } catch {
        throw new Error(
            'HTTPS: chưa đọc được cặp chứng chỉ/khóa hợp lệ. Kiểm tra đường dẫn, thời hạn và khóa khớp chứng chỉ; không tự chuyển sang cert khác.',
        );
    }
}
