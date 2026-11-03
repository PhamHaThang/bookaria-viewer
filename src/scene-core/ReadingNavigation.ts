import type { PerspectiveCamera } from 'three';
import { MOUSE, Vector2 } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { configureSceneOrbit, stopSceneOrbit } from './camera-navigation';
import { beginDolly, type DollyStart, dragDolly } from './dolly';

/** Editor-compatible navigation, with taps kept separate from camera gestures. */
export class ReadingNavigation {
    private down: {
        id: number;
        x: number;
        y: number;
        button: number;
        tap: boolean;
        moved: boolean;
    } | null = null;
    private pointers = new Set<number>();
    private space = false;
    private orbit = true;
    private zoom: { y: number; start: DollyStart } | null = null;
    constructor(
        private canvas: HTMLCanvasElement,
        private camera: PerspectiveCamera,
        private controls: OrbitControls,
        private tap: (event: PointerEvent) => void,
        private changed: () => void,
    ) {
        configureSceneOrbit(controls);
        canvas.tabIndex = 0;
        canvas.addEventListener('pointerdown', this.pointerDown, true);
        canvas.addEventListener('pointermove', this.pointerMove, true);
        canvas.addEventListener('pointerup', this.pointerUp, true);
        canvas.addEventListener('pointercancel', this.pointerCancel);
        canvas.addEventListener('lostpointercapture', this.lostCapture);
        canvas.addEventListener('wheel', this.wheel, { capture: true, passive: true });
        window.addEventListener('keydown', this.keyDown);
        window.addEventListener('keyup', this.keyUp);
        window.addEventListener('blur', this.blur);
    }
    setOrbit(enabled: boolean) {
        this.blur();
        this.orbit = enabled;
        this.restore();
    }
    private restore() {
        this.controls.enabled = this.orbit;
        this.controls.mouseButtons.LEFT = MOUSE.ROTATE;
        this.zoom = null;
        this.canvas.style.cursor = this.orbit && this.space ? 'all-scroll' : '';
    }
    private blocked() {
        return Boolean(
            document.querySelector('dialog[open], [role="dialog"], details#reader-menu[open]'),
        );
    }
    private keyDown = (event: KeyboardEvent) => {
        if (
            !this.orbit ||
            this.blocked() ||
            event.defaultPrevented ||
            (event.target !== this.canvas &&
                !(event.target === document.body && this.canvas.matches(':hover'))) ||
            event.code !== 'Space' ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey
        )
            return;
        event.preventDefault();
        this.space = true;
        if (!this.down) this.canvas.style.cursor = 'all-scroll';
    };
    private keyUp = (event: KeyboardEvent) => {
        if (event.code !== 'Space') return;
        this.space = false;
        if (!this.down) this.canvas.style.cursor = '';
    };
    private wheel = () => {
        if (this.orbit) this.changed();
    };
    private pointerDown = (event: PointerEvent) => {
        this.pointers.add(event.pointerId);
        if (this.down) {
            this.down.tap = false;
            return;
        }
        if (this.pointers.size > 1 || this.blocked()) return;
        this.canvas.focus({ preventScroll: true });
        if (this.orbit) stopSceneOrbit(this.controls);
        const modified = event.shiftKey || event.ctrlKey || event.metaKey;
        this.down = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            button: event.button,
            moved: false,
            tap: event.button === 0 && !this.space && !modified && !event.altKey,
        };
        if (!this.orbit) {
            this.canvas.setPointerCapture(event.pointerId);
            return;
        }
        if (event.button === 1) {
            const box = this.canvas.getBoundingClientRect();
            this.zoom = {
                y: event.clientY,
                start: beginDolly(
                    this.camera,
                    this.controls.target,
                    new Vector2(
                        ((event.clientX - box.left) / box.width) * 2 - 1,
                        1 - ((event.clientY - box.top) / box.height) * 2,
                    ),
                ),
            };
            this.controls.enabled = false;
            this.canvas.style.cursor = 'ns-resize';
            this.canvas.setPointerCapture(event.pointerId);
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        const pan = event.button === 2 ? !modified : this.space;
        // OrbitControls reverses left-button behavior for Ctrl/Shift/Meta.
        this.controls.mouseButtons.LEFT = pan !== modified ? MOUSE.PAN : MOUSE.ROTATE;
        this.canvas.style.cursor = pan ? 'all-scroll' : 'move';
    };
    private pointerMove = (event: PointerEvent) => {
        if (this.down?.id !== event.pointerId) return;
        if (Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > 4) {
            this.down.moved = true;
            if (this.orbit) this.changed();
        }
        if (!this.zoom) return;
        dragDolly(
            this.camera,
            this.controls.target,
            this.zoom.start,
            event.clientY - this.zoom.y,
            this.canvas.clientHeight,
            this.controls.minDistance,
            this.controls.maxDistance,
        );
        this.controls.update();
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    private pointerUp = (event: PointerEvent) => {
        this.pointers.delete(event.pointerId);
        const down = this.down;
        if (!down || down.id !== event.pointerId) return;
        const zooming = Boolean(this.zoom);
        this.down = null;
        this.restore();
        if (zooming || !this.orbit) {
            if (this.canvas.hasPointerCapture(event.pointerId))
                this.canvas.releasePointerCapture(event.pointerId);
        }
        if (zooming) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        if (
            !down.tap ||
            down.moved ||
            this.pointers.size ||
            this.space ||
            event.button !== 0 ||
            event.shiftKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            this.blocked()
        )
            return;
        const box = this.canvas.getBoundingClientRect();
        if (
            Math.hypot(event.clientX - down.x, event.clientY - down.y) <= 4 &&
            event.clientX >= box.left &&
            event.clientX <= box.right &&
            event.clientY >= box.top &&
            event.clientY <= box.bottom
        )
            this.tap(event);
    };
    private pointerCancel = (event: PointerEvent) => {
        this.pointers.delete(event.pointerId);
        if (this.down?.id !== event.pointerId) return;
        this.down = null;
        this.restore();
        if (this.canvas.hasPointerCapture(event.pointerId))
            this.canvas.releasePointerCapture(event.pointerId);
    };
    private lostCapture = (event: PointerEvent) => {
        queueMicrotask(() => {
            if (
                this.down?.id === event.pointerId &&
                !this.canvas.hasPointerCapture(event.pointerId)
            )
                this.blur();
        });
    };
    private blur = () => {
        this.space = false;
        for (const pointerId of this.pointers)
            this.canvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId }));
        this.pointers.clear();
        this.down = null;
        this.restore();
    };
    dispose() {
        this.blur();
        this.canvas.removeEventListener('pointerdown', this.pointerDown, true);
        this.canvas.removeEventListener('pointermove', this.pointerMove, true);
        this.canvas.removeEventListener('pointerup', this.pointerUp, true);
        this.canvas.removeEventListener('pointercancel', this.pointerCancel);
        this.canvas.removeEventListener('lostpointercapture', this.lostCapture);
        this.canvas.removeEventListener('wheel', this.wheel, true);
        window.removeEventListener('keydown', this.keyDown);
        window.removeEventListener('keyup', this.keyUp);
        window.removeEventListener('blur', this.blur);
    }
}
