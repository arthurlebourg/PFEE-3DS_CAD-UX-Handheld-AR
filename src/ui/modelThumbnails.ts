import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Same glob as main.ts: Vite dedupes the assets, so these are the very URLs
// the placement pipeline loads (and the browser cache serves them twice).
const modules = import.meta.glob('../../assets/*.glb', { eager: true, query: '?url', import: 'default' });
const modelUrls: Record<string, string> = {};
for (const path in modules) {
    const filename = path.split('/').pop()!;
    modelUrls[filename] = modules[path];
}

/** Thumbnail edge in pixels: cards are ~120-160 CSS px wide on phones. */
const RENDER_SIZE = 256;
/** The live preview spins at this rate; the AR scene keeps the GPU budget. */
const LIVE_INTERVAL_MS = 50;
const LIVE_SPEED_RAD_PER_S = 0.6;
/** Breathing room between two GLB parses, so AR frames get through. */
const QUEUE_PAUSE_MS = 300;
/** Background preloading waits for the browser to be idle, at most this long. */
const PRELOAD_IDLE_TIMEOUT_MS = 5000;
const CAMERA_FOV = 35;
/** Camera direction: three-quarter view from slightly above. */
const VIEW_DIRECTION = new THREE.Vector3(1, 0.6, 1.2).normalize();
/** Bump when the rendering changes, to drop every stored thumbnail. */
const CACHE_NAME = 'model-thumbnails-v1';

export type ThumbnailResult = (model: string, url: string | null) => void;

// -----------------------------------------------------------------------------
// Snapshots: one app-wide queue, fed in the background from launch
// -----------------------------------------------------------------------------

/**
 * Session cache, blob URL per model; `null` records a model that failed to load.
 * Bounded by the model count, a few tens of KB per entry.
 */
const snapshotCache = new Map<string, string | null>();
/** Open pickers, told about every snapshot as it lands. */
const listeners = new Set<ThumbnailResult>();

let queue: string[] = [];
let pumping = false;
let preloadScheduled = false;

/**
 * Renders every model's thumbnail in the background, once the browser is idle
 * after launch, so the picker opens on ready images. Thumbnails are also stored
 * in the Cache Storage, keyed by the hashed GLB URL: later launches read them
 * back without parsing any GLB, and a changed model gets a fresh one.
 */
export function preloadThumbnails(models: string[]): void {
    if (preloadScheduled) return;
    preloadScheduled = true;

    const start = () => {
        void prunePersisted();
        for (const model of models) enqueue(model, false);
    };
    // Typed as always present, yet missing from Safari.
    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(start, { timeout: PRELOAD_IDLE_TIMEOUT_MS });
    } else {
        setTimeout(start, 2000);
    }
}

/** Queues a snapshot; `urgent` (a card on screen) jumps ahead of the preload. */
function enqueue(model: string, urgent: boolean): void {
    if (snapshotCache.has(model)) return;
    const queued = queue.includes(model);
    if (queued && !urgent) return;
    queue = queued ? queue.filter((name) => name !== model) : queue;
    if (urgent) queue.unshift(model);
    else queue.push(model);
    void pump();
}

async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;

    while (queue.length > 0) {
        const model = queue.shift()!;
        if (snapshotCache.has(model)) continue;

        const result = await produce(model);
        // `undefined`: no renderer this time; not cached, so a later request retries.
        if (result !== undefined) snapshotCache.set(model, result);
        for (const listener of listeners) listener(model, result ?? null);

        if (queue.length > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, QUEUE_PAUSE_MS));
        }
    }

    pumping = false;
    releaseStageIfIdle();
}

/** Stored thumbnail first; otherwise parse, render once, store. */
async function produce(model: string): Promise<string | null | undefined> {
    const url = modelUrls[model];
    if (!url) return null;

    const stored = await readPersisted(url);
    if (stored) return URL.createObjectURL(stored);

    let pivot: THREE.Group;
    try {
        pivot = await loadModel(url);
    } catch (error) {
        console.warn(`[ModelPicker] Preview unavailable for ${model}:`, error);
        return null;
    }

    try {
        const blob = await snapshotBlob(pivot);
        if (!blob) return undefined;
        void writePersisted(url, blob);
        return URL.createObjectURL(blob);
    } finally {
        disposeObject(pivot);
    }
}

async function snapshotBlob(pivot: THREE.Group): Promise<Blob | null> {
    const source = getStage()?.render(pivot);
    if (!source) return null;

    // Copy within the same task: the WebGL drawing buffer is not preserved.
    const scratch = document.createElement('canvas');
    scratch.width = RENDER_SIZE;
    scratch.height = RENDER_SIZE;
    scratch.getContext('2d')?.drawImage(source, 0, 0);
    return new Promise<Blob | null>((resolve) => scratch.toBlob(resolve, 'image/png'));
}

