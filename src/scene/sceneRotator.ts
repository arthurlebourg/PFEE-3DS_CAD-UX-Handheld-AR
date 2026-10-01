import * as THREE from 'three';

export class SceneRotator {
    private angle = 0;

    public rotateAroundCenter(
        xrRig: THREE.Group,
        objects: THREE.Object3D[],
        deltaAngle: number,
    ): void {
        if (objects.length === 0) return;

        this.angle += deltaAngle;
        this.applyRotation(xrRig, objects);
    }

    public refresh(
        xrRig: THREE.Group,
        objects: THREE.Object3D[],
    ): void {
        if (objects.length === 0) {
            xrRig.position.set(0, 0, 0);
            return;
        }

        this.applyRotation(xrRig, objects);
    }

    public reset(xrRig: THREE.Group): void {
        this.angle = 0;
        xrRig.position.set(0, 0, 0);
        xrRig.quaternion.identity();
    }

    private applyRotation(
        xrRig: THREE.Group,
        objects: THREE.Object3D[],
    ): void {
        const center = this.computeCenter(objects);

        // We rotate the camera rig in the opposite direction
        // to preserve the current apparent model rotation.
        const rigRotation = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            -this.angle,
        );

        // Move the rig so that it rotates around the models' center,
        // rather than around the scene origin.
        const rotatedCenter = center.clone().applyQuaternion(rigRotation);
        const translation = center.clone().sub(rotatedCenter);

        xrRig.quaternion.copy(rigRotation);
        xrRig.position.copy(translation);
    }

    private computeCenter(objects: THREE.Object3D[]): THREE.Vector3 {
        const center = new THREE.Vector3();

        for (const object of objects) {
            center.add(object.position);
        }

        return center.divideScalar(objects.length);
    }
}