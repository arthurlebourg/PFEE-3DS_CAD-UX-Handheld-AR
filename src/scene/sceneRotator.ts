import * as THREE from 'three';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
/** The models' up axis may lean at most this far from the vertical. */
const MAX_TILT_RAD = Math.PI / 2;
const TILT_CLAMP_ITERATIONS = 24;

/**
 * Perceived placement of the scene in the real world: a scene point p (at
 * unit rig scale) appears at `orientation * p + offset`, in real units.
 */
export interface SceneTransform {
    orientation: THREE.Quaternion;
    offset: THREE.Vector3;
}

/**
 * SceneRotator: the perceived orientation of the placed models.
 *
 * The models never move: the camera rig carries the inverse transform, so the
 * scene appears to turn in place. Each gesture turns it around a pivot that
 * sits on the models' center horizontally (yaw behaves as before) and at the
 * mid-height of their bounding boxes, so a tilt rocks the models on
 * themselves instead of sinking them into the table.
 *
 * The full transform is stored rather than an angle around the current pivot:
 * the pivot moves whenever a model is placed or removed, and recomputing the
 * rig from it would make the whole rotated scene jump.
 */
export class SceneRotator {
    private orientation = new THREE.Quaternion();
    private offset = new THREE.Vector3();

    private gestureStartOrientation = new THREE.Quaternion();
    private gestureStartOffset = new THREE.Vector3();
    private gesturePivot = new THREE.Vector3();
    private tiltAxis = new THREE.Vector3(1, 0, 0);

    /**
     * Freezes the state a two-finger gesture is measured against: the starting
     * transform, the pivot (where the models currently appear) and the tilt
     * axis, the camera's horizontal right vector.
     */
    public beginGesture(
        xrRig: THREE.Group,
        objects: THREE.Object3D[],
        camera: THREE.Object3D,
    ): void {
        this.gestureStartOrientation.copy(this.orientation);
        this.gestureStartOffset.copy(this.offset);

        if (objects.length > 0) {
            this.gesturePivot
                .copy(this.computePivot(objects))
                .divideScalar(xrRig.scale.x)
                .applyQuaternion(this.orientation)
                .add(this.offset);
        }

        // The camera is a child of the rig, so its local pose is in the
        // real-world frame, where the transform is expressed.
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        right.y = 0;
        if (right.lengthSq() < 1e-6) {
            right.set(1, 0, 0);
        }
        this.tiltAxis.copy(right.normalize());
    }

    /**
     * Applies a yaw (around the vertical) and a tilt (around the frozen
     * horizontal axis), both in radians and relative to the gesture start.
     * Positive tilt tips the top of the models towards the viewer.
     */
    public applyGesture(
        xrRig: THREE.Group,
        objects: THREE.Object3D[],
        yaw: number,
        tilt: number,
    ): void {
        if (objects.length === 0) return;

        const delta = new THREE.Quaternion()
            .setFromAxisAngle(WORLD_UP, yaw)
            .multiply(new THREE.Quaternion().setFromAxisAngle(this.tiltAxis, this.clampTilt(tilt)));

        this.orientation.copy(this.gestureStartOrientation).premultiply(delta);
        this.offset
            .copy(this.gestureStartOffset)
            .sub(this.gesturePivot)
            .applyQuaternion(delta)
            .add(this.gesturePivot);
        this.applyRig(xrRig);
    }

    /** Re-derives the rig after its scale changed. */
    public refresh(xrRig: THREE.Group): void {
        this.applyRig(xrRig);
    }

    public reset(xrRig: THREE.Group): void {
        this.orientation.identity();
        this.offset.set(0, 0, 0);
        this.applyRig(xrRig);
    }

    public getTransform(): SceneTransform {
        return { orientation: this.orientation.clone(), offset: this.offset.clone() };
    }

    public setTransform(transform: SceneTransform, xrRig: THREE.Group): void {
        this.orientation.copy(transform.orientation);
        this.offset.copy(transform.offset);
        this.applyRig(xrRig);
    }

    /**
     * Shrinks the tilt so the models' up axis never leans past
     * {@link MAX_TILT_RAD}. Bisection, as the lean is not monotonic in the
     * tilt once the gesture starts from an already tilted orientation.
     */
    private clampTilt(tilt: number): number {
        const startLean = this.leanAfterTilt(0);
        const limit = Math.max(MAX_TILT_RAD, startLean);
        if (this.leanAfterTilt(tilt) <= limit) return tilt;

        let allowed = 0;
        let rejected = tilt;
        for (let i = 0; i < TILT_CLAMP_ITERATIONS; i++) {
            const middle = (allowed + rejected) / 2;
            if (this.leanAfterTilt(middle) <= limit) {
                allowed = middle;
            } else {
                rejected = middle;
            }
        }
        return allowed;
    }

    /** Angle between the vertical and the models' up axis after a tilt. */
    private leanAfterTilt(tilt: number): number {
        const up = WORLD_UP.clone()
            .applyQuaternion(this.gestureStartOrientation)
            .applyAxisAngle(this.tiltAxis, tilt);
        return up.angleTo(WORLD_UP);
    }

    /**
     * The rig holds the inverse transform, with the rig scale folded in: the
     * scene point x appears at `orientation * x / scale + offset`.
     */
    private applyRig(xrRig: THREE.Group): void {
        const rigRotation = this.orientation.clone().invert();

        xrRig.quaternion.copy(rigRotation);
        xrRig.position
            .copy(this.offset)
            .applyQuaternion(rigRotation)
            .multiplyScalar(-xrRig.scale.x);
    }

    /** Models' center horizontally, mid-height of their bounding boxes; scene units. */
    private computePivot(objects: THREE.Object3D[]): THREE.Vector3 {
        const center = new THREE.Vector3();

        for (const object of objects) {
            center.add(object.position).add(this.pivotOffset(object));
        }

        return center.divideScalar(objects.length);
    }

    /**
     * Vertical offset from the model's origin to its bounding-box center.
     * Cached on first use: the model root never rotates and its size does not
     * follow the rig scale, so the offset is constant, and an exploded view
     * must not shift the pivot mid-session.
     */
    private pivotOffset(object: THREE.Object3D): THREE.Vector3 {
        let cached = object.userData.pivotOffset as THREE.Vector3 | undefined;
        if (!cached) {
            const box = new THREE.Box3().setFromObject(object);
            cached = box.isEmpty()
                ? new THREE.Vector3()
                : new THREE.Vector3(0, box.getCenter(new THREE.Vector3()).y - object.position.y, 0);
            object.userData.pivotOffset = cached;
        }
        return cached;
    }
}

/**
 * Converts a real-world pose (reference space, e.g. a hit-test result) into
 * scene coordinates, through the rig's rotation, offset and scale. Anything
 * anchored to the real world (reticle, preview, shadow receivers) goes through
 * this, so it stays put while the scene is rotated or rescaled around it.
 */
export function realToScene(
    xrRig: THREE.Object3D,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    outPosition: THREE.Vector3,
    outQuaternion: THREE.Quaternion,
): void {
    xrRig.updateMatrix();
    outPosition.copy(position).applyMatrix4(xrRig.matrix);
    outQuaternion.copy(quaternion).premultiply(xrRig.quaternion);
}