// -----------------------------------------------------------------------------
// GLB parsing, one at a time app-wide (snapshots and live previews alike)
// -----------------------------------------------------------------------------

const loader = new GLTFLoader();
let parseChain: Promise<unknown> = Promise.resolve();

function loadModel(url: string): Promise<THREE.Group> {
    const run = parseChain.then(async () => frameModel((await loader.loadAsync(url)).scene));
    parseChain = run.catch(() => undefined);
    return run;
}

// -----------------------------------------------------------------------------
// Persistent cache (Cache Storage; absent outside secure contexts)
// -----------------------------------------------------------------------------

/** Not a real resource: just a stable, URL-shaped key per GLB version. */
function cacheKey(modelUrl: string): string {
    return `${location.origin}/__model-thumbnails__/${encodeURIComponent(modelUrl)}`;
}

async function openCache(): Promise<Cache | null> {
    if (typeof caches === 'undefined') return null;
    try {
        return await caches.open(CACHE_NAME);
    } catch {
        return null;
    }
}

async function readPersisted(modelUrl: string): Promise<Blob | null> {
    try {
        const response = await (await openCache())?.match(cacheKey(modelUrl));
        return response ? await response.blob() : null;
    } catch {
        return null;
    }
}

async function writePersisted(modelUrl: string, blob: Blob): Promise<void> {
    try {
        await (await openCache())?.put(
            cacheKey(modelUrl),
            new Response(blob, { headers: { 'Content-Type': 'image/png' } }),
        );
    } catch {
        // Quota or private mode: the session cache still holds it.
    }
}

/** Drops thumbnails of GLBs that no longer exist (replaced or removed models). */
async function prunePersisted(): Promise<void> {
    try {
        const cache = await openCache();
        if (!cache) return;
        const valid = new Set(Object.values(modelUrls).map(cacheKey));
        for (const request of await cache.keys()) {
            if (!valid.has(request.url)) await cache.delete(request);
        }
    } catch {
        // Best effort only.
    }
}

// -----------------------------------------------------------------------------
// The one offscreen renderer
// -----------------------------------------------------------------------------

/**
 * ONE offscreen WebGLRenderer for every thumbnail and live preview: a single
 * extra WebGL context whatever the model count (phones cap contexts at 8-16,
 * and the AR scene owns one). Alive while the queue runs or a picker is open,
 * then disposed with its context.
 */
class Stage {
    private readonly renderer: THREE.WebGLRenderer;
    private readonly envTexture: THREE.Texture;
    // Holds one model at a time, only for the duration of a render.
    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.01, 100);

    constructor() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(1);
        this.renderer.setSize(RENDER_SIZE, RENDER_SIZE, false);
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

        const pmrem = new THREE.PMREMGenerator(this.renderer);
        const room = new RoomEnvironment();
        this.envTexture = pmrem.fromScene(room, 0.04).texture;
        this.scene.environment = this.envTexture;
        room.dispose();
        pmrem.dispose();
    }

    public render(pivot: THREE.Group): HTMLCanvasElement {
        const radius = pivot.userData.radius as number;
        const distance = radius / Math.sin(THREE.MathUtils.degToRad(CAMERA_FOV / 2)) * 1.05;
        this.camera.position.copy(VIEW_DIRECTION).multiplyScalar(distance);
        this.camera.near = distance / 100;
        this.camera.far = distance * 10;
        this.camera.updateProjectionMatrix();
        this.camera.lookAt(0, 0, 0);

        this.scene.add(pivot);
        this.renderer.render(this.scene, this.camera);
        this.scene.remove(pivot);

        return this.renderer.domElement;
    }

    public dispose(): void {
        this.envTexture.dispose();
        this.scene.environment = null;
        this.renderer.dispose();
        this.renderer.forceContextLoss();
    }
}

let stage: Stage | null = null;
/** Out of contexts or no WebGL: every card falls back to its placeholder. */
let webglUnavailable = false;
/** Open pickers: they may need the stage for a live preview. */
let stageUsers = 0;

function getStage(): Stage | null {
    if (stage || webglUnavailable) return stage;
    try {
        stage = new Stage();
    } catch (error) {
        console.warn('[ModelPicker] Offscreen renderer unavailable:', error);
        webglUnavailable = true;
    }
    return stage;
}

function releaseStageIfIdle(): void {
    if (!stage || pumping || stageUsers > 0) return;
    stage.dispose();
    stage = null;
}

// -----------------------------------------------------------------------------
// Picker-side handle
// -----------------------------------------------------------------------------

