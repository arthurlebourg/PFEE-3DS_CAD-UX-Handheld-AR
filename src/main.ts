import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { isDevMode, setupDevMode } from './devMode.js';

import { UIManager } from './ui.js';
import { PickHelper } from './picking.js';
import { PerfProbe } from './perf.js';
import { JoystickWidget } from './joystickWidget.js';
import { SceneRotator } from './sceneRotator.js';
import { GestureRecognizer } from './gestureRecognizer.js';
import { ModeManager } from './modeManager.js';
import { EditMode } from './editMode.js';
import { InspectMode } from './inspectMode.js';

const modules = import.meta.glob('../assets/*.glb', { eager: true, query: '?url', import: 'default' });
const modelUrls: Record<string, string> = {};
for (const path in modules) {
    const filename = path.split('/').pop()!;
    modelUrls[filename] = modules[path] as string;
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
let sceneRotator: SceneRotator;
let pickHelper: PickHelper;
let perf: PerfProbe;

let gestureRecognizer: GestureRecognizer;
let modeManager: ModeManager;
let editMode: EditMode;
let inspectMode: InspectMode;

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
        () => {
            modeManager.toggle();
        },
        () => {},
        (modelName) => {
            loadModel(modelName);
        },
        (showPerf) => {
            perf.setVisible(showPerf);
        },
        () => {
            deleteSelectedModel();
        },
        () => {
            resetSelectedModel();
        },
        availableModels,
        isDevMode  // ← active les boutons debug (perf, picking colors) en dev uniquement
    );

    uiManager.attach(document.body);
    sceneRotator = new SceneRotator();

    const joystick = new JoystickWidget((strength) => {
        const maxSpeed = 0.06;

        sceneRotator.rotateAroundCenter(
            xrRig,
            placedModels,
            strength * maxSpeed,
        );
    });
    joystick.attach(document.body);

    editMode = new EditMode({
        joystick,
        placeModel: () => {
            if (previewModel?.visible && loadedModel) {
                placeModel();
                return true;
            }
            return false;
        },
        onRigScale: (scale) => {
            updateRigScale(scale);
        },
        pickModel: (inputSource) => {
            const mesh = pickHelper.pickXR(inputSource, renderer, scene, perf);
            return mesh ? findRootPlacedModel(mesh) : null;
        },
        highlightModel: (model) => {
            pickHelper.highlightModel(model);
        },
        unhighlightModel: (model) => {
            pickHelper.unhighlightModel(model);
        },
        onSelectionChange: (model) => {
            uiManager.setModelActionsVisible(model !== null);
        },
    });

    inspectMode = new InspectMode({
        pickHelper,
        pickMesh: (inputSource) => pickHelper.pickXR(inputSource, renderer, scene, perf),
        getCamera: () => camera,
        onExplode: (factor) => {
            explode(factor);
        },
    });

    modeManager = new ModeManager(editMode, inspectMode, (mode) => {
        uiManager.setMode(mode);
        if (mode === 'inspect' && previewModel) {
            previewModel.visible = false;
        }
    });

    gestureRecognizer = new GestureRecognizer(modeManager);
    gestureRecognizer.attach(document.body);

    if (isDevMode) {
        devTick = setupDevMode(scene, camera, renderer, uiManager);
        // No AR hit-testing in dev mode, so placement is useless: inspecting
        // (picking, explode) is the relevant default.
        modeManager.setMode('inspect');
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

            // Save original transforms for the Reset action
            devModel.userData.originalPosition = devModel.position.clone();
            devModel.userData.originalQuaternion = devModel.quaternion.clone();
            devModel.userData.originalModelScale = devModel.scale.clone();

            scene.add(devModel);
            pickHelper.registerModel(devModel);
        } else {
            // Selecting a model in the carousel arms placement: the next tap
            // in Edit mode will place it.
            modeManager.setMode('edit');
            editMode.arm();
        }
    });
}

/**
 * Handles select events on the screen. The GestureRecognizer decides whether
 * this is a genuine tap (or double tap) and dispatches it to the active mode.
 */
function onSelect(inputSource?: XRInputSource): void {
    if (!renderer.xr.isPresenting) return;

    gestureRecognizer.handleXRSelect(inputSource);
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

    // Save original scale (including auto-fit scale) for the Reset action
    model.userData.originalModelScale = model.scale.clone();

    scene.add(model);
    placedModels.push(model);
    pickHelper.registerModel(model);
    sceneRotator.refresh(xrRig, placedModels);
}

/**
 * Finds the root placed model (or the dev model) containing a given child.
 */
function findRootPlacedModel(object: THREE.Object3D): THREE.Object3D | null {
    let curr: THREE.Object3D | null = object;
    while (curr) {
        if (placedModels.includes(curr) || curr === devModel) {
            return curr;
        }
        curr = curr.parent;
    }
    return null;
}

