import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportBook, reportDeviceId } from '../src/shared/reports.ts';

const body = { reason: 'OTHER', note: 'Nội dung cần kiểm tra', deviceId: 'anonymous-device-test' };
test('reports use a stable random device id with private-mode memory fallback', () => {
    const values = new Map(),
        storage = {
            getItem: (key) => values.get(key),
            setItem: (key, value) => values.set(key, value),
        };
    const first = reportDeviceId(storage);
    assert.equal(reportDeviceId(storage), first);
    assert.ok(first.length >= 8);
    const blocked = {
        getItem: () => {
            throw Error('blocked');
        },
        setItem: () => {
            throw Error('blocked');
        },
    };
    assert.equal(reportDeviceId(blocked), reportDeviceId(blocked));
});
test('report validates request, omits credentials and requires 201 receipt', async () => {
    const before = globalThis.fetch,
        calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return Response.json({ data: { received: true } }, { status: 201 });
    };
    try {
        await reportBook('test-book', body);
        assert.equal(calls[0].init.credentials, 'omit');
        assert.equal(calls[0].url, '/api/v1/public/books/test-book/reports');
        assert.deepEqual(JSON.parse(calls[0].init.body), body);
        await assert.rejects(() => reportBook('test-book', { ...body, pageId: 'invalid' }));
        assert.equal(calls.length, 1);
        globalThis.fetch = async () =>
            Response.json({ data: { received: false } }, { status: 201 });
        await assert.rejects(() => reportBook('test-book', body));
    } finally {
        globalThis.fetch = before;
    }
});
test('report rate limit, unavailable and uncertain delivery keep actionable errors without automatic retry', async () => {
    const before = globalThis.fetch;
    try {
        globalThis.fetch = async () =>
            Response.json(
                {
                    error: {
                        code: 'RATE_LIMITED',
                        message: 'Wait',
                        requestId: 'report-test',
                        details: { retryAfterSeconds: 30 },
                    },
                },
                { status: 429 },
            );
        await assert.rejects(() => reportBook('test-book', body), /30 giây/);
        globalThis.fetch = async () => new Response(null, { status: 410 });
        await assert.rejects(() => reportBook('test-book', body), /không còn khả dụng/);
        let calls = 0;
        globalThis.fetch = async () => {
            calls++;
            throw new TypeError('lost response');
        };
        await assert.rejects(() => reportBook('test-book', body), /Chưa xác nhận/);
        assert.equal(calls, 1);
    } finally {
        globalThis.fetch = before;
    }
});
