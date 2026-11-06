import assert from 'node:assert/strict';
import test from 'node:test';
import { InteractionRunner } from '../src/scene-core/InteractionRunner.ts';
import { WorkflowState } from '../src/scene-core/WorkflowState.ts';
import { InteractionRuleSchema } from '../src/shared/contracts/scene.schema.ts';

const parsed = (actions, edges, trigger = { type: 'onPageEnter' }, id = 'rule') =>
    InteractionRuleSchema.parse({
        id,
        trigger,
        actions,
        editorLayout: [
            { id: 'start', x: 0, y: 0 },
            ...actions.map((_, index) => ({ id: `n${index}`, x: index * 300 + 300, y: 0 })),
        ],
        workflow: {
            version: 1,
            edges: edges.map(([source, target, port = 'next']) => ({ source, target, port })),
        },
    });
const remember = (key, value, operation = 'set') => ({
    type: 'setState',
    key,
    value,
    operation,
    delayMsSchema: 0,
});
const question = {
    questionId: 'q1',
    title: 'Câu hỏi thử',
    choices: [
        { id: 'a', text: 'Đúng' },
        { id: 'b', text: 'Sai' },
    ],
    correctChoiceId: 'a',
};

test('conditions follow only their selected port, merges execute once, navigation ends the branch', async () => {
    const rule = parsed(
        [
            {
                type: 'condition',
                test: { type: 'variable', key: 'score', operator: 'gte', value: 3 },
            },
            remember('unlocked', true),
            remember('unlocked', false),
            { type: 'navigate', navigation: { target: 'end' } },
        ],
        [
            ['start', 'n0'],
            ['n0', 'n1', 'true'],
            ['n0', 'n2', 'false'],
            ['n1', 'n3'],
            ['n2', 'n3'],
        ],
    );
    const state = new WorkflowState(),
        events = [],
        destinations = [];
    const runner = new InteractionRunner(
        [rule],
        () => assert.fail('internal nodes must not reach the scene executor'),
        assert.fail,
        undefined,
        { state, navigate: (value) => destinations.push(value) },
    );
    runner.onStep = (event) => {
        if (event.state === 'done') events.push(event);
    };
    await runner.run('rule');
    assert.equal(state.snapshot().values.unlocked, false);
    assert.deepEqual(
        events.map((event) => event.nodeId),
        ['n0', 'n2', 'n3'],
    );
    assert.equal(events[0].branch, 'false');
    assert.equal(destinations.length, 1);
    state.set(remember('score', 3));
    events.length = 0;
    await runner.run('rule');
    assert.equal(state.snapshot().values.unlocked, true);
    assert.deepEqual(
        events.map((event) => event.nodeId),
        ['n0', 'n1', 'n3'],
    );
    runner.dispose();
});

test('answers fire matching events, remain available to conditions, and do not leak between isolated previews', async () => {
    const ask = parsed(
        [
            { type: 'askQuestion', question },
            { type: 'condition', test: { type: 'answer', questionId: 'q1', result: 'correct' } },
            remember('score', 1, 'increment'),
            remember('wrong', true),
        ],
        [
            ['start', 'n0'],
            ['n0', 'n1'],
            ['n1', 'n2', 'true'],
            ['n1', 'n3', 'false'],
        ],
    );
    const answer = {
        id: 'answer',
        enabled: true,
        trigger: { type: 'onAnswer', questionId: 'q1', answer: 'correct' },
        actions: [remember('reward', true)],
        onRetrigger: 'ignore',
    };
    const state = new WorkflowState();
    const runner = new InteractionRunner([ask, answer], () => {}, assert.fail, undefined, {
        state,
        question: async () => 'a',
    });
    await runner.run('rule');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(state.snapshot().values, { reward: true, score: 1 });
    assert.deepEqual(state.snapshot().answers.q1, { choiceId: 'a', correct: true });
    assert.deepEqual(new WorkflowState().snapshot().values, {});
    runner.dispose();
});

test('tap counts are scoped to the page, animation completion matches clip, marker events stay distinct', async () => {
    const actions = [],
        state = new WorkflowState();
    const rules = [
        { id: 'tap', trigger: { type: 'onTap', objectId: 'object' } },
        { id: 'animation', trigger: { type: 'onAnimationEnd', objectId: 'model', clip: 'Idle' } },
        { id: 'found', trigger: { type: 'onMarkerFound' } },
        { id: 'lost', trigger: { type: 'onMarkerLost' } },
    ].map((rule) =>
        InteractionRuleSchema.parse({
            ...rule,
            actions: [{ type: 'openUrl', url: `https://example.com/${rule.id}` }],
        }),
    );
    const runner = new InteractionRunner(
        rules,
        (action) => actions.push(action.url),
        assert.fail,
        undefined,
        { state, pageId: 'page-a' },
    );
    await runner.fire({ type: 'onTap', objectId: 'object' });
    await runner.fire({ type: 'onAnimationEnd', objectId: 'model', clip: 'Walk' });
    await runner.fire({ type: 'onAnimationEnd', objectId: 'model', clip: 'Idle' });
    await runner.fire({ type: 'onMarkerFound' });
    await runner.fire({ type: 'onMarkerLost' });
    assert.deepEqual(
        actions,
        ['tap', 'animation', 'found', 'lost'].map((id) => `https://example.com/${id}`),
    );
    assert.equal(
        state.test({ type: 'interactionCount', objectId: 'object', min: 1 }, 'page-a'),
        true,
    );
    assert.equal(
        state.test({ type: 'interactionCount', objectId: 'object', min: 1 }, 'page-b'),
        false,
    );
    runner.dispose();
});

