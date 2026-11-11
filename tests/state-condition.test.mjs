import assert from 'node:assert/strict';
import test from 'node:test';
import { InteractionRunner } from '../src/scene-core/InteractionRunner.ts';
import { WorkflowState } from '../src/scene-core/WorkflowState.ts';
import { InteractionRuleSchema } from '../src/shared/contracts/scene.schema.ts';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const set = (key, value) => ({ type: 'setState', key, value, operation: 'set' });
const predicate = (key = 'score', value = 3, operator = 'gte') => ({
    type: 'variable',
    key,
    operator,
    value,
});
const eventRule = (
    id = 'reward',
    condition = predicate(),
    actions = [{ type: 'openUrl', url: 'https://example.com' }],
    extras = {},
) =>
    InteractionRuleSchema.parse({
        id,
        trigger: { type: 'onStateCondition', test: condition },
        actions,
        ...extras,
    });

test('memory events start at page entry, run once on each false-to-true edge and stop on page leave', async () => {
    const state = new WorkflowState(),
        calls = [];
    const runner = new InteractionRunner(
        [eventRule()],
        () => calls.push('reward'),
        undefined,
        undefined,
        { state },
    );
    state.set(set('score', 3));
    await tick();
    assert.deepEqual(calls, []);
    await runner.fire({ type: 'onPageEnter' });
    await tick();
    assert.deepEqual(calls, ['reward']);
    state.set(set('score', 4));
    state.set(set('unrelated', true));
    state.set(set('score', 3));
    await tick();
    assert.equal(calls.length, 1);
    state.set(set('score', 1));
    state.set(set('score', 3));
    await tick();
    assert.equal(calls.length, 2);
    await runner.fire({ type: 'onPageLeave' });
    state.set(set('score', 0));
    state.set(set('score', 3));
    await tick();
    assert.equal(calls.length, 2);
    runner.dispose();
});

test('a tap producer releases the correct reactive rule, leaving unrelated and disabled rules alone', async () => {
    const state = new WorkflowState(),
        calls = [];
    const rules = [
        eventRule(),
        eventRule('other', predicate('score', 10)),
        eventRule('disabled', predicate(), undefined, { enabled: false }),
        InteractionRuleSchema.parse({
            id: 'tap',
            trigger: { type: 'onTap', objectId: 'button' },
            actions: [set('score', 3)],
        }),
    ];
    const runner = new InteractionRunner(rules, () => calls.push('reward'), undefined, undefined, {
        state,
    });
    await runner.fire({ type: 'onPageEnter' });
    await runner.fire({ type: 'onTap', objectId: 'button' });
    await tick();
    assert.equal(calls.length, 1);
    // A synthetic memory trigger must not bypass the subscribed predicates.
    await runner.fire({ type: 'onStateCondition', test: predicate('score', 999) });
    assert.equal(calls.length, 1);
    runner.dispose();
});

for (const [value, initial, target] of [
    ['boolean', false, true],
    ['string', 'waiting', 'done'],
]) {
    test(`memory events support ${value} comparisons without coercion`, async () => {
        const state = new WorkflowState(),
            calls = [];
        state.set(set('mission', initial));
        const runner = new InteractionRunner(
            [eventRule('mission', predicate('mission', target, 'eq'))],
            () => calls.push(1),
            undefined,
            undefined,
            { state },
        );
        await runner.fire({ type: 'onPageEnter' });
        await tick();
        assert.equal(calls.length, 0);
        state.set(set('mission', target));
        await tick();
        state.set(set('mission', target));
        await tick();
        assert.equal(calls.length, 1);
        runner.dispose();
    });
}

for (const policy of ['ignore', 'restart']) {
    test(`reactive runs respect ${policy} while a previous action is still running`, async () => {
        const state = new WorkflowState(),
            signals = [],
            pending = [];
        const runner = new InteractionRunner(
            [eventRule('reward', predicate(), undefined, { onRetrigger: policy })],
            (_, signal) => {
                signals.push(signal);
                return new Promise((resolve) => {
                    pending.push(resolve);
                    signal.addEventListener('abort', resolve, { once: true });
                });
            },
            undefined,
            undefined,
            { state },
        );
        await runner.fire({ type: 'onPageEnter' });
        state.set(set('score', 3));
        await tick();
        state.set(set('score', 0));
        state.set(set('score', 3));
        await tick();
        assert.equal(signals.length, policy === 'restart' ? 2 : 1);
        assert.equal(signals[0].aborted, policy === 'restart');
        pending.forEach((resolve) => {
            resolve();
        });
        await tick();
        runner.dispose();
    });
}

test('cancel/reset/dispose release subscriptions and page re-entry evaluates saved progress once', async () => {
    const state = new WorkflowState(),
        calls = [];
    const runner = new InteractionRunner([eventRule()], () => calls.push(1), undefined, undefined, {
        state,
    });
    await runner.fire({ type: 'onPageEnter' });
    runner.cancelAll();
    state.set(set('score', 3));
    await tick();
    assert.equal(calls.length, 0);
    await runner.fire({ type: 'onPageEnter' });
    await tick();
    assert.equal(calls.length, 1);
    runner.dispose();
    state.set(set('score', 0));
    state.set(set('score', 3));
    await tick();
    assert.equal(calls.length, 1);
});

test('self-updates that remain satisfied do not recursively retrigger the rule', async () => {
    const state = new WorkflowState(),
        events = [];
    const runner = new InteractionRunner(
        [eventRule('self', predicate(), [set('score', 4)])],
        () => {},
        undefined,
        undefined,
        { state },
    );
    runner.onStep = (event) => events.push(event);
    await runner.fire({ type: 'onPageEnter' });
    state.set(set('score', 3));
    await tick();
    assert.equal(events.filter((event) => event.state === 'done').length, 1);
    assert.equal(state.snapshot().values.score, 4);
    runner.dispose();
});

for (const delayed of [false, true]) {
    test(`feedback guard stops ${delayed ? 'asynchronous' : 'synchronous'} memory cycles`, async () => {
        const state = new WorkflowState(),
            errors = [];
        const delay = delayed ? [{ type: 'wait', ms: 1 }] : [];
        const rules = [
            eventRule('off', predicate('flag', false, 'eq'), [...delay, set('flag', true)], {
                onRetrigger: 'restart',
            }),
            eventRule('on', predicate('flag', true, 'eq'), [...delay, set('flag', false)], {
                onRetrigger: 'restart',
            }),
        ];
        const runner = new InteractionRunner(
            rules,
            () => {},
            (message) => errors.push(message),
            undefined,
            { state },
        );
        await runner.fire({ type: 'onPageEnter' });
        const deadline = Date.now() + 2000;
        while (!errors.length && Date.now() < deadline)
            await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(errors.length, 1);
        assert.match(errors[0], /tự kích hoạt/);
        const value = state.snapshot().values.flag;
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(state.snapshot().values.flag, value);
        runner.dispose();
    });
}
