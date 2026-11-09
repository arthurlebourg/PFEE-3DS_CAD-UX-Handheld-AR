import type * as THREE from 'three';
import type { InteractionMode, PinchState } from './interactionMode.js';
import type { ViewController } from '../scene/viewController.js';

interface SceneModeDeps {
    view: ViewController;
    /** Places the armed model at the preview cursor. Returns true if placed. */
    placeModel(): boolean;
    /** GPU-picks the mesh under the tap. */
    pickMesh(inputSource?: XRInputSource): THREE.Mesh | null;
    /** Selects the tapped piece (main then switches to the Selection state). */
    selectPiece(mesh: THREE.Mesh): void;
    /**
     * Hides the piece if the first tap of this double tap just deselected it
     * (emptying the selection, hence this state); returns whether it did.
     */
    hideJustDeselected(mesh: THREE.Mesh): boolean;
    /** The placed model under a screen point (CSS pixels), if any. */
    modelAt(x: number, y: number): THREE.Object3D | null;
    beginMove(model: THREE.Object3D, x: number, y: number): void;
    updateMove(x: number, y: number): void;
    /** Ends the move; dropping on the trash deletes the model. */
    endMove(x: number, y: number): void;
}

/**
 * SceneMode: nothing is selected; the whole models are what the user handles.
 *
 * - Tap places the armed model (arming happens through the model picker;
 *   placing disarms so a stray tap can't drop a second copy). When placement
 *   is not armed, tapping a piece selects it, which enters the Selection state.
 * - Dragging one finger on a model moves it along the real surface; a trash
 *   appears while moving, and dropping the model on it deletes it.
 * - Two fingers drive the view (see ViewController).
 */
export class SceneMode implements InteractionMode {
    public readonly name = 'scene';

    private readonly deps: SceneModeDeps;
    private armed = false;

    constructor(deps: SceneModeDeps) {
        this.deps = deps;
    }

    /** True while a picker-selected model is waiting to be placed. */
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

    public exit(): void {}

    public onTap(inputSource?: XRInputSource): void {
        if (this.armed) {
            if (this.deps.placeModel()) {
                this.armed = false;
            }
            return;
        }

        const mesh = this.deps.pickMesh(inputSource);
        if (mesh) {
            this.deps.selectPiece(mesh);
        }
    }

    /**
     * A double tap normally starts in the Selection state, its first tap
     * having selected the piece. Double-tapping the only selected piece is the
     * exception: the first tap drops it and lands here, so the second must
     * still hide it. Anything else is just another tap.
     */
    public onDoubleTap(inputSource?: XRInputSource): void {
        const mesh = this.deps.pickMesh(inputSource);
        if (mesh && this.deps.hideJustDeselected(mesh)) return;
        this.onTap(inputSource);
    }

    public onDragStart(x: number, y: number): boolean {
        const model = this.deps.modelAt(x, y);
        if (!model) return false;

        this.deps.beginMove(model, x, y);
        return true;
    }

    public onDragMove(x: number, y: number): void {
        this.deps.updateMove(x, y);
    }

    public onDragEnd(x: number, y: number): void {
        this.deps.endMove(x, y);
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