test('cancelling a pending question prevents all following state and navigation changes', async () => {
    const rule = InteractionRuleSchema.parse({
        id: 'pending',
        trigger: { type: 'onPageEnter' },
        actions: [{ type: 'askQuestion', question }, remember('completed', true)],
    });
    const runner = new InteractionRunner([rule], () => assert.fail(), assert.fail, undefined, {
        question: (_, signal) =>
            new Promise((_, reject) =>
                signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
            ),
    });
    const task = runner.run('pending');
    await Promise.resolve();
    runner.cancelAll();
    await task;
    assert.deepEqual(runner.progress.snapshot().values, {});
    runner.dispose();
});

test('progress persists per book/version, restores primitive types and tolerates unavailable storage', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const values = new Map();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key) => values.get(key) || null,
            setItem: (key, value) => values.set(key, value),
        },
    });
    try {
        const first = new WorkflowState('book-a:1');
        first.set(remember('score', 4));
        first.set(remember('completed', true));
        first.answer('q1', { choiceId: 'a', correct: true });
        first.tap('p1', 'o1');
        assert.deepEqual(new WorkflowState('book-a:1').snapshot(), first.snapshot());
        assert.deepEqual(new WorkflowState('book-a:2').snapshot().values, {});
        const restored = new WorkflowState('book-a:1');
        restored.reset();
        assert.deepEqual(new WorkflowState('book-a:1').snapshot().values, {});
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            get() {
                throw new Error('unavailable');
            },
        });
        const blocked = new WorkflowState('blocked');
        blocked.set(remember('score', 1));
        assert.equal(blocked.snapshot().values.score, 1);
    } finally {
        if (original) Object.defineProperty(globalThis, 'localStorage', original);
        else delete globalThis.localStorage;
    }
});

test('closing a question is reported as cancelled and never completes subsequent actions', async () => {
    const rule = InteractionRuleSchema.parse({
        id: 'closed',
        trigger: { type: 'onPageEnter' },
        actions: [{ type: 'askQuestion', question }, remember('completed', true)],
    });
    const events = [];
    const runner = new InteractionRunner([rule], () => assert.fail(), assert.fail, undefined, {
        question: async () => null,
    });
    runner.onStep = (event) => events.push(event);
    await runner.run('closed');
    assert.equal(events.at(-1).state, 'cancelled');
    assert.deepEqual(runner.progress.snapshot().values, {});
    runner.dispose();
});

test('book memory starts from declared defaults, preserves reader progress, and resets to defaults', () => {
    const definitions = [
        { key: 'score', name: 'Điểm', type: 'number', initialValue: 10 },
        { key: 'found', name: 'Đã khám phá', type: 'boolean', initialValue: false },
        { key: 'choice', name: 'Nhân vật', type: 'string', initialValue: 'Milo' },
    ];
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const disk = new Map();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key) => disk.get(key) || null,
            setItem: (key, value) => disk.set(key, value),
        },
    });
    try {
        const state = new WorkflowState('memory-book:1', definitions);
        assert.equal(
            state.test({ type: 'variable', key: 'score', operator: 'gte', value: 10 }, 'page-a'),
            true,
        );
        state.set(remember('score', 5, 'increment'));
        state.set(remember('found', true));
        assert.deepEqual(new WorkflowState('memory-book:1', definitions).snapshot().values, {
            score: 15,
            found: true,
            choice: 'Milo',
        });
        assert.equal(new WorkflowState(undefined, definitions).snapshot().values.score, 10);
        assert.throws(() => state.set(remember('found', 10)), /không phù hợp/);
        const changedDefaults = definitions.map((item) =>
            item.key === 'score' ? { ...item, initialValue: 20 } : item,
        );
        const restored = new WorkflowState('memory-book:1', changedDefaults);
        assert.equal(restored.snapshot().values.score, 15);
        restored.reset();
        assert.deepEqual(restored.snapshot().values, { score: 20, found: false, choice: 'Milo' });
        disk.set(
            'memory-book:1',
            JSON.stringify({ version: 1, values: { score: 'wrong type', found: true } }),
        );
        assert.equal(new WorkflowState('memory-book:1', definitions).snapshot().values.score, 10);
    } finally {
        if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
        else delete globalThis.localStorage;
    }
});
