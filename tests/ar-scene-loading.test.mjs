import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScene } from '../src/scene-core/buildScene.ts';

const page = {
    imageUrl: 'https://example.test/paper.png',
    aspect: 1.4,
    settings: {},
    scene: { schemaVersion: 1, objects: [], interactions: [] },
};
const hooks = { notice() {}, link() {}, log() {} };

test('AR does not download or decode the invisible page background; screen reading keeps it', async () => {
    const keys = ['fetch', 'createImageBitmap', 'ImageBitmap'];
    const saved = keys.map((key) => [key, globalThis[key]]);
    const requests = [];
    globalThis.fetch = async (url) => {
        requests.push(url);
        return new Response(new Uint8Array([1]));
    };
    globalThis.ImageBitmap = class {
        width = 2;
        height = 1;
        close() {}
    };
    globalThis.createImageBitmap = async () => new ImageBitmap();
    let ar;
    let read;
    try {
        ar = await buildScene(page, {}, new AbortController().signal, hooks, { background: false });
        assert.equal(requests.length, 0);
        assert.equal(ar.group.getObjectByName('page-background'), undefined);
        assert.equal(ar.group.getObjectByName('page-background-image'), undefined);
        read = await buildScene(page, {}, new AbortController().signal, hooks);
        assert.deepEqual(requests, [page.imageUrl]);
        assert.ok(read.group.getObjectByName('page-background'));
        assert.ok(read.group.getObjectByName('page-background-image'));
    } finally {
        ar?.dispose();
        read?.dispose();
        for (const [key, value] of saved) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    }
});
