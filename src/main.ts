import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { isDevMode, setupDevMode } from './devMode.js';

import { UIManager } from './ui/uiManager.js';
import { PerfProbe } from './ui/perf.js';
import { PickHelper } from './scene/picking.js';
import { SceneRotator, realToScene } from './scene/sceneRotator.js';
import { ShadowSystem } from './scene/shadowSystem.js';
import type { ShadowSurfacePose } from './scene/shadowSystem.js';
import { GestureRecognizer } from './input/gestureRecognizer.js';
import { ModeManager } from './modes/modeManager.js';
import { EditMode } from './modes/editMode.js';
import { InspectMode } from './modes/inspectMode.js';
import { SpatialMappingOverlay } from './ui/spatialMappingOverlay.js';
import { ModeHistoryManager } from './history/historyManager.js';
import { TutorialEventBus } from './tutorial/tutorialEvents.js';
import { TutorialManager } from './tutorial/tutorialManager.js';
import { PlacementOverlay } from './ui/placementOverlay.js';
import { HierarchySlider } from './ui/hierarchySlider.js';

const modules = import.meta.glob('../assets/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const modelUrls: Record<string, string> = {};
for (const path in modules) {
    const filename = path.split('/').pop()!;
    modelUrls[filename] = modules[path] as string;
}
const availableModels = Object.keys(modelUrls);

/** Physical (rig-independent) pose stored on a model's userData. */
/**
 * On the preview, `physical*` is the real-world hit-test pose. On a placed
 * model it is the model's scene pose at unit rig scale (equal to the real
 * pose only if the scene was unrotated at placement), and `surface*` keeps
 * the real surface it was placed on, for its shadow receiver.
 */
interface PhysicalPose {
    physicalPosition?: THREE.Vector3;
    physicalRotation?: THREE.Quaternion;
    surfacePosition?: THREE.Vector3;
    surfaceRotation?: THREE.Quaternion;
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
let hierarchySlider: HierarchySlider;
let perf: PerfProbe;
let shadowSystem: ShadowSystem;

let gestureRecognizer: GestureRecognizer;
let modeManager: ModeManager;
let tutorial: TutorialManager;
let placementOverlay: PlacementOverlay;

/**
 * The tutorial observes the app through this bus. Emitting is the app's only
 * concession to it: modes keep owning every gesture, so a tutorial step is
 * validated by the effect the user actually saw in the scene.
 */
const tutorialEvents = new TutorialEventBus();
let editMode: EditMode;
let inspectMode: InspectMode;
let spatialMappingOverlay: SpatialMappingOverlay;
let historyManager: ModeHistoryManager;

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

    shadowSystem = new ShadowSystem(scene, renderer);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

    controller1 = renderer.xr.getController(0);
    controller1.addEventListener('select', (event) => { onSelect(event.data); });
    xrRig.add(controller1);
    controller2 = renderer.xr.getController(1);
    controller2.addEventListener('select', (event) => { onSelect(event.data); });
    xrRig.add(controller2);

    pickHelper = new PickHelper();
    placementOverlay = new PlacementOverlay(scene);
    hierarchySlider = new HierarchySlider((node, level) => {
        pickHelper.selectNode(node);
        tutorialEvents.emit({ kind: 'granularity-changed', level });
    });
    hierarchySlider.attach(document.body);
    perf = new PerfProbe({ visible: false });
    perf.mount(document.body);

    historyManager = new ModeHistoryManager('edit', (canUndo, canRedo) => {
        uiManager?.updateHistoryState(canUndo, canRedo);
    });

    uiManager = new UIManager(
        {
            onModeToggle: () => modeManager.toggle(),
            onModelSelect: (modelName) => loadModel(modelName),
            onDelete: () => deleteSelectedModel(),
            onReset: () => resetSelectedModel(),
            onInvertSelection: () => invertSelection(),
            onUndo: () => historyManager.undo(),
            onRedo: () => historyManager.redo(),
            onPerfToggle: (showPerf) => perf.setVisible(showPerf),
            onHelp: () => tutorial.toggleCheatSheet(),
        },
        availableModels,
        isDevMode  // ← active les boutons debug (perf, picking colors) en dev uniquement
    );

    uiManager.attach(document.body);
    placementOverlay.attach(document.body);
    historyManager.notifyActiveState();
    sceneRotator = new SceneRotator();

    // The tour waits for mapping: its first step places a model, which needs a
    // surface, and its cards would otherwise stack under the scan overlay.
    spatialMappingOverlay = new SpatialMappingOverlay(() => {
        if (!isDevMode) {
            modeManager.setMode('edit');
            editMode.arm();
            tutorial.offerOnFirstRun();
        } else {
            if (devModel) {
                devModel.visible = true;
            }
            // ?tutorial=1 iterates on the overlay without a headset. The AR-only
            // placement step is filtered out, since dev mode has no hit-testing.
            if (new URLSearchParams(window.location.search).get('tutorial') === '1') {
                tutorial.replay();
            }
        }
    }, isDevMode);
    spatialMappingOverlay.attach(document.body);

    // Yaw of the current two-finger gesture, so the tutorial gets deltas.
    let gestureYaw = 0;

    editMode = new EditMode({
        placeModel: () => {
            if (!spatialMappingOverlay.isComplete) {
                return false;
            }
            if (previewModel?.visible && loadedModel && previewModel.userData.placementAllowed !== false) {                
                placeModel();
                tutorialEvents.emit({ kind: 'model-placed' });
                return true;
            }
            return false;
        },
        onRigScale: (scale) => {
            updateRigScale(scale);
            tutorialEvents.emit({ kind: 'scale-changed', perceived: 1 / scale });
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
            tutorialEvents.emit({ kind: 'model-selected', selected: model !== null });
        },
        onAction: (action) => {
            historyManager.push('edit', action);
        },
        beginSceneRotation: () => {
            gestureYaw = 0;
            sceneRotator.beginGesture(xrRig, placedModels, camera);
        },
        rotateScene: (yaw, tilt) => {
            sceneRotator.applyGesture(xrRig, placedModels, yaw, tilt);

            // With nothing placed the rotation is a no-op, so it must not count
            // towards the tutorial's rotation step either.
            const deltaRad = yaw - gestureYaw;
            gestureYaw = yaw;
            if (placedModels.length > 0 && deltaRad !== 0) {
                tutorialEvents.emit({ kind: 'scene-rotated', deltaRad });
            }
        },
        getSceneTransform: () => sceneRotator.getTransform(),
        setSceneTransform: (transform) => {
            sceneRotator.setTransform(transform, xrRig);
        },
    });

    inspectMode = new InspectMode({
        pickHelper,
        pickMesh: (inputSource) => pickHelper.pickXR(inputSource, renderer, scene, perf),
        onExplode: (factor) => {
            explode(factor);
            tutorialEvents.emit({ kind: 'explode-changed', factor });
        },
        showGranularity: (chain) => {
            hierarchySlider.setHierarchy(chain);
        },
        hideGranularity: () => {
            hierarchySlider.hide();
        },
        onPartPicked: () => {
            tutorialEvents.emit({ kind: 'part-picked' });
        },
        onPartHidden: () => {
            tutorialEvents.emit({ kind: 'part-hidden' });
        },
        onAction: (action) => {
            historyManager.push('inspect', action);
        },
    });

    modeManager = new ModeManager(editMode, inspectMode, (mode) => {
        uiManager.setMode(mode);
        historyManager.setMode(mode);
        placementOverlay.setMode(mode);
        if (mode === 'inspect' && previewModel) {
            previewModel.visible = false;
            placementOverlay.hideReticle();
        }
        tutorialEvents.emit({ kind: 'mode-changed', mode });
    });

    gestureRecognizer = new GestureRecognizer(modeManager, (gesture) => {
        tutorialEvents.emit({ kind: 'gesture', gesture });
    });
    gestureRecognizer.attach(document.body);

    tutorial = new TutorialManager({
        events: tutorialEvents,
        spotlightRect: (target) => uiManager.getSpotlightRect(target),
        currentMode: () => modeManager.currentName,
        resetScene: () => {
            resetSceneState();
        },
        isDevMode,
    });
    tutorial.attach(document.body);

    if (isDevMode) {
        devTick = setupDevMode(scene, camera, renderer, uiManager, spatialMappingOverlay);
        // No AR hit-testing in dev mode, so placement is useless: inspecting
        // (picking, explode) is the relevant default.
        modeManager.setMode('inspect');
    } else {
        const arButtonOptions = {
            requiredFeatures: ['hit-test'],
            optionalFeatures: ['dom-overlay'],
            domOverlay: { root: document.body },
        };
        document.body.appendChild(ARButton.createButton(renderer, arButtonOptions));

        renderer.xr.addEventListener('sessionstart', () => {
            uiManager.toggleVisibility(true);
            spatialMappingOverlay.start();
            placementOverlay.setVisible(true);
            placementOverlay.setMode(modeManager.currentName);
        });
        renderer.xr.addEventListener('sessionend', () => {
            uiManager.toggleVisibility(false);
            perf.setVisible(false);
            tutorial.stop();
            spatialMappingOverlay.hide();
            placementOverlay.setVisible(false);
        });
    }

    if (availableModels.length > 0) {
        loadModel(availableModels[0]);
    }

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('keydown', (event) => {
        if (event.key === 'i' || event.key === 'I') {
            invertSelection();
        }
    });
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

        // Re-pivot so the model rests on its origin: bottom of the bounding
        // box at y = 0, centered in x/z. Shifting the direct children keeps the
        // root free for the placement pose, and adds no level to the hierarchy.
        const pivot = new THREE.Vector3();
        box.getCenter(pivot);
        pivot.y = box.min.y;
        for (const child of loadedModel.children) {
            child.position.sub(pivot);
        }
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
                shadowSystem.unregisterModel(devModel);
                scene.remove(devModel);
                pickHelper.removeModel(devModel);
            }
            devModel = loadedModel.clone();
            devModel.applyMatrix4(currentScaleMatrix);
            devModel.position.set(0, 1.5, -2);
            devModel.visible = spatialMappingOverlay ? spatialMappingOverlay.isComplete : true;

            // Save original transforms for the Reset action
            devModel.userData.originalPosition = devModel.position.clone();
            devModel.userData.originalQuaternion = devModel.quaternion.clone();
            devModel.userData.originalModelScale = devModel.scale.clone();

            scene.add(devModel);
            pickHelper.registerModel(devModel);

            // Desktop dev mode has no WebXR hit-test. Use the horizontal grid
            // at y = 0 as the physical support surface so shadows are testable.
            shadowSystem.registerModel(devModel, {
                position: new THREE.Vector3(devModel.position.x, 0, devModel.position.z),
                quaternion: new THREE.Quaternion(),
            });
        } else {
            // Selecting a model in the carousel arms placement: the next tap
            // in Edit mode will place it once mapping is complete.
            if (spatialMappingOverlay.isComplete) {
                modeManager.setMode('edit');
                editMode.arm();
            }
        }
    });
}

