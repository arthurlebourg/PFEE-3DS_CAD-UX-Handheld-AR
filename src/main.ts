import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { isDevMode, setupDevMode } from './devMode.js';

import { UIManager } from './ui.js';
import { PickHelper } from './picking.js';
import { PerfProbe } from './perf.js';
import { VirtualJoycon } from './virtualJoycon.js';
import { SceneRotator } from './sceneRotator.js';

const modules = import.meta.glob('../assets/*.glb', { eager: true, query: '?url', import: 'default' });
const modelUrls: Record<string, string> = {};
for (const path in modules) {
    const filename = path.split('/').pop()!;
    modelUrls[filename] = modules[path];
}
const availableModels = Object.keys(modelUrls);

/** Physical (rig-independent) pose stored on a model's userData. */
interface PhysicalPose {
    physicalPosition?: THREE.Vector3;
    physicalRotation?: THREE.Quaternion;
}

const currentScaleMatrix = new THREE.Matrix4().makeScale(1, 1, 1);
let container: HTMLDivElement;
let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let renderer: THREE.WebGLRenderer;
let controller1: THREE.XRTargetRaySpace;
let controller2: THREE.XRTargetRaySpace;

let xrRig: THREE.Group;
let rigScale = 1.0;
const placedModels: THREE.Object3D[] = [];

let loadedModel: THREE.Object3D | null = null;
let previewModel: THREE.Object3D | null = null;
let devModel: THREE.Object3D | null = null;

let hitTestSource: XRHitTestSource | null = null;
let hitTestSourceRequested = false;

let devTick: (() => void) | null = null;

let uiManager: UIManager;
let virtualJoycon: VirtualJoycon;
let sceneRotator: SceneRotator;
let pickHelper: PickHelper;
let perf: PerfProbe;

init();

/**
 * Initializes the Three.js scene, WebXR session, lights, and loads the 3D model.
 */
function init(): void {
    container = document.createElement('div');
    document.body.appendChild(container);

    scene = new THREE.Scene();
    
    xrRig = new THREE.Group();
    scene.add(xrRig);

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
    xrRig.add(camera);

    // No MSAA: the full-resolution resolve every frame is a major fill cost on
    // mobile, and WebXR applies its own AA to the composited layer.
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setAnimationLoop(animate);
    renderer.xr.enabled = !isDevMode;
    // setPixelRatio does not control the XR render resolution; the XR layer does.
    // At full device DPR the app is fill-bound, so shade fewer fragments.
    renderer.xr.setFramebufferScaleFactor(0.7);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

    controller1 = renderer.xr.getController(0);
    controller1.addEventListener('select', (event) => { onSelect(event.data); });
    xrRig.add(controller1);
    controller2 = renderer.xr.getController(1);
    controller2.addEventListener('select', (event) => { onSelect(event.data); });
    xrRig.add(controller2);

    pickHelper = new PickHelper();
    perf = new PerfProbe({ visible: false });
    perf.mount(document.body);

    uiManager = new UIManager(
        (isPlacement) => {
            if (!isPlacement && previewModel) {
                previewModel.visible = false;
            }
        },
        () => {},
        (modelName) => {
            loadModel(modelName);
        },
        (showPerf) => {
            perf.setVisible(showPerf);
        },
        (scale) => {
            updateRigScale(scale);
        () => {                        
        if (pickHelper.selectedMeshes.length > 0) {
                pickHelper.hideSelected();
            } else {
                    pickHelper.showAll();
                }
        },
        availableModels,
        isDevMode  // ← active les boutons debug (perf, picking colors) en dev uniquement
    );

    uiManager.attach(document.body);
    sceneRotator = new SceneRotator();

    virtualJoycon = new VirtualJoycon((strength) => {
        const maxSpeed = 0.06;

        sceneRotator.rotateAroundCenter(
            xrRig,
            placedModels,
            strength * maxSpeed,
        );
    });

    virtualJoycon.attach(document.body);

    if (isDevMode) {
        devTick = setupDevMode(scene, camera, renderer, uiManager);
    } else {
        const arButtonOptions = {
            requiredFeatures: ['hit-test'],
            optionalFeatures: ['dom-overlay'],
            domOverlay: { root: document.body }
        };
        document.body.appendChild(ARButton.createButton(renderer, arButtonOptions));

        renderer.xr.addEventListener('sessionstart', () => {
            uiManager.toggleVisibility(true);
        });
        renderer.xr.addEventListener('sessionend', () => {
            uiManager.toggleVisibility(false);
            perf.setVisible(false);
        });
    }

    if (availableModels.length > 0) {
        loadModel(availableModels[0]);
    }

    window.addEventListener('resize', onWindowResize);
}

/**
 * Loads a GLTF model, sets it as the loaded model, and creates a placement preview.
 */
function loadModel(modelName: string): void {
    const url = modelUrls[modelName];
    if (!url) return;

    if (previewModel) {
        scene.remove(previewModel);
        previewModel = null;
    }

    const loader = new GLTFLoader();
    loader.load(url, (gltf) => {
        loadedModel = gltf.scene;

        const box = new THREE.Box3().setFromObject(loadedModel);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const targetSize = 0.3; // 30 cm
        const scale = maxDim > 0 ? targetSize / maxDim : 1;
        currentScaleMatrix.makeScale(scale, scale, scale);

        loadedModel.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            const mesh = child as THREE.Mesh;
            mesh.material = Array.isArray(mesh.material)
                ? mesh.material.map((mat) => mat.clone())
                : mesh.material.clone();
        });

        previewModel = createPreview(loadedModel);
        scene.add(previewModel);

        if (isDevMode) {
            // No AR hit-testing in dev mode: drop the model on the orbit target
            // so it is immediately visible and pickable.
            if (devModel) {
                scene.remove(devModel);
                pickHelper.removeModel(devModel);
            }
            devModel = loadedModel.clone();
            devModel.applyMatrix4(currentScaleMatrix);
            devModel.position.set(0, 1.5, -2);
            scene.add(devModel);
            pickHelper.registerModel(devModel);
        } else if (uiManager) {
            uiManager.forcePlacementMode(true);
        }
    });
}

