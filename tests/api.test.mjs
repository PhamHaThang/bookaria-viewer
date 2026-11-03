import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchBytes, loadPreview, PreviewUnavailableError } from '../src/shared/api.ts';

test('public preview requests omit credentials, disable cache/referrer and distinguish unavailable from incompatible data', async () => {
    const previous = globalThis.fetch;
    const calls = [];
    try {
        globalThis.fetch = async (url, options) => {
            calls.push({ url, options });
            return new Response('{}', { status: 404 });
        };
        await assert.rejects(
            loadPreview('a'.repeat(32), new AbortController().signal),
            PreviewUnavailableError,
        );
        assert.equal(calls[0].options.credentials, 'omit');
        assert.equal(calls[0].options.cache, 'no-store');
        assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
        globalThis.fetch = async () =>
            new Response(JSON.stringify({ data: { schemaVersion: 999 } }), { status: 200 });
        await assert.rejects(
            loadPreview('a'.repeat(32), new AbortController().signal),
            /phiên bản dữ liệu/,
        );
        const count = calls.length;
        await assert.rejects(loadPreview('../bad-token', new AbortController().signal));
        assert.equal(calls.length, count);
    } finally {
        globalThis.fetch = previous;
    }
});
test('binary loader bounds actual streamed bytes and stops after cancellation', async () => {
    const previous = globalThis.fetch;
    try {
        globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]));
        await assert.rejects(
            fetchBytes('https://example.com/test', new AbortController().signal, 2),
            /giới hạn/,
        );
        const abort = new AbortController();
        abort.abort();
        await assert.rejects(fetchBytes('https://example.com/test', abort.signal));
        assert.deepEqual(
            [
                ...new Uint8Array(
                    await fetchBytes('https://example.com/test', new AbortController().signal, 3),
                ),
            ],
            [1, 2, 3],
        );
    } finally {
        globalThis.fetch = previous;
    }
});
