import type { Object3D } from 'three';
import type { InteractionMode, PinchState } from './interactionMode.js';
import { clamp } from './interactionMode.js';
import type { HistoryAction } from '../history/historyManager.js';
import type { SceneTransform } from '../scene/sceneRotator.js';

interface EditModeDeps {
    /** Places the armed model at the preview cursor. Returns true if placed. */
    placeModel(): boolean;
    /** Applies a new rig scale (the inverse of the perceived model scale). */
    onRigScale(rigScale: number): void;
    /** GPU-picks the placed model root under the tap. */
    pickModel(inputSource?: XRInputSource): Object3D | null;
    highlightModel(model: Object3D): void;
    unhighlightModel(model: Object3D): void;
    /** Fired when the selected model changes (drives the Delete/Reset buttons). */
    onSelectionChange(model: Object3D | null): void;
    /** Pushes an undoable action to the edit history stack. */
    onAction?: (action: HistoryAction) => void;
    /** Freezes the scene orientation and tilt axis a two-finger gesture is measured against. */
    beginSceneRotation(): void;
    /** Rotates the scene by a yaw and a tilt (radians), relative to the gesture start. */
    rotateScene(yaw: number, tilt: number): void;
    getSceneTransform(): SceneTransform;
    setSceneTransform(transform: SceneTransform): void;
}

/** Perceived-scale bounds, matching the old slider's 10%–1000% range. */
const MIN_PERCEIVED_SCALE = 0.1;
const MAX_PERCEIVED_SCALE = 10;
/** Tilt per unit of normalized vertical drag: ~60% of the short screen edge tips the scene 90°. */
const TILT_RAD_PER_DRAG = Math.PI / 2;

/**
 * EditMode: compose the scene.
 *
 * - Tap places the armed model (arming happens through the model carousel;
 *   placing disarms so a stray tap can't drop a second copy). When placement
 *   is not armed, tap selects the placed model under the finger, exposing the
 *   contextual Delete/Reset buttons; tapping empty space deselects.
 * - Two fingers manipulate the scene, as in a maps app: pinch rescales the
 *   perceived scene scale (drives the rig), twisting turns the scene around
 *   the vertical, and dragging both fingers vertically tilts it.
 */
export class EditMode implements InteractionMode {
    public readonly name = 'edit';

    private readonly deps: EditModeDeps;

    private armed = false;
    private selected: Object3D | null = null;
    private committedPerceivedScale = 1;
    private currentPerceivedScale = 1;
    private pinchStartPerceivedScale = 1;
    private pinchStartTransform: SceneTransform | null = null;

    constructor(deps: EditModeDeps) {
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

    public selectModel(model: Object3D | null): void {
        this.select(model);
    }

    /** True while a carousel-selected model is waiting to be placed. */
    public get isArmed(): boolean {
        return this.armed;
    }

    /** The placed model the Delete/Reset buttons act on. */
    public get selectedModel(): Object3D | null {
        return this.selected;
    }

    /** Arms placement: the next tap will place the loaded model. */
    public arm(): void {
        this.armed = true;
        this.select(null);
    }

    public disarm(): void {
        this.armed = false;
    }

    public clearSelection(): void {
        this.select(null);
    }

    /**
     * Realigns the pinch state after an external rig-scale reset, so the next
     * pinch starts from 100% instead of jumping back to the old scale.
     */
    public resetScaleState(): void {
        this.committedPerceivedScale = 1;
        this.currentPerceivedScale = 1;
    }

    public enter(): void {}

    public exit(): void {
        this.clearSelection();
    }

    public onTap(inputSource?: XRInputSource): void {
        if (this.armed) {
            if (this.deps.placeModel()) {
                this.armed = false;
            }
            return;
        }

        this.select(this.deps.pickModel(inputSource));
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

        this.deps.onAction?.({
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

    private select(model: Object3D | null): void {
        if (model === this.selected) return;

        if (this.selected) {
            this.deps.unhighlightModel(this.selected);
        }
        this.selected = model;
        if (model) {
            this.deps.highlightModel(model);
        }
        this.deps.onSelectionChange(model);
    }
}
