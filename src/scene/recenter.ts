import * as THREE from 'three';
import type { HistoryAction } from '../history/historyManager.js';

/** A detected surface, in reference space (the XR rig's local frame). */
export interface SurfacePose {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
}

export interface ModelRecentererDeps {
    xrRig: THREE.Object3D;
    camera: THREE.Camera;
    /** The model the button acts on, or null when there is none. */
    getTarget: () => THREE.Object3D | null;
    /** Called after the model's root pose changed (move, undo or redo). */
    onPoseChanged: (model: THREE.Object3D) => void;
    onAction: (action: HistoryAction) => void;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * World pose on the surface whose front (+Z) faces the camera, keeping the
 * surface's own orientation and only turning about its normal.
 */
export function computeFacingPose(
    surface: SurfacePose,
    xrRig: THREE.Object3D,
    cameraWorldPos: THREE.Vector3,
): SurfacePose {
    xrRig.updateMatrixWorld();
    const position = surface.position.clone().applyMatrix4(xrRig.matrixWorld);
    const surfaceQuat = xrRig.quaternion.clone().multiply(surface.quaternion);

    const toCamera = cameraWorldPos.clone()
        .sub(position)
        .applyQuaternion(surfaceQuat.clone().invert());
    const yaw = Math.atan2(toCamera.x, toCamera.z);

    return {
        position,
        quaternion: surfaceQuat.multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw)),
    };
}

/**
 * Moves the active model onto the surface under the screen center, facing the
 * camera. Unlike Reset, the model keeps its current scale.
 */
export class ModelRecenterer {
    private readonly deps: ModelRecentererDeps;
    private surface: SurfacePose | null = null;

    constructor(deps: ModelRecentererDeps) {
        this.deps = deps;
    }

    /** Sets the surface under the screen center, or null when none is usable. */
    public setSurface(surface: SurfacePose | null): void {
        this.surface = surface;
    }

    public get canRecenter(): boolean {
        return this.surface !== null && this.deps.getTarget() !== null;
    }

    public recenter(): void {
        const model = this.deps.getTarget();
        if (!model || !this.surface) return;

        const before: SurfacePose = {
            position: model.position.clone(),
            quaternion: model.quaternion.clone(),
        };
        const after = computeFacingPose(
            this.surface,
            this.deps.xrRig,
            this.deps.camera.getWorldPosition(new THREE.Vector3()),
        );

        const apply = (pose: SurfacePose): void => {
            model.position.copy(pose.position);
            model.quaternion.copy(pose.quaternion);
            this.deps.onPoseChanged(model);
        };

        apply(after);
        this.deps.onAction({
            description: 'Recentrer modèle',
            undo: () => apply(before),
            redo: () => apply(after),
        });
    }
}
