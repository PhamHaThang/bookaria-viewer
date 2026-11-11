import assert from 'node:assert/strict';
import test from 'node:test';
import { InteractionRunner } from '../src/scene-core/InteractionRunner.ts';
import { WorkflowState } from '../src/scene-core/WorkflowState.ts';
import { InteractionRuleSchema } from '../src/shared/contracts/scene.schema.ts';

const remember = (key, value) => ({ type: 'setState', key, operation: 'set', value });
const score = { type: 'variable', key: 'score', operator: 'gte', value: 3 };
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture(condition = score, policy = 'ignore') {
    const state = new WorkflowState();
    let listeners = 0;
    const subscribe = state.subscribe.bind(state);
    state.subscribe = (listener) => {
        listeners++;
        const off = subscribe(listener);
        return () => {
            listeners--;
            off();
        };
    };
    const rule = InteractionRuleSchema.parse({
        id: 'waiter',
        trigger: { type: 'onPageEnter' },
        onRetrigger: policy,
        actions: [{ type: 'waitUntil', test: condition }, remember('released', true)],
    });
    let visible = false;
    const errors = [],
        events = [];
    const runner = new InteractionRunner(
        [rule],
        () => assert.fail('Handled by runner'),
        (message) => errors.push(message),
        undefined,
        { state, pageId: 'page', visible: () => visible },
    );
    runner.onStep = (event) => events.push(event);
    return {
        state,
        runner,
        errors,
        events,
        count: () => listeners,
        show: () => {
            visible = true;
            state.notify();
        },
    };
}

test('waitUntil checks immediately and removes its listener when already satisfied', async () => {
    const f = fixture();
    f.state.set(remember('score', 3));
    await f.runner.run('waiter');
    assert.equal(f.state.snapshot().values.released, true);
    assert.equal(f.count(), 0);
    assert.deepEqual(f.errors, []);
    f.runner.dispose();
});

test('another rule can release a pending wait; false updates do not advance it', async () => {
    const f = fixture();
    const waiting = f.runner.fire({ type: 'onPageEnter' });
    await tick();
    assert.equal(f.count(), 1);
    f.state.set(remember('score', 2));
    await tick();
    assert.equal(f.state.snapshot().values.released, undefined);
    const producer = new InteractionRunner(
        [
            InteractionRuleSchema.parse({
                id: 'producer',
                trigger: { type: 'onTap', objectId: 'button' },
                actions: [remember('score', 3)],
            }),
        ],
        () => {},
        undefined,
        undefined,
        { state: f.state, pageId: 'page' },
    );
    await producer.fire({ type: 'onTap', objectId: 'button' });
    await waiting;
    f.state.set(remember('score', 4));
    assert.equal(f.events.filter((event) => event.index === 1 && event.state === 'done').length, 1);
    assert.equal(f.count(), 0);
    f.runner.dispose();
    producer.dispose();
});

for (const operation of ['cancelAll', 'dispose']) {
    test(`${operation} cancels the wait and prevents late state changes from continuing`, async () => {
        const f = fixture();
        const pending = f.runner.run('waiter');
        await tick();
        f.runner[operation]();
        await pending;
        assert.equal(f.count(), 0);
        f.state.set(remember('score', 3));
        await tick();
        assert.equal(f.state.snapshot().values.released, undefined);
        assert.equal(f.events.at(-1).state, 'cancelled');
        assert.deepEqual(f.errors, []);
        f.runner.dispose();
    });
}

test('restart replaces the previous subscription; ignore keeps one pending run', async () => {
    for (const policy of ['restart', 'ignore']) {
        const f = fixture(score, policy);
        const first = f.runner.run('waiter');
        await tick();
        const second = f.runner.run('waiter');
        await tick();
        assert.equal(f.count(), 1);
        f.state.set(remember('score', 3));
        await Promise.all([first, second]);
        assert.equal(f.count(), 0);
        assert.equal(
            f.events.filter((event) => event.index === 1 && event.state === 'done').length,
            1,
        );
        f.runner.dispose();
    }
});

for (const [name, condition, update] of [
    [
        'answer',
        { type: 'answer', questionId: 'q', result: 'correct' },
        (f) => f.state.answer('q', { choiceId: 'yes', correct: true }),
    ],
    [
        'tap count',
        { type: 'interactionCount', objectId: 'button', min: 1 },
        (f) => f.state.tap('page', 'button'),
    ],
    ['visibility', { type: 'visible', objectId: 'item', value: true }, (f) => f.show()],
    [
        'reset to defaults',
        { type: 'variable', key: 'flag', operator: 'eq', value: false },
        (f) => f.state.reset(),
    ],
]) {
    test(`waitUntil wakes on ${name} changes`, async () => {
        const f = fixture(condition);
        f.state.set(remember('flag', true));
        const pending = f.runner.run('waiter');
        await tick();
        assert.equal(f.count(), 1);
        update(f);
        await pending;
        assert.equal(f.state.snapshot().values.released, true);
        assert.equal(f.count(), 0);
        f.runner.dispose();
    });
}
