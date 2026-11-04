import * as THREE from 'three';

export function nextFrame(signal: AbortSignal) {
    signal.throwIfAborted();
    return new Promise<void>((resolve, reject) => {
        const abort = () => {
            cancelAnimationFrame(frame);
            reject(signal.reason);
        };
        const frame = requestAnimationFrame(() => {
            signal.removeEventListener('abort', abort);
            resolve();
        });
        signal.addEventListener('abort', abort, { once: true });
    });
}

/** Prepare off-scene, so first visibility does not compile all shaders/upload all maps at once. */
export async function prepareScene(
    renderer: Pick<THREE.WebGLRenderer, 'compileAsync' | 'initTexture'>,
    group: THREE.Group,
    camera: THREE.Camera,
    scene: THREE.Scene,
    signal: AbortSignal,
) {
    signal.throwIfAborted();
    await renderer.compileAsync(group, camera, scene);
    signal.throwIfAborted();
    const textures = new Set<THREE.Texture>();
    group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
            for (const value of Object.values(material))
                if (value instanceof THREE.Texture && !(value instanceof THREE.VideoTexture))
                    textures.add(value);
    });
    let batch = performance.now();
    for (const texture of textures) {
        signal.throwIfAborted();
        renderer.initTexture(texture);
        if (performance.now() - batch >= 4) {
            await nextFrame(signal);
            batch = performance.now();
        }
    }
}
