import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { UIManager } from './ui.js';
import { PickHelper } from './picking.js';

const modelUrl = new URL('../assets/ferrari_f40.glb', import.meta.url).href;

let container: HTMLDivElement;
let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let renderer: THREE.WebGLRenderer;
let controller1: THREE.XRTargetRaySpace;
let controller2: THREE.XRTargetRaySpace;

let loadedModel: THREE.Object3D | null = null;
let previewModel: THREE.Object3D | null = null;

let hitTestSource: XRHitTestSource | null = null;
let hitTestSourceRequested = false;

const PLACEMENT_SCALE = 0.2;
const scaleMatrix = new THREE.Matrix4().makeScale(PLACEMENT_SCALE, PLACEMENT_SCALE, PLACEMENT_SCALE);

let uiManager: UIManager;
let pickHelper: PickHelper;

init();

/**
 * Initializes the Three.js scene, WebXR session, lights, and loads the 3D model.
 */
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

    // Controllers
    controller1 = renderer.xr.getController(0);
    scene.add(controller1);
    controller2 = renderer.xr.getController(1);
    scene.add(controller2);

    // Helpers
    pickHelper = new PickHelper();
    
    uiManager = new UIManager(
        (isPlacement) => {
            if (!isPlacement && previewModel) {
                previewModel.visible = false;
            }
        },
        () => {
        }
    );
    
    uiManager.attach(document.body);

    // AR Button & DOM Overlay
    const arButtonOptions = {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: document.body }
    };
    document.body.appendChild(ARButton.createButton(renderer, arButtonOptions));

    // XREvents
    renderer.xr.addEventListener('sessionstart', () => uiManager.toggleVisibility(true));
    renderer.xr.addEventListener('sessionend', () => uiManager.toggleVisibility(false));


    const loader = new GLTFLoader();
    loader.load(modelUrl, (gltf) => {
        loadedModel = gltf.scene;
        
        loadedModel.traverse((child) => {
            if (child instanceof THREE.Mesh && child.material) {
                child.material = child.material.clone();
            }
        });

        previewModel = createPreview(loadedModel);
        scene.add(previewModel);
    });

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('touchstart', onTouchStart);
}

/**
 * Handles touch events on the screen, triggering GPU picking and piece selection.
 */
function onTouchStart(event: TouchEvent): void {
    if (!renderer.xr.isPresenting || event.touches.length === 0) return;

    const touch = event.touches[0];
    const pickedMesh = pickHelper.pick(touch.clientX, touch.clientY, renderer, camera);

    if (pickedMesh) {
        pickHelper.handleMeshSelection(pickedMesh, camera);
    } else {
        if (pickHelper.attachedParts.length > 0) {
            pickHelper.attachedParts = [];
        } else if (pickHelper.selectedMeshes.length > 0) {
            pickHelper.clearSelection();
        } else if (uiManager.isPlacementMode && previewModel?.visible && loadedModel) {
            placeModel();
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
    scene.add(model);

    const pickingModel = pickHelper.createPickingModel(model);
    pickingModel.position.copy(model.position);
    pickingModel.quaternion.copy(model.quaternion);
    pickingModel.scale.copy(model.scale);
    pickHelper.pickingScene.add(pickingModel);

    if (uiManager.isPlacementMode) {
        uiManager.forcePlacementMode(false);
    }
}

/**
 * Creates a semi-transparent version of the 3D model for placement preview.
 */
function createPreview(source: THREE.Object3D): THREE.Object3D {
    const preview = source.clone();
    preview.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || !child.material) return;
        const makeGhost = (mat: THREE.Material): THREE.Material => {
            const ghost = mat.clone();
            ghost.transparent = true;
            ghost.opacity = 0.4;
            ghost.depthWrite = true;
            return ghost;
        };
        const material = child.material;
        child.material = Array.isArray(material) ? material.map(makeGhost) : makeGhost(material);
    });
    preview.matrixAutoUpdate = false;
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
                    previewModel.matrix.fromArray(pose.transform.matrix).multiply(scaleMatrix);
                }
            } else {
                previewModel.visible = false;
            }
        }
    }

    pickHelper.updateAttachedMeshes(camera);

    if (uiManager.showPickingColors) {
        const oldToneMapping = renderer.toneMapping;
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.render(pickHelper.pickingScene, camera);
        renderer.toneMapping = oldToneMapping;
    } else {
        renderer.render(scene, camera);
    }
}
