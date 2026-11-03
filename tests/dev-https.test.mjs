import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createSecureContext } from 'node:tls';
import { getCertificate } from '@vitejs/plugin-basic-ssl';
import { readDevHttps } from '../scripts/dev-https.ts';

test('development HTTPS preserves default and refuses incomplete custom configuration', () => {
    assert.equal(readDevHttps({}), undefined);
    assert.equal(
        readDevHttps({ VIEWER_HTTPS_CERT_FILE: ' ', VIEWER_HTTPS_KEY_FILE: '' }),
        undefined,
    );
    for (const env of [
        { VIEWER_HTTPS_CERT_FILE: 'cert.pem' },
        { VIEWER_HTTPS_KEY_FILE: 'key.pem' },
    ])
        assert.throws(() => readDevHttps(env), /cả VIEWER_HTTPS_CERT_FILE/);
});

test('custom certificate errors never silently fall back or expose file contents', () => {
    assert.throws(
        () =>
            readDevHttps({
                VIEWER_HTTPS_CERT_FILE: 'missing.pem',
                VIEWER_HTTPS_KEY_FILE: 'missing-key.pem',
            }),
        /chưa đọc được/,
    );
});

test('custom certificate loads relative files, forms valid TLS context, rejects wrong key and malformed PEM', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bookaria-https-test-'));
    try {
        const first = await getCertificate(join(root, 'cache-a'), 'Bookaria test A', [
            'viewer.localhost',
        ]);
        const second = await getCertificate(join(root, 'cache-b'), 'Bookaria test B', [
            'viewer.localhost',
        ]);
        await writeFile(join(root, 'cert.pem'), first);
        await writeFile(join(root, 'key.pem'), first);
        const env = { VIEWER_HTTPS_CERT_FILE: './cert.pem', VIEWER_HTTPS_KEY_FILE: './key.pem' };
        const options = readDevHttps(env, root);
        assert.ok(Buffer.isBuffer(options.cert));
        assert.doesNotThrow(() => createSecureContext(options));
        await writeFile(join(root, 'key.pem'), second);
        assert.throws(() => readDevHttps(env, root), /chưa đọc được/);
        await writeFile(join(root, 'cert.pem'), 'INVALID-TEST-CERT-CONTENT');
        assert.throws(
            () => readDevHttps(env, root),
            (error) =>
                !error.message.includes('INVALID-TEST-CERT-CONTENT') &&
                error.message.includes('chưa đọc được'),
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
