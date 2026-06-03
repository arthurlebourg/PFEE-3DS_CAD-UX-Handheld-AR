import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { PickHelper } from './picking';
import { RaycastPickHelper } from './raycasting-picking';
import { UIManager } from './ui';

const ferrariUrl = new URL('../assets/ferrari_f40.glb', import.meta.url).href;

// Toggle this constant to switch between the two picking strategies.
// true  → GPU color-ID picking  (PickHelper)
// false → CPU raycasting        (RaycastPickHelper)
const USE_GPU_PICKING = false;

let container: HTMLDivElement;
let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let renderer: THREE.WebGLRenderer;
let controller1: THREE.XRTargetRaySpace;
let controller2: THREE.XRTargetRaySpace;

let ferrariModel: THREE.Object3D | null = null;
let previewModel: THREE.Object3D | null = null;

let hitTestSource: XRHitTestSource | null = null;
let hitTestSourceRequested = false;

// Matrix applied on top of the hit pose to scale the placed/preview model down.
const PLACEMENT_SCALE = 0.05;
const scaleMatrix = new THREE.Matrix4().makeScale(PLACEMENT_SCALE, PLACEMENT_SCALE, PLACEMENT_SCALE);

// Picking helpers
const gpuPicker = new PickHelper();
const rayPicker = new RaycastPickHelper();

// UI 
const ui = new UIManager(
    (_isPlacement) => {
        gpuPicker.clearSelection();
        rayPicker.clearSelection();
    },
    (showColors) => {
        // Debug
        debugShowPickingColors = showColors;
    }
);

let debugShowPickingColors = false;

init();

function init(): void {
    container = document.createElement('div');
    document.body.appendChild(container);

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setAnimationLoop(animate);
    renderer.xr.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

    document.body.appendChild(ARButton.createButton(renderer, {
        requiredFeatures: ['hit-test', 'dom-overlay'],
        domOverlay: { root: container },
    }));

    const loader = new GLTFLoader();
    loader.load(ferrariUrl, (gltf) => {
        ferrariModel = gltf.scene;
        previewModel = createPreview(ferrariModel);
        scene.add(previewModel);
    });

    // XR controller "select" event 
    // In placement mode: place a new car.
    // In selection mode: pick the mesh under the controller ray.
    function onXRSelect(this: THREE.XRTargetRaySpace): void {
        if (ui.isPlacementMode) {
            if (previewModel?.visible && ferrariModel) {
                const model = ferrariModel.clone();
                previewModel.matrix.decompose(model.position, model.quaternion, model.scale);
                scene.add(model);
                // Register the newly placed car as a raycasting target.
                gpuPicker.createPickingModel(model);
                rayPicker.registerModel(model);
            }
        } else {
            // Convert the XR controller ray to a screen-space click and pick.
            const controllerPos = new THREE.Vector3().setFromMatrixPosition(this.matrixWorld);
            const screenPos = controllerPos.project(camera);
            const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
            const y = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;
            handlePick(x, y);
        }
    }

    // Controllers
    controller1 = renderer.xr.getController(0);
    controller1.addEventListener('select', onXRSelect);
    scene.add(controller1);

    controller2 = renderer.xr.getController(1);
    controller2.addEventListener('select', onXRSelect);
    scene.add(controller2);

    //Non-XR pointer / touch fallback
    renderer.domElement.addEventListener('click', (event: MouseEvent) => {
        if (!ui.isPlacementMode) {
            handlePick(event.clientX, event.clientY);
        }
    });

    renderer.domElement.addEventListener('touchend', (event: TouchEvent) => {
        if (!ui.isPlacementMode && event.changedTouches.length > 0) {
            const t = event.changedTouches[0];
            handlePick(t.clientX, t.clientY);
        }
    });

    // Show the mode-switch UI once the AR session starts.
    renderer.xr.addEventListener('sessionstart', () => ui.toggleVisibility(true));
    renderer.xr.addEventListener('sessionend', () => {
        ui.toggleVisibility(false);
        gpuPicker.clearSelection();
        rayPicker.clearSelection();
    });

    ui.attach(container);

    window.addEventListener('resize', onWindowResize);
}

/**
 * Dispatches a pick event at the given CSS pixel coordinates using whichever
 * strategy is active (GPU or raycasting).
 */
function handlePick(x: number, y: number): void {
    let pickedMesh: THREE.Mesh | null = null;

    if (USE_GPU_PICKING) {
        pickedMesh = gpuPicker.pick(x, y, renderer, camera);
        if (pickedMesh) gpuPicker.handleMeshSelection(pickedMesh, camera);
    } else {
        pickedMesh = rayPicker.pick(x, y, renderer, camera);
        if (pickedMesh) rayPicker.handleMeshSelection(pickedMesh, camera);
    }
}

// Builds a translucent "ghost" of the model to preview the placement spot.
// Cloned once and reused every frame to avoid per-frame allocations.
function createPreview(source: THREE.Object3D): THREE.Object3D {
    const preview = source.clone();

    preview.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) {
            return;
        }

        // Clone materials so the translucency doesn't leak onto placed cars,
        // which keep sharing the original opaque materials.
        const makeGhost = (material: THREE.Material): THREE.Material => {
            const ghost = material.clone();
            ghost.transparent = true;
            ghost.opacity = 0.4;
            ghost.depthWrite = true;
            return ghost;
        };

        const material = child.material as THREE.Material | THREE.Material[];
        child.material = Array.isArray(material) ? material.map(makeGhost) : makeGhost(material);
    });

    // Driven manually from the hit-test pose each frame.
    preview.matrixAutoUpdate = false;
    preview.visible = false;

    return preview;
}

function onWindowResize(): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);
    gpuPicker.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
}

function animate(_timestamp: DOMHighResTimeStamp, frame?: XRFrame): void {
    if (frame) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (session && referenceSpace && !hitTestSourceRequested) {
            void session.requestReferenceSpace('viewer').then((viewerSpace) => {
                void session.requestHitTestSource?.({ space: viewerSpace })?.then((source) => {
                    hitTestSource = source;
                });
            });

            session.addEventListener('end', () => {
                hitTestSourceRequested = false;
                hitTestSource = null;
            });

            hitTestSourceRequested = true;
        }

        if (hitTestSource && referenceSpace && previewModel) {
            const hitTestResults = frame.getHitTestResults(hitTestSource);

            if (hitTestResults.length > 0) {
                const hit = hitTestResults[0];
                const pose = hit.getPose(referenceSpace);

                if (pose) {
                    previewModel.visible = true;
                    previewModel.matrix
                        .fromArray(pose.transform.matrix)
                        .multiply(scaleMatrix);
                }
            } else {
                previewModel.visible = false;
            }
        }
    }

    // Update attached meshes for whichever picker is active.
    if (USE_GPU_PICKING) {
        gpuPicker.updateAttachedMeshes(camera);
    } else {
        rayPicker.updateAttachedMeshes(camera);
    }

    // Debug: render the GPU picking color scene instead of the real scene.
    if (USE_GPU_PICKING && debugShowPickingColors) {
        renderer.render(gpuPicker.pickingScene, camera);
    } else {
        renderer.render(scene, camera);
    }
}
