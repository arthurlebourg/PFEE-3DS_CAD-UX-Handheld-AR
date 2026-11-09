/** The pending ring stays invisible this long, past an ordinary tap. */
const RING_APPEAR_DELAY_MS = 120;
const RING_APPEAR_MS = 100;

/**
 * ExplodeGauge: feedback for the hold-and-slide explode gesture.
 *
 * While the finger stays still a ring fills under it, over the hold delay, so
 * the user sees the press is going somewhere. It only fades in after a moment,
 * so plain taps (which start the same countdown) don't flash it. Once the hold fires, a vertical
 * gauge beside the finger shows the explosion level as the finger slides up
 * (explode) or down (reassemble). Purely visual: pointer-events none, the
 * GestureRecognizer keeps the touch.
 */
export class ExplodeGauge {
    private root = document.createElement('div');
    private ring = document.createElement('div');
    private gauge = document.createElement('div');
    private fill = document.createElement('div');
    private label = document.createElement('div');
    private readonly holdDelayMs: number;

    constructor(holdDelayMs: number) {
        this.holdDelayMs = holdDelayMs;
        this.injectStyles();

        this.root.className = 'ar-explode-gauge';
        this.root.setAttribute('aria-hidden', 'true');
        this.ring.className = 'ar-eg-ring';
        this.gauge.className = 'ar-eg-bar';
        this.fill.className = 'ar-eg-fill';
        this.label.className = 'ar-eg-label';
        this.gauge.appendChild(this.fill);
        this.root.append(this.ring, this.gauge, this.label);
    }

    public attach(parent: HTMLElement): void {
        parent.appendChild(this.root);
    }

    /** The hold countdown started at (x, y). */
    public showPending(x: number, y: number): void {
        this.place(x, y);
        this.root.className = 'ar-explode-gauge pending';
        // Restart the fill animation from empty.
        this.ring.style.animation = 'none';
        void this.ring.offsetWidth;
        this.ring.style.animation = '';
        this.ring.style.animationDuration = `${String(this.holdDelayMs)}ms, ${String(RING_APPEAR_MS)}ms`;
    }

    /** The hold fired: the gauge replaces the ring. */
    public showActive(x: number, y: number, fraction: number): void {
        this.place(x, y);
        this.root.className = 'ar-explode-gauge active';
        this.setValue(fraction);
    }

    /** Explosion level, 0 (assembled) to 1 (fully exploded). */
    public setValue(fraction: number): void {
        const clamped = Math.min(1, Math.max(0, fraction));
        this.fill.style.height = `${String(clamped * 100)}%`;
        this.label.textContent = `${String(Math.round(clamped * 100))} %`;
    }

    public hide(): void {
        this.root.className = 'ar-explode-gauge';
    }

    private place(x: number, y: number): void {
        this.root.style.left = `${String(x)}px`;
        this.root.style.top = `${String(y)}px`;
    }

    private injectStyles(): void {
        const styleId = 'ar-explode-gauge-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .ar-explode-gauge {
                position: absolute;
                width: 0;
                height: 0;
                z-index: 1100;
                pointer-events: none;
                display: none;
            }

            .ar-explode-gauge.pending,
            .ar-explode-gauge.active { display: block; }

            .ar-eg-ring {
                position: absolute;
                left: -32px;
                top: -32px;
                width: 64px;
                height: 64px;
                border-radius: 50%;
                display: none;
                background: conic-gradient(rgba(255, 140, 0, 0.9) var(--ar-eg-sweep, 0deg), rgba(255, 255, 255, 0.15) 0);
                -webkit-mask: radial-gradient(circle, transparent 25px, #000 26px);
                mask: radial-gradient(circle, transparent 25px, #000 26px);
                opacity: 0;
                animation-name: ar-eg-fill, ar-eg-appear;
                animation-timing-function: linear;
                animation-fill-mode: forwards;
                animation-delay: 0ms, ${String(RING_APPEAR_DELAY_MS)}ms;
            }

            @keyframes ar-eg-appear {
                from { opacity: 0; }
                to { opacity: 1; }
            }

            .ar-explode-gauge.pending .ar-eg-ring { display: block; }

            @property --ar-eg-sweep {
                syntax: '<angle>';
                inherits: false;
                initial-value: 0deg;
            }

            @keyframes ar-eg-fill {
                from { --ar-eg-sweep: 0deg; }
                to { --ar-eg-sweep: 360deg; }
            }

            /* The bar sits right of the finger, centred on it, so the thumb never hides it. */
            .ar-eg-bar {
                position: absolute;
                left: 44px;
                top: -80px;
                width: 12px;
                height: 160px;
                border-radius: 6px;
                border: 1px solid rgba(255, 255, 255, 0.35);
                background: rgba(20, 20, 25, 0.7);
                overflow: hidden;
                display: none;
            }

            .ar-eg-fill {
                position: absolute;
                left: 0;
                right: 0;
                bottom: 0;
                height: 0;
                background: #ffa500;
            }

            .ar-eg-label {
                position: absolute;
                left: 64px;
                top: -12px;
                padding: 3px 8px;
                border-radius: 6px;
                background: rgba(15, 15, 20, 0.9);
                color: #fff;
                font-size: 12px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-weight: 600;
                white-space: nowrap;
                display: none;
            }

            .ar-explode-gauge.active .ar-eg-bar,
            .ar-explode-gauge.active .ar-eg-label { display: block; }
        `;
        document.head.appendChild(style);
    }
}
