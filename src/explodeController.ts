/**
 * ExplodeController: two-finger pinch/spread to drive an exploded view.
 *
 * Spreading two fingers apart pushes parts outward from the model center;
 * pinching them back collapses the assembly. The gesture reports a continuous
 * explosion factor (0 = assembled) via the supplied callback, mirroring the
 * touch-handling shape of {@link VirtualJoycon}. Two fingers is a clean channel:
 * a single finger is already claimed by tap-to-pick and the long-press joystick.
 */
export class ExplodeController {
    private active = false;
    private wasUsed = false;

    private startDistance = 0;
    private committedFactor = 0;
    private currentFactor = 0;

    // Full-scale explosion once the fingers spread across ~60% of the short
    // screen edge; capped so parts never fly arbitrarily far.
    private readonly spreadFraction = 0.6;
    private readonly maxFactor = 1.5;

    private onExplode: (factor: number) => void;

    constructor(onExplode: (factor: number) => void) {
        this.onExplode = onExplode;
    }

    public attach(parent: HTMLElement) {
        parent.addEventListener('beforexrselect', (event) => {
            if (this.active || this.wasUsed) {
                event.preventDefault();
            }
        });

        parent.addEventListener('touchstart', (event) => {
            // A fresh single-finger touch is a genuine tap: clear the pinch's
            // select-suppression so it doesn't swallow the next pick.
            if (event.touches.length === 1 && !this.active) {
                this.wasUsed = false;
                return;
            }

            if (event.touches.length !== 2) return;

            // Ignore pinches that start on interactive UI (sliders, panels).
            const target = event.target as HTMLElement | null;
            if (target?.closest('.ar-menu-container, .ar-model-panel')) return;

            this.startDistance = this.touchDistance(event.touches);
            this.active = true;
            this.wasUsed = true;

            event.preventDefault();
        }, { passive: false });

        parent.addEventListener('touchmove', (event) => {
            if (!this.active || event.touches.length !== 2) return;

            const distance = this.touchDistance(event.touches);
            const referencePx =
                Math.min(window.innerWidth, window.innerHeight) * this.spreadFraction;
            const delta = (distance - this.startDistance) / referencePx;

            this.currentFactor = clamp(this.committedFactor + delta, 0, this.maxFactor);
            this.onExplode(this.currentFactor);

            event.preventDefault();
            event.stopPropagation();
        }, { passive: false });

        const onEnd = (event: TouchEvent) => {
            // Lock in the reached factor as soon as the pinch breaks (a finger
            // lifts), but keep suppressing selects until all fingers are up so
            // the trailing touch can't fire a stray pick.
            if (this.active && event.touches.length < 2) {
                this.committedFactor = this.currentFactor;
                this.active = false;
            }

            if (this.wasUsed) {
                event.preventDefault();
                event.stopPropagation();
            }
        };

        parent.addEventListener('touchend', onEnd, { passive: false });
        parent.addEventListener('touchcancel', onEnd, { passive: false });
    }

    /**
     * Returns true once if a pinch just ran, letting the caller drop the stray
     * tap that a two-finger release can emit.
     */
    public consumeTap(): boolean {
        if (!this.wasUsed) return false;

        this.wasUsed = false;
        return true;
    }

    private touchDistance(touches: TouchList): number {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.hypot(dx, dy);
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
