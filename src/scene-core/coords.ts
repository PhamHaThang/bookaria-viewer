import { Matrix4, Quaternion, Vector3 } from 'three';
import type { ManifestPage } from '../shared/contracts/manifest.schema';

export function pageToMarkerMatrix(page: Pick<ManifestPage, 'marker'>) {
    const transform = page.marker.mode === 'BOOKARIA_MARKER' ? page.marker.transform : undefined;
    if (!transform) return new Matrix4();
    const scale = 1 / transform.size;
    return new Matrix4().compose(
        new Vector3(-transform.x * scale, -transform.y * scale, 0),
        new Quaternion(),
        new Vector3(scale, scale, scale),
    );
}
// MindAR Controller returns a matrix in target-image pixels, with origin at its lower-left.
export function targetToPageMatrix(
    world: number[],
    width: number,
    height: number,
    page: Pick<ManifestPage, 'marker'>,
) {
    return new Matrix4()
        .fromArray(world)
        .multiply(new Matrix4().makeTranslation(width / 2, height / 2, 0))
        .multiply(new Matrix4().makeScale(width, width, width))
        .multiply(pageToMarkerMatrix(page));
}
export function fitDistance(aspect: number, viewportAspect: number, fovDegrees = 40) {
    return (
        (Math.max(aspect, 1 / viewportAspect) / (2 * Math.tan((fovDegrees * Math.PI) / 360))) * 1.25
    );
}