/**
 * Handles select events on the screen. The GestureRecognizer decides whether
 * this is a genuine tap (or double tap) and dispatches it to the active mode.
 */
function onSelect(inputSource?: XRInputSource): void {
    if (!renderer.xr.isPresenting || !spatialMappingOverlay.isComplete) return;

    gestureRecognizer.handleXRSelect(inputSource);
}

/**
 * Updates the scale of the camera rig and adjusts placed models' positions
 * to keep them anchored to their physical positions. Real-world anchors
 * (reticle, preview, shadow receivers) follow on the next frame.
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

    // The rig offset is in scaled units, so it follows the new scale.
    sceneRotator.refresh(xrRig);

    // Clear picking selection to prevent offset/scale mismatch while dragging
    if (pickHelper) {
        pickHelper.clearSelection();
        if (pickHelper) {
        pickHelper.clearSelection();
        hierarchySlider.hide();
    }
    }
}

/**
 * Places the full 3D model at the current location of the AR preview cursor.
 */
function placeModel(): void {
    if (!loadedModel || !previewModel) return;

    const model = loadedModel.clone();
    previewModel.matrix.decompose(model.position, model.quaternion, model.scale);
    
    // The preview already sits at the hit-test pose mapped into the (possibly
    // rotated) scene: keep that scene pose, so the model lands under the
    // reticle and then turns with the rest of the scene.
    const previewPose = previewModel.userData as PhysicalPose;
    if (previewPose.physicalPosition && previewPose.physicalRotation) {
        model.userData.physicalPosition = model.position.clone().divideScalar(rigScale);
        model.userData.physicalRotation = model.quaternion.clone();
        model.userData.surfacePosition = previewPose.physicalPosition.clone();
        model.userData.surfaceRotation = previewPose.physicalRotation.clone();
    }

    // Save original scale (including auto-fit scale) for the Reset action
    model.userData.originalModelScale = model.scale.clone();

    scene.add(model);
    placedModels.push(model);
    pickHelper.registerModel(model);

    // The invisible receiver lies on the exact real surface used for placement.
    shadowSystem.registerModel(model, shadowSurfacePose(model));

    historyManager.push('edit', {
        description: 'Placer modèle',
        undo: () => {
            if (editMode.selectedModel === model) {
                editMode.clearSelection();
                pickHelper.clearSelection();
            }
            pickHelper.removeModel(model);
            scene.remove(model);
            const idx = placedModels.indexOf(model);
            if (idx !== -1) {
                placedModels.splice(idx, 1);
            }
        },
        redo: () => {
            scene.add(model);
            placedModels.push(model);
            pickHelper.registerModel(model);
        },
    });
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

    const index = placedModels.indexOf(model);
    const wasDevModel = (model === devModel);

    // Unhighlights the model and hides the Delete/Reset buttons.
    editMode.clearSelection();
    pickHelper.clearSelection();

    pickHelper.removeModel(model);
    shadowSystem.unregisterModel(model);
    scene.remove(model);

    if (index !== -1) {
        placedModels.splice(index, 1);
    }
    if (model === devModel) {
        devModel = null;
    }

    historyManager.push('edit', {
        description: 'Supprimer modèle',
        undo: () => {
            scene.add(model);
            if (index >= 0 && index <= placedModels.length) {
                placedModels.splice(index, 0, model);
            } else {
                placedModels.push(model);
            }
            if (wasDevModel) {
                devModel = model;
            }
            pickHelper.registerModel(model);
            editMode.selectModel(model);
        },
        redo: () => {
            if (editMode.selectedModel === model) {
                editMode.clearSelection();
                pickHelper.clearSelection();
            }
            pickHelper.removeModel(model);
            scene.remove(model);
            const idx = placedModels.indexOf(model);
            if (idx !== -1) {
                placedModels.splice(idx, 1);
            }
            if (model === devModel) {
                devModel = null;
            }
        },
    });
}

