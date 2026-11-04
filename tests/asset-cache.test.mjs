import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ASSET_CACHE_LIMITS, AssetCache } from '../src/scene-core/asset-cache.ts';

const signal = () => new AbortController().signal;

test('returning to an asset uses completed bytes, keeps the full versioned URL and respects abort/size checks', async () => {
    const requests = [];
    const cache = new AssetCache(async (url) => {
        requests.push(url);
        return new ArrayBuffer(4);
    });
    const first = await cache.get('https://cdn.test/model.glb?v=1', signal());
    assert.equal(await cache.get('https://cdn.test/model.glb?v=1', signal()), first);
    await cache.get('https://cdn.test/model.glb?v=2', signal());
    await assert.rejects(cache.get('https://cdn.test/model.glb?v=1', signal(), 3), /vượt giới hạn/);
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(cache.get('https://cdn.test/model.glb?v=1', cancelled.signal));
    assert.equal(requests.length, 2);
    assert.equal(ASSET_CACHE_LIMITS.totalBytes, 24 * 1024 * 1024);
    assert.equal(ASSET_CACHE_LIMITS.fileBytes, 8 * 1024 * 1024);
});

test('cache evicts least recently used bytes and large files still load without evicting smaller ones', async () => {
    const requests = [];
    const cache = new AssetCache(
        async (url) => {
            requests.push(url);
            return new ArrayBuffer(url === '/large' ? 5 : 2);
        },
        { totalBytes: 6, fileBytes: 4 },
    );
    for (const url of ['/a', '/b', '/c', '/a', '/d', '/a', '/c']) await cache.get(url, signal());
    assert.deepEqual(requests, ['/a', '/b', '/c', '/d']);
    assert.equal((await cache.get('/large', signal())).byteLength, 5);
    await cache.get('/large', signal());
    await cache.get('/a', signal());
    await cache.get('/b', signal());
    assert.deepEqual(requests, ['/a', '/b', '/c', '/d', '/large', '/large', '/b']);
});

test('failed, empty or cancelled downloads are not retained', async () => {
    let calls = 0;
    const abort = new AbortController();
    const cache = new AssetCache(async (url) => {
        calls++;
        if (url === '/failed') throw Error('network failed');
        if (url === '/cancelled') abort.abort();
        return new ArrayBuffer(url === '/empty' ? 0 : 2);
    });
    for (let i = 0; i < 2; i++) await assert.rejects(cache.get('/failed', signal()));
    for (let i = 0; i < 2; i++) await cache.get('/empty', signal());
    await assert.rejects(cache.get('/cancelled', abort.signal));
    await cache.get('/cancelled', signal());
    assert.equal(calls, 6);
});

test('clearing a book prevents a late old download from replacing bytes of the new book', async () => {
    let resolveOld;
    let requests = 0;
    const current = new ArrayBuffer(2);
    const cache = new AssetCache(() => {
        requests++;
        return requests === 1
            ? new Promise((resolve) => {
                  resolveOld = resolve;
              })
            : Promise.resolve(current);
    });
    const old = cache.get('/shared-url', signal());
    cache.clear();
    await cache.get('/shared-url', signal());
    resolveOld(new ArrayBuffer(1));
    await old;
    assert.equal(await cache.get('/shared-url', signal()), current);
    cache.clear();
    await cache.get('/shared-url', signal());
    assert.equal(requests, 3);
});

test('overlapping completions for one URL do not count the stored file twice', async () => {
    const completions = [];
    let requests = 0;
    const cache = new AssetCache(
        async (url) => {
            requests++;
            if (url !== '/same') return new ArrayBuffer(2);
            return new Promise((resolve) => {
                completions.push(resolve);
            });
        },
        { totalBytes: 6, fileBytes: 4 },
    );
    const a = cache.get('/same', signal());
    const b = cache.get('/same', signal());
    for (const resolve of completions) resolve(new ArrayBuffer(2));
    await Promise.all([a, b]);
    await cache.get('/b', signal());
    await cache.get('/c', signal());
    await cache.get('/same', signal());
    assert.equal(requests, 4);
});
