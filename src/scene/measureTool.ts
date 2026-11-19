import type * as THREE from 'three';
import type { HistoryAction } from '../history/historyManager.js';
import { Ruler } from './ruler.js';
import type { RulerPoints } from './ruler.js';

/**
 * How often the models are probed under the crosshair. Each probe is a GPU
 * pick, whose pixel readback stalls the pipeline, so it is not run every frame.
 */
const MODEL_PROBE_INTERVAL_MS = 100;

/** What the crosshair is on: a model piece wins over the real surface behind it. */
export type AimTarget = 'model' | 'surface' | null;

/** Which end the + button places next. */
export type NextEnd = 'first' | 'second' | 'new';

export interface MeasureToolDeps {
    /** Scene-space point on the visible model piece under the screen centre, if any. */
    probeModel(): THREE.Vector3 | null;
    /** Scene point to real-world coordinates. */
    sceneToReal(point: THREE.Vector3): THREE.Vector3;
    /** Pushes an undoable action to the history. */
    onAction(action: HistoryAction): void;
}

/**
 * MeasureTool: aims the crosshair and places the ruler's ends.
 *
 * Main feeds it the real surface under the screen centre each frame; the
 * models are probed here, throttled. There is one ruler at a time: the first
 * end of a new ruler replaces the previous one. Each end placed is one
 * undoable step, which is also how a ruler is removed.
 */
export class MeasureTool {
    private readonly deps: MeasureToolDeps;
    private readonly ruler: Ruler;

    private active = false;
    private surface: THREE.Vector3 | null = null;
    /** Real-world point of the latest model probe. */
    private modelPoint: THREE.Vector3 | null = null;
    private lastProbe = -Infinity;

    constructor(rig: THREE.Object3D, deps: MeasureToolDeps) {
        this.deps = deps;
        this.ruler = new Ruler(rig);
    }

    public attach(parent: HTMLElement): void {
        this.ruler.attach(parent);
    }

    /** Hides the ruler outside the AR session. */
    public setVisible(visible: boolean): void {
        this.ruler.setVisible(visible);
    }

    /** Turns the crosshair on (Measure state) or off; the ruler stays shown either way. */
    public setActive(active: boolean): void {
        this.active = active;
        this.modelPoint = null;
        this.lastProbe = -Infinity;
    }

    /** The real-world surface point under the screen centre this frame, or null. */
    public setSurface(point: THREE.Vector3 | null): void {
        this.surface = point;
    }

    public get target(): AimTarget {
        if (!this.active) return null;
        if (this.modelPoint) return 'model';
        return this.surface ? 'surface' : null;
    }

    public get nextEnd(): NextEnd {
        const { start, end } = this.ruler.getPoints();
        if (!start) return 'first';
        return end ? 'new' : 'second';
    }

    /** Per frame: refreshes the aim and lays out the ruler. */
    public update(camera: THREE.Camera): void {
        if (this.active && performance.now() - this.lastProbe >= MODEL_PROBE_INTERVAL_MS) {
            this.probe();
        }
        this.ruler.setAim(this.aimPoint());
        this.ruler.update(camera);
    }

    /** Places the next end under the crosshair, as one undoable step. Returns whether it did. */
    public addPoint(): boolean {
        if (!this.active) return false;

        // Probe again so the end lands exactly under the crosshair, not where
        // it was up to one probe interval ago.
        this.probe();
        const aim = this.aimPoint();
        if (!aim) return false;

        const before = this.ruler.getPoints();
        const after: RulerPoints = before.start && !before.end
            ? { start: before.start, end: aim }
            : { start: aim, end: null };
        this.ruler.setPoints(after);

        this.deps.onAction({
            description: after.end ? 'Ruler end' : 'Ruler start',
            undo: () => {
                this.ruler.setPoints(before);
            },
            redo: () => {
                this.ruler.setPoints(after);
            },
        });
        return true;
    }

    public getPoints(): RulerPoints {
        return this.ruler.getPoints();
    }

    public setPoints(points: RulerPoints): void {
        this.ruler.setPoints(points);
    }

    /** Removes the ruler, without recording it (Reset records its own step). */
    public clear(): void {
        this.ruler.setPoints({ start: null, end: null });
    }

    private probe(): void {
        this.lastProbe = performance.now();
        const point = this.deps.probeModel();
        this.modelPoint = point ? this.deps.sceneToReal(point) : null;
    }

    private aimPoint(): THREE.Vector3 | null {
        if (!this.active) return null;
        return (this.modelPoint ?? this.surface)?.clone() ?? null;
    }
}