/**
 * Executes the actual reset of transforms and inspect state on a model.
 */
function doResetModel(model: THREE.Object3D): void {
    // Drop Inspect-side state first: piece selection, hidden pieces, and the
    // committed explode factor (positions are restored below).
    pickHelper.clearSelection();
    inspectMode.showAllHidden(false);
    inspectMode.resetExplodeState();

    // Reset camera rig rotation and perceived scale to their default values,
    // and put every placed model back where it was placed on the real table.
    sceneRotator.reset(xrRig);
    updateRigScale(1.0);
    editMode.resetScaleState();
    reanchorModelsToSurface();

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

    // Restore the model's own pose (placed models were re-anchored above).
    if (model === devModel) {
        if (model.userData.originalPosition) {
            model.position.copy(model.userData.originalPosition as THREE.Vector3);
        }
        if (model.userData.originalQuaternion) {
            model.quaternion.copy(model.userData.originalQuaternion as THREE.Quaternion);
        }
    }
    if (model.userData.originalModelScale) {
        model.scale.copy(model.userData.originalModelScale as THREE.Vector3);
    }

    if (model === devModel) {
        shadowSystem.updateSurface(model, {
            position: new THREE.Vector3(model.position.x, 0, model.position.z),
            quaternion: new THREE.Quaternion(),
        });
    } else {
        shadowSystem.updateSurface(model, shadowSurfacePose(model));
    }
}

