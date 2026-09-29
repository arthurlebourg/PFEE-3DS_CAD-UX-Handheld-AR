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
    /** Pushes an undoable action to the inspect history stack. */
    onAction?: (action: HistoryAction) => void;
}

/** Parts never fly further than this explosion factor. */
const MAX_EXPLODE_FACTOR = 1.5;

/**
 * InspectMode: analyze a model without touching the scene layout.
 *
 * - Tap picks a piece.
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

    public exit(): void {}

    public onTap(inputSource?: XRInputSource): void {
        const { pickHelper } = this.deps;
        const pickedMesh = this.deps.pickMesh(inputSource);

        if (pickedMesh) {
            pickHelper.handleMeshSelection(pickedMesh);
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
