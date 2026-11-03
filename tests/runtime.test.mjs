import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Matrix4, Vector3 } from 'three';
import { fitDistance, pageToMarkerMatrix, targetToPageMatrix } from '../src/scene-core/coords.ts';
import { InteractionRunner, sleep } from '../src/scene-core/InteractionRunner.ts';
import { wrapText } from '../src/scene-core/text.ts';
import { previewGroupUrl } from '../src/shared/api.ts';
import { PreviewMessageSchema, trustedMessage } from '../src/shared/protocol.ts';

const action = (value) => ({
    type: 'openUrl',
    url: `https://example.com/${value}`,
    delayMsSchema: 0,
});
const rule = (overrides = {}) => ({
    id: 'r1',
    name: 'R',
    enabled: true,
    trigger: { type: 'onTap', objectId: 'object' },
    onRetrigger: 'ignore',
    actions: [action(1), { type: 'wait', ms: 5 }, action(2)],
    ...overrides,
});
test('ordered commands await execution and waits; delay uses the actual backend key', async () => {
    const calls = [];
    const runner = new InteractionRunner(
        [
            rule({
                actions: [{ ...action(1), delayMsSchema: 7 }, { type: 'wait', ms: 9 }, action(2)],
            }),
        ],
        async (a) => {
            calls.push(a.url);
        },
        () => {},
        async (ms) => {
            calls.push(ms);
        },
    );
    await runner.fire({ type: 'onTap', objectId: 'object' });
    assert.deepEqual(calls, [7, 'https://example.com/1', 9, 'https://example.com/2']);
    runner.dispose();
});
test('only matching enabled triggers fire and page-enter/leave stay independent', async () => {
    const calls = [];
    const runner = new InteractionRunner(
        [
            rule(),
            rule({ id: 'disabled', enabled: false }),
            rule({ id: 'enter', trigger: { type: 'onPageEnter' }, actions: [action('enter')] }),
            rule({ id: 'leave', trigger: { type: 'onPageLeave' }, actions: [action('leave')] }),
        ],
        (a) => {
            calls.push(a.url);
        },
    );
    await runner.fire({ type: 'onTap', objectId: 'other' });
    assert.equal(calls.length, 0);
    await runner.fire({ type: 'onPageEnter' });
    await runner.fire({ type: 'onPageLeave' });
    assert.deepEqual(calls, ['https://example.com/enter', 'https://example.com/leave']);
    runner.dispose();
});
test('ignore returns existing run and does not execute a second chain', async () => {
    let release;
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    const calls = [];
    const runner = new InteractionRunner(
        [rule()],
        (a) => {
            calls.push(a.url);
        },
        () => {},
        () => gate,
    );
    const first = runner.run('r1');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(runner.run('r1'), first);
    release();
    await first;
    assert.equal(calls.length, 2);
    runner.dispose();
});
test('restart aborts old delay and a finishing old task cannot unregister its replacement', async () => {
    const gates = [],
        calls = [];
    const runner = new InteractionRunner(
        [rule({ onRetrigger: 'restart', actions: [{ type: 'wait', ms: 5 }, action(1)] })],
        (a) => {
            calls.push(a.url);
        },
        () => {},
        (_ms, signal) =>
            new Promise((resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true });
                gates.push(resolve);
            }),
    );
    const old = runner.run('r1');
    await Promise.resolve();
    const next = runner.run('r1');
    await Promise.resolve();
    await old;
    gates[1]();
    await next;
    assert.deepEqual(calls, ['https://example.com/1']);
    runner.dispose();
});
test('cancelAll and dispose cancel timers and prevent delayed side effects', async () => {
    const calls = [];
    const runner = new InteractionRunner(
        [rule({ actions: [{ type: 'wait', ms: 60000 }, action(1)] })],
        (a) => {
            calls.push(a.url);
        },
    );
    const task = runner.run('r1');
    await Promise.resolve();
    runner.dispose();
    await task;
    await runner.run('r1');
    assert.deepEqual(calls, []);
    const abort = new AbortController();
    const delayed = sleep(60000, abort.signal);
    abort.abort();
    await assert.rejects(delayed);
});
test('one action failure stops its chain, reports once, and allows a later explicit retry', async () => {
    const errors = [],
        calls = [];
    const runner = new InteractionRunner(
        [rule()],
        (a) => {
            calls.push(a.url);
            throw new Error('missing clip');
        },
        (message) => errors.push(message),
    );
    await runner.run('r1');
    await runner.run('r1');
    assert.equal(calls.length, 2);
    assert.deepEqual(errors, ['missing clip', 'missing clip']);
    runner.dispose();
});
test('concurrent different rules are independent and disabled manual runs are ignored', async () => {
    const calls = [];
    const runner = new InteractionRunner(
        [
            rule({ actions: [action(1)] }),
            rule({ id: 'r2', actions: [action(2)] }),
            rule({ id: 'r3', enabled: false }),
        ],
        (a) => {
            calls.push(a.url);
        },
    );
    await Promise.all([runner.run('r1'), runner.run('r2'), runner.run('r3')]);
    assert.deepEqual(calls.sort(), ['https://example.com/1', 'https://example.com/2']);
    runner.dispose();
});
test('page coordinates align marker center, width, position and depth', () => {
    const page = { marker: { mode: 'BOOKARIA_MARKER', transform: { x: 0.3, y: -0.4, size: 0.2 } } };
    const matrix = pageToMarkerMatrix(page);
    const marker = new Vector3(0.3, -0.4, 0).applyMatrix4(matrix);
    assert.ok(marker.length() < 1e-8);
    const depth = new Vector3(0.3, -0.4, 0.2).applyMatrix4(matrix);
    assert.ok(Math.abs(depth.z - 1) < 1e-8);
    const point = new Vector3(0, 0, 0).applyMatrix4(
        targetToPageMatrix(new Matrix4().toArray(), 100, 100, page),
    );
    assert.deepEqual(point.toArray().map(Math.round), [-100, 250, 0]);
});
test('custom page uses width-based target coordinates and camera fitting handles narrow viewports', () => {
    const matrix = targetToPageMatrix(new Matrix4().toArray(), 420, 594, {
        marker: { mode: 'CUSTOM_MARKER' },
    });
    assert.deepEqual(new Vector3(0, 0, 0).applyMatrix4(matrix).toArray(), [210, 297, 0]);
    assert.ok(fitDistance(297 / 210, 0.5) > fitDistance(297 / 210, 2));
});
test('iframe messages require matching parent origin and window source', () => {
    const parent = {};
    assert.equal(
        trustedMessage(
            { origin: 'http://localhost:5173', source: parent },
            parent,
            'http://localhost:5173',
        ),
        true,
    );
    assert.equal(
        trustedMessage(
            { origin: 'https://attacker.example', source: parent },
            parent,
            'http://localhost:5173',
        ),
        false,
    );
    assert.equal(
        trustedMessage(
            { origin: 'http://localhost:5173', source: {} },
            parent,
            'http://localhost:5173',
        ),
        false,
    );
    assert.equal(
        PreviewMessageSchema.safeParse({
            type: 'BOOKARIA_PREVIEW',
            nonce: 'bad',
            requestId: 1,
            payload: {},
        }).success,
        false,
    );
});

test('preview binary uses configured API proxy instead of embedded backend localhost URLs', () => {
    assert.equal(
        previewGroupUrl('a'.repeat(32), 0),
        `/api/v1/public/previews/${'a'.repeat(32)}/groups/0`,
    );
    for (const group of [-1, 0.5, 10000])
        assert.throws(() => previewGroupUrl('a'.repeat(32), group));
    assert.throws(() => previewGroupUrl('../token', 0));
});

test('text renderer preserves explicit newlines and blank paragraphs while wrapping words', () => {
    assert.deepEqual(
        wrapText('Chào bạn\nBookaria', (text) => text.length, 20),
        ['Chào bạn', 'Bookaria'],
    );
    assert.deepEqual(
        wrapText('Một hai ba\n\nBốn', (text) => text.length, 7),
        ['Một hai', 'ba', '', 'Bốn'],
    );
});
