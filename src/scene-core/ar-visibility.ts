import type { Camera, Object3D } from 'three';
import { Box3, Frustum, Matrix4, Mesh } from 'three';

/** The printed page already comes from the camera; only reading mode draws its image. */
export function setPageBackgroundVisibility(group: Object3D | undefined, visible: boolean) {
    for (const name of ['page-background', 'page-background-image']) {
        const mesh = group?.getObjectByName(name);
        if (mesh) mesh.visible = visible;
    }
}

export type ARContentVisibility = 'visible' | 'outside' | 'behind' | 'empty';

/** Coarse visibility for guidance only. Never change the authored AR transform. */
export function arContentVisibility(root: Object3D, camera: Camera): ARContentVisibility {
    const frustum = new Frustum().setFromProjectionMatrix(
        new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const bounds = new Box3();
    let count = 0,
        behind = 0,
        visible = false;
    root.traverseVisible((node) => {
        if (visible || !(node instanceof Mesh)) return;
        let owner: Object3D | null = node;
        while (owner && owner !== root && !owner.userData.objectId) owner = owner.parent;
        if (!owner?.userData.objectId) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        if (!materials.some((m) => m.visible && !(m.transparent && m.opacity <= 0))) return;
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        if (!node.geometry.boundingBox || node.geometry.boundingBox.isEmpty()) return;
        bounds.copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld);
        if (![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) return;
        count++;
        if (frustum.intersectsBox(bounds)) visible = true;
        else if (bounds.applyMatrix4(camera.matrixWorldInverse).min.z >= 0) behind++;
    });
    if (visible) return 'visible';
    if (!count) return 'empty';
    return count === behind ? 'behind' : 'outside';
}
