import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    Box3,
    BoxGeometry,
    Group,
    Mesh,
    MeshBasicMaterial,
    PerspectiveCamera,
    Vector2,
    Vector3,
} from 'three';
import { beginDolly, dragDolly } from '../src/scene-core/dolly.ts';
import {
    fitReadingCamera,
    readingBounds,
    readingProjection,
} from '../src/scene-core/reading-camera.ts';

test('reading fit keeps a tall page and off-page 3D content inside the usable screen at every orientation', () => {
    const bounds = new Box3(new Vector3(-0.85, -1.15, 0), new Vector3(1.2, 1.15, 0.85));
    for (const [width, height] of [
        [1440, 900],
        [390, 844],
        [320, 568],
        [844, 390],
    ]) {
        const camera = new PerspectiveCamera(40);
        camera.up.set(0, 0, 1);
        const frame = {
            width,
            height,
            top: Math.min(92, height * 0.18),
            bottom: Math.min(108, height * 0.24),
            side: Math.min(32, width * 0.06),
        };
        fitReadingCamera(camera, bounds, frame);
        for (const x of [bounds.min.x, bounds.max.x])
            for (const y of [bounds.min.y, bounds.max.y])
                for (const z of [bounds.min.z, bounds.max.z]) {
                    const projected = new Vector3(x, y, z).project(camera);
                    const px = ((projected.x + 1) * width) / 2,
                        py = ((1 - projected.y) * height) / 2;
                    assert.ok(
                        px >= frame.side && px <= width - frame.side,
                        `horizontal clipping at ${width}x${height}`,
                    );
                    assert.ok(
                        py >= frame.top && py <= height - frame.bottom,
                        `vertical clipping at ${width}x${height}: ${py}`,
                    );
                    assert.ok(projected.z > -1 && projected.z < 1);
                }
    }
});

test('hidden audio, invisible objects and transparent hit areas do not zoom the reading view out', () => {
    const root = new Group();
    const visible = new Mesh(new BoxGeometry(0.4, 0.4, 0.4), new MeshBasicMaterial());
    visible.position.set(0.8, 0, 0.3);
    const hidden = visible.clone();
    hidden.position.set(100, 0, 0);
    hidden.visible = false;
    const hitArea = new Mesh(
        new BoxGeometry(100, 100, 100),
        new MeshBasicMaterial({ transparent: true, opacity: 0 }),
    );
    root.add(visible, hidden, hitArea);
    const bounds = readingBounds(root, 1.4);
    assert.ok(Math.abs(bounds.max.x - 1) < 1e-6);
    assert.equal(bounds.min.y, -0.7);
    assert.equal(bounds.max.y, 0.7);
    assert.ok(bounds.max.z > 0.49 && bounds.max.z < 0.51);
});

test('resizing a manually navigated camera preserves its position and projection remains reversible', () => {
    const camera = new PerspectiveCamera(40);
    camera.up.set(0, 0, 1);
    camera.position.set(1, -2, 3);
    camera.lookAt(0, 0, 0);
    const before = camera.position.clone(),
        rotation = camera.quaternion.clone();
    readingProjection(camera, { width: 390, height: 844, top: 92, bottom: 108, side: 24 });
    assert.deepEqual(camera.position, before);
    assert.deepEqual(camera.quaternion.toArray(), rotation.toArray());
    const point = new Vector3(0.2, 0.1, 0.3);
    camera.updateMatrixWorld();
    assert.ok(point.clone().project(camera).unproject(camera).distanceTo(point) < 1e-10);
    camera.clearViewOffset();
    assert.equal(camera.view.enabled, false);
});

test('middle drag zoom is reversible, cursor anchored, and clamps safely at its limits', () => {
    const camera = new PerspectiveCamera(40, 1.6);
    camera.up.set(0, 0, 1);
    camera.position.set(0, -1, 3);
    camera.lookAt(0, 0, 0);
    const target = new Vector3(),
        before = camera.position.clone();
    const start = beginDolly(camera, target, new Vector2(0.35, -0.2));
    const projected = start.anchor.clone().project(camera);
    assert.equal(dragDolly(camera, target, start, -120, 800, 0.15, 15), true);
    assert.ok(camera.position.distanceTo(target) < start.distance);
    const after = start.anchor.clone().project(camera);
    assert.ok(Math.abs(after.x - projected.x) < 1e-10 && Math.abs(after.y - projected.y) < 1e-10);
    dragDolly(camera, target, start, 0, 800, 0.15, 15);
    assert.ok(camera.position.distanceTo(before) < 1e-10);
    dragDolly(camera, target, start, 100000, 800, 0.15, 15);
    assert.ok(Math.abs(camera.position.distanceTo(target) - 15) < 1e-10);
});
