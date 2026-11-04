import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TargetCache } from '../src/tracker/target-cache.ts';

const flush = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
};

test('prefetch is shared with the foreground request and only one request is in flight', async () => {
    const calls = [];
    let complete;
    const bytes = new ArrayBuffer(4);
    const cache = new TargetCache((url, signal, limit) => {
        calls.push({ url, signal, limit });
        return new Promise((resolve) => {
            complete = resolve;
        });
    });
    try {
        cache.prefetch(1, '/1');
        cache.prefetch(2, '/2');
        const foreground = cache.get(1, '/1');
        assert.equal(calls.length, 1);
        complete(bytes);
        assert.equal(await foreground, bytes);
        assert.equal(await cache.get(1, '/1'), bytes);
        assert.equal(calls[0].limit, 10 * 1024 * 1024);
    } finally {
        cache.stop();
    }
});

test('an explicit page change cancels an unrelated speculative download', async () => {
    const calls = [];
    const cache = new TargetCache((url, signal) => {
        calls.push({ url, signal });
        if (url === '/1')
            return new Promise((_, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            });
        return Promise.resolve(new ArrayBuffer(2));
    });
    try {
        cache.prefetch(1, '/1');
        await cache.get(2, '/2');
        assert.equal(calls[0].signal.aborted, true);
        assert.deepEqual(
            calls.map((call) => call.url),
            ['/1', '/2'],
        );
        assert.equal((await cache.get(2, '/2')).byteLength, 2);
    } finally {
        cache.stop();
    }
});

test('a speculative failure is silent and can be retried when the group is needed', async () => {
    let calls = 0;
    let fail;
    const cache = new TargetCache(() => {
        calls++;
        return calls === 1
            ? new Promise((_, reject) => {
                  fail = reject;
              })
            : Promise.resolve(new ArrayBuffer(3));
    });
    try {
        cache.prefetch(1, '/1');
        const foreground = cache.get(1, '/1');
        fail(Error('temporary network error'));
        assert.equal((await foreground).byteLength, 3);
        assert.equal(calls, 2);
    } finally {
        cache.stop();
    }
});

test('the 30 MiB cache evicts least recently used groups and rejects oversized groups', async () => {
    const calls = [];
    const cache = new TargetCache(async (url) => {
        calls.push(url);
        return new ArrayBuffer((url === '/oversized' ? 11 : 10) * 1024 * 1024);
    });
    try {
        for (const group of [0, 1, 2, 0, 3, 0, 2, 1]) await cache.get(group, `/${group}`);
        assert.deepEqual(calls, ['/0', '/1', '/2', '/3', '/1']);
        await assert.rejects(cache.get(9, '/oversized'), /vượt giới hạn/);
    } finally {
        cache.stop();
    }
});

test('stopping aborts a download and never repopulates the cache after a late response', async () => {
    let finish;
    let request;
    const cache = new TargetCache((_, signal) => {
        request = signal;
        return new Promise((resolve) => {
            finish = resolve;
        });
    });
    cache.prefetch(0, '/0');
    cache.stop();
    assert.equal(request.aborted, true);
    finish(new ArrayBuffer(4));
    await flush();
    await assert.rejects(cache.get(0, '/0'), /Đã dừng camera/);
});

test('a stalled download times out instead of blocking every other target group', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let aborted = false;
    const cache = new TargetCache(
        (_, signal) =>
            new Promise((_, reject) => {
                signal.addEventListener('abort', () => {
                    aborted = true;
                    reject(signal.reason);
                });
            }),
    );
    try {
        const pending = cache.get(0, '/0');
        const failed = assert.rejects(pending, /gián đoạn/);
        t.mock.timers.tick(10000);
        await failed;
        assert.equal(aborted, true);
    } finally {
        cache.stop();
        t.mock.timers.reset();
    }
});

test('failed prefetch does not retry on every camera pose, while foreground requests remain available', async () => {
    let attempts = 0;
    let clock = 0;
    const cache = new TargetCache(
        async () => {
            attempts++;
            throw Error('offline');
        },
        () => clock,
    );
    try {
        cache.prefetch(1, '/1');
        await flush();
        for (let frame = 0; frame < 60; frame++) {
            cache.prefetch(1, '/1');
            await flush();
        }
        assert.equal(attempts, 1);
        clock = 15000;
        cache.prefetch(1, '/1');
        await flush();
        assert.equal(attempts, 2);
        await assert.rejects(cache.get(1, '/1'), /offline/);
        assert.equal(attempts, 3, 'Explicit demand bypasses speculative retry cooldown');
    } finally {
        cache.stop();
    }
});
