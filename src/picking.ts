import * as THREE from 'three';

interface AttachedPart {
    mesh: THREE.Mesh;
    offsetMatrix: THREE.Matrix4;
}

/**
 * PickHelper: Handles GPU-based picking (color ID rendering) and multi-selection dragging.
 */
export class PickHelper {
    public pickingScene: THREE.Scene;
    public pickingTexture: THREE.WebGLRenderTarget;
    
    public selectedMeshes: THREE.Mesh[] = [];
    public attachedParts: AttachedPart[] = [];
    
    private idToMeshMap = new Map<number, THREE.Mesh>();
    private meshToPickMap = new Map<THREE.Mesh, THREE.Mesh>();
    private readonly EM_KEY = 'originalEmissive';

    /**
     * Initializes the picking scene and the off-screen render target.
     */
    constructor() {
        this.pickingScene = new THREE.Scene();
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
     * Clones the visual model and assigns a unique flat color (ID) to each part.
     */
    public createPickingModel(model: THREE.Object3D): THREE.Object3D {
        const pickModel = model.clone();
        
        const originalMeshes: THREE.Mesh[] = [];
        model.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                originalMeshes.push(child);
            }
        });

        let meshIndex = 0;
        pickModel.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                const originalMesh = originalMeshes[meshIndex];
                
                let id: number;
                do {
                    id = Math.floor(Math.random() * 0xffffff);
                    id = id | 0x333333;
                } while (this.idToMeshMap.has(id));

                this.idToMeshMap.set(id, originalMesh);
                this.meshToPickMap.set(originalMesh, child);

                const color = new THREE.Color();
                color.r = ((id >> 16) & 255) / 255;
                color.g = ((id >> 8) & 255) / 255;
                color.b = (id & 255) / 255;
                
                child.material = new THREE.MeshBasicMaterial({
                    color: color,
                    blending: THREE.NoBlending,
                    side: THREE.DoubleSide
                });
                
                meshIndex++;
            }
        });
        
        return pickModel;
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

            const pickingMesh = this.meshToPickMap.get(part.mesh);
            if (pickingMesh) {
                pickingMesh.position.copy(part.mesh.position);
            }
        }
    }

    /**
     * Renders the picking scene and reads the pixel color at the specified coordinates to identify the clicked mesh.
     */
    public pick(x: number, y: number, renderer: THREE.WebGLRenderer, camera: THREE.Camera): THREE.Mesh | null {
        const dpr = renderer.getPixelRatio();
        const pixelX = Math.round(x * dpr);
        const pixelY = Math.round((window.innerHeight - y) * dpr);

        const oldToneMapping = renderer.toneMapping;
        renderer.toneMapping = THREE.NoToneMapping;
        
        renderer.setRenderTarget(this.pickingTexture);
        renderer.clear();
        renderer.render(this.pickingScene, camera);

        const pixelBuffer = new Uint8Array(4);
        renderer.readRenderTargetPixels(this.pickingTexture, pixelX, pixelY, 1, 1, pixelBuffer);
        
        renderer.setRenderTarget(null);
        renderer.toneMapping = oldToneMapping;

        const id = (pixelBuffer[0] << 16) | (pixelBuffer[1] << 8) | pixelBuffer[2];
        
        if (id > 0) {
            return this.idToMeshMap.get(id) || null;
        }
        return null;
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
     * Visually highlights a mesh by setting its emissive color to bright cyan.
     */
    private highlightMesh(mesh: THREE.Mesh) {
        const material = mesh.material as THREE.MeshStandardMaterial;
        if (material && material.emissive) {
            if (!mesh.userData[this.EM_KEY]) {
                mesh.userData[this.EM_KEY] = material.emissive.clone();
            }
            
            material.emissive.setHex(0x00ffff);
            
            if ('emissiveIntensity' in material) {
                material.emissiveIntensity = 2.0;
            }
        }
    }

    /**
     * Restores a mesh to its original visual state.
     */
    private removeHighlight(mesh: THREE.Mesh) {
        const material = mesh.material as THREE.MeshStandardMaterial;
        const originalEmissive = mesh.userData[this.EM_KEY];
        
        if (material && material.emissive && originalEmissive) {
            material.emissive.copy(originalEmissive);
            if ('emissiveIntensity' in material) {
                material.emissiveIntensity = 1.0;
            }
        }
    }
}