/**
 * ThumbnailRenderer: what an open picker sees of the thumbnail machinery.
 * Snapshots usually exist already (preloaded at launch); a card still missing
 * one jumps the background queue. The hovered or keyboard-focused card spins
 * live: at most one model stays in memory, on a throttled timer rather than
 * requestAnimationFrame, which browsers may pause during an immersive session.
 */
export class ThumbnailRenderer {
    private readonly onResult: ThumbnailResult;
    private disposed = false;

    private liveName: string | null = null;
    private liveCanvas: HTMLCanvasElement | null = null;
    private liveModel: { name: string; pivot: THREE.Group } | null = null;
    private liveTimer: number | null = null;
    private liveLastTime = 0;

    constructor(onResult: ThumbnailResult) {
        this.onResult = onResult;
        listeners.add(onResult);
        stageUsers++;
    }

    /** Asks for a model's snapshot; the answer comes through `onResult`. */
    public request(model: string): void {
        if (this.disposed) return;
        if (snapshotCache.has(model)) {
            this.onResult(model, snapshotCache.get(model) ?? null);
            return;
        }
        if (webglUnavailable || !modelUrls[model]) {
            this.onResult(model, null);
            return;
        }
        enqueue(model, true);
    }

    /** Its card scrolled away: back to the background pace. */
    public cancel(model: string): void {
        if (queue.includes(model)) {
            queue = [...queue.filter((name) => name !== model), model];
        }
    }

    /**
     * Spins `model` live inside `canvas`, or stops the live preview with `null`.
     * The snapshot stays underneath, so a failure here just leaves the image.
     */
    public setLive(model: string | null, canvas: HTMLCanvasElement | null = null): void {
        if (this.disposed) return;

        this.liveName = model;
        this.liveCanvas = canvas;
        this.stopLiveLoop();

        if (!model || !canvas) return;
        if (this.liveModel?.name === model) {
            this.startLiveLoop();
            return;
        }
        if (webglUnavailable || !modelUrls[model] || snapshotCache.get(model) === null) return;

        loadModel(modelUrls[model]).then((pivot) => {
            // Closed, or the pointer moved on, while the GLB was loading.
            if (this.disposed || this.liveName !== model) {
                disposeObject(pivot);
                return;
            }
            // One live model at most: the previous one goes.
            if (this.liveModel) disposeObject(this.liveModel.pivot);
            this.liveModel = { name: model, pivot };
            this.startLiveLoop();
        }).catch(() => {
            // The snapshot (or placeholder) stays.
        });
    }

    /** Stops the live preview and lets the shared renderer go once idle. Idempotent. */
    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        listeners.delete(this.onResult);
        this.stopLiveLoop();
        if (this.liveModel) {
            disposeObject(this.liveModel.pivot);
            this.liveModel = null;
        }
        stageUsers--;
        releaseStageIfIdle();
    }

    private startLiveLoop(): void {
        if (this.liveTimer !== null || !this.liveModel || !this.liveCanvas) return;
        if (this.liveModel.name !== this.liveName) return;

        this.liveLastTime = performance.now();
        const tick = () => {
            this.liveTimer = null;
            const live = this.liveModel;
            const canvas = this.liveCanvas;
            if (this.disposed || !live || !canvas || live.name !== this.liveName) return;

            const now = performance.now();
            const dt = (now - this.liveLastTime) / 1000;
            this.liveLastTime = now;

            // Nothing to show while the tab is hidden: keep the timer, skip the GPU.
            if (!document.hidden) {
                live.pivot.rotation.y += LIVE_SPEED_RAD_PER_S * dt;

                const source = getStage()?.render(live.pivot);
                const ctx = canvas.getContext('2d');
                if (source && ctx) {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
                }
            }

            this.liveTimer = window.setTimeout(tick, LIVE_INTERVAL_MS);
        };
        tick();
    }

    private stopLiveLoop(): void {
        if (this.liveTimer !== null) {
            window.clearTimeout(this.liveTimer);
            this.liveTimer = null;
        }
    }
}

/**
 * Wraps the model in a pivot centred on its bounding box, so it spins in place,
 * and stores the bounding-sphere radius used to frame the camera.
 */
function frameModel(model: THREE.Object3D): THREE.Group {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());

    model.position.sub(center);

    const pivot = new THREE.Group();
    pivot.add(model);
    pivot.userData.radius = sphere.radius > 0 ? sphere.radius : 1;
    return pivot;
}

/** Frees geometries, materials and their textures (incl. decoded bitmaps). */
function disposeObject(root: THREE.Object3D): void {
    root.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();

        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
            for (const value of Object.values(material)) {
                if (value instanceof THREE.Texture) {
                    const image: unknown = value.image;
                    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
                        image.close();
                    }
                    value.dispose();
                }
            }
            material.dispose();
        }
    });
}
