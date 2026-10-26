import * as THREE from 'three';
import type { PerfProbe } from '../ui/perf.js';
import { assemblySteps, indexAssembly, pieceMeshes, pieceOf, stepMeshes } from './assemblyTree.js';
import type { AssemblyStep } from './assemblyTree.js';



type MaterialBackup = { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] };

/** Layer the pick camera renders in isolation, so only pickable meshes hit the id buffer. */
const PICK_LAYER = 1;

/**
 * Opacity of a model's other pieces while the slider widens the selection to a
 * sub-assembly: almost invisible, just enough to keep the outline in context.
 */
const DIM_OPACITY = 0.06;

/** A material's state before dimming, restored as is. */
type DimBackup = { transparent: boolean; opacity: number; depthWrite: boolean };

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


    private idToMeshMap = new Map<number, THREE.Mesh>();
    private nextId = 1;
    private readonly EM_KEY = 'originalEmissive';
    private registeredRoots = new Set<THREE.Object3D>();
    /**
     * Assembly id -> node, per registered model: built once at registration so
     * a tap only walks ids. Weak, so a model dropped by any path is not retained.
     */
    private assemblyIndexes = new WeakMap<THREE.Object3D, Map<number, THREE.Object3D>>();
    /** The granularity step the selection currently is, if any. */
    private activeStep: AssemblyStep | null = null;
    /** Meshes currently faded around a sub-assembly selection (see updateContextDimming). */
    private dimmedMeshes = new Set<THREE.Mesh>();

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
        this.registeredRoots.add(model);
        this.assemblyIndexes.set(model, indexAssembly(model));
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
     * selection state, and disposes the cached pick material.
     */
    public removeModel(model: THREE.Object3D): void {
        this.registeredRoots.delete(model);
        this.assemblyIndexes.delete(model);
        if (this.activeStep && this.rootOf(this.activeStep.node) === model) {
            this.activeStep = null;
        }
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

            (child.userData.pickMaterial as THREE.Material | undefined)?.dispose();

            delete child.userData.originalPosition;
            delete child.userData.originalQuaternion;
            delete child.userData.originalScale;
        });
        // Restores the model's faded pieces too, so an undo never brings it back dimmed.
        this.updateContextDimming();
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
     * Toggles the tapped piece as a whole: all of its primitives, not just the
     * one hit. Re-tapping a piece inside a widened (sub-assembly) selection
     * drops that whole selection, as re-tapping a selected piece drops it.
     */
    public handleMeshSelection(pickedMesh: THREE.Mesh) {
        const piece = pieceOf(pickedMesh);
        const meshes = piece ? pieceMeshes(piece) : [pickedMesh];
        const isAlreadySelected = meshes.every((mesh) => this.selectedMeshes.includes(mesh));

        if (isAlreadySelected) {
            if (this.activeStep?.scope === 'subtree') {
                this.clearSelection();
                return;
            }
            for (const mesh of meshes) {
                this.deselectMesh(mesh);
            }
        } else {
            for (const mesh of meshes) {
                if (this.selectedMeshes.includes(mesh)) continue;
                this.selectedMeshes.push(mesh);
                this.highlightMesh(mesh);
            }
            this.updateContextDimming();
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
     * Removes a single mesh from the selection,
     * restoring its original material.
     */
    public deselectMesh(mesh: THREE.Mesh): void {
        if (!this.selectedMeshes.includes(mesh)) return;

        this.removeHighlight(mesh);
        this.selectedMeshes = this.selectedMeshes.filter((m) => m !== mesh);
        this.updateContextDimming();
    }

    /**
     * Clears the current selection.
     */
    public clearSelection() {
        for (const mesh of this.selectedMeshes) {
            this.removeHighlight(mesh);
        }
        this.selectedMeshes = [];
        this.activeStep = null;
        this.updateContextDimming();
    }

    /**
     * Checks whether a mesh and all its ancestors are visible.
     */
    private isMeshVisible(mesh: THREE.Mesh): boolean {
        let curr: THREE.Object3D | null = mesh;
        while (curr) {
            if (!curr.visible) return false;
            curr = curr.parent;
        }
        return true;
    }

    /**
     * Inverts the current mesh selection: selects all unselected visible meshes
     * and deselects all currently selected meshes.
     */
    public invertSelection(): void {
        const uniqueMeshes = Array.from(new Set(this.idToMeshMap.values()));
        const nextSelected: THREE.Mesh[] = [];

        for (const mesh of uniqueMeshes) {
            if (!this.isMeshVisible(mesh)) {
                if (this.selectedMeshes.includes(mesh)) {
                    this.removeHighlight(mesh);
                }
                continue;
            }

            if (this.selectedMeshes.includes(mesh)) {
                this.removeHighlight(mesh);
            } else {
                this.highlightMesh(mesh);
                nextSelected.push(mesh);
            }
        }

        this.selectedMeshes = nextSelected;
        // An arbitrary set now, no longer a granularity step.
        this.activeStep = null;
        this.updateContextDimming();
    }

    /**
     * Granularity steps for a picked mesh, bottom (its piece) to top (the whole
     * model), from the assembly tree computed at load (see assemblyTree.ts).
     */
    public getSelectableAncestorChain(mesh: THREE.Mesh): AssemblyStep[] {
        const root = this.rootOf(mesh);
        const index = root ? this.assemblyIndexes.get(root) : undefined;
        const steps = index ? assemblySteps(mesh, index) : [];
        // A model loaded without a tree still gets its piece as a single step.
        return steps.length > 0 ? steps : [{ node: mesh, scope: 'piece', pieces: 1 }];
    }

    /** Replaces the selection with a granularity step. */
    public selectNode(step: AssemblyStep): void {
        const meshes = stepMeshes(step);
        if (meshes.length === 0) return;

        for (const mesh of this.selectedMeshes) {
            this.removeHighlight(mesh);
        }
        this.selectedMeshes = meshes;
        for (const mesh of meshes) {
            this.highlightMesh(mesh);
        }
        this.activeStep = step;
        this.updateContextDimming();
    }

    /**
     * Ends the sub-assembly context when the slider closes (leaving Inspect
     * mode, or the selection emptied): the selection stays, unfaded, and no
     * longer counts as a granularity step.
     */
    public clearContextDimming(): void {
        this.activeStep = null;
        this.updateContextDimming();
    }

    /**
     * Fades a model's other pieces while the slider has widened the selection
     * to a sub-assembly (a 'subtree' step), so what the level covers reads at a
     * glance; the piece level and plain taps leave the scene as is. Only the
     * model holding the selection is touched. Runs on selection changes, never
     * per frame.
     */
    private updateContextDimming(): void {
        const next = new Set<THREE.Mesh>();
        const step = this.activeStep;
        const root = step?.scope === 'subtree' ? this.rootOf(step.node) : null;
        if (root) {
            const selected = new Set(this.selectedMeshes);
            root.traverse((child) => {
                if (!(child instanceof THREE.Mesh)) return;
                const mesh = child as THREE.Mesh;
                if (!selected.has(mesh)) next.add(mesh);
            });
        }

        for (const mesh of this.dimmedMeshes) {
            if (!next.has(mesh)) this.undimMesh(mesh);
        }
        for (const mesh of next) {
            if (!this.dimmedMeshes.has(mesh)) this.dimMesh(mesh);
        }
        this.dimmedMeshes = next;
    }

    /**
     * Near invisible without depth writes, so the opaque selection stays
     * visible through the pieces in front of it; no shadow either, which an
     * all but invisible piece would otherwise still cast.
     */
    private dimMesh(mesh: THREE.Mesh): void {
        this.isolateMaterial(mesh);
        mesh.userData.dimCastShadow = mesh.castShadow;
        mesh.castShadow = false;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mesh.userData.dimBackup = materials.map((material): DimBackup => ({
            transparent: material.transparent,
            opacity: material.opacity,
            depthWrite: material.depthWrite,
        }));
        for (const material of materials) {
            material.transparent = true;
            material.opacity = Math.min(material.opacity, DIM_OPACITY);
            material.depthWrite = false;
            material.needsUpdate = true;
        }
    }

    private undimMesh(mesh: THREE.Mesh): void {
        const backup = mesh.userData.dimBackup as DimBackup[] | undefined;
        if (!backup) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material, i) => {
            const saved = backup[i];
            if (!saved) return;
            material.transparent = saved.transparent;
            material.opacity = saved.opacity;
            material.depthWrite = saved.depthWrite;
            material.needsUpdate = true;
        });
        mesh.castShadow = mesh.userData.dimCastShadow as boolean;
        delete mesh.userData.dimBackup;
        delete mesh.userData.dimCastShadow;
    }

    /**
     * Placed copies of a model share its materials (Object3D.clone keeps them),
     * so a mesh gets its own copy before any per-piece change (highlight, dim).
     */
    private isolateMaterial(mesh: THREE.Mesh): void {
        if (mesh.userData.isolatedMaterial) return;
        mesh.material = Array.isArray(mesh.material)
            ? mesh.material.map((material) => material.clone())
            : mesh.material.clone();
        mesh.userData.isolatedMaterial = true;
    }

    /** The registered model containing `object`, if any. */
    private rootOf(object: THREE.Object3D): THREE.Object3D | null {
        let current: THREE.Object3D | null = object;
        while (current && !this.registeredRoots.has(current)) {
            current = current.parent;
        }
        return current;
    }

    /**
     * Visually highlights a mesh by setting its emissive color (bright orange
     * by default, for the Inspect piece selection).
     */
    private highlightMesh(mesh: THREE.Mesh, colorHex = 0xff6600) {
        this.isolateMaterial(mesh);

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
