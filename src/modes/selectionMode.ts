import type * as THREE from 'three';
import type { InteractionMode, PinchState } from './interactionMode.js';
import type { ViewController } from '../scene/viewController.js';

interface SelectionModeDeps {
    view: ViewController;
    /** GPU-picks the mesh under the tap. */
    pickMesh(inputSource?: XRInputSource): THREE.Mesh | null;
    /** Toggles the tapped piece; null (empty space) clears the selection. */
    togglePiece(mesh: THREE.Mesh | null): void;
    /** Hides the piece under the double tap. */
    hidePiece(mesh: THREE.Mesh): void;
    /** Feedback under the finger while the hold counts down. */
    showHoldPending(x: number, y: number): void;
    hideHoldFeedback(): void;
    /** Starts exploding the selection's models. */
    beginExplode(x: number, y: number): void;
    /** Vertical drag since the hold, in CSS pixels (negative = up). */
    updateExplode(dy: number): void;
    endExplode(): void;
}

/**
 * SelectionMode: one or more pieces are selected; the pieces are what the
 * user handles.
 *
 * - Tap toggles a piece in the selection (adds it, or drops it if already
 *   selected); tapping empty space clears it, which returns to the Scene state.
 * - Double tap hides the piece under the finger.
 * - Hold half a second anywhere, then slide up to explode the selection's
 *   models, down to reassemble them. The level stays on release.
 * - Two fingers drive the view (see ViewController).
 */
export class SelectionMode implements InteractionMode {
    public readonly name = 'selection';

    private readonly deps: SelectionModeDeps;

    constructor(deps: SelectionModeDeps) {
        this.deps = deps;
    }

    public enter(): void {}

    public exit(): void {
        this.deps.hideHoldFeedback();
    }

    public onTap(inputSource?: XRInputSource): void {
        this.deps.togglePiece(this.deps.pickMesh(inputSource));
    }

    public onDoubleTap(inputSource?: XRInputSource): void {
        const mesh = this.deps.pickMesh(inputSource);
        if (mesh) {
            this.deps.hidePiece(mesh);
        }
    }

    public onHoldPending(x: number, y: number): void {
        this.deps.showHoldPending(x, y);
    }

    public onHoldCancel(): void {
        this.deps.hideHoldFeedback();
    }

    public onHoldStart(x: number, y: number): void {
        this.deps.beginExplode(x, y);
    }

    public onHoldMove(_dx: number, dy: number): void {
        this.deps.updateExplode(dy);
    }

    public onHoldEnd(): void {
        this.deps.endExplode();
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
