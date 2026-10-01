import * as THREE from 'three';

/** Pose of a real or virtual surface that should receive the projected shadow. */
export interface ShadowSurfacePose {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
}

/**
 * Handles directional shadows for CAD models.
 *
 * The system is deliberately independent from Inspect/Edit features:
 * - exploded view works because it moves the actual meshes;
 * - hidden pieces stop casting automatically because mesh.visible becomes false;
 * - any registered mesh can cast and receive shadows normally.
 *
 * For the real AR surface, a transparent ShadowMaterial plane is used as a
 * proxy so that only the darkened shadow is composited over the camera image.
 */
export class ShadowSystem {
    private readonly scene: THREE.Scene;
    private readonly light: THREE.DirectionalLight;
    private readonly lightTarget: THREE.Object3D;
    private readonly receivers = new Map<THREE.Object3D, THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>>();

    private readonly surfaceNormal = new THREE.Vector3();

    /** Large enough for the current 30 cm CAD model and exploded view. */
    private readonly receiverSize = 3.0;
    private readonly lightHeight = 4.0;
    private readonly shadowExtent = 1.25;

    constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
        this.scene = scene;

        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Directional light = parallel rays, matching a light source at infinity.
        this.light = new THREE.DirectionalLight(0xffffff, 1.0);
        this.light.castShadow = true;
        this.light.shadow.mapSize.set(1024, 1024);
        this.light.shadow.bias = -0.0002;
        this.light.shadow.normalBias = 0.01;
        this.light.shadow.intensity = 0.65;

        const shadowCamera = this.light.shadow.camera;
        shadowCamera.left = -this.shadowExtent;
        shadowCamera.right = this.shadowExtent;
        shadowCamera.top = this.shadowExtent;
        shadowCamera.bottom = -this.shadowExtent;
        shadowCamera.near = 0.01;
        shadowCamera.far = 10.0;
        shadowCamera.updateProjectionMatrix();

        this.lightTarget = new THREE.Object3D();
        this.scene.add(this.lightTarget);

        this.light.target = this.lightTarget;
        this.scene.add(this.light);
    }

    /**
     * Registers a CAD model as a shadow caster/receiver and creates an invisible
     * proxy for the real surface underneath it.
     */
    public registerModel(model: THREE.Object3D, surfacePose: ShadowSurfacePose): void {
        model.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;

            child.castShadow = true;
            child.receiveShadow = true;
        });

        const receiver = this.createReceiver();
        this.receivers.set(model, receiver);
        this.scene.add(receiver);

        this.updateSurface(model, surfacePose);
    }

    /** Removes the real-surface proxy associated with a model. */
    public unregisterModel(model: THREE.Object3D): void {
        const receiver = this.receivers.get(model);
        if (!receiver) return;

        this.scene.remove(receiver);
        receiver.geometry.dispose();
        receiver.material.dispose();
        this.receivers.delete(model);
    }

    /**
     * Updates the proxy surface after the root model pose changes.
     * Child-mesh changes (explode/hide) do not need to call this method.
     */
    public updateSurface(model: THREE.Object3D, surfacePose: ShadowSurfacePose): void {
        const receiver = this.receivers.get(model);
        if (!receiver) return;

        receiver.position.copy(surfacePose.position);
        receiver.quaternion.copy(surfacePose.quaternion);

        // Move the proxy 1 mm below the detected surface to avoid edge/depth
        // artefacts where the CAD touches the support surface.
        this.surfaceNormal
            .set(0, 1, 0)
            .applyQuaternion(surfacePose.quaternion)
            .normalize();

        receiver.position.addScaledVector(this.surfaceNormal, -0.001);

        this.lightTarget.position.copy(surfacePose.position);
        this.light.position
            .copy(surfacePose.position)
            .addScaledVector(this.surfaceNormal, this.lightHeight);

        this.lightTarget.updateMatrixWorld();
        this.light.updateMatrixWorld();
    }

    /**
     * Makes an existing scene mesh receive projected shadows.
     * Useful if another virtual mesh sits below part of the CAD.
     */
    public registerReceiver(object: THREE.Object3D): void {
        object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.receiveShadow = true;
            }
        });
    }

    private createReceiver(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial> {
        const geometry = new THREE.PlaneGeometry(this.receiverSize, this.receiverSize);

        // PlaneGeometry lies in XY and faces +Z. Rotate it so its local normal
        // is +Y; the WebXR hit-test quaternion then aligns +Y with the surface normal.
        geometry.rotateX(-Math.PI / 2);

        const material = new THREE.ShadowMaterial({
            color: 0x000000,
            opacity: 0.32,
            transparent: true,
            depthWrite: false,
        });

        const receiver = new THREE.Mesh(geometry, material);
        receiver.receiveShadow = true;
        receiver.castShadow = false;
        receiver.frustumCulled = false;

        return receiver;
    }
}
