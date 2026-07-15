import * as THREE from 'three';
import type { PerfProbe } from '../ui/perf.js';

interface AttachedPart {
    mesh: THREE.Mesh;
    offsetMatrix: THREE.Matrix4;
}

type MaterialBackup = { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] };

/** Layer the pick camera renders in isolation, so only pickable meshes hit the id buffer. */
const PICK_LAYER = 1;

/**
 * PickHelper: GPU colour picking via in-place material swapping.
 *
 * Each registered mesh is briefly swapped to a flat id-colour material and the
 * real scene is rendered off-screen through a layer-masked camera, then restored.
 * Drawing the actual meshes means picks always match what's on screen (including
 * mid-drag) with no parallel scene to keep in sync.
 */
export class PickHelper {
    public pickingTexture: THREE.WebGLRenderTarget;

    public selectedMeshes: THREE.Mesh[] = [];
    public attachedParts: AttachedPart[] = [];

    private idToMeshMap = new Map<number, THREE.Mesh>();
    private nextId = 1;
    private readonly EM_KEY = 'originalEmissive';

    private pickCamera = new THREE.PerspectiveCamera();

    /**
     * Initializes the off-screen render target used for the pick pass.
     */
    constructor() {
        const dpr = window.devicePixelRatio;
        this.pickingTexture = new THREE.WebGLRenderTarget(window.innerWidth * dpr, window.innerHeight * dpr, {
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            generateMipmaps: false
        });
    }

    /**
     * Resizes the picking texture to match the screen dimensions.
     */
    public resize(width: number, height: number, dpr: number) {
        this.pickingTexture.setSize(width * dpr, height * dpr);
    }

    /**
     * Registers every sub-mesh of a placed model as an individually pickable
     * part: assigns it a unique id encoded as an RGB colour, caches a flat
     * id-material for the pick pass, and enables the pick layer so the pick
     * camera will render it.
     */
    public registerModel(model: THREE.Object3D): void {
        model.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) {
                return;
            }

            // Save original local transform (position, rotation/quaternion, scale)
            // to support resetting the model without modifying its mesh geometry.
            child.userData.originalPosition = child.position.clone();
            child.userData.originalQuaternion = child.quaternion.clone();
            child.userData.originalScale = child.scale.clone();

            const id = this.nextId++;

            const color = new THREE.Color();
            color.r = ((id >> 16) & 255) / 255;
            color.g = ((id >> 8) & 255) / 255;
            color.b = (id & 255) / 255;

            // Write the id colour verbatim: no tone mapping, no blending, both faces.
            child.userData.pickMaterial = new THREE.MeshBasicMaterial({
                color,
                blending: THREE.NoBlending,
                side: THREE.DoubleSide,
                toneMapped: false
            });

