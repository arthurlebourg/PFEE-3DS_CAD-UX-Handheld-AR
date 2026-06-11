import * as THREE from 'three';

export class SceneRotator {
  private baseReferenceSpace: XRReferenceSpace | null = null;
  private angle = 0;

  public captureBaseReferenceSpace(renderer: THREE.WebGLRenderer) {
    this.baseReferenceSpace = renderer.xr.getReferenceSpace();
  }

  public rotateAroundCenter(
    renderer: THREE.WebGLRenderer,
    objects: THREE.Object3D[],
    deltaAngle: number,
  ) {
    if (!this.baseReferenceSpace) return;
    if (objects.length === 0) return;

    this.angle += deltaAngle;

    const center = this.computeCenter(objects);

    const rotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      this.angle,
    );

    const inverseRotation = rotation.clone().invert();

    const rotatedCenter = center.clone().applyQuaternion(inverseRotation);
    const translation = center.clone().sub(rotatedCenter);

    const transform = new XRRigidTransform(
      {
        x: translation.x,
        y: translation.y,
        z: translation.z,
      },
      {
        x: inverseRotation.x,
        y: inverseRotation.y,
        z: inverseRotation.z,
        w: inverseRotation.w,
      },
    );

    const offsetReferenceSpace =
      this.baseReferenceSpace.getOffsetReferenceSpace(transform);

    renderer.xr.setReferenceSpace(offsetReferenceSpace);
  }

  private computeCenter(objects: THREE.Object3D[]) {
    const center = new THREE.Vector3();

    for (const object of objects) {
      center.add(object.position);
    }

    center.divideScalar(objects.length);
    return center;
  }
}