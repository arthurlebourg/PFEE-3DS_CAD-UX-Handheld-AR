import type { PinchState } from '../modes/interactionMode.js';
import { clamp } from '../modes/interactionMode.js';
import type { HistoryAction } from '../history/historyManager.js';
import type { SceneTransform } from './sceneRotator.js';

export interface ViewControllerDeps {
    /** Applies a new rig scale (the inverse of the perceived model scale). */
    onRigScale(rigScale: number): void;
    /** Freezes the scene orientation and tilt axis a two-finger gesture is measured against. */
    beginSceneRotation(): void;
    /** Rotates the scene by a yaw and a tilt (radians), relative to the gesture start. */
    rotateScene(yaw: number, tilt: number): void;
    getSceneTransform(): SceneTransform;
    setSceneTransform(transform: SceneTransform): void;
    /** Pushes an undoable action to the history. */
    onAction(action: HistoryAction): void;
}

/** Perceived-scale bounds, matching the old slider's 10%–1000% range. */
const MIN_PERCEIVED_SCALE = 0.1;
const MAX_PERCEIVED_SCALE = 10;
/** Tilt per unit of normalized vertical drag: ~60% of the short screen edge tips the scene 90°. */
const TILT_RAD_PER_DRAG = Math.PI / 2;

/**
 * ViewController: the two-finger view gestures, identical in every state.
 *
 * As in a maps app: pinch rescales the perceived scene scale (drives the rig),
 * twisting turns the scene around the vertical, and dragging both fingers
 * vertically tilts it. Each state forwards its pinch handlers here, so a pinch
 * means the same thing whether or not something is selected.
 */
export class ViewController {
    private readonly deps: ViewControllerDeps;

    private committedPerceivedScale = 1;
    private currentPerceivedScale = 1;
    private pinchStartPerceivedScale = 1;
    private pinchStartTransform: SceneTransform | null = null;

    constructor(deps: ViewControllerDeps) {
        this.deps = deps;
    }

    public getPerceivedScale(): number {
        return this.committedPerceivedScale;
    }

    public setPerceivedScale(scale: number): void {
        this.committedPerceivedScale = clamp(scale, MIN_PERCEIVED_SCALE, MAX_PERCEIVED_SCALE);
        this.currentPerceivedScale = this.committedPerceivedScale;
        this.deps.onRigScale(1 / this.committedPerceivedScale);
    }

    /**
     * Realigns the pinch state after an external rig-scale reset, so the next
     * pinch starts from 100% instead of jumping back to the old scale.
     */
    public resetScaleState(): void {
        this.committedPerceivedScale = 1;
        this.currentPerceivedScale = 1;
    }

    public onPinchStart(): void {
        this.pinchStartPerceivedScale = this.committedPerceivedScale;
        this.pinchStartTransform = this.deps.getSceneTransform();
        this.deps.beginSceneRotation();
    }

    public onPinchMove(pinch: PinchState): void {
        if (pinch.zoomRatio !== 1) {
            this.currentPerceivedScale = clamp(
                this.committedPerceivedScale * pinch.zoomRatio,
                MIN_PERCEIVED_SCALE,
                MAX_PERCEIVED_SCALE,
            );
            this.deps.onRigScale(1 / this.currentPerceivedScale);
        }

        if (pinch.twist !== 0 || pinch.tilt !== 0) {
            this.deps.rotateScene(pinch.twist, pinch.tilt * TILT_RAD_PER_DRAG);
        }
    }

    /** One undoable step per gesture, whichever of zoom / twist / tilt it used. */
    public onPinchEnd(): void {
        const startScale = this.pinchStartPerceivedScale;
        const endScale = this.currentPerceivedScale;
        this.committedPerceivedScale = this.currentPerceivedScale;

        const startTransform = this.pinchStartTransform;
        const endTransform = this.deps.getSceneTransform();
        this.pinchStartTransform = null;

        const scaled = Math.abs(endScale - startScale) > 0.01;
        const rotated = startTransform !== null &&
            startTransform.orientation.angleTo(endTransform.orientation) > 0.01;
        if (!scaled && !rotated) return;

        this.deps.onAction({
            description: 'Échelle / orientation scène',
            undo: () => {
                this.setPerceivedScale(startScale);
                if (startTransform) this.deps.setSceneTransform(startTransform);
            },
            redo: () => {
                this.setPerceivedScale(endScale);
                this.deps.setSceneTransform(endTransform);
            },
        });
    }
}
