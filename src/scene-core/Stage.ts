import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ManifestPage } from '../shared/contracts/manifest.schema';
import { createPageLighting } from '../shared/scene/page-lighting';
import {
    type ARContentVisibility,
    arContentVisibility,
    setPageBackgroundVisibility,
} from './ar-visibility';
import type { PageRuntime } from './buildScene';
import { stopSceneOrbit } from './camera-navigation';
import { ReadingNavigation } from './ReadingNavigation';
import {
    fitReadingCamera,
    type ReadingFrame,
    readingBounds,
    readingProjection,
} from './reading-camera';

export class Stage {
    readonly renderer: THREE.WebGLRenderer;
    readonly scene = new THREE.Scene();
    readonly camera = new THREE.PerspectiveCamera(40, 1, 0.005, 10000);
    readonly anchor = new THREE.Group();
    private lighting = createPageLighting();
    private controls: OrbitControls;
    private resizeObserver: ResizeObserver;
    private runtime: PageRuntime | null = null;
    private aspect = 1.4;
    private arProjection: number[] | null = null;
    private videoSize = { width: 1, height: 1 };
    private last = 0;
    private navigation: ReadingNavigation;
    private navigated = false;
    private nextVisibilityCheck = 0;
    private contentVisibility: ARContentVisibility | null = null;
    constructor(private container: HTMLElement) {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.domElement.setAttribute('aria-label', 'Nội dung 3D của trang');
        this.renderer.domElement.setAttribute('role', 'img');
        this.container.append(this.renderer.domElement);
        this.camera.up.set(0, 0, 1);
        this.camera.position.set(0, -0.8, 3);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.navigation = new ReadingNavigation(
            this.renderer.domElement,
            this.camera,
            this.controls,
            this.tap,
            () => {
                this.navigated = true;
            },
        );
        this.scene.add(this.anchor);
        this.scene.add(this.lighting.group);

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(container);
        this.resize();
        this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
        this.renderer.setAnimationLoop((time) => {
            const delta = this.last ? Math.min(0.1, (time - this.last) / 1000) : 0;
            this.last = time;
            if (!this.arProjection) this.controls.update();
            this.runtime?.update(delta, this.camera);
            this.renderer.render(this.scene, this.camera);
            if (
                this.arProjection &&
                this.anchor.visible &&
                this.runtime &&
                time >= this.nextVisibilityCheck
            ) {
                this.nextVisibilityCheck = time + 500;
                const visibility = arContentVisibility(this.runtime.group, this.camera);
                if (visibility !== this.contentVisibility) {
                    this.contentVisibility = visibility;
                    this.container.dispatchEvent(
                        new CustomEvent('ar-content-visibility', { detail: visibility }),
                    );
                }
            }
        });
    }
    private contextLost = (event: Event) => {
        event.preventDefault();
        this.container.dispatchEvent(
            new CustomEvent('stage-error', {
                detail: 'WebGL bị gián đoạn. Dừng và mở lại bản xem trước.',
            }),
        );
    };
    private tap = (event: PointerEvent) => {
        if (!this.runtime || !this.anchor.visible) return;
        const box = this.renderer.domElement.getBoundingClientRect();
        const pointer = new THREE.Vector2(
            ((event.clientX - box.left) / box.width) * 2 - 1,
            (-(event.clientY - box.top) / box.height) * 2 + 1,
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(pointer, this.camera);
        for (const hit of raycaster.intersectObject(this.runtime.group, true)) {
            let object: THREE.Object3D | null = hit.object;
            let id: string | undefined;
            let visible = true;
            while (object) {
                visible &&= object.visible;
                if (object.userData.objectId) id = object.userData.objectId;
                object = object.parent;
            }
            if (id && visible) {
                this.runtime.tap(id, hit.uv);
                break;
            }
        }
    };
    setRuntime(runtime: PageRuntime | null, page?: ManifestPage) {
        this.anchor.clear();
        this.runtime = runtime;
        this.contentVisibility = null;
        this.nextVisibilityCheck = 0;
        if (runtime) {
            this.anchor.add(runtime.group);
            setPageBackgroundVisibility(runtime.group, !this.arProjection);
        }
        if (page) {
            this.aspect = page.aspect;
            this.lighting.setPreset(page.settings.lighting);
        }
        if (!this.arProjection) this.resetView();
    }
    private readingFrame(): ReadingFrame {
        const width = Math.max(1, this.container.clientWidth),
            height = Math.max(1, this.container.clientHeight);
        const safe = getComputedStyle(document.documentElement);
        // Fixed chrome has the same footprint on welcome/read and never resizes the canvas.
        const inset = (edge: string) =>
            Number.parseFloat(safe.getPropertyValue(`--reader-safe-${edge}`)) || 0;
        return {
            width,
            height,
            side: Math.max(Math.min(32, width * 0.06), inset('left') + 12, inset('right') + 12),
            top: Math.min(92 + Math.max(0, inset('top') - 16), height * 0.3),
            bottom: Math.min(108 + inset('bottom'), height * 0.3),
        };
    }
    resetView() {
        if (this.arProjection) return;
        stopSceneOrbit(this.controls);
        this.navigated = false;
        // The first pass orients billboards; the second fits their actual displayed bounds.
        for (let pass = 0; pass < 2; pass++) {
            this.runtime?.update(0, this.camera);
            const fitted = fitReadingCamera(
                this.camera,
                readingBounds(this.runtime?.group, this.aspect),
                this.readingFrame(),
            );
            this.controls.target.copy(fitted.target);
            this.controls.minDistance = Math.max(0.01, fitted.radius * 0.03);
            this.controls.maxDistance = Math.max(15, fitted.distance * 6);
            this.controls.update();
        }
        this.runtime?.update(0, this.camera);
    }
    setAR(projection: number[] | null, width = 1, height = 1) {
        this.arProjection = projection;
        this.videoSize = { width, height };
        this.navigation.setOrbit(!projection);
        setPageBackgroundVisibility(this.runtime?.group, !projection);
        this.contentVisibility = null;
        this.nextVisibilityCheck = 0;
        this.anchor.matrixAutoUpdate = !projection;
        this.anchor.matrix.identity();
        this.anchor.position.set(0, 0, 0);
        this.anchor.quaternion.identity();
        this.anchor.scale.set(1, 1, 1);
        this.anchor.visible = !projection;
        if (projection) {
            this.camera.clearViewOffset();
            this.camera.position.set(0, 0, 0);
            this.camera.quaternion.identity();
            this.camera.updateMatrixWorld();
        }
        this.resize();
        if (!projection) this.resetView();
    }
    track(matrix: THREE.Matrix4 | null) {
        this.anchor.visible = Boolean(matrix);
        if (matrix) {
            this.anchor.matrix.copy(matrix);
            this.anchor.matrixWorldNeedsUpdate = true;
        } else this.contentVisibility = null;
    }
    private resize() {
        const width = this.container.clientWidth,
            height = this.container.clientHeight;
        if (!width || !height) return;
        this.renderer.setSize(width, height);
        this.camera.aspect = width / height;
        if (this.arProjection) {
            const inputAspect = this.videoSize.width / this.videoSize.height;
            this.camera.projectionMatrix.fromArray(this.arProjection);
            const cropped = this.camera.projectionMatrix.elements;
            if (inputAspect > this.camera.aspect) cropped[0] *= inputAspect / this.camera.aspect;
            else cropped[5] *= this.camera.aspect / inputAspect;
            this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
        } else if (this.navigated) readingProjection(this.camera, this.readingFrame());
        else this.resetView();
    }
    dispose() {
        this.renderer.setAnimationLoop(null);
        this.resizeObserver.disconnect();
        this.navigation.dispose();
        this.controls.dispose();

        this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
        this.renderer.dispose();
        this.renderer.forceContextLoss();
        this.renderer.domElement.remove();
        this.scene.clear();
    }
}
