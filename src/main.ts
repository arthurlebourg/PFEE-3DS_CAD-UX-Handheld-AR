import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const ferrariUrl = new URL('../assets/ferrari_f40.glb', import.meta.url).href;

type Mode = 'place' | 'select';

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

let mode: Mode = 'place';

// Matrix applied on top of the hit pose to scale the placed/preview model down.
const PLACEMENT_SCALE = 0.05;
const scaleMatrix = new THREE.Matrix4().makeScale(PLACEMENT_SCALE, PLACEMENT_SCALE, PLACEMENT_SCALE);

// --- GPU color picking state -------------------------------------------------
const HIGHLIGHT_COLOR = 0xff6600;
const HIGHLIGHT_INTENSITY = 0.6;

// One pickable per sub-mesh of every placed car. The id is encoded as an RGB
// color in an off-screen render; reading back the pixel under the tap tells us
// which mesh was hit.
const pickables = new Map<number, THREE.Mesh>();
let nextPickId = 1;

let pickTarget: THREE.WebGLRenderTarget | null = null;
let pickCamera: THREE.PerspectiveCamera;
const pickPixel = new Uint8Array(4);

let selectedMesh: THREE.Mesh | null = null;

init();

function init(): void {
    container = document.createElement('div');
    document.body.appendChild(container);

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    // Used only for the off-screen picking pass; matrices are copied from the XR
    // camera at pick time, so it never updates itself.
    pickCamera = new THREE.PerspectiveCamera();
    pickCamera.matrixAutoUpdate = false;
    pickCamera.matrixWorldAutoUpdate = false;

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

    const overlay = createModeUI();
    document.body.appendChild(overlay);
    document.body.appendChild(
        ARButton.createButton(renderer, {
            requiredFeatures: ['hit-test'],
            optionalFeatures: ['dom-overlay'],
            domOverlay: { root: overlay },
        }),
    );

    const loader = new GLTFLoader();
    loader.load(ferrariUrl, (gltf) => {
        ferrariModel = gltf.scene;
        previewModel = createPreview(ferrariModel);
        scene.add(previewModel);
    });

    controller1 = renderer.xr.getController(0);
    controller1.addEventListener('select', (event) => { onSelect(event.data); });
    scene.add(controller1);

    controller2 = renderer.xr.getController(1);
    controller2.addEventListener('select', (event) => { onSelect(event.data); });
    scene.add(controller2);

    window.addEventListener('resize', onWindowResize);
}

function onSelect(inputSource?: XRInputSource): void {
    if (mode === 'place') {
        placeCar();
    } else {
        pick(inputSource);
    }
}

// --- Place mode --------------------------------------------------------------
function placeCar(): void {
    if (!previewModel?.visible || !ferrariModel) {
        return;
    }

    const model = ferrariModel.clone();
    // previewModel.matrix already bakes in the placement scale, so reuse it directly.
    previewModel.matrix.decompose(model.position, model.quaternion, model.scale);
    scene.add(model);
    registerPickables(model);
}

// Registers every sub-mesh of a freshly placed car as an individually pickable
// part, each with a unique id-color material cached for the picking pass.
function registerPickables(root: THREE.Object3D): void {
    root.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) {
            return;
        }

        const id = nextPickId++;
        const pickMaterial = new THREE.MeshBasicMaterial();
        // Treat the id bytes as already-linear so no color-space conversion
        // mangles them on the way to the (NoColorSpace) pick target.
        pickMaterial.color.setHex(id, THREE.LinearSRGBColorSpace);
        pickMaterial.toneMapped = false;

        child.userData.pickId = id;
        child.userData.pickMaterial = pickMaterial;
        pickables.set(id, child as THREE.Mesh);
    });
}

