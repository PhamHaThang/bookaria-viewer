import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReadingEvents, readingDevice } from '../src/shared/reading-events.ts';

const version = '11111111-1111-4111-8111-111111111111';
const page = '22222222-2222-4222-8222-222222222222';
const device = { type: 'desktop', os: 'Windows', browser: 'Edge' };

test('reading sessions are fresh, memory only and include one OPEN with version, never account data', async () => {
    const sent = [],
        other = [];
    const a = new ReadingEvents(version, device, async (batch) => sent.push(batch));
    const b = new ReadingEvents(version, device, async (batch) => other.push(batch));
    await a.flush();
    await a.flush();
    await b.flush();
    assert.equal(sent.length, 1);
    assert.deepEqual(
        sent[0].events.map((e) => e.type),
        ['OPEN'],
    );
    assert.notEqual(sent[0].sessionId, other[0].sessionId);
    assert.equal(sent[0].bookVersionId, version);
    assert.deepEqual(Object.keys(sent[0]).sort(), [
        'bookVersionId',
        'device',
        'events',
        'sessionId',
    ]);
});
test('bursts are bounded to 50 per request, at most one in flight; final flush does not duplicate batches', async () => {
    const batches = [],
        gates = [];
    let active = 0,
        max = 0;
    const events = new ReadingEvents(version, device, async (batch, final) => {
        active++;
        max = Math.max(max, active);
        batches.push({ batch, final });
        if (batches.length === 1) await new Promise((resolve) => gates.push(resolve));
        active--;
    });
    for (let i = 0; i < 170; i++)
        events.record({ type: 'TAP', pageId: page, objectId: `object-${i}` });
    const last = events.flush(true);
    gates[0]();
    await last;
    assert.equal(max, 1);
    assert.equal(batches.length, 3);
    assert.deepEqual(
        batches.map((x) => x.batch.events.length),
        [50, 50, 50],
    );
    assert.equal(batches[1].final, true);
    const taps = batches.flatMap((x) => x.batch.events).filter((x) => x.type === 'TAP');
    assert.equal(new Set(taps.map((x) => x.objectId)).size, taps.length);
    events.dispose();
    await events.flush();
    assert.equal(batches.length, 3);
});
test('failed delivery is dropped and does not replay or stop reading; disposed recorder ignores events', async () => {
    let calls = 0;
    const events = new ReadingEvents(version, device, async () => {
        calls++;
        throw Error('offline');
    });
    await events.flush();
    await events.flush();
    assert.equal(calls, 1);
    events.record({ type: 'PAGE_FOUND', pageId: page });
    events.record({ type: 'TAP', pageId: 'bad', objectId: 'bad' });
    await events.flush();
    assert.equal(calls, 2);
    events.dispose();
    events.record({ type: 'SCAN_TIMEOUT' });
    await events.flush();
    assert.equal(calls, 2);
});
test('default event transport is anonymous, JSON and keepalive on final flush, with no credentials', async () => {
    const before = globalThis.fetch,
        calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(null, { status: 202 });
    };
    try {
        const events = new ReadingEvents(version, device);
        await events.flush(true);
        assert.equal(calls[0].url, '/api/v1/public/events');
        assert.equal(calls[0].init.credentials, 'omit');
        assert.equal(calls[0].init.keepalive, true);
        assert.equal(JSON.parse(calls[0].init.body).events[0].type, 'OPEN');
    } finally {
        globalThis.fetch = before;
    }
});
test('device metadata is coarse and does not preserve user agent or browser version', () => {
    assert.deepEqual(readingDevice('Mozilla iPhone Safari/999'), {
        type: 'mobile',
        os: 'iOS',
        browser: 'Safari',
    });
    assert.equal(readingDevice('Android Tablet Chrome/100').type, 'tablet');
    assert.equal(readingDevice('Windows Chrome/100 Edg/101').browser, 'Edge');
});
