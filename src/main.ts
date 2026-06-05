import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { UIManager } from './ui.js';
import { PickHelper } from './picking.js';
import { PerfProbe } from './perf.js';

const modules = import.meta.glob('../assets/*.glb', { eager: true, query: '?url', import: 'default' });
const modelUrls: Record<string, string> = {};
for (const path in modules) {
    const filename = path.split('/').pop()!;
    modelUrls[filename] = modules[path] as string;
}
const availableModels = Object.keys(modelUrls);

const currentScaleMatrix = new THREE.Matrix4().makeScale(1, 1, 1);
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

let uiManager: UIManager;
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
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    // No MSAA: the full-resolution resolve every frame is a major fill cost on
    // mobile, and WebXR applies its own AA to the composited layer.
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setAnimationLoop(animate);
    renderer.xr.enabled = true;
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
    scene.add(controller1);
    controller2 = renderer.xr.getController(1);
    controller2.addEventListener('select', (event) => { onSelect(event.data); });
    scene.add(controller2);

    pickHelper = new PickHelper();
    perf = new PerfProbe({ visible: false });
    perf.mount(document.body);

    uiManager = new UIManager(
        (isPlacement) => {
            if (!isPlacement && previewModel) {
                previewModel.visible = false;
            }
        },
        () => {
        },
        (modelName) => {
            loadModel(modelName);
        },
        (showPerf) => {
            perf.setVisible(showPerf);
        },
        availableModels
    );
    
    uiManager.attach(document.body);

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
        
        if (uiManager) {
            uiManager.forcePlacementMode(true);
        }
    });
}

/**
 * Handles select events on the screen, triggering GPU picking and piece selection.
 */
function onSelect(inputSource?: XRInputSource): void {
    if (!renderer.xr.isPresenting) return;

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
 * Places the full 3D model at the current location of the AR preview cursor.
 */
function placeModel(): void {
    if (!loadedModel || !previewModel) return;

    const model = loadedModel.clone();
    previewModel.matrix.decompose(model.position, model.quaternion, model.scale);
    scene.add(model);

    pickHelper.registerModel(model);
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
    perf.frame(_timestamp);

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
                    previewModel.matrix.fromArray(pose.transform.matrix).multiply(currentScaleMatrix);
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