/**
 * Puts every placed model back on the real surface it was placed on, upright.
 *
 * A model placed while the scene was rotated keeps that rotation baked into
 * its scene pose (so it landed under the reticle); once the scene orientation
 * is reset, that pose alone would show it elsewhere, possibly on its side.
 * With an unrotated scene the real placement pose is the scene pose, scaled.
 */
function reanchorModelsToSurface(): void {
    for (const model of placedModels) {
        const pose = model.userData as PhysicalPose;
        if (!pose.surfacePosition || !pose.surfaceRotation) continue;

        pose.physicalPosition = pose.surfacePosition.clone();
        pose.physicalRotation = pose.surfaceRotation.clone();
        model.position.copy(pose.physicalPosition).multiplyScalar(rigScale);
        model.quaternion.copy(pose.physicalRotation);
        // The root turned: the cached bounding-box pivot offset is stale.
        delete model.userData.pivotOffset;
    }
}

type ModelPoses = Map<THREE.Object3D, { position: THREE.Vector3; rotation: THREE.Quaternion }>;

/** Placed models' unit-scale root poses, to undo a {@link reanchorModelsToSurface}. */
function snapshotModelPoses(): ModelPoses {
    const poses: ModelPoses = new Map();
    for (const model of placedModels) {
        const pose = model.userData as PhysicalPose;
        if (!pose.physicalPosition || !pose.physicalRotation) continue;
        poses.set(model, {
            position: pose.physicalPosition.clone(),
            rotation: pose.physicalRotation.clone(),
        });
    }
    return poses;
}

