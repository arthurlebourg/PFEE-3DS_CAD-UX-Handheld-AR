import * as THREE from 'three';

interface AttachedPart {
    mesh: THREE.Mesh;
    offsetMatrix: THREE.Matrix4;
}

export class RaycastPickHelper {
    private raycaster: THREE.Raycaster;
    private pickableMeshes: THREE.Mesh[] = [];

    public selectedMeshes: THREE.Mesh[] = [];
    public attachedParts: AttachedPart[] = [];

    private readonly EM_KEY = 'originalEmissive';

    constructor() {
        this.raycaster = new THREE.Raycaster();
    }

    public registerModel(model: THREE.Object3D): void {
        model.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                this.pickableMeshes.push(child);
            }
        });
    }

    public pick(
        x: number,
        y: number,
        renderer: THREE.WebGLRenderer,
        camera: THREE.Camera
    ): THREE.Mesh | null {
        const canvas = renderer.domElement;
        const rect = canvas.getBoundingClientRect();

        const ndcX = ((x - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((y - rect.top) / rect.height) * 2 + 1;
        const pointer = new THREE.Vector2(ndcX, ndcY);

        this.raycaster.setFromCamera(pointer, camera as THREE.PerspectiveCamera);

        const intersections = this.raycaster.intersectObjects(this.pickableMeshes, false);

        if (intersections.length > 0) {
            return intersections[0].object as THREE.Mesh;
        }
        return null;
    }

    public handleMeshSelection(pickedMesh: THREE.Mesh, camera: THREE.Camera): void {
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


    public updateAttachedMeshes(camera: THREE.Camera): void {
        if (this.attachedParts.length === 0) return;

        for (const part of this.attachedParts) {
            if (!part.mesh.parent) continue;

            const targetWorldMatrix = new THREE.Matrix4().multiplyMatrices(
                camera.matrixWorld,
                part.offsetMatrix
            );
            const targetWorldPos = new THREE.Vector3().setFromMatrixPosition(targetWorldMatrix);
            part.mesh.parent.worldToLocal(targetWorldPos);
            part.mesh.position.lerp(targetWorldPos, 0.15);
        }
    }


    public clearSelection(): void {
        for (const mesh of this.selectedMeshes) {
            this.removeHighlight(mesh);
        }
        this.selectedMeshes = [];
        this.attachedParts = [];
    }


    public unregisterModel(model: THREE.Object3D): void {
        const toRemove = new Set<THREE.Mesh>();
        model.traverse((child) => {
            if (child instanceof THREE.Mesh) toRemove.add(child);
        });

        this.pickableMeshes = this.pickableMeshes.filter((m) => !toRemove.has(m));
        this.selectedMeshes = this.selectedMeshes.filter((m) => {
            if (toRemove.has(m)) {
                this.removeHighlight(m);
                return false;
            }
            return true;
        });
        this.attachedParts = this.attachedParts.filter((p) => !toRemove.has(p.mesh));
    }

    private attachSelectedMeshesToCamera(camera: THREE.Camera): void {
        this.attachedParts = [];
        const cameraInverse = camera.matrixWorldInverse.clone();

        for (const mesh of this.selectedMeshes) {
            const offsetMatrix = new THREE.Matrix4().multiplyMatrices(
                cameraInverse,
                mesh.matrixWorld
            );
            this.attachedParts.push({ mesh, offsetMatrix });
        }
    }

    private highlightMesh(mesh: THREE.Mesh): void {
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

    private removeHighlight(mesh: THREE.Mesh): void {
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
