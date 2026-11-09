import * as THREE from 'three';
import { clamp } from '../modes/interactionMode.js';
import type { HistoryAction } from '../history/historyManager.js';

export interface ExplodeControllerDeps {
    /** Re-applies a model's root position: its placement pose plus {@link liftOffset}. */
    onLiftChange(model: THREE.Object3D): void;
    /** Observation hook: a model's factor changed (drives the tutorial). */
    onFactorChange?(model: THREE.Object3D, factor: number): void;
    /** Pushes an undoable action to the history. */
    onAction(action: HistoryAction): void;
}

/** Parts never fly further than this explosion factor. */
export const MAX_EXPLODE_FACTOR = 1.5;

/** Per-mesh data cached by {@link prepare}, in the model root's frame. */
interface ExplodeMeshData {
    rest: THREE.Vector3;
    /** Radial offset at factor 1, in the mesh's parent frame (adds onto position). */
    dir: THREE.Vector3;
    /** Bottom of the mesh's box at rest, and how far factor 1 moves it up. */
    restMinY: number;
    dirY: number;
}

/**
 * ExplodeController: the exploded view, per model.
 *
 * Each part moves along the vector from the model's center to its own center,
 * times the model's factor (0 = assembled). Factors are per model, so
 * exploding the selection's model leaves the others assembled.
 *
 * Parts below the center move down and would sink into the table, so the
 * model is lifted by exactly what its lowest part dropped below the assembled
 * bottom: the exploded view always rests on the surface. The lift is applied
 * by main on the model root (see {@link liftOffset}), next to its placement
 * pose; the parts themselves only ever move radially.
 */
export class ExplodeController {
    private readonly deps: ExplodeControllerDeps;

    private gestureModels: THREE.Object3D[] = [];
    private gestureStart = new Map<THREE.Object3D, number>();

    constructor(deps: ExplodeControllerDeps) {
        this.deps = deps;
    }

    public getFactor(model: THREE.Object3D): number {
        return (model.userData.explodeFactor as number | undefined) ?? 0;
    }

    /** Scene-space offset of the model root for its current lift. */
    public liftOffset(model: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
        const lift = (model.userData.explodeLift as number | undefined) ?? 0;
        return out.set(0, lift * model.scale.y, 0).applyQuaternion(model.quaternion);
    }

    public setFactor(model: THREE.Object3D, factor: number): void {
        const clamped = clamp(factor, 0, MAX_EXPLODE_FACTOR);
        const meshes = this.prepare(model);

        let minY = Infinity;
        let restMin = Infinity;
        for (const [mesh, data] of meshes) {
            mesh.position.copy(data.rest).addScaledVector(data.dir, clamped);
            minY = Math.min(minY, data.restMinY + data.dirY * clamped);
            restMin = Math.min(restMin, data.restMinY);
        }

        model.userData.explodeFactor = clamped;
        model.userData.explodeLift = meshes.size > 0 ? Math.max(0, restMin - minY) : 0;
        this.deps.onLiftChange(model);
        this.deps.onFactorChange?.(model, clamped);
    }

    /** Freezes the models a hold-and-drag explodes, and their starting factors. */
    public beginGesture(models: THREE.Object3D[]): void {
        this.gestureModels = models;
        this.gestureStart = new Map(models.map((model) => [model, this.getFactor(model)]));
    }

    /** Applies a factor change, relative to the gesture start, to every gesture model. */
    public updateGesture(delta: number): void {
        for (const model of this.gestureModels) {
            this.setFactor(model, (this.gestureStart.get(model) ?? 0) + delta);
        }
    }

    /** One undoable step per gesture. */
    public endGesture(): void {
        const start = this.gestureStart;
        const end = new Map(this.gestureModels.map((model) => [model, this.getFactor(model)]));
        this.gestureModels = [];
        this.gestureStart = new Map();

        const changed = [...end].some(([model, factor]) => Math.abs(factor - (start.get(model) ?? 0)) > 0.01);
        if (!changed) return;

        this.deps.onAction({
            description: 'Éclatement',
            undo: () => {
                for (const [model, factor] of start) this.setFactor(model, factor);
            },
            redo: () => {
                for (const [model, factor] of end) this.setFactor(model, factor);
            },
        });
    }

    /**
     * Caches, once per model, each part's assembled local position, its radial
     * direction (in that part's parent frame) away from the model center, and
     * how its box bottom moves (in the root frame, for the lift). Precomputing
     * keeps the per-gesture {@link setFactor} pass cheap.
     */
    private prepare(model: THREE.Object3D): Map<THREE.Mesh, ExplodeMeshData> {
        const cached = model.userData.explodeData as Map<THREE.Mesh, ExplodeMeshData> | undefined;
        if (cached) return cached;

        model.updateWorldMatrix(true, true);
        const modelCenter = new THREE.Box3()
            .setFromObject(model)
            .getCenter(new THREE.Vector3());

        const toRoot = model.matrixWorld.clone().invert();
        const toRootDir = new THREE.Matrix3().setFromMatrix4(toRoot);
        const meshToRoot = new THREE.Matrix4();
        const meshCenter = new THREE.Vector3();
        const offset = new THREE.Vector3();
        const parentInverse = new THREE.Matrix4();
        const toParentLocal = new THREE.Matrix3();
        const data = new Map<THREE.Mesh, ExplodeMeshData>();

        model.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            const mesh = child as THREE.Mesh;

            mesh.geometry.computeBoundingBox();
            const box = mesh.geometry.boundingBox;
            if (!box) return;

            // World-space center of this part, as a radial offset from the model center.
            box.getCenter(meshCenter).applyMatrix4(mesh.matrixWorld);
            offset.copy(meshCenter).sub(modelCenter);

            // How the part's bottom moves, in the root frame (the one the model is grounded in).
            meshToRoot.multiplyMatrices(toRoot, mesh.matrixWorld);
            const restMinY = box.clone().applyMatrix4(meshToRoot).min.y;
            const dirY = offset.clone().applyMatrix3(toRootDir).y;

            // Rotated/scaled into the part's parent frame, so it adds straight onto mesh.position.
            const dir = offset.clone();
            if (mesh.parent) {
                parentInverse.copy(mesh.parent.matrixWorld).invert();
                toParentLocal.setFromMatrix4(parentInverse);
                dir.applyMatrix3(toParentLocal);
            }

            data.set(mesh, { rest: mesh.position.clone(), dir, restMinY, dirY });
        });

        model.userData.explodeData = data;
        return data;
    }
}
