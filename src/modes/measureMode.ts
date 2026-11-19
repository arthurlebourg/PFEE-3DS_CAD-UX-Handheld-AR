import type { InteractionMode, PinchState } from './interactionMode.js';
import type { ViewController } from '../scene/viewController.js';

interface MeasureModeDeps {
    view: ViewController;
    /** Shows the crosshair and starts aiming. */
    onEnter(): void;
    /** Hides the crosshair; the ruler stays in the room. */
    onExit(): void;
}

/**
 * MeasureMode: placing a ruler, entered with the Measure button.
 *
 * Ends are aimed with the crosshair at the screen centre and placed with the
 * toolbar's + button, so screen taps do nothing here: the finger would hide
 * the spot being measured. Two fingers still drive the view (see
 * ViewController); the ruler stays put in the room meanwhile.
 */
export class MeasureMode implements InteractionMode {
    public readonly name = 'measure';

    private readonly deps: MeasureModeDeps;

    constructor(deps: MeasureModeDeps) {
        this.deps = deps;
    }

    public enter(): void {
        this.deps.onEnter();
    }

    public exit(): void {
        this.deps.onExit();
    }

    public onPinchStart(): void {
        this.deps.view.onPinchStart();
    }

    public onPinchMove(pinch: PinchState): void {
        this.deps.view.onPinchMove(pinch);
    }

    public onPinchEnd(): void {
        this.deps.view.onPinchEnd();
    }
}
