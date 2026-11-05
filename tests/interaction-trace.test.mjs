import assert from 'node:assert/strict';
import test from 'node:test';
import { InteractionRunner } from '../src/scene-core/InteractionRunner.ts';

const rule = {
    id: 'trace',
    enabled: true,
    trigger: { type: 'onPageEnter' },
    onRetrigger: 'ignore',
    actions: [
        { type: 'wait', ms: 5 },
        { type: 'openUrl', url: 'https://example.com', delayMsSchema: 0 },
    ],
};
test('trace reports actual wait and execution order without changing actions', async () => {
    const calls = [],
        runner = new InteractionRunner(
            [rule],
            () => calls.push('execute'),
            () => {},
            async () => {},
        );
    runner.onStep = (event) => calls.push(`${event.index}:${event.state}`);
    await runner.run('trace');
    assert.deepEqual(calls, ['0:waiting', '0:done', '1:running', 'execute', '1:done']);
    runner.dispose();
});
test('a broken observer cannot interrupt the reader and cancellation stops later actions', async () => {
    let count = 0;
    const runner = new InteractionRunner([rule], () => {
        count++;
    });
    runner.onStep = () => {
        throw new Error('UI failed');
    };
    await runner.run('trace');
    assert.equal(count, 1);
    const events = [];
    runner.onStep = (event) => events.push(event.state);
    const task = runner.run('trace');
    await Promise.resolve();
    runner.cancelAll();
    await task;
    assert.equal(count, 1);
    assert.ok(events.includes('cancelled'));
    runner.dispose();
});
test('execution failure marks the failing step and stops the following chain', async () => {
    const errors = [],
        events = [];
    const runner = new InteractionRunner(
        [{ ...rule, actions: [rule.actions[1], rule.actions[1]] }],
        () => {
            throw new Error('failed');
        },
        (message) => errors.push(message),
    );
    runner.onStep = (event) => events.push(event);
    await runner.run('trace');
    assert.deepEqual(errors, ['failed']);
    assert.deepEqual(
        events.map((event) => [event.index, event.state]),
        [
            [0, 'running'],
            [0, 'error'],
        ],
    );
    runner.dispose();
});
