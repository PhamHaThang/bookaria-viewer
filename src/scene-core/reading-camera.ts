import type { Object3D, PerspectiveCamera } from 'three';
import { Box3, MathUtils, Mesh, SkinnedMesh, Vector3 } from 'three';

export type ReadingFrame = {
    width: number;
    height: number;
    top: number;
    bottom: number;
    side: number;
};

/** Page plus visible rendered content. Invisible audio and interaction proxies don't enlarge it. */
export function readingBounds(root: Object3D | undefined, aspect: number) {
    const box = new Box3(new Vector3(-0.5, -aspect / 2, 0), new Vector3(0.5, aspect / 2, 0));
    root?.updateWorldMatrix(true, true);
    root?.traverseVisible((node) => {
        if (!(node instanceof Mesh)) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        if (!materials.some((m) => m.visible && !(m.transparent && m.opacity <= 0))) return;
        if (node instanceof SkinnedMesh) {
            node.skeleton.update();
            node.computeBoundingBox();
        } else if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        const local = node instanceof SkinnedMesh ? node.boundingBox : node.geometry.boundingBox;
        if (!local || local.isEmpty()) return;
        const bounds = local.clone().applyMatrix4(node.matrixWorld);
        if ([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite))
            box.union(bounds);
    });
    return box;
}

/** Reserve space for the header/thumbnail strip without moving the AR coordinate system. */
export function readingProjection(camera: PerspectiveCamera, frame: ReadingFrame) {
    const { width, height, top, bottom, side } = frame;
    camera.aspect = width / height;
    camera.setViewOffset(width, height, 0, (bottom - top) / 2, width, height);
    camera.updateProjectionMatrix();
    return {
        x: Math.max(0.2, (width - 2 * side) / width),
        y: Math.max(0.2, (height - top - bottom) / height),
    };
}

/** Fit all eight corners, including depth, in the usable reading area. */
export function fitReadingCamera(
    camera: PerspectiveCamera,
    bounds: Box3,
    frame: ReadingFrame,
    direction = new Vector3(0, -0.32, 1),
) {
    const usable = readingProjection(camera, frame);
    const target = bounds.getCenter(new Vector3());
    const axis = direction.clone().normalize();
    if (!axis.lengthSq()) axis.set(0, -0.32, 1).normalize();
    if (Math.abs(axis.dot(camera.up)) > 0.999) axis.y -= 0.01;
    axis.normalize();
    const right = new Vector3().crossVectors(camera.up, axis).normalize();
    const up = new Vector3().crossVectors(axis, right).normalize();
    const tanY = Math.tan(MathUtils.degToRad(camera.fov / 2)) / camera.zoom;
    const tanX = tanY * camera.aspect;
    let distance = 0;
    for (const x of [bounds.min.x, bounds.max.x])
        for (const y of [bounds.min.y, bounds.max.y])
            for (const z of [bounds.min.z, bounds.max.z]) {
                const corner = new Vector3(x, y, z).sub(target),
                    depth = corner.dot(axis);
                distance = Math.max(
                    distance,
                    depth + (Math.abs(corner.dot(right)) * 1.12) / (tanX * usable.x),
                    depth + (Math.abs(corner.dot(up)) * 1.12) / (tanY * usable.y),
                );
            }
    const radius = bounds.getSize(new Vector3()).length() / 2;
    distance = Math.max(distance, radius * 1.05, 0.15);
    camera.position.copy(target).addScaledVector(axis, distance);
    camera.lookAt(target);
    camera.near = Math.max(radius / 2000, 0.00001);
    camera.far = Math.max(distance + radius * 50, 100);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return { target, distance, radius };
}
