import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssetCache } from '../src/scene-core/asset-cache.ts';
import { buildScene } from '../src/scene-core/buildScene.ts';
import { SceneObjectSchema } from '../src/shared/contracts/scene.schema.ts';

const assetId = '11111111-1111-4111-8111-111111111111';
const hooks = { notice() {}, link() {}, log() {} };
const page = (type) => ({
    imageUrl: 'https://example.test/paper.png',
    aspect: 1.4,
    settings: {},
    scene: {
        schemaVersion: 1,
        interactions: [],
        objects: [SceneObjectSchema.parse({ id: 'object', type, assetId, transform: {} })],
    },
});

function triangleGLB() {
    const json = JSON.stringify({
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        accessors: [
            {
                bufferView: 0,
                componentType: 5126,
                count: 3,
                type: 'VEC3',
                min: [0, 0, 0],
                max: [1, 1, 0],
            },
        ],
        bufferViews: [{ buffer: 0, byteLength: 36 }],
        buffers: [{ byteLength: 36 }],
    });
    const header = Buffer.from(json.padEnd(Math.ceil(json.length / 4) * 4, ' '));
    const binary = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
    const glb = Buffer.alloc(12 + 8 + header.length + 8 + binary.length);
    glb.writeUInt32LE(0x46546c67, 0);
    glb.writeUInt32LE(2, 4);
    glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(header.length, 12);
    glb.writeUInt32LE(0x4e4f534a, 16);
    header.copy(glb, 20);
    const offset = 20 + header.length;
    glb.writeUInt32LE(binary.length, offset);
    glb.writeUInt32LE(0x004e4942, offset + 4);
    binary.copy(glb, offset + 8);
    return glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
}

test('two page runtimes reuse a model file but parse independent geometry and release the old scene', async () => {
    let requests = 0;
    const bytes = triangleGLB();
    const cache = new AssetCache(async () => {
        requests++;
        return bytes;
    });
    const assets = {
        [assetId]: { type: 'MODEL', url: 'https://example.test/model.glb', size: bytes.byteLength },
    };
    const options = { background: false, bytes: cache };
    let first;
    let second;
    try {
        first = await buildScene(
            page('model'),
            assets,
            new AbortController().signal,
            hooks,
            options,
        );
        const oldGeometry =
            first.nodes.get('object').billboard.content.children[0].children[0].geometry;
        let disposed = false;
        oldGeometry.addEventListener('dispose', () => {
            disposed = true;
        });
        first.dispose();
        assert.equal(disposed, true);
        assert.equal(first.group.children.length, 0);
        second = await buildScene(
            page('model'),
            assets,
            new AbortController().signal,
            hooks,
            options,
        );
        const nextGeometry =
            second.nodes.get('object').billboard.content.children[0].children[0].geometry;
        assert.notEqual(nextGeometry, oldGeometry);
        assert.equal(nextGeometry.attributes.position.count, 3);
        assert.equal(requests, 1);
        assert.equal(
            bytes.byteLength,
            triangleGLB().byteLength,
            'GLTF parsing must not detach cached bytes',
        );
        cache.clear();
        const third = await buildScene(
            page('model'),
            assets,
            new AbortController().signal,
            hooks,
            options,
        );
        third.dispose();
        assert.equal(requests, 2);
    } finally {
        first?.dispose();
        second?.dispose();
        cache.clear();
    }
});

test('image decode failure evicts bytes for retry; decoded bitmaps are closed per page', async () => {
    const keys = ['ImageBitmap', 'createImageBitmap'];
    const saved = keys.map((key) => [key, globalThis[key]]);
    let requests = 0;
    let decodes = 0;
    let closed = 0;
    globalThis.ImageBitmap = class {
        width = 1;
        height = 1;
        close() {
            closed++;
        }
    };
    globalThis.createImageBitmap = async () => {
        decodes++;
        if (decodes === 1) throw Error('bad image');
        return new ImageBitmap();
    };
    const cache = new AssetCache(async () => {
        requests++;
        return new ArrayBuffer(4);
    });
    const assets = { [assetId]: { type: 'IMAGE', url: 'https://example.test/image.png', size: 4 } };
    const options = { background: false, bytes: cache };
    let first;
    let second;
    try {
        await assert.rejects(
            buildScene(page('image'), assets, new AbortController().signal, hooks, options),
            /bad image/,
        );
        first = await buildScene(
            page('image'),
            assets,
            new AbortController().signal,
            hooks,
            options,
        );
        first.dispose();
        second = await buildScene(
            page('image'),
            assets,
            new AbortController().signal,
            hooks,
            options,
        );
        second.dispose();
        assert.equal(requests, 2);
        assert.equal(decodes, 3);
        assert.equal(closed, 2);
    } finally {
        first?.dispose();
        second?.dispose();
        cache.clear();
        for (const [key, value] of saved) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    }
});

test('information card images share file bytes but own resized canvases and close decoded bitmaps', async () => {
    const keys = ['document', 'ImageBitmap', 'createImageBitmap'];
    const saved = keys.map((key) => [key, globalThis[key]]);
    let requests = 0;
    let closed = 0;
    const resized = [];
    globalThis.ImageBitmap = class {
        width = 2400;
        height = 1200;
        close() {
            closed++;
        }
    };
    globalThis.createImageBitmap = async () => new ImageBitmap();
    const context = new Proxy(
        {
            measureText: (text) => ({ width: text.length * 16 }),
            drawImage(image, ...args) {
                if (image instanceof ImageBitmap) resized.push(args);
            },
        },
        { get: (target, key) => target[key] ?? (() => {}) },
    );
    globalThis.document = {
        fonts: { ready: Promise.resolve(), load: async () => [] },
        createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    };
    const cache = new AssetCache(async () => {
        requests++;
        return new ArrayBuffer(4);
    });
    const assets = { [assetId]: { type: 'IMAGE', url: 'https://example.test/card.png', size: 4 } };
    const cardPage = {
        ...page('image'),
        scene: {
            schemaVersion: 1,
            interactions: [],
            objects: [
                SceneObjectSchema.parse({
                    id: 'card',
                    type: 'text',
                    text: 'Nội dung thẻ',
                    transform: {},
                    presentation: { kind: 'screen', title: 'Thông tin', imageAssetId: assetId },
                }),
            ],
        },
    };
    let first;
    let second;
    try {
        first = await buildScene(cardPage, assets, new AbortController().signal, hooks, {
            background: false,
            bytes: cache,
        });
        first.dispose();
        second = await buildScene(cardPage, assets, new AbortController().signal, hooks, {
            background: false,
            bytes: cache,
        });
        second.dispose();
        assert.equal(requests, 1);
        assert.equal(closed, 2);
        assert.deepEqual(resized, [
            [0, 0, 1024, 512],
            [0, 0, 1024, 512],
        ]);
    } finally {
        first?.dispose();
        second?.dispose();
        cache.clear();
        for (const [key, value] of saved) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    }
});
