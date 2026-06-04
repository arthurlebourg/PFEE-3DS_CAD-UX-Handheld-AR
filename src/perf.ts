/**
 * PerfProbe: lightweight runtime instrumentation for frame timing and GPU picking.
 *
 * It collects two families of metrics:
 *  - Frame metrics: per-frame delta and FPS.
 *  - Pick metrics: end-to-end pick latency broken into prep / render / readback
 *    phases. Because readRenderTargetPixels() is a synchronous GPU->CPU flush,
 *    wrapping performance.now() around the render+readback captures the real GPU
 *    stall, not just CPU submit time.
 *
 * Results are kept in rolling windows and surfaced as min/mean/p50/p95 in a
 * dom-overlay HUD (visible in WebXR) and as User Timing marks for the DevTools
 * Performance timeline.
 */

type PickPhase = 'prep' | 'render' | 'readback';

interface RollingStats {
    n: number;
    mean: number;
    min: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
}

const EMPTY_STATS: RollingStats = { n: 0, mean: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0 };

/** Bounded sample buffer that drops the oldest value once it is full. */
class RollingWindow {
    private samples: number[] = [];
    private readonly capacity: number;

    constructor(capacity: number) {
        this.capacity = capacity;
    }

    push(value: number): void {
        this.samples.push(value);
        if (this.samples.length > this.capacity) {
            this.samples.shift();
        }
    }

    get length(): number {
        return this.samples.length;
    }

    stats(): RollingStats {
        const n = this.samples.length;
        if (n === 0) {
            return EMPTY_STATS;
        }

        let sum = 0;
        for (const value of this.samples) {
            sum += value;
        }

        const sorted = [...this.samples].sort((a, b) => a - b);
        const pct = (p: number): number => sorted[Math.min(n - 1, Math.floor((p / 100) * n))];

        return {
            n,
            mean: sum / n,
            min: sorted[0],
            p50: pct(50),
            p95: pct(95),
            p99: pct(99),
            max: sorted[n - 1],
        };
    }
}

interface PerfProbeOptions {
    /** Frame samples to retain (120 by default; ~2s at 60Hz, ~4s at 30Hz). */
    frameWindow?: number;
    /** Pick samples to retain. */
    pickWindow?: number;
    /** Start with the HUD visible. */
    visible?: boolean;
}

export class PerfProbe {
    // --- Frame timing ---
    private lastFrameTimestamp = 0;
    private readonly frameDeltas: RollingWindow;

    // --- Pick timing ---
    private readonly pickTotal: RollingWindow;
    private readonly pickPhases: Record<PickPhase, RollingWindow>;
    private pickCount = 0;

    // Per-pick scratch state.
    private pickStart = 0;
    private phaseMark = 0;
    private currentPhases: Record<PickPhase, number> = { prep: 0, render: 0, readback: 0 };

    // --- HUD ---
    private hud: HTMLElement | null = null;
    private visible: boolean;
    private lastHudUpdate = 0;
    private readonly hudIntervalMs = 250;

    constructor(options: PerfProbeOptions = {}) {
        this.frameDeltas = new RollingWindow(options.frameWindow ?? 120);
        this.pickTotal = new RollingWindow(options.pickWindow ?? 60);
        this.pickPhases = {
            prep: new RollingWindow(options.pickWindow ?? 60),
            render: new RollingWindow(options.pickWindow ?? 60),
            readback: new RollingWindow(options.pickWindow ?? 60),
        };
        this.visible = options.visible ?? true;
    }

    /** Creates the HUD element and appends it to the dom-overlay root. */
    mount(parent: HTMLElement = document.body): void {
        if (this.hud) {
            return;
        }
        const hud = document.createElement('div');
        hud.style.cssText = [
            'position:absolute',
            'top:12px',
            'left:12px',
            'z-index:200',
            'padding:8px 10px',
            'border-radius:8px',
            'background:rgba(0,0,0,0.6)',
            'color:#0f0',
            'font:12px/1.4 monospace',
            'white-space:pre',
            'pointer-events:none',
            'user-select:none',
        ].join(';');
        hud.style.display = this.visible ? 'block' : 'none';
        hud.textContent = 'perf: warming up…';
        parent.appendChild(hud);
        this.hud = hud;
    }

    setVisible(visible: boolean): void {
        this.visible = visible;
        if (this.hud) {
            this.hud.style.display = visible ? 'block' : 'none';
        }
    }

    toggle(): void {
        this.setVisible(!this.visible);
    }

    /**
     * Call once at the top of the animation loop. `timestamp` is the
     * DOMHighResTimeStamp the XR/raf loop hands you.
     */
    frame(timestamp: number): void {
        if (this.lastFrameTimestamp > 0) {
            const delta = timestamp - this.lastFrameTimestamp;
            this.frameDeltas.push(delta);
        }
        this.lastFrameTimestamp = timestamp;
        this.refreshHud(timestamp);
    }

    // --- Pick phase instrumentation ---------------------------------------

    /** Marks the start of a pick. Call right before the off-screen pass. */
    beginPick(): void {
        this.currentPhases = { prep: 0, render: 0, readback: 0 };
        this.pickStart = performance.now();
        this.phaseMark = this.pickStart;
        performance.mark('pick:start');
    }

    /** Records the duration of the phase that just completed. */
    split(phase: PickPhase): void {
        const now = performance.now();
        this.currentPhases[phase] = now - this.phaseMark;
        this.phaseMark = now;
    }

    /** Finalizes a pick, pushing its timings into the rolling windows. */
    endPick(): void {
        const total = performance.now() - this.pickStart;
        this.pickTotal.push(total);
        this.pickPhases.prep.push(this.currentPhases.prep);
        this.pickPhases.render.push(this.currentPhases.render);
        this.pickPhases.readback.push(this.currentPhases.readback);
        this.pickCount++;

        try {
            performance.measure('pick', 'pick:start');
        } catch {
            // Mark may have been cleared; ignore.
        }
    }

    // --- HUD rendering -----------------------------------------------------

    private refreshHud(timestamp: number): void {
        if (!this.hud || !this.visible) {
            return;
        }
        if (timestamp - this.lastHudUpdate < this.hudIntervalMs) {
            return;
        }
        this.lastHudUpdate = timestamp;

        const frame = this.frameDeltas.stats();
        const fps = frame.mean > 0 ? 1000 / frame.mean : 0;
        const pick = this.pickTotal.stats();
        const prep = this.pickPhases.prep.stats();
        const render = this.pickPhases.render.stats();
        const readback = this.pickPhases.readback.stats();

        const lines = [
            `FPS  ${fps.toFixed(1)}  (frame p50 ${frame.p50.toFixed(1)}ms p95 ${frame.p95.toFixed(1)}ms)`,
            `PICK n=${this.pickCount}`,
            `  total p50 ${pick.p50.toFixed(2)}ms p95 ${pick.p95.toFixed(2)}ms max ${pick.max.toFixed(2)}ms`,
            `  prep ${prep.mean.toFixed(2)}ms | render ${render.mean.toFixed(2)}ms | readback ${readback.mean.toFixed(2)}ms`,
        ];
        this.hud.textContent = lines.join('\n');
    }
}