/**
 * Deletes the model currently selected in Edit mode from the scene.
 */
function deleteSelectedModel(): void {
    const model = editMode.selectedModel;
    if (!model) return;

    // Unhighlights the model and hides the Delete/Reset buttons.
    editMode.clearSelection();
    pickHelper.clearSelection();

    pickHelper.removeModel(model);
    scene.remove(model);

    const index = placedModels.indexOf(model);
    if (index !== -1) {
        placedModels.splice(index, 1);
    }
    if (model === devModel) {
        devModel = null;
    }

    sceneRotator.refresh(xrRig, placedModels);
}

/**
 * Resets the model currently selected in Edit mode: reassembles its parts
 * (undoing explode, camera-attached drags and hidden pieces), restores its
 * original pose and scale, and resets the rig rotation and perceived scale.
 */
function resetSelectedModel(): void {
    const model = editMode.selectedModel;
    if (!model) return;

    // Drop Inspect-side state first: piece selection, hidden pieces, and the
    // committed explode factor (positions are restored below).
    pickHelper.clearSelection();
    inspectMode.showAllHidden();
    inspectMode.resetExplodeState();

    // Reset camera rig rotation and perceived scale to their default values.
    sceneRotator.reset(xrRig);
    updateRigScale(1.0);
    editMode.resetScaleState();

    // Restore every part's original local transform (saved at registration).
    model.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        if (child.userData.originalPosition) {
            child.position.copy(child.userData.originalPosition as THREE.Vector3);
        }
        if (child.userData.originalQuaternion) {
            child.quaternion.copy(child.userData.originalQuaternion as THREE.Quaternion);
        }
        if (child.userData.originalScale) {
            child.scale.copy(child.userData.originalScale as THREE.Vector3);
        }
    });

    // Restore the model's own pose and scale.
    if (model === devModel) {
        if (model.userData.originalPosition) {
            model.position.copy(model.userData.originalPosition as THREE.Vector3);
        }
        if (model.userData.originalQuaternion) {
            model.quaternion.copy(model.userData.originalQuaternion as THREE.Quaternion);
        }
    } else {
        const pose = model.userData as PhysicalPose;
        if (pose.physicalPosition && pose.physicalRotation) {
            model.position.copy(pose.physicalPosition);
            model.quaternion.copy(pose.physicalRotation);
        }
    }
    if (model.userData.originalModelScale) {
        model.scale.copy(model.userData.originalModelScale as THREE.Vector3);
    }

    sceneRotator.refresh(xrRig, placedModels);
}

/**
 * Applies an exploded-view offset to every placed (and, in dev mode, the dev)
 * model. A factor of 0 restores the assembled pose; higher factors push each
 * part radially outward from its own model's center.
 */
function explode(factor: number): void {
    const models = devModel ? [...placedModels, devModel] : placedModels;

    for (const model of models) {
        prepareExplode(model);

        model.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            const rest = child.userData.explodeRest as THREE.Vector3 | undefined;
            const dir = child.userData.explodeDir as THREE.Vector3 | undefined;
            if (!rest || !dir) return;

            child.position.copy(rest).addScaledVector(dir, factor);
        });
    }
}

/**
 * Caches, once per model, each part's assembled local position and the radial
 * direction (in that part's parent local space) that points away from the
 * model center. Precomputing keeps the per-gesture {@link explode} pass cheap.
 */
function prepareExplode(model: THREE.Object3D): void {
    if (model.userData.explodePrepared) return;

    model.updateWorldMatrix(true, true);
    const modelCenter = new THREE.Box3()
        .setFromObject(model)
        .getCenter(new THREE.Vector3());

    const meshCenter = new THREE.Vector3();
    const offset = new THREE.Vector3();
    const parentInverse = new THREE.Matrix4();
    const toParentLocal = new THREE.Matrix3();

    model.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const mesh = child as THREE.Mesh;

        mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox;
        if (!box) return;

        // World-space center of this part...
        box.getCenter(meshCenter).applyMatrix4(mesh.matrixWorld);
        // ...as a radial offset from the model center, rotated/scaled into the
        // part's parent local frame so it adds straight onto mesh.position.
        offset.copy(meshCenter).sub(modelCenter);
        if (mesh.parent) {
            parentInverse.copy(mesh.parent.matrixWorld).invert();
            toParentLocal.setFromMatrix4(parentInverse);
            offset.applyMatrix3(toParentLocal);
        }

        mesh.userData.explodeRest = mesh.position.clone();
        mesh.userData.explodeDir = offset.clone();
    });

    model.userData.explodePrepared = true;
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

            const placementArmed =
                modeManager.currentName === 'edit' && editMode.isArmed;
            if (hitTestResults.length > 0 && placementArmed) {
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
