import assert from 'node:assert/strict';
import test from 'node:test';
import { InteractionRunner } from '../src/scene-core/InteractionRunner.ts';
import { InteractionRuleSchema } from '../src/shared/contracts/scene.schema.ts';

const initial = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
const movement = { type: 'transformTo', objectId: 'target', position: [1, 0, 0], durationMs: 0 };
const rule = () =>
    InteractionRuleSchema.parse({
        id: 'r',
        trigger: { type: 'onPageEnter' },
        actions: [{ type: 'wait', ms: 7 }, movement, { type: 'wait', ms: 9 }],
        editorLayout: ['start', 'before', 'move', 'after'].map((id, x) => ({ id, x, y: 0 })),
        workflow: {
            version: 1,
            edges: [
                { source: 'start', target: 'before' },
                { source: 'before', target: 'move' },
                { source: 'move', target: 'after' },
            ],
        },
        movementLoop: { startId: 'move', endId: 'move', pauseMs: 0, initial },
    });

test('infinite movement repeats only its segment, resets the pose, yields for input and cancels without errors', async () => {
    const calls = [],
        waits = [],
        errors = [];
    const runner = new InteractionRunner(
        [rule()],
        (action) => calls.push(action),
        (error) => errors.push(error),
        async (ms) => {
            waits.push(ms);
            if (waits.length === 5) runner.cancelAll();
        },
    );
    await runner.run('r');
    assert.deepEqual(waits, [7, 16, 16, 16, 16]);
    assert.equal(calls.filter(({ durationMs }) => durationMs === 0).length, 7);
    assert.deepEqual(calls[1].position, initial.position);
    assert.deepEqual(calls[2].position, [1, 0, 0]);
    assert.deepEqual(errors, []);
    runner.dispose();
});

for (const stop of ['leave', 'dispose', 'restart']) {
    test(`loop supports ${stop} and retrigger ignore without leaking its old task`, async () => {
        const loop = rule();
        loop.actions[0].ms = 0;
        loop.movementLoop.pauseMs = 500;
        const signals = [],
            calls = [],
            errors = [];
        const runner = new InteractionRunner(
            [loop],
            (action) => calls.push(action),
            (error) => errors.push(error),
            (_ms, signal) =>
                new Promise((_resolve, reject) => {
                    signals.push(signal);
                    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
                }),
        );
        const first = runner.run('r');
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(runner.run('r'), first);
        assert.equal(calls.length, 1);
        if (stop === 'leave') await runner.fire({ type: 'onPageLeave' });
        else if (stop === 'dispose') runner.dispose();
        else {
            loop.onRetrigger = 'restart';
            const next = runner.run('r');
            await first;
            await new Promise((resolve) => setImmediate(resolve));
            assert.notEqual(next, first);
            assert.equal(signals.length, 2);
            runner.cancelAll();
            await next;
        }
        await first;
        assert.ok(signals.every((signal) => signal.aborted));
        assert.deepEqual(errors, []);
        runner.dispose();
    });
}
