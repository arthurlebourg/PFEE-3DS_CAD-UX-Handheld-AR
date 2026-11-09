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
import { GestureRecognizer, HOLD_DELAY_MS } from './input/gestureRecognizer.js';
import { ModeManager } from './modes/modeManager.js';
import { SceneMode } from './modes/sceneMode.js';
import { SelectionMode } from './modes/selectionMode.js';
import { ViewController } from './scene/viewController.js';
import { ExplodeController, MAX_EXPLODE_FACTOR } from './scene/explodeController.js';
import { HiddenParts } from './scene/hiddenParts.js';
import { SpatialMappingOverlay } from './ui/spatialMappingOverlay.js';
import { HistoryStack } from './history/historyManager.js';
import { TutorialEventBus } from './tutorial/tutorialEvents.js';
import { TutorialManager } from './tutorial/tutorialManager.js';
import { PlacementOverlay } from './ui/placementOverlay.js';
import { HierarchySlider } from './ui/hierarchySlider.js';
import { ExplodeGauge } from './ui/explodeGauge.js';
import { TrashZone } from './ui/trashZone.js';
import { buildAssemblyTree, pieceMeshes, pieceOf } from './scene/assemblyTree.js';

const modules = import.meta.glob('../assets/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const modelUrls: Record<string, string> = {};
for (const path in modules) {
    const filename = path.split('/').pop()!;
    modelUrls[filename] = modules[path] as string;
}
const availableModels = Object.keys(modelUrls);

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
let explodeGauge: ExplodeGauge;
let trashZone: TrashZone;
/** Previous animation-loop timestamp, to advance the fades. */
let lastFrameTime: number | null = null;

/**
 * The tutorial observes the app through this bus. Emitting is the app's only
 * concession to it: modes keep owning every gesture, so a tutorial step is
 * validated by the effect the user actually saw in the scene.
 */
const tutorialEvents = new TutorialEventBus();
let sceneMode: SceneMode;
let selectionMode: SelectionMode;
let view: ViewController;
let explodeController: ExplodeController;
let hiddenParts: HiddenParts;
let spatialMappingOverlay: SpatialMappingOverlay;
let historyManager: HistoryStack;

/** The model being dragged, and where the drag started (see beginMove). */
interface MoveState {
    model: THREE.Object3D;
    /** Scene-space point of the support plane under the finger at the start. */
    startPoint: THREE.Vector3 | null;
    startPhysical: THREE.Vector3;
    startSurface: THREE.Vector3;
}
let move: MoveState | null = null;

/**
 * ?placementDebug=1 shows the hit-test pose and each placed model's bounding
 * box and origin, to tell on device a model sunk by its origin from a
 * misestimated plane. Off by default.
 */
const placementDebug = new URLSearchParams(window.location.search).get('placementDebug') === '1';
let debugHitAxes: THREE.AxesHelper | null = null;
/** Per placed model: a frame tracking its matrixWorld (holding its local box) and its origin axes. */
const debugModelHelpers = new Map<THREE.Object3D, { frame: THREE.Group; axes: THREE.AxesHelper }>();

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

    if (placementDebug) {
        debugHitAxes = new THREE.AxesHelper(0.05);
        debugHitAxes.visible = false;
        scene.add(debugHitAxes);
    }

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

    historyManager = new HistoryStack(50, () => {
        uiManager?.updateHistoryState(historyManager.canUndo, historyManager.canRedo);
    });

    uiManager = new UIManager(
        {
            onModelSelect: (modelName) => loadModel(modelName),
            onReset: () => resetScene(),
            onInvertSelection: () => invertSelection(),
            onShowAll: () => hiddenParts.showAll(true),
            onCloseSelection: () => clearSelection(),
            onExit: () => void renderer.xr.getSession()?.end(),
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
    uiManager.updateHistoryState(false, false);
    sceneRotator = new SceneRotator();

    explodeGauge = new ExplodeGauge(HOLD_DELAY_MS);
    explodeGauge.attach(document.body);
    trashZone = new TrashZone();
    trashZone.attach(document.body);

    // The tour waits for mapping: its first step places a model, which needs a
    // surface, and its cards would otherwise stack under the scan overlay.
    spatialMappingOverlay = new SpatialMappingOverlay(() => {
        if (!isDevMode) {
            sceneMode.arm();
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
    let gestureTilt = 0;

    view = new ViewController({
        onRigScale: (scale) => {
            updateRigScale(scale);
            tutorialEvents.emit({ kind: 'scale-changed', perceived: 1 / scale });
        },
        beginSceneRotation: () => {
            gestureYaw = 0;
            gestureTilt = 0;
            sceneRotator.beginGesture(xrRig, placedModels, camera);
        },
        rotateScene: (yaw, tilt) => {
            sceneRotator.applyGesture(xrRig, placedModels, yaw, tilt);

            // With nothing placed the rotation is a no-op, so it must not count
            // towards the tutorial's rotation steps either.
            const yawDelta = yaw - gestureYaw;
            const tiltDelta = tilt - gestureTilt;
            gestureYaw = yaw;
            gestureTilt = tilt;
            if (placedModels.length === 0) return;
            if (yawDelta !== 0) {
                tutorialEvents.emit({ kind: 'scene-rotated', deltaRad: yawDelta });
            }
            if (tiltDelta !== 0) {
                tutorialEvents.emit({ kind: 'scene-tilted', deltaRad: tiltDelta });
            }
        },
        getSceneTransform: () => sceneRotator.getTransform(),
        setSceneTransform: (transform) => {
            sceneRotator.setTransform(transform, xrRig);
        },
        onAction: (action) => {
            historyManager.push(action);
        },
    });

    explodeController = new ExplodeController({
        onLiftChange: (model) => {
            syncModelPosition(model);
        },
        onFactorChange: (_model, factor) => {
            tutorialEvents.emit({ kind: 'explode-changed', factor });
        },
        onAction: (action) => {
            historyManager.push(action);
        },
    });

    hiddenParts = new HiddenParts({
        onChange: (count) => {
            uiManager.setHiddenCount(count);
        },
        onAction: (action) => {
            historyManager.push(action);
        },
    });

    const pickMesh = (inputSource?: XRInputSource) => pickHelper.pickXR(inputSource, renderer, scene, perf);

    sceneMode = new SceneMode({
        view,
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
        pickMesh,
        selectPiece: (mesh) => {
            togglePiece(mesh);
        },
        hideJustDeselected: (mesh) => {
            if (!justDeselected.includes(mesh)) return false;
            hidePiece(mesh);
            return true;
        },
        modelAt: (x, y) => movableModelAt(x, y),
        beginMove: (model, x, y) => {
            beginMove(model, x, y);
        },
        updateMove: (x, y) => {
            updateMove(x, y);
        },
        endMove: (x, y) => {
            endMove(x, y);
        },
    });

    selectionMode = new SelectionMode({
        view,
        pickMesh,
        togglePiece: (mesh) => {
            togglePiece(mesh);
        },
        hidePiece: (mesh) => {
            hidePiece(mesh);
        },
        showHoldPending: (x, y) => {
            explodeGauge.showPending(x, y);
        },
        hideHoldFeedback: () => {
            explodeGauge.hide();
        },
        beginExplode: (x, y) => {
            beginExplode(x, y);
        },
        updateExplode: (dy) => {
            updateExplode(dy);
        },
        endExplode: () => {
            explodeController.endGesture();
            explodeGauge.hide();
        },
    });

    modeManager = new ModeManager(sceneMode, selectionMode, (mode) => {
        uiManager.setMode(mode);
        if (mode === 'selection' && previewModel) {
            previewModel.visible = false;
            placementOverlay.hideReticle();
        }
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
    } else {
        const arButtonOptions = {
            requiredFeatures: ['hit-test'],
            optionalFeatures: ['dom-overlay'],
            domOverlay: { root: document.body },
        };
        const button = ARButton.createButton(renderer, arButtonOptions);
        document.body.appendChild(button);

        renderer.xr.addEventListener('sessionstart', () => {
            // Its "STOP AR" sits bottom centre, where the toolbar goes; the
            // Quitter icon in the top-left corner replaces it in session.
            button.style.visibility = 'hidden';
            uiManager.toggleVisibility(true);
            spatialMappingOverlay.start();
            placementOverlay.setVisible(true);
        });
        renderer.xr.addEventListener('sessionend', () => {
            button.style.visibility = '';
            uiManager.toggleVisibility(false);
            perf.setVisible(false);
            tutorial.stop();
            spatialMappingOverlay.hide();
            placementOverlay.setVisible(false);
            explodeGauge.hide();
            clearSelection();
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
        groundModel(loadedModel);
        buildAssemblyTree(loadedModel, gltf.parser.associations);

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
                shadowSystem.unregisterModel(devModel);
                scene.remove(devModel);
                pickHelper.removeModel(devModel);
                removePlacementDebug(devModel);
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
            addPlacementDebug(devModel);

            // Desktop dev mode has no WebXR hit-test. Use the horizontal grid
            // at y = 0 as the physical support surface so shadows are testable.
            shadowSystem.registerModel(devModel, {
                position: new THREE.Vector3(devModel.position.x, 0, devModel.position.z),
                quaternion: new THREE.Quaternion(),
            });
        } else {
            // Choosing a model in the picker arms placement: the next tap
            // places it once mapping is complete.
            if (spatialMappingOverlay.isComplete) {
                clearSelection();
                sceneMode.arm();
            }
        }
    });
}

/**
 * Re-anchors a freshly loaded glTF so its origin sits at the bottom centre of
 * its bounding box. Placement poses the origin on the hit-test point, and CAD
 * exports are usually centred on theirs, which sank half the model into the
 * floor. Only the root's direct children move: no geometry is touched, and no
 * extra node is added (it would show up as a level in the granularity slider).
 */
function groundModel(root: THREE.Object3D): void {
    const box = localBoundingBox(root);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const offset = new THREE.Vector3(-center.x, -box.min.y, -center.z);
    for (const child of root.children) {
        child.position.add(offset);
    }
    root.updateMatrixWorld(true);
}

/**
 * Bounding box of `root`'s content in `root`'s own frame. The root transform
 * is cleared while measuring, so a pose or a CAD unit scale on it cannot skew
 * the box; `root` must be unparented or a child of the scene. Precise (per
 * vertex): the fast box inflates under rotated parts and would leave the model
 * floating.
 */
function localBoundingBox(root: THREE.Object3D): THREE.Box3 {
    const position = root.position.clone();
    const quaternion = root.quaternion.clone();
    const scale = root.scale.clone();

    root.position.set(0, 0, 0);
    root.quaternion.identity();
    root.scale.set(1, 1, 1);
    root.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(root, true);

    root.position.copy(position);
    root.quaternion.copy(quaternion);
    root.scale.copy(scale);
    root.updateMatrixWorld(true);

    return box;
}

/** Debug only: draws `model`'s local box and its origin (the placement point). */
function addPlacementDebug(model: THREE.Object3D): void {
    if (!placementDebug) return;

    // The frame replays the model's matrixWorld, so the box turns and scales
    // with it; the axes stay 5 cm whatever the model's own scale.
    const frame = new THREE.Group();
    frame.matrixAutoUpdate = false;
    frame.add(new THREE.Box3Helper(localBoundingBox(model)));
    const axes = new THREE.AxesHelper(0.05);

    scene.add(frame, axes);
    debugModelHelpers.set(model, { frame, axes });
}

function removePlacementDebug(model: THREE.Object3D): void {
    const helpers = debugModelHelpers.get(model);
    if (!helpers) return;

    scene.remove(helpers.frame, helpers.axes);
    (helpers.frame.children[0] as THREE.Box3Helper).dispose();
    helpers.axes.dispose();
    debugModelHelpers.delete(model);
}

/** Debug only: follows placed models (hidden while deleted / undone). */
function updatePlacementDebug(): void {
    for (const [model, { frame, axes }] of debugModelHelpers) {
        const shown = model.parent !== null;
        frame.visible = shown;
        axes.visible = shown;
        if (!shown) continue;

        model.updateWorldMatrix(true, false);
        frame.matrix.copy(model.matrixWorld);
        frame.matrixWorldNeedsUpdate = true;
        axes.position.copy(model.position);
        axes.quaternion.copy(model.quaternion);
    }
}

/** Debug only: the raw hit-test pose, armed or not, in the same frame as the preview. */
function showDebugHitPose(pose: XRPose | undefined): void {
    if (!debugHitAxes) return;

    debugHitAxes.visible = pose !== undefined;
    if (!pose) return;

    const { position, orientation } = pose.transform;
    realToScene(
        xrRig,
        new THREE.Vector3(position.x, position.y, position.z),
        new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w),
        debugHitAxes.position,
        debugHitAxes.quaternion,
    );
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
 * (reticle, preview, shadow receivers) follow on the next frame. The
 * selection survives: zooming is a view gesture, available in every state.
 */
function updateRigScale(newScale: number): void {
    rigScale = newScale;

    if (xrRig) {
        xrRig.scale.set(rigScale, rigScale, rigScale);
    }

    for (const model of placedModels) {
        syncModelPosition(model);
    }

    // The rig offset is in scaled units, so it follows the new scale.
    sceneRotator.refresh(xrRig);
}

/**
 * Puts a model root where its pose says: its unit-scale placement pose
 * (`physicalPosition`, or the dev model's original position) times the rig
 * scale, plus the exploded view's lift.
 */
function syncModelPosition(model: THREE.Object3D): void {
    const { physicalPosition } = model.userData as PhysicalPose;
    if (physicalPosition) {
        model.position.copy(physicalPosition).multiplyScalar(rigScale);
    } else if (model.userData.originalPosition) {
        model.position.copy(model.userData.originalPosition as THREE.Vector3);
    } else {
        return;
    }
    model.position.add(explodeController.liftOffset(model, new THREE.Vector3()));
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

    scene.add(model);
    placedModels.push(model);
    pickHelper.registerModel(model);
    addPlacementDebug(model);

    // The invisible receiver lies on the exact real surface used for placement.
    shadowSystem.registerModel(model, shadowSurfacePose(model));

    historyManager.push({
        description: 'Placer modèle',
        undo: () => {
            removeModel(model);
        },
        redo: () => {
            restoreModel(model, placedModels.length);
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

/** Takes a model out of the scene (delete, or undoing its placement). */
function removeModel(model: THREE.Object3D): void {
    pickHelper.removeModel(model);
    shadowSystem.unregisterModel(model);
    scene.remove(model);

    const index = placedModels.indexOf(model);
    if (index !== -1) {
        placedModels.splice(index, 1);
    }
    if (model === devModel) {
        devModel = null;
    }
    syncState();
}

/** Puts a removed model back, at its former place in the list. */
function restoreModel(model: THREE.Object3D, index: number): void {
    scene.add(model);
    placedModels.splice(Math.min(index, placedModels.length), 0, model);
    pickHelper.registerModel(model);
    shadowSystem.registerModel(model, shadowSurfacePose(model));
}

/** Deletes a placed model (dropped on the trash), as one undoable step. */
function deleteModel(model: THREE.Object3D): void {
    const index = placedModels.indexOf(model);
    if (index === -1) return;

    removeModel(model);
    tutorialEvents.emit({ kind: 'model-deleted' });

    historyManager.push({
        description: 'Supprimer modèle',
        undo: () => {
            restoreModel(model, index);
        },
        redo: () => {
            removeModel(model);
        },
    });
}

// -----------------------------------------------------------------------------
// Selection: the state follows it
// -----------------------------------------------------------------------------

/** Scene when nothing is selected, Selection otherwise. */
function syncState(): void {
    const selecting = pickHelper.selectedMeshes.length > 0;
    if (!selecting) {
        hierarchySlider.hide();
        pickHelper.clearContextDimming();
    }
    modeManager.setMode(selecting ? 'selection' : 'scene');
}

/** The piece the last tap dropped from the selection, for a double tap on it. */
let justDeselected: THREE.Mesh[] = [];

/**
 * Toggles the tapped piece in the selection (a new piece also opens the
 * granularity slider on its ancestor chain); a tap on empty space (null)
 * clears the selection.
 */
function togglePiece(mesh: THREE.Mesh | null): void {
    justDeselected = [];
    if (mesh) {
        const isNewSelection = !pickHelper.selectedMeshes.includes(mesh);
        if (!isNewSelection) {
            const piece = pieceOf(mesh);
            justDeselected = piece ? pieceMeshes(piece) : [mesh];
        }
        pickHelper.handleMeshSelection(mesh);
        if (isNewSelection) {
            hierarchySlider.setHierarchy(pickHelper.getSelectableAncestorChain(mesh));
        }
        tutorialEvents.emit({ kind: 'part-picked' });
    } else {
        pickHelper.clearSelection();
    }
    syncState();
}

function clearSelection(): void {
    pickHelper.clearSelection();
    syncState();
}

/**
 * Inverts the piece selection: selects unselected visible meshes, deselects
 * selected ones.
 */
function invertSelection(): void {
    pickHelper.invertSelection();
    syncState();
}

/** Hides the double-tapped piece (all its primitives), with a fade. */
function hidePiece(mesh: THREE.Mesh): void {
    const piece = pieceOf(mesh);
    const meshes = piece ? pieceMeshes(piece) : [mesh];

    // The first tap of the double already selected the piece; undo that so
    // it doesn't come back highlighted when it is shown again.
    for (const part of meshes) {
        pickHelper.deselectMesh(part);
    }
    hiddenParts.hide(meshes);
    tutorialEvents.emit({ kind: 'part-hidden' });
    syncState();
}

// -----------------------------------------------------------------------------
// Exploded view: hold, then slide up / down
// -----------------------------------------------------------------------------

/** Share of the screen height a slide covers from assembled to fully exploded. */
const EXPLODE_SLIDE_FRACTION = 0.4;

let explodeModels: THREE.Object3D[] = [];

/** The models holding the selection, in placement order. */
function selectionModels(): THREE.Object3D[] {
    const models = new Set<THREE.Object3D>();
    for (const mesh of pickHelper.selectedMeshes) {
        const model = findRootPlacedModel(mesh);
        if (model) models.add(model);
    }
    return [...models];
}

function beginExplode(x: number, y: number): void {
    explodeModels = selectionModels();
    if (explodeModels.length === 0) {
        explodeGauge.hide();
        return;
    }

    explodeController.beginGesture(explodeModels);
    navigator.vibrate?.(10);
    explodeGauge.showActive(x, y, explodeController.getFactor(explodeModels[0]) / MAX_EXPLODE_FACTOR);
}

function updateExplode(dy: number): void {
    if (explodeModels.length === 0) return;

    const delta = (-dy / (window.innerHeight * EXPLODE_SLIDE_FRACTION)) * MAX_EXPLODE_FACTOR;
    explodeController.updateGesture(delta);
    explodeGauge.setValue(explodeController.getFactor(explodeModels[0]) / MAX_EXPLODE_FACTOR);
}

// -----------------------------------------------------------------------------
// Moving a model: one-finger drag along the real surface, trash to delete
// -----------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();

/** The placed model under a screen point (CSS pixels), if it can be moved. */
function movableModelAt(x: number, y: number): THREE.Object3D | null {
    // pickAt takes XR screen axes, whose Y points down (top = -1), not NDC.
    const axisX = (x / window.innerWidth) * 2 - 1;
    const axisY = (y / window.innerHeight) * 2 - 1;
    const mesh = pickHelper.pickAt(axisX, axisY, renderer, scene, perf);
    const model = mesh ? findRootPlacedModel(mesh) : null;
    // Only placed models know the real surface they slide on.
    return model && (model.userData as PhysicalPose).surfacePosition ? model : null;
}

/** The real surface a model was placed on, as a plane in scene coordinates. */
function supportPlane(model: THREE.Object3D): THREE.Plane {
    const { surfacePosition, surfaceRotation } = model.userData as PhysicalPose;
    const point = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    realToScene(xrRig, surfacePosition!, surfaceRotation!, point, rotation);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
}

/** Where the ray under a screen point (CSS pixels) meets a scene-space plane. */
function planePointAt(x: number, y: number, plane: THREE.Plane): THREE.Vector3 | null {
    const xrCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : null;
    const viewCamera = xrCamera?.cameras[0] ?? camera;
    const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, 1 - (y / window.innerHeight) * 2);
    raycaster.setFromCamera(ndc, viewCamera);
    return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
}

/** Scene point to the real world, through the rig (the inverse of realToScene). */
function sceneToReal(point: THREE.Vector3): THREE.Vector3 {
    xrRig.updateMatrix();
    return point.clone().applyMatrix4(xrRig.matrix.clone().invert());
}

let movePlane: THREE.Plane | null = null;

function beginMove(model: THREE.Object3D, x: number, y: number): void {
    const pose = model.userData as PhysicalPose;
    movePlane = supportPlane(model);
    move = {
        model,
        startPoint: planePointAt(x, y, movePlane),
        startPhysical: pose.physicalPosition!.clone(),
        startSurface: pose.surfacePosition!.clone(),
    };
    trashZone.show();
    uiManager.setMoving(true);
}

/** Sets a model's placement pose: unit-scale scene position and real surface point. */
function setModelPlacement(model: THREE.Object3D, physical: THREE.Vector3, surface: THREE.Vector3): void {
    const pose = model.userData as PhysicalPose;
    pose.physicalPosition = physical.clone();
    pose.surfacePosition = surface.clone();
    syncModelPosition(model);
}

/**
 * Slides the model with the finger, along the real surface: the scene offset
 * moves its unit-scale pose, and the same offset taken back to the real world
 * moves the surface point its shadow receiver hangs on.
 */
function updateMove(x: number, y: number): void {
    if (!move) return;
    trashZone.setHot(trashZone.contains(x, y));

    const point = move.startPoint && movePlane ? planePointAt(x, y, movePlane) : null;
    if (!move.startPoint || !point) return;

    const sceneDelta = point.clone().sub(move.startPoint);
    const realDelta = sceneToReal(point).sub(sceneToReal(move.startPoint));
    setModelPlacement(
        move.model,
        move.startPhysical.clone().addScaledVector(sceneDelta, 1 / rigScale),
        move.startSurface.clone().add(realDelta),
    );
}

function endMove(x: number, y: number): void {
    if (!move) return;
    const { model, startPhysical, startSurface } = move;
    const droppedOnTrash = trashZone.contains(x, y);
    move = null;
    movePlane = null;
    trashZone.hide();
    uiManager.setMoving(false);

    const pose = model.userData as PhysicalPose;
    const endPhysical = pose.physicalPosition!.clone();
    const endSurface = pose.surfacePosition!.clone();

    if (droppedOnTrash) {
        // Deleted from where it was picked up, so undoing brings it back there.
        setModelPlacement(model, startPhysical, startSurface);
        deleteModel(model);
        return;
    }

    if (endSurface.distanceTo(startSurface) < 0.001) return;

    tutorialEvents.emit({ kind: 'model-moved' });
    historyManager.push({
        description: 'Déplacer modèle',
        undo: () => {
            setModelPlacement(model, startPhysical, startSurface);
        },
        redo: () => {
            setModelPlacement(model, endPhysical, endSurface);
        },
    });
}

// -----------------------------------------------------------------------------
// Réinitialiser: the whole scene back to zero, as one undoable step
// -----------------------------------------------------------------------------

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
        model.quaternion.copy(pose.physicalRotation);
        syncModelPosition(model);
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
        model.quaternion.copy(rotation);
        syncModelPosition(model);
        delete model.userData.pivotOffset;
    }
}

/** Every model in the scene, the dev model included. */
function allModels(): THREE.Object3D[] {
    return devModel ? [...placedModels, devModel] : placedModels;
}

/**
 * Everything back to zero: no selection, every piece shown, every model
 * reassembled (and set back down) and back where it was placed, upright, and
 * the view unrotated at 100%.
 */
function doResetScene(): void {
    clearSelection();
    hiddenParts.showAll();
    for (const model of allModels()) {
        explodeController.setFactor(model, 0);
    }

    sceneRotator.reset(xrRig);
    updateRigScale(1.0);
    view.resetScaleState();
    reanchorModelsToSurface();
}

/** Réinitialiser: {@link doResetScene}, as one undoable step. */
function resetScene(): void {
    const previousRigScale = rigScale;
    const previousSceneTransform = sceneRotator.getTransform();
    const previousModelPoses = snapshotModelPoses();
    const previousFactors = new Map(allModels().map((model) => [model, explodeController.getFactor(model)]));
    const previouslyHidden = [...hiddenParts.meshes];

    doResetScene();

    historyManager.push({
        description: 'Réinitialiser',
        undo: () => {
            restoreModelPoses(previousModelPoses);
            sceneRotator.setTransform(previousSceneTransform, xrRig);
            view.setPerceivedScale(1 / previousRigScale);
            for (const [model, factor] of previousFactors) {
                explodeController.setFactor(model, factor);
            }
            hiddenParts.rehide(previouslyHidden);
        },
        redo: () => {
            doResetScene();
        },
    });
}

/**
 * Undoes what a tutorial run leaves behind, without recording it: the tour's
 * actions were recorded as it went, and undoing them now would replay state
 * this reset just wiped.
 */
function resetSceneState(): void {
    doResetScene();
    historyManager.clear();
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

    hiddenParts.tick(lastFrameTime === null ? 0 : _timestamp - lastFrameTime);
    lastFrameTime = _timestamp;

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

            if (debugHitAxes) {
                showDebugHitPose(pose);
            }

            const placementArmed =
                modeManager.currentName === 'scene' && sceneMode.isArmed;
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
    if (placementDebug) {
        updatePlacementDebug();
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
