import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Matrix4 } from 'three';
import { startTracking } from '../src/tracker/mindar.ts';
import { TRACKING_OPTIONS } from '../src/tracker/tracking-config.ts';

let scope;
class FakeController {
    constructor(options) {
        this.options = options;
        this.state = scope;
        this.state.controllers.push(this);
        this.worker = {
            terminate: () => {
                this.state.terminated++;
            },
        };
    }
    getProjectionMatrix() {
        return Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0));
    }
    addImageTargetsFromBuffer(buffer) {
        assert.equal(this.timer, undefined, 'Retargeting must not overlap processing');
        this.state.selected.push(new Uint8Array(buffer)[0]);
        const tensor = {
            disposed: false,
            dispose() {
                assert.equal(this.disposed, false, 'No double disposal');
                this.disposed = true;
            },
        };
        this.tracker = {
            featurePointsListT: [tensor],
            imagePixelsListT: [],
            imagePropertiesListT: [],
        };
        this.state.tensors.push(tensor);
        return { dimensions: [[100, 100]] };
    }
    dummyRun() {}
    processVideo() {
        this.trackingStates = [{ isTracking: true }];
        this.timer = setInterval(() => {
            this.inFrame = true;
            this.options.onUpdate({ type: 'processDone' });
            this.inFrame = false;
        }, 2);
    }
    stopProcessVideo() {
        const pendingFrame = this.timer !== undefined && !this.inFrame;
        clearInterval(this.timer);
        this.timer = undefined;
        if (pendingFrame) queueMicrotask(() => this.options.onUpdate({ type: 'processDone' }));
    }
    dispose() {
        this.stopProcessVideo();
        this.state.disposals++;
    }
}
function install() {
    const keys = [
        'isSecureContext',
        'navigator',
        'document',
        'window',
        'fetch',
        'requestAnimationFrame',
    ];
    const saved = new Map(
        keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
    );
    const state = {
        calls: 0,
        stops: 0,
        disposals: 0,
        terminated: 0,
        controllers: [],
        selected: [],
        tensors: [],
        downloads: [],
        updates: [],
        issues: [],
    };
    scope = state;
    const video = Object.assign(new EventTarget(), {
        videoWidth: 640,
        videoHeight: 480,
        play: async () => {},
        pause() {},
        remove() {},
        srcObject: null,
    });
    const stream = {
        getTracks: () => [
            {
                stop() {
                    state.stops++;
                },
            },
        ],
    };
    const document = {
        createElement: (tag) =>
            tag === 'video' ? video : Object.assign(new EventTarget(), { remove() {} }),
        head: {
            append(script) {
                queueMicrotask(() => script.dispatchEvent(new Event('load')));
            },
        },
    };
    const values = {
        isSecureContext: true,
        navigator: {
            mediaDevices: {
                getUserMedia: async (constraints) => {
                    assert.equal(constraints.audio, false);
                    state.calls++;
                    return stream;
                },
            },
        },
        document,
        window: { MINDAR: { IMAGE: { Controller: FakeController } } },
        fetch: async (url) => {
            state.downloads.push(url);
            return new Response(new Uint8Array([url.endsWith('/1') ? 1 : 0]));
        },
        requestAnimationFrame: (fn) => setTimeout(() => fn(0), 1),
    };
    for (const [key, value] of Object.entries(values))
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    return {
        state,
        stream,
        video,
        restore() {
            for (const [key, value] of saved) {
                if (value) Object.defineProperty(globalThis, key, value);
                else delete globalThis[key];
            }
        },
    };
}
async function waitFor(predicate) {
    for (let n = 0; n < 150; n++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.ok(predicate(), 'Expected tracker state');
}
const groups = [
    { group: 0, url: 'https://example.test/0' },
    { group: 1, url: 'https://example.test/1' },
];
const hooks = (state) => ({
    resize() {},
    searching() {},
    issue: (message) => state.issues.push(message),
    update: (...args) => state.updates.push(args),
});

test('retargeting reuses the camera/controller, waits for frame completion and frees previous target tensors', async () => {
    const f = install(),
        abort = new AbortController();
    let session;
    try {
        session = await startTracking({ prepend() {} }, groups, 0, abort.signal, hooks(f.state));
        session.prefer(1);
        await waitFor(() => f.state.selected.length === 2);
        assert.equal(f.state.calls, 1);
        assert.equal(f.state.controllers.length, 1);
        for (const [key, value] of Object.entries(TRACKING_OPTIONS))
            assert.equal(f.state.controllers[0].options[key], value);
        assert.equal(f.state.tensors[0].disposed, true);
        session.prefer(0);
        await waitFor(() => f.state.selected.length === 3);
        assert.equal(
            f.state.downloads.length,
            2,
            'Prefetch and returning to a group share the cache',
        );
        abort.abort();
        session.stop();
        await waitFor(() => f.state.terminated === 1);
        assert.equal(f.state.stops, 1);
        assert.equal(f.state.disposals, 1);
        assert.ok(f.state.tensors.every((t) => t.disposed));
        assert.deepEqual(f.state.issues, []);
    } finally {
        abort.abort();
        session?.stop();
        await new Promise((resolve) => setTimeout(resolve, 5));
        f.restore();
    }
});
test('tracker filters pose spikes and resets smoothing when the target group changes', async () => {
    const f = install(),
        abort = new AbortController();
    let session;
    try {
        session = await startTracking({ prepend() {} }, groups, 0, abort.signal, hooks(f.state));
        const controller = f.state.controllers[0];
        const emit = (x) =>
            controller.options.onUpdate({
                type: 'updateMatrix',
                targetIndex: 0,
                worldMatrix: new Matrix4().makeTranslation(x, 0, -1000).toArray(),
            });
        emit(0);
        assert.equal(f.state.updates.at(-1)[2][12], 0);
        controller.trackingStates[0].isTracking = false;
        emit(100);
        assert.equal(f.state.updates.length, 1, 'Held vendor matrices are not fresh tracking');
        controller.trackingStates[0].isTracking = true;
        emit(500);
        assert.equal(f.state.updates.length, 1, 'A rejected spike starts a hold, not a loss');
        emit(1);
        assert.ok(f.state.updates.at(-1)[2][12] < 1);
        session.prefer(1);
        await waitFor(() => f.state.selected.length === 2);
        emit(500);
        assert.equal(f.state.updates.at(-1)[0], 1);
        assert.equal(f.state.updates.at(-1)[2][12], 500);
    } finally {
        abort.abort();
        session?.stop();
        await new Promise((resolve) => setTimeout(resolve, 5));
        f.restore();
    }
});

test('a camera granted after cancellation is closed immediately without loading a controller', async () => {
    const f = install(),
        abort = new AbortController();
    let grant;
    navigator.mediaDevices.getUserMedia = () =>
        new Promise((resolve) => {
            grant = resolve;
        });
    try {
        const pending = startTracking({ prepend() {} }, groups, 0, abort.signal, hooks(f.state));
        abort.abort();
        grant(f.stream);
        await assert.rejects(pending);
        assert.equal(f.state.stops, 1);
        assert.equal(f.state.controllers.length, 0);
    } finally {
        abort.abort();
        f.restore();
    }
});
test('camera denial produces a readable recovery message and does not initialize tracking', async () => {
    const f = install();
    navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException('denied', 'NotAllowedError');
    };
    try {
        await assert.rejects(
            startTracking(
                { prepend() {} },
                groups,
                0,
                new AbortController().signal,
                hooks(f.state),
            ),
            /Đọc trên màn hình/,
        );
        assert.equal(f.state.controllers.length, 0);
    } finally {
        f.restore();
    }
});
