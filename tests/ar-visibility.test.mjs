import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Group, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry } from 'three';
import {
    arContentVisibility,
    setPageBackgroundVisibility,
} from '../src/scene-core/ar-visibility.ts';
import { targetToPageMatrix } from '../src/scene-core/coords.ts';

test('AR hides both page layers and reading mode restores them without hiding authored objects', () => {
    const root = new Group();
    for (const name of ['page-background', 'page-background-image', 'object']) {
        const child = new Group();
        child.name = name;
        root.add(child);
    }
    setPageBackgroundVisibility(root, false);
    assert.equal(root.children[0].visible, false);
    assert.equal(root.children[1].visible, false);
    assert.equal(root.children[2].visible, true);
    setPageBackgroundVisibility(root, true);
    assert.ok(root.children.every((child) => child.visible));
    setPageBackgroundVisibility(undefined, false);
});

function fixture() {
    const camera = new PerspectiveCamera(45, 0.5, 10, 100000);
    camera.updateMatrixWorld();
    const root = new Group(),
        object = new Group();
    object.userData.objectId = 'object';
    object.add(new Mesh(new PlaneGeometry(100, 100), new MeshBasicMaterial()));
    root.add(object);
    const state = () => {
        root.updateMatrixWorld(true);
        return arContentVisibility(root, camera);
    };
    return { camera, root, object, state };
}

test('visibility guidance distinguishes visible, offscreen and behind-camera content', () => {
    const { object, state } = fixture();
    object.position.z = -1500;
    assert.equal(state(), 'visible');
    object.position.x = 5000;
    assert.equal(state(), 'outside');
    object.position.z = 1500;
    assert.equal(state(), 'behind');
    object.visible = false;
    assert.equal(state(), 'empty');
});

test('backgrounds and transparent interaction hit areas do not count as visible AR content', () => {
    const { object, root, state } = fixture();
    const paper = new Mesh(new PlaneGeometry(1000, 1000), new MeshBasicMaterial());
    paper.position.z = -1500;
    root.add(paper);
    object.children[0].material.transparent = true;
    object.children[0].material.opacity = 0;
    assert.equal(state(), 'empty');
});

test('an object spanning the viewport is visible even when all its corners fall outside the screen', () => {
    const { object, state } = fixture();
    object.position.z = -100;
    object.scale.setScalar(100);
    assert.equal(state(), 'visible');
});

test('small Bookaria markers can put elevated content behind a close camera; moving back restores it without changing authored data', () => {
    const { camera, root, object } = fixture();
    object.children[0].geometry.dispose();
    object.children[0].geometry = new PlaneGeometry(0.2, 0.2);
    const marker = { mode: 'BOOKARIA_MARKER', transform: { x: 0.42, y: -0.265, size: 0.105 } };
    object.position.set(marker.transform.x, marker.transform.y, 0.24);
    const original = object.position.toArray();
    root.matrixAutoUpdate = false;
    const state = (distance) => {
        root.matrix.copy(
            targetToPageMatrix(
                new Matrix4().makeTranslation(-512, -512, -distance).toArray(),
                1024,
                1024,
                { marker },
            ),
        );
        root.updateMatrixWorld(true);
        return arContentVisibility(root, camera);
    };
    assert.equal(state(1480), 'behind');
    assert.equal(state(6000), 'visible');
    assert.deepEqual(object.position.toArray(), original);
});
