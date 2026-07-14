import type { InteractionMode, PinchState } from './interactionMode.js';
import { clamp } from './interactionMode.js';
import type { JoystickWidget } from './joystickWidget.js';

interface EditModeDeps {
    joystick: JoystickWidget;
    /** Places the armed model at the preview cursor. Returns true if placed. */
    placeModel(): boolean;
    /** Applies a new rig scale (the inverse of the perceived model scale). */
    onRigScale(rigScale: number): void;
}

/** Perceived-scale bounds, matching the old slider's 10%–1000% range. */
const MIN_PERCEIVED_SCALE = 0.1;
const MAX_PERCEIVED_SCALE = 10;

/**
 * EditMode: compose the scene.
 *
 * - Tap places the armed model (arming happens through the model carousel;
 *   placing disarms so a stray tap can't drop a second copy).
 * - Two-finger pinch rescales the perceived scene scale (drives the rig,
 *   replacing the old "Échelle perçue" slider).
 * - Holding a finger summons the joystick that rotates the scene around the
 *   placed models' center.
 */
export class EditMode implements InteractionMode {
    public readonly name = 'edit';

    private readonly deps: EditModeDeps;

    private armed = false;
    private committedPerceivedScale = 1;
    private currentPerceivedScale = 1;

    constructor(deps: EditModeDeps) {
        this.deps = deps;
    }

    /** True while a carousel-selected model is waiting to be placed. */
    public get isArmed(): boolean {
        return this.armed;
    }

    /** Arms placement: the next tap will place the loaded model. */
    public arm(): void {
        this.armed = true;
    }

    public disarm(): void {
        this.armed = false;
    }

    public enter(): void {}

    public exit(): void {
        this.deps.joystick.hide();
    }

    public onTap(): void {
        if (this.armed) {
            if (this.deps.placeModel()) {
                this.armed = false;
            }
            return;
        }

        // TODO(edit-selection): tap should select a placed model to expose the
        // contextual Reset/Delete buttons; requires model-level picking.
    }

    public onHoldStart(x: number, y: number): void {
        this.deps.joystick.show(x, y);
    }

    public onHoldMove(dx: number, dy: number): void {
        this.deps.joystick.move(dx, dy);
    }

    public onHoldEnd(): void {
        this.deps.joystick.hide();
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
        this.committedPerceivedScale = this.currentPerceivedScale;
    }
}
