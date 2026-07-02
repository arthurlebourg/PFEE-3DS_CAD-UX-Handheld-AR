import { gestureArbiter, GestureType } from './gestureArbiter.js';

/**
 * PinchScale: recognizes a two-finger pinch/spread gesture on the DOM
 * overlay and reports the frame-to-frame distance ratio between the two
 * touches, so the caller can drive a scale factor from it.
 *
 * Mirrors VirtualJoycon's touch-handling style, but claims the `Pinch` slot
 * in the {@link GestureArbiter} so it can preempt an in-progress one-finger
 * rotation drag the moment a second finger lands, while itself never
 * overriding an active button press.
 */
export class PinchScale {
    private active = false;
    private lastDistance = 0;

    private readonly onScaleChange: (ratio: number) => void;

    constructor(onScaleChange: (ratio: number) => void) {
        this.onScaleChange = onScaleChange;
    }

    public attach(parent: HTMLElement): void {
        parent.addEventListener('touchstart', (event) => {
            if (event.touches.length !== 2) return;

            // Ignore touches that start on interactive UI (sliders, buttons,
            // panels) so pinching over them doesn't also scale the model.
            const target = event.target as HTMLElement | null;
            if (target?.closest('.ar-menu-container, .ar-model-panel')) return;

            if (!gestureArbiter.tryStart(GestureType.Pinch)) return;

            this.active = true;
            this.lastDistance = this.touchDistance(event.touches);

            event.preventDefault();
            event.stopPropagation();
        }, { passive: false });

        parent.addEventListener('touchmove', (event) => {
            if (!this.active) return;
            if (event.touches.length < 2) return;

            const distance = this.touchDistance(event.touches);

            if (this.lastDistance > 0) {
                const ratio = distance / this.lastDistance;
                this.onScaleChange(ratio);
            }
            this.lastDistance = distance;

            event.preventDefault();
            event.stopPropagation();
        }, { passive: false });

        parent.addEventListener('touchend', (event) => {
            if (!this.active) return;

            // Stay active while at least two fingers remain down; drop out
            // as soon as the pinch loses its second contact point.
            if (event.touches.length < 2) {
                this.cancel();
            } else {
                event.preventDefault();
                event.stopPropagation();
            }
        }, { passive: false });

        parent.addEventListener('touchcancel', () => this.cancel(), { passive: false });
    }

    private touchDistance(touches: TouchList): number {
        const a = touches[0];
        const b = touches[1];
        return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    }

    private cancel(): void {
        if (!this.active) return;

        this.active = false;
        this.lastDistance = 0;
        gestureArbiter.end(GestureType.Pinch);
    }
}