// --- Select mode (GPU color picking) ----------------------------------------
function pick(inputSource?: XRInputSource): void {
    if (pickables.size === 0) {
        return;
    }

    // Screen taps in AR arrive as a 'screen' target-ray input whose gamepad axes
    // hold the touch position in NDC ([-1, 1], y up).
    const axes = inputSource?.gamepad?.axes;
    if (inputSource?.targetRayMode !== 'screen' || !axes || axes.length < 2) {
        return;
    }
    const ndcX = axes[0];
    const ndcY = axes[1];

    const xrCamera = renderer.xr.getCamera();
    const view = xrCamera.cameras[0] ?? xrCamera;
    pickCamera.matrixWorld.copy(view.matrixWorld);
    pickCamera.matrixWorldInverse.copy(view.matrixWorldInverse);
    pickCamera.projectionMatrix.copy(view.projectionMatrix);
    pickCamera.projectionMatrixInverse.copy(view.projectionMatrixInverse);

    const target = ensurePickTarget();
    // axes are y-down (-1 at top, from the pointer's clientY) while the pick
    // target's pixels are y-up (row 0 at the bottom), so flip y on readback.
    const px = Math.floor((ndcX * 0.5 + 0.5) * target.width);
    const py = Math.floor((0.5 - ndcY * 0.5) * target.height);
    if (px < 0 || py < 0 || px >= target.width || py >= target.height) {
        return;
    }

    // Swap every pickable to its flat id-material, hide the translucent preview,
    // and render the scene off-screen from the XR viewpoint.
    const restore: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];
    for (const mesh of pickables.values()) {
        restore.push({ mesh, material: mesh.material });
        mesh.material = mesh.userData.pickMaterial as THREE.MeshBasicMaterial;
    }
    const previewWasVisible = previewModel?.visible ?? false;
    if (previewModel) {
        previewModel.visible = false;
    }

    const xrWasEnabled = renderer.xr.enabled;
    renderer.xr.enabled = false; // keep render() from overriding our pick camera
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, pickCamera);
    renderer.readRenderTargetPixels(target, px, py, 1, 1, pickPixel);
    renderer.setRenderTarget(null);
    renderer.xr.enabled = xrWasEnabled;

    for (const entry of restore) {
        entry.mesh.material = entry.material;
    }
    if (previewModel) {
        previewModel.visible = previewWasVisible;
    }

    const id = (pickPixel[0] << 16) | (pickPixel[1] << 8) | pickPixel[2];
    highlight(id === 0 ? null : (pickables.get(id) ?? null));
}

function ensurePickTarget(): THREE.WebGLRenderTarget {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (!pickTarget) {
        pickTarget = new THREE.WebGLRenderTarget(size.x, size.y);
    } else if (pickTarget.width !== size.x || pickTarget.height !== size.y) {
        pickTarget.setSize(size.x, size.y);
    }
    return pickTarget;
}

// Applies the emissive glow to the picked mesh, restoring the previous one.
// Re-picking the same mesh toggles it off.
function highlight(mesh: THREE.Mesh | null): void {
    const next = mesh === selectedMesh ? null : mesh;

    if (selectedMesh) {
        const material = selectedMesh.material as THREE.MeshStandardMaterial;
        material.emissive.copy(selectedMesh.userData.baseEmissive as THREE.Color);
        material.emissiveIntensity = selectedMesh.userData.baseEmissiveIntensity as number;
    }

    selectedMesh = next;

    if (next) {
        // Clone the material once so the glow stays isolated to this single part,
        // even though placed cars otherwise share materials.
        if (!next.userData.isolatedMaterial) {
            next.material = (next.material as THREE.Material).clone();
            next.userData.isolatedMaterial = true;
        }
        const material = next.material as THREE.MeshStandardMaterial;
        next.userData.baseEmissive = material.emissive.clone();
        next.userData.baseEmissiveIntensity = material.emissiveIntensity;
        material.emissive.setHex(HIGHLIGHT_COLOR);
        material.emissiveIntensity = HIGHLIGHT_INTENSITY;
    }
}

// --- UI ----------------------------------------------------------------------
function createModeUI(): HTMLDivElement {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;bottom:24px;left:0;width:100%;display:flex;justify-content:center;gap:12px;pointer-events:none;font-family:sans-serif;';

    const buttons: Record<Mode, HTMLButtonElement> = {
        place: makeModeButton('Place'),
        select: makeModeButton('Select'),
    };

    const setMode = (next: Mode): void => {
        mode = next;
        for (const key of Object.keys(buttons) as Mode[]) {
            buttons[key].style.opacity = key === next ? '1' : '0.5';
        }
        // The placement ghost only makes sense while placing.
        if (next === 'select' && previewModel) {
            previewModel.visible = false;
        }
    };

    buttons.place.addEventListener('click', () => { setMode('place'); });
    buttons.select.addEventListener('click', () => { setMode('select'); });
    overlay.appendChild(buttons.place);
    overlay.appendChild(buttons.select);
    setMode('place');

    return overlay;
}

function makeModeButton(label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = label;
    button.style.cssText = 'pointer-events:auto;padding:12px 24px;border:none;border-radius:24px;background:#fff;color:#000;font-size:16px;font-weight:600;';
    return button;
}

// --- Preview ghost -----------------------------------------------------------
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

        if (mode === 'place' && hitTestSource && referenceSpace && previewModel) {
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

    renderer.render(scene, camera);
}
