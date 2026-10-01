import * as THREE from 'three';
import type { InteractionMode, PinchState } from './interactionMode.js';
import { clamp } from './interactionMode.js';
import type { PickHelper } from '../scene/picking.js';
import type { HistoryAction } from '../history/historyManager.js';

interface InspectModeDeps {
    pickHelper: PickHelper;
    /** GPU-picks the mesh under the tap (needs the XRInputSource's screen coords). */
    pickMesh(inputSource?: XRInputSource): THREE.Mesh | null;
    /** Drives the exploded view; 0 = assembled. */
    onExplode(factor: number): void;
    /** Opens the granularity slider on a freshly picked piece's ancestor chain. */
    showGranularity(chain: THREE.Object3D[]): void;
    /** Closes the granularity slider: nothing is selected any more. */
    hideGranularity(): void;
    /** Pushes an undoable action to the inspect history stack. */
    onAction?: (action: HistoryAction) => void;
    /** Observation hook: a piece was picked (drives the tutorial). */
    onPartPicked?(): void;
    /** Observation hook: a piece was hidden (drives the tutorial). */
    onPartHidden?(): void;
}

/** Parts never fly further than this explosion factor. */
const MAX_EXPLODE_FACTOR = 1.5;

/**
 * InspectMode: analyze a model without touching the scene layout.
 *
 * - Tap picks a piece, and opens the granularity slider on its ancestor
 *   chain so the selection can be widened to a whole sub-assembly.
 * - Double tap hides the piece under the finger.
 * - Two-finger pinch drives the exploded view.
 */
export class InspectMode implements InteractionMode {
    public readonly name = 'inspect';

    private readonly deps: InspectModeDeps;

    private committedExplode = 0;
    private currentExplode = 0;
    private pinchStartExplode = 0;

    private hiddenMeshes: THREE.Mesh[] = [];

    constructor(deps: InspectModeDeps) {
        this.deps = deps;
    }

    public getExplodeFactor(): number {
        return this.committedExplode;
    }

    public getHiddenMeshes(): readonly THREE.Mesh[] {
        return this.hiddenMeshes;
    }

    public setExplodeFactor(factor: number): void {
        this.committedExplode = clamp(factor, 0, MAX_EXPLODE_FACTOR);
        this.currentExplode = this.committedExplode;
        this.deps.onExplode(this.committedExplode);
    }

    public enter(): void {}

    public exit(): void {
        this.deps.hideGranularity();
    }

    public onTap(inputSource?: XRInputSource): void {
        const { pickHelper } = this.deps;
        const pickedMesh = this.deps.pickMesh(inputSource);

        if (pickedMesh) {
            const isNewSelection = !pickHelper.selectedMeshes.includes(pickedMesh);
            pickHelper.handleMeshSelection(pickedMesh);
            if (isNewSelection) {
                this.deps.showGranularity(pickHelper.getSelectableAncestorChain(pickedMesh));
            }
            this.deps.onPartPicked?.();
        } else if (pickHelper.selectedMeshes.length > 0) {
            pickHelper.clearSelection();
        }

        // Re-tapping a selected piece deselects it, so the slider follows the
        // selection rather than the tap.
        if (pickHelper.selectedMeshes.length === 0) {
            this.deps.hideGranularity();
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
        this.deps.onPartHidden?.();

        this.deps.onAction?.({
            description: 'Masquer pièce',
            undo: () => {
                mesh.visible = true;
                const index = this.hiddenMeshes.indexOf(mesh);
                if (index !== -1) {
                    this.hiddenMeshes.splice(index, 1);
                }
            },
            redo: () => {
                this.deps.pickHelper.deselectMesh(mesh);
                mesh.visible = false;
                if (!this.hiddenMeshes.includes(mesh)) {
                    this.hiddenMeshes.push(mesh);
                }
            },
        });
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

    /** Reveals every piece hidden by double tap. */
    public showAllHidden(recordAction = false): void {
        if (this.hiddenMeshes.length === 0) return;

        const previouslyHidden = [...this.hiddenMeshes];
        for (const mesh of previouslyHidden) {
            mesh.visible = true;
        }
        this.hiddenMeshes = [];

        if (recordAction) {
            this.deps.onAction?.({
                description: 'Afficher toutes les pièces',
                undo: () => {
                    for (const mesh of previouslyHidden) {
                        mesh.visible = false;
                        if (!this.hiddenMeshes.includes(mesh)) {
                            this.hiddenMeshes.push(mesh);
                        }
                    }
                },
                redo: () => {
                    for (const mesh of previouslyHidden) {
                        mesh.visible = true;
                    }
                    this.hiddenMeshes = [];
                },
            });
        }
    }

    public onPinchStart(): void {
        this.pinchStartExplode = this.committedExplode;
    }

    /** Inverts piece selection: selects unselected visible meshes, deselects selected ones. */
    public invertSelection(): void {
        this.deps.pickHelper.invertSelection();
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
        const start = this.pinchStartExplode;
        const end = this.currentExplode;
        this.committedExplode = this.currentExplode;

        if (Math.abs(end - start) > 0.01) {
            this.deps.onAction?.({
                description: 'Éclatement de la vue',
                undo: () => {
                    this.setExplodeFactor(start);
                },
                redo: () => {
                    this.setExplodeFactor(end);
                },
            });
        }
    }
}