/**
 * Handles select events on the screen, triggering GPU picking and piece selection.
 */
function onSelect(inputSource?: XRInputSource): void {
    if (!renderer.xr.isPresenting) return;

    if (virtualJoycon.consumeTap()) return;

    // In placement mode a tap only ever places a model; picking is disabled.
    if (uiManager.isPlacementMode) {
        if (previewModel?.visible && loadedModel) {
            placeModel();
        }
        return;
    }

    const pickedMesh = pickHelper.pickXR(inputSource, renderer, scene, perf);

    if (pickedMesh) {
        pickHelper.handleMeshSelection(pickedMesh, camera);
    } else if (pickHelper.attachedParts.length > 0) {
        pickHelper.attachedParts = [];
    } else if (pickHelper.selectedMeshes.length > 0) {
        pickHelper.clearSelection();
    }
}

/**
 * Updates the scale of the camera rig and adjusts placed models' positions
 * to keep them anchored to their physical positions.
 */
function updateRigScale(newScale: number): void {
    rigScale = newScale;
    
    if (xrRig) {
        xrRig.scale.set(rigScale, rigScale, rigScale);
    }
    
    // Update all placed models' positions to remain anchored physically
    for (const model of placedModels) {
        const { physicalPosition } = model.userData as PhysicalPose;
        if (physicalPosition) {
            model.position.copy(physicalPosition).multiplyScalar(rigScale);
        }
    }

    // Update preview model position
    const previewPose = previewModel?.userData as PhysicalPose | undefined;
    if (previewModel && previewPose?.physicalPosition) {
        previewModel.position.copy(previewPose.physicalPosition).multiplyScalar(rigScale);
    }

    // Since the scale changes the positions, we need to update the center of rotation
    sceneRotator.refresh(xrRig, placedModels);

    // Clear picking selection to prevent offset/scale mismatch while dragging
    if (pickHelper) {
        pickHelper.clearSelection();
    }
}

/**
 * Places the full 3D model at the current location of the AR preview cursor.
 */
function placeModel(): void {
    if (!loadedModel || !previewModel) return;

    const model = loadedModel.clone();
    previewModel.matrix.decompose(model.position, model.quaternion, model.scale);
    
    const previewPose = previewModel.userData as PhysicalPose;
    if (previewPose.physicalPosition && previewPose.physicalRotation) {
        model.userData.physicalPosition = previewPose.physicalPosition.clone();
        model.userData.physicalRotation = previewPose.physicalRotation.clone();
    }
    
    scene.add(model);
    placedModels.push(model);
    pickHelper.registerModel(model);
    sceneRotator.refresh(xrRig, placedModels);
}

/**
 * Creates a semi-transparent version of the 3D model for placement preview.
 */
function createPreview(source: THREE.Object3D): THREE.Object3D {
    const preview = source.clone();
    preview.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const mesh = child as THREE.Mesh;
        const makeGhost = (mat: THREE.Material): THREE.Material => {
            const ghost = mat.clone();
            ghost.transparent = true;
            ghost.opacity = 0.4;
            ghost.depthWrite = true;
            return ghost;
        };
        mesh.material = Array.isArray(mesh.material)
            ? mesh.material.map(makeGhost)
            : makeGhost(mesh.material);
    });
    preview.visible = false;
    return preview;
}

/**
 * Updates camera and renderer dimensions when the browser window is resized.
 */
function onWindowResize(): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    pickHelper.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
}

/**
 * Main animation loop called every frame by the WebXR engine.
 * Handles AR hit testing, moving parts, and rendering the final scene.
 */
function animate(_timestamp: DOMHighResTimeStamp, frame?: XRFrame): void {
    perf.frame(_timestamp);
    devTick?.();

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

            if (hitTestResults.length > 0 && uiManager.isPlacementMode) {
                const hit = hitTestResults[0];
                const pose = hit.getPose(referenceSpace);
                if (pose) {
                    previewModel.visible = true;
                    
                    const posePosition = new THREE.Vector3();
                    const poseRotation = new THREE.Quaternion();
                    const poseScale = new THREE.Vector3();
                    const poseMatrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
                    poseMatrix.decompose(posePosition, poseRotation, poseScale);
                    
                    // Store the physical pose coordinates
                    previewModel.userData.physicalPosition = posePosition.clone();
                    previewModel.userData.physicalRotation = poseRotation.clone();

                    // Apply the rigScale to the position
                    previewModel.position.copy(posePosition).multiplyScalar(rigScale);
                    previewModel.quaternion.copy(poseRotation);

                    // Set scale from currentScaleMatrix (auto-fit scale)
                    const modelScale = new THREE.Vector3();
                    const modelRot = new THREE.Quaternion();
                    const modelPos = new THREE.Vector3();
                    currentScaleMatrix.decompose(modelPos, modelRot, modelScale);
                    previewModel.scale.copy(modelScale);
                }
            } else {
                previewModel.visible = false;
            }
        }
    }

    pickHelper.updateAttachedMeshes(camera);

    if (uiManager.showPickingColors) {
        pickHelper.renderPickingDebug(renderer, scene, camera);
    } else {
        renderer.render(scene, camera);
    }
}