function restoreModelPoses(poses: ModelPoses): void {
    for (const [model, { position, rotation }] of poses) {
        const pose = model.userData as PhysicalPose;
        pose.physicalPosition = position.clone();
        pose.physicalRotation = rotation.clone();
        model.position.copy(position).multiplyScalar(rigScale);
        model.quaternion.copy(rotation);
        delete model.userData.pivotOffset;
    }
}

/**
 * Undoes what a tutorial run leaves behind: hidden pieces, an exploded view,
 * a rotated rig and a changed perceived scale; placed models go back where
 * they were placed.
 *
 * Unlike the Réinitialiser button this needs no selection — the tour never
 * requires one.
 */
function resetSceneState(): void {
    inspectMode.showAllHidden();
    inspectMode.resetExplodeState();
    explode(0);

    sceneRotator.reset(xrRig);
    updateRigScale(1.0);
    editMode.resetScaleState();
    reanchorModelsToSurface();
    editMode.clearSelection();
    pickHelper.clearSelection();

    // The tour's actions were recorded as it went; undoing them now would
    // replay state this reset just wiped.
    historyManager.clearAll();
}

/**
 * Inverts the current piece selection in Inspect mode (or globally).
 */
function invertSelection(): void {
    if (modeManager.currentName === 'inspect') {
        inspectMode.invertSelection();
    } else {
        pickHelper.invertSelection();
    }
}

/**
 * Resets the model currently selected in Edit mode: reassembles its parts
 * (undoing explode and hidden pieces), restores its scale, resets the rig
 * rotation and perceived scale, and puts every placed model back where it
 * was placed.
 */
function resetSelectedModel(): void {
    const model = editMode.selectedModel;
    if (!model) return;

    // Snapshot state before reset
    const prevModelPos = model.position.clone();
    const prevModelQuat = model.quaternion.clone();
    const prevModelScale = model.scale.clone();

    const meshTransforms = new Map<THREE.Mesh, {
        position: THREE.Vector3;
        quaternion: THREE.Quaternion;
        scale: THREE.Vector3;
        visible: boolean;
    }>();

    model.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const mesh = child as THREE.Mesh;
        meshTransforms.set(mesh, {
            position: mesh.position.clone(),
            quaternion: mesh.quaternion.clone(),
            scale: mesh.scale.clone(),
            visible: mesh.visible,
        });
    });

    const previousRigScale = rigScale;
    const previousSceneTransform = sceneRotator.getTransform();
    const previousModelPoses = snapshotModelPoses();
    const previousExplodeFactor = inspectMode.getExplodeFactor();

    doResetModel(model);

    historyManager.push('edit', {
        description: 'Réinitialiser modèle',
        undo: () => {
            model.position.copy(prevModelPos);
            model.quaternion.copy(prevModelQuat);
            model.scale.copy(prevModelScale);

            for (const [mesh, t] of meshTransforms) {
                mesh.position.copy(t.position);
                mesh.quaternion.copy(t.quaternion);
                mesh.scale.copy(t.scale);
                mesh.visible = t.visible;
            }

            restoreModelPoses(previousModelPoses);
            sceneRotator.setTransform(previousSceneTransform, xrRig);
            updateRigScale(previousRigScale);
            editMode.setPerceivedScale(1 / previousRigScale);
            inspectMode.setExplodeFactor(previousExplodeFactor);
            editMode.selectModel(model);
        },
        redo: () => {
            doResetModel(model);
            editMode.selectModel(model);
        },
    });
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
 * Scene pose of a placed model's shadow receiver: on the real surface it was
 * placed on, right under where the model currently appears. The scene is
 * rotated by moving the rig, so the surface must be mapped back through it,
 * or it would turn (and tilt) with the models instead of staying on the table.
 */
function shadowSurfacePose(model: THREE.Object3D): ShadowSurfacePose {
    const { surfacePosition, surfaceRotation } = model.userData as PhysicalPose;
    if (!surfacePosition || !surfaceRotation) {
        return { position: model.position, quaternion: model.quaternion };
    }

    // Where the model appears in the real world, projected onto the surface.
    xrRig.updateMatrix();
    const apparent = model.position.clone().applyMatrix4(xrRig.matrix.clone().invert());
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(surfaceRotation);
    apparent.addScaledVector(normal, -normal.dot(apparent.clone().sub(surfacePosition)));

    const pose: ShadowSurfacePose = {
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
    };
    realToScene(xrRig, apparent, surfaceRotation, pose.position, pose.quaternion);
    return pose;
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

    if (isDevMode && spatialMappingOverlay) {
        spatialMappingOverlay.updateDev(camera);
    }

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

        let hasSurface = false;
        if (hitTestSource && referenceSpace) {
            const hitTestResults = frame.getHitTestResults(hitTestSource);
            hasSurface = hitTestResults.length > 0;

            const pose = hasSurface ? hitTestResults[0].getPose(referenceSpace) : undefined;
            const posePosition = new THREE.Vector3();
            const poseRotation = new THREE.Quaternion();
            if (pose) {
                const poseScale = new THREE.Vector3();
                new THREE.Matrix4().fromArray(pose.transform.matrix).decompose(posePosition, poseRotation, poseScale);
            }

            const placementArmed =
                modeManager.currentName === 'edit' && editMode.isArmed;
            if (pose && !spatialMappingOverlay.isComplete) {
                // Still mapping: show where the surface is, but hold the ghost
                // preview until the surface has stabilized.
                placementOverlay.updateReticle(posePosition, poseRotation, xrRig, true);
                if (previewModel) previewModel.visible = false;
            } else if (pose && placementArmed && previewModel) {
                const inRange = placementOverlay.updateReticle(posePosition, poseRotation, xrRig);

                previewModel.userData.physicalPosition = posePosition.clone();
                previewModel.userData.physicalRotation = poseRotation.clone();
                previewModel.userData.placementAllowed = inRange;

                // Show the ghost preview only when placement is valid.
                previewModel.visible = inRange;

                if (inRange) {
                    // Map the real hit pose through the rig (scale and rotation)
                    realToScene(xrRig, posePosition, poseRotation, previewModel.position, previewModel.quaternion);

                    // Set scale from currentScaleMatrix (auto-fit scale)
                    const modelScale = new THREE.Vector3();
                    const modelRot = new THREE.Quaternion();
                    const modelPos = new THREE.Vector3();
                    currentScaleMatrix.decompose(modelPos, modelRot, modelScale);
                    previewModel.scale.copy(modelScale);
                }
            } else {
                if (previewModel) previewModel.visible = false;
                placementOverlay.hideReticle();
            }
        }

        if (referenceSpace && spatialMappingOverlay) {
            spatialMappingOverlay.updateWebXR(hasSurface);
        }
    }
    // Receivers are anchored to the real world: they follow every rig change
    // (rotation, scale, undo), cheaply, for the handful of placed models.
    for (const model of placedModels) {
        shadowSystem.updateSurface(model, shadowSurfacePose(model));
    }

    if (uiManager.showPickingColors) {
        pickHelper.renderPickingDebug(renderer, scene, camera);
    } else {
        renderer.render(scene, camera);
    }
}
