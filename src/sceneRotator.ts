import * as THREE from 'three';

export class SceneRotator {
  private center = new THREE.Vector3();
  private axis = new THREE.Vector3(0, 1, 0);

  public rotateAroundCenter(objects: THREE.Object3D[], angle: number) {
    if (objects.length === 0) return;

    this.computeCenter(objects);

    const rotation = new THREE.Quaternion().setFromAxisAngle(this.axis, angle);

    for (const object of objects) {
      const offset = object.position.clone().sub(this.center);
      offset.applyQuaternion(rotation);

      object.position.copy(this.center).add(offset);
      object.quaternion.premultiply(rotation);

      object.updateMatrixWorld(true);
    }
  }

  private computeCenter(objects: THREE.Object3D[]) {
    this.center.set(0, 0, 0);

    for (const object of objects) {
      this.center.add(object.position);
    }

    this.center.divideScalar(objects.length);
  }
}