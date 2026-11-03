import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { buildScene } from '../src/scene-core/buildScene.ts';
import { SceneObjectSchema } from '../src/shared/contracts/scene.schema.ts';

test('Viewer taps expand inline annotation descriptions, collapse peers and keep surface anchors through camera movement', async () => {
    const saved = new Map(
        ['document', 'fetch', 'ImageBitmap', 'createImageBitmap'].map((key) => [
            key,
            globalThis[key],
        ]),
    );
    const context = new Proxy(
        { measureText: (text) => ({ width: text.length * 32 }) },
        { get: (target, key) => target[key] ?? (() => {}) },
    );
    globalThis.document = {
        fonts: { ready: Promise.resolve(), load: async () => [] },
        createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    };
    globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]));
    globalThis.ImageBitmap = class {
        width = 1;
        height = 1;
        close() {}
    };
    globalThis.createImageBitmap = async () => new ImageBitmap();
    let runtime;
    try {
        const label = (id, shape) =>
            SceneObjectSchema.parse({
                id,
                type: 'label',
                text: shape === 'circle' ? '1' : 'Chi tiết',
                target: [-0.3, 0, 0],
                billboard: true,
                transform: { position: [0.2, -0.1, 0.4] },
                presentation: {
                    kind: 'annotation',
                    shape,
                    description: 'Mô tả giữ nguyên một dòng',
                    anchorAtTarget: true,
                },
            });
        const notices = [];
        runtime = await buildScene(
            {
                imageUrl: 'https://example.com/page.png',
                aspect: 1.4,
                settings: {},
                scene: {
                    schemaVersion: 1,
                    objects: [label('line', 'line'), label('circle', 'circle')],
                    interactions: [],
                },
            },
            {},
            new AbortController().signal,
            { notice: (message) => notices.push(message), link() {}, log() {} },
        );
        const root = (id) => runtime.nodes.get(id).root;
        const expanded = (id) =>
            root(id).getObjectByName('annotation-label').parent.userData.annotationExpanded;
        assert.equal(expanded('line'), false);
        assert.equal(expanded('circle'), false);
        runtime.tap('line');
        assert.equal(expanded('line'), true);
        runtime.tap('circle');
        assert.equal(expanded('line'), false);
        assert.equal(expanded('circle'), true);
        runtime.tap('circle');
        assert.equal(expanded('circle'), false);
        assert.deepEqual(notices, [], 'inline description should not open a notice popup');
        const camera = new PerspectiveCamera(40, 1, 0.01, 100);
        for (const position of [
            [1, -2, 3],
            [-2, 1, 2],
        ]) {
            camera.position.fromArray(position);
            camera.up.set(0, 0, 1);
            camera.lookAt(0, 0, 0);
            camera.updateMatrixWorld();
            runtime.update(0.016, camera);
            runtime.group.updateMatrixWorld(true);
            const marker = root('line').getObjectByName('annotation-marker');
            assert.ok(
                marker.getWorldPosition(new Vector3()).distanceTo(root('line').position) < 1e-6,
            );
            const normal = new Vector3(0, 0, 1).transformDirection(
                root('line').getObjectByName('annotation-label').matrixWorld,
            );
            assert.ok(
                normal.dot(new Vector3(0, 0, 1).applyQuaternion(camera.quaternion)) > 0.999999,
            );
        }
    } finally {
        runtime?.dispose();
        for (const [key, value] of saved) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    }
});
