import * as THREE from 'three';
import type { InteractionMode, PinchState } from './interactionMode.js';
import { clamp } from './interactionMode.js';
import type { PickHelper } from '../scene/picking.js';

interface InspectModeDeps {
    pickHelper: PickHelper;
    /** GPU-picks the mesh under the tap (needs the XRInputSource's screen coords). */
    pickMesh(inputSource?: XRInputSource): THREE.Mesh | null;
    getCamera(): THREE.Camera;
    /** Drives the exploded view; 0 = assembled. */
    onExplode(factor: number): void;
}

/** Parts never fly further than this explosion factor. */
const MAX_EXPLODE_FACTOR = 1.5;

/**
 * InspectMode: analyze a model without touching the scene layout.
 *
 * - Tap picks a piece (select / attach-to-camera, as before).
 * - Double tap hides the piece under the finger.
 * - Two-finger pinch drives the exploded view.
 *
 * TODO(inspect): explode only the selected model once model-level selection
 * lands; granularity slider, undo/redo and hierarchy panel come later.
 */
export class InspectMode implements InteractionMode {
    public readonly name = 'inspect';

    private readonly deps: InspectModeDeps;

    private committedExplode = 0;
    private currentExplode = 0;

    private hiddenMeshes: THREE.Mesh[] = [];

    constructor(deps: InspectModeDeps) {
        this.deps = deps;
    }

    public enter(): void {}

    public exit(): void {}

    public onTap(inputSource?: XRInputSource): void {
        const { pickHelper } = this.deps;
        const pickedMesh = this.deps.pickMesh(inputSource);

        if (pickedMesh) {
            pickHelper.handleMeshSelection(pickedMesh, this.deps.getCamera());
        } else if (pickHelper.attachedParts.length > 0) {
            pickHelper.attachedParts = [];
        } else if (pickHelper.selectedMeshes.length > 0) {
            pickHelper.clearSelection();
        }
    }

    public onDoubleTap(inputSource?: XRInputSource): void {
        const mesh = this.deps.pickMesh(inputSource);
        if (!mesh) return;

        // The first tap of the double already selected the piece; undo that so
        // it doesn't come back highlighted when it is shown again.
        this.deps.pickHelper.deselectMesh(mesh);

        mesh.visible = false;
        this.hiddenMeshes.push(mesh);
    }

    /**
     * Realigns the pinch state after an external reassembly (Reset button),
     * so the next pinch starts from an assembled model instead of jumping
     * back to the old explosion factor.
     */
    public resetExplodeState(): void {
        this.committedExplode = 0;
        this.currentExplode = 0;
    }

    /** Reveals every piece hidden by double tap (future "show all" UI button). */
    public showAllHidden(): void {
        for (const mesh of this.hiddenMeshes) {
            mesh.visible = true;
        }
        this.hiddenMeshes = [];
    }

    public onPinchMove(pinch: PinchState): void {
        this.currentExplode = clamp(
            this.committedExplode + pinch.deltaNormalized,
            0,
            MAX_EXPLODE_FACTOR,
        );
        this.deps.onExplode(this.currentExplode);
    }

    public onPinchEnd(): void {
        this.committedExplode = this.currentExplode;
    }
}
