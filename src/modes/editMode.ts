import type { Object3D } from 'three';
import type { InteractionMode, PinchState } from './interactionMode.js';
import { clamp } from './interactionMode.js';
import type { JoystickWidget } from '../ui/joystickWidget.js';
import type { HistoryAction } from '../history/historyManager.js';

interface EditModeDeps {
    joystick: JoystickWidget;
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
    /** Called when scene rotation via joystick begins. */
    onRotateStart?: () => void;
    /** Called when scene rotation via joystick ends. */
    onRotateEnd?: () => void;
}

/** Perceived-scale bounds, matching the old slider's 10%–1000% range. */
const MIN_PERCEIVED_SCALE = 0.1;
const MAX_PERCEIVED_SCALE = 10;

/**
 * EditMode: compose the scene.
 *
 * - Tap places the armed model (arming happens through the model carousel;
 *   placing disarms so a stray tap can't drop a second copy). When placement
 *   is not armed, tap selects the placed model under the finger, exposing the
 *   contextual Delete/Reset buttons; tapping empty space deselects.
 * - Two-finger pinch rescales the perceived scene scale (drives the rig,
 *   replacing the old "Échelle perçue" slider).
 * - Holding a finger summons the joystick that rotates the scene around the
 *   placed models' center.
 */
export class EditMode implements InteractionMode {
    public readonly name = 'edit';

    private readonly deps: EditModeDeps;

    private armed = false;
    private selected: Object3D | null = null;
    private committedPerceivedScale = 1;
    private currentPerceivedScale = 1;
    private pinchStartPerceivedScale = 1;

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
        this.deps.joystick.hide();
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

    public onHoldStart(x: number, y: number): void {
        this.deps.onRotateStart?.();
        this.deps.joystick.show(x, y);
    }

    public onHoldMove(dx: number, dy: number): void {
        this.deps.joystick.move(dx, dy);
    }

    public onHoldEnd(): void {
        this.deps.joystick.hide();
        this.deps.onRotateEnd?.();
    }

    public onPinchStart(): void {
        this.pinchStartPerceivedScale = this.committedPerceivedScale;
    }

    public onPinchMove(pinch: PinchState): void {
        this.currentPerceivedScale = clamp(
            this.committedPerceivedScale * pinch.ratio,
            MIN_PERCEIVED_SCALE,
            MAX_PERCEIVED_SCALE,
        );
        this.deps.onRigScale(1 / this.currentPerceivedScale);
    }

    public onPinchEnd(): void {
        const start = this.pinchStartPerceivedScale;
        const end = this.currentPerceivedScale;
        this.committedPerceivedScale = this.currentPerceivedScale;

        if (Math.abs(end - start) > 0.01) {
            this.deps.onAction?.({
                description: 'Échelle perçue',
                undo: () => {
                    this.setPerceivedScale(start);
                },
                redo: () => {
                    this.setPerceivedScale(end);
                },
            });
        }
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