            child.layers.enable(PICK_LAYER);
            this.idToMeshMap.set(id, child as THREE.Mesh);
        });
    }

    /**
     * Unregisters every sub-mesh of a model: clears it from the id map, drops any
     * selection/attachment state, and disposes the cached pick material.
     */
    public removeModel(model: THREE.Object3D): void {
        model.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) {
                return;
            }
            for (const [id, mesh] of this.idToMeshMap) {
                if (mesh === child) {
                    this.idToMeshMap.delete(id);
                }
            }
            this.selectedMeshes = this.selectedMeshes.filter((m) => m !== child);
            this.attachedParts = this.attachedParts.filter((p) => p.mesh !== child);
            (child.userData.pickMaterial as THREE.Material | undefined)?.dispose();

            delete child.userData.originalPosition;
            delete child.userData.originalQuaternion;
            delete child.userData.originalScale;
        });
    }

    /**
     * Smoothly updates the position of all attached parts to follow the camera.
     */
    public updateAttachedMeshes(camera: THREE.Camera) {
        if (this.attachedParts.length === 0) {
            return;
        }

        for (const part of this.attachedParts) {
            if (!part.mesh.parent) continue;

            const targetWorldMatrix = new THREE.Matrix4().multiplyMatrices(camera.matrixWorld, part.offsetMatrix);
            const targetWorldPos = new THREE.Vector3().setFromMatrixPosition(targetWorldMatrix);

            part.mesh.parent.worldToLocal(targetWorldPos);
            part.mesh.position.lerp(targetWorldPos, 0.15);
        }
    }

    /**
     * Swaps every registered mesh to its flat id-material, returning the list of
     * originals so they can be restored after the pick render.
     */
    private swapToPickMaterials(): MaterialBackup[] {
        const backup: MaterialBackup[] = [];
        for (const mesh of this.idToMeshMap.values()) {
            backup.push({ mesh, material: mesh.material });
            mesh.material = mesh.userData.pickMaterial as THREE.MeshBasicMaterial;
        }
        return backup;
    }

    /**
     * Restores the visible materials swapped out by {@link swapToPickMaterials}.
     */
    private restoreMaterials(backup: MaterialBackup[]) {
        for (const entry of backup) {
            entry.mesh.material = entry.material;
        }
    }

    /**
     * Renders the scene off-screen with id-colour materials and reads back the
     * pixel under the tap to identify the clicked mesh.
     */
    public pickXR(inputSource: XRInputSource | undefined, renderer: THREE.WebGLRenderer, scene: THREE.Scene, probe?: PerfProbe): THREE.Mesh | null {
        const axes = inputSource?.gamepad?.axes;
        if (inputSource?.targetRayMode !== 'screen' || !axes || axes.length < 2) {
            return null;
        }
        if (this.idToMeshMap.size === 0) {
            return null;
        }
        const ndcX = axes[0];
        const ndcY = axes[1];

        const px = Math.floor((ndcX * 0.5 + 0.5) * this.pickingTexture.width);
        const py = Math.floor((0.5 - ndcY * 0.5) * this.pickingTexture.height);

        if (px < 0 || py < 0 || px >= this.pickingTexture.width || py >= this.pickingTexture.height) {
            return null;
        }

        probe?.beginPick();

        const xrCamera = renderer.xr.getCamera();
        const view = xrCamera.cameras[0] ?? xrCamera;

        this.pickCamera.matrixAutoUpdate = false;
        this.pickCamera.matrixWorldAutoUpdate = false;
        this.pickCamera.matrixWorld.copy(view.matrixWorld);
        this.pickCamera.matrixWorldInverse.copy(view.matrixWorldInverse);
        this.pickCamera.projectionMatrix.copy(view.projectionMatrix);
        this.pickCamera.projectionMatrixInverse.copy(view.projectionMatrixInverse);
        // Render only pickable meshes; the preview ghost and controllers are skipped.
        this.pickCamera.layers.set(PICK_LAYER);

        const oldToneMapping = renderer.toneMapping;
        renderer.toneMapping = THREE.NoToneMapping;

        const xrWasEnabled = renderer.xr.enabled;
        renderer.xr.enabled = false;

        // Scissor the render to the single pixel under the tap: full-resolution
        // projection, but only one fragment is ever shaded. Set on the target so
        // it applies at bind time and survives clear()/render().
        this.pickingTexture.scissor.set(px, py, 1, 1);
        this.pickingTexture.scissorTest = true;

        const backup = this.swapToPickMaterials();
        const pixelBuffer = new Uint8Array(4);

        try {
            renderer.setRenderTarget(this.pickingTexture);
            renderer.clear();
            probe?.split('prep');

            renderer.render(scene, this.pickCamera);
            probe?.split('render');

            renderer.readRenderTargetPixels(this.pickingTexture, px, py, 1, 1, pixelBuffer);
            probe?.split('readback');
        } finally {
            this.restoreMaterials(backup);
            this.pickingTexture.scissorTest = false;
            renderer.setRenderTarget(null);
            renderer.xr.enabled = xrWasEnabled;
            renderer.toneMapping = oldToneMapping;
        }

        const id = (pixelBuffer[0] << 16) | (pixelBuffer[1] << 8) | pixelBuffer[2];
        const pickedMesh = id > 0 ? (this.idToMeshMap.get(id) ?? null) : null;
        probe?.endPick();
        return pickedMesh;
    }

    /**
     * Debug view: renders the id-colour materials on screen.
     * Note: under an active XR session the headset camera ignores the layer mask,
     * so the id-coloured parts show within the normal scene rather than on black.
     */
    public renderPickingDebug(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
        const backup = this.swapToPickMaterials();
        const oldMask = camera.layers.mask;
        const oldToneMapping = renderer.toneMapping;

        camera.layers.set(PICK_LAYER);
        renderer.toneMapping = THREE.NoToneMapping;

        try {
            renderer.render(scene, camera);
        } finally {
            renderer.toneMapping = oldToneMapping;
            camera.layers.mask = oldMask;
            this.restoreMaterials(backup);
        }
    }

    /**
     * Handles the interaction logic for selecting, multi-selecting, and attaching meshes.
     */
    public handleMeshSelection(pickedMesh: THREE.Mesh, camera: THREE.Camera) {
        const isAlreadySelected = this.selectedMeshes.includes(pickedMesh);

        if (isAlreadySelected) {
            if (this.attachedParts.length > 0) {
                this.attachedParts = [];
            } else {
                this.attachSelectedMeshesToCamera(camera);
            }
        } else {
            this.selectedMeshes.push(pickedMesh);
            this.highlightMesh(pickedMesh);
            this.attachedParts = [];
        }
    }

    /**
     * Highlights every mesh of a placed model, marking it as the selected
     * model in Edit mode. Blue, to distinguish from the orange piece
     * selection used in Inspect mode.
     */
    public highlightModel(model: THREE.Object3D, colorHex = 0x007bff): void {
        model.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                this.highlightMesh(child as THREE.Mesh, colorHex);
            }
        });
    }

    /**
     * Restores the original appearance of every mesh of a model highlighted
     * by {@link highlightModel}.
     */
    public unhighlightModel(model: THREE.Object3D): void {
        model.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                this.removeHighlight(child as THREE.Mesh);
            }
        });
    }

    /**
     * Removes a single mesh from the selection and any camera attachment,
     * restoring its original material.
     */
    public deselectMesh(mesh: THREE.Mesh): void {
        if (!this.selectedMeshes.includes(mesh)) return;

        this.removeHighlight(mesh);
        this.selectedMeshes = this.selectedMeshes.filter((m) => m !== mesh);
        this.attachedParts = this.attachedParts.filter((p) => p.mesh !== mesh);
    }

    /**
     * Drops all attached pieces and clears the current selection.
     */
    public clearSelection() {
        for (const mesh of this.selectedMeshes) {
            this.removeHighlight(mesh);
        }
        this.selectedMeshes = [];
        this.attachedParts = [];
    }

    /**
     * Binds all currently selected meshes to the camera for grouped movement.
     */
    private attachSelectedMeshesToCamera(camera: THREE.Camera) {
        this.attachedParts = [];
        const cameraInverse = camera.matrixWorldInverse.clone();

        for (const mesh of this.selectedMeshes) {
            const meshWorldMatrix = mesh.matrixWorld;
            const offsetMatrix = new THREE.Matrix4().multiplyMatrices(cameraInverse, meshWorldMatrix);

            this.attachedParts.push({
                mesh: mesh,
                offsetMatrix: offsetMatrix
            });
        }
    }

    /**
     * Visually highlights a mesh by setting its emissive color (bright orange
     * by default, for the Inspect piece selection).
     */
    private highlightMesh(mesh: THREE.Mesh, colorHex = 0xff6600) {
        if (!mesh.userData.isolatedMaterial) {
            mesh.material = (mesh.material as THREE.Material).clone();
            mesh.userData.isolatedMaterial = true;
        }

        const material = mesh.material as THREE.MeshStandardMaterial;
        if (material && material.emissive) {
            if (!mesh.userData[this.EM_KEY]) {
                mesh.userData[this.EM_KEY] = material.emissive.clone();
                mesh.userData.originalEmissiveIntensity = material.emissiveIntensity;
            }

            material.emissive.setHex(colorHex);

            if ('emissiveIntensity' in material) {
                material.emissiveIntensity = 0.6;
            }
        }
    }

    /**
     * Restores a mesh to its original visual state.
     */
    private removeHighlight(mesh: THREE.Mesh) {
        const material = mesh.material as THREE.MeshStandardMaterial;
        const originalEmissive = mesh.userData[this.EM_KEY] as THREE.Color | undefined;

        if (material && material.emissive && originalEmissive) {
            material.emissive.copy(originalEmissive);
            const originalIntensity = mesh.userData.originalEmissiveIntensity as number | undefined;
            if ('emissiveIntensity' in material && originalIntensity !== undefined) {
                material.emissiveIntensity = originalIntensity;
            }
        }
    }
}
