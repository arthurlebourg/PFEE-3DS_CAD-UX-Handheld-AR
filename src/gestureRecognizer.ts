import type { ModeManager } from './modeManager.js';
import type { PinchState } from './interactionMode.js';

/** Delay before a still finger becomes a hold (drives the rotation joystick). */
const HOLD_DELAY_MS = 1000;
/** Two taps closer than this in time form a double tap. */
const DOUBLE_TAP_WINDOW_MS = 300;
/** A pinch reaches full scale once fingers spread across ~60% of the short screen edge. */
const PINCH_SPREAD_FRACTION = 0.6;
/** Touches starting on interactive UI never become scene gestures. */
const UI_SELECTOR = '.ar-menu-container, .ar-model-panel';

/**
 * GestureRecognizer: sole owner of raw touch input over the AR view.
 *
 * Classifies touches into tap / double tap / hold+drag / two-finger pinch and
 * forwards them to the active {@link ModeManager} mode. Screen taps still
 * arrive as XR `select` events (GPU picking needs the XRInputSource), so main
 * routes them here via {@link handleXRSelect}; the recognizer swallows the
 * stray selects that holds and pinches would otherwise emit.
 *
 * Centralizing classification here replaces the previous per-controller
 * listeners (VirtualJoycon, ExplodeController) and their consumeTap /
 * stopPropagation cross-suppression.
 */
export class GestureRecognizer {
    private readonly modeManager: ModeManager;

    private holdTimer: number | null = null;
    private holdActive = false;
    private pinchActive = false;
    /** True while a finished hold/pinch must swallow its trailing XR select. */
    private suppressNextSelect = false;
    /** True when the current touch began on interactive UI. */
    private touchIgnored = false;

    private startX = 0;
    private startY = 0;
    private currentX = 0;
    private currentY = 0;

    private pinchStartDistance = 0;
    private lastTapTime = 0;

    constructor(modeManager: ModeManager) {
        this.modeManager = modeManager;
    }

    public attach(parent: HTMLElement): void {
        parent.addEventListener('beforexrselect', (event) => {
            if (this.holdActive || this.pinchActive || this.suppressNextSelect) {
                event.preventDefault();
            }
        });

        parent.addEventListener('touchstart', (event) => {
            this.onTouchStart(event);
        }, { passive: false });

        parent.addEventListener('touchmove', (event) => {
            this.onTouchMove(event);
        }, { passive: false });

        parent.addEventListener('touchend', (event) => {
            this.onTouchEnd(event);
        }, { passive: false });

        parent.addEventListener('touchcancel', (event) => {
            this.onTouchEnd(event);
        }, { passive: false });
    }

    /**
     * Entry point for XR `select` events (screen taps). Dispatches a tap or a
     * double tap to the active mode, unless a hold/pinch consumed the touch.
     * Modes without a double-tap handler receive plain taps for both.
     */
    public handleXRSelect(inputSource?: XRInputSource): void {
        if (this.suppressNextSelect) {
            this.suppressNextSelect = false;
            return;
        }

        const mode = this.modeManager.current;
        const now = performance.now();
        const isDoubleTap = now - this.lastTapTime < DOUBLE_TAP_WINDOW_MS;

        if (isDoubleTap && mode.onDoubleTap) {
            this.lastTapTime = 0;
            mode.onDoubleTap(inputSource);
            return;
        }

        this.lastTapTime = now;
        mode.onTap?.(inputSource);
    }

    private onTouchStart(event: TouchEvent): void {
        if (event.touches.length === 1) {
            // A fresh single-finger touch starts a new gesture: clear any
            // leftover select-suppression so it doesn't swallow this tap.
            this.suppressNextSelect = false;

            const target = event.target as HTMLElement | null;
            this.touchIgnored = !!target?.closest(UI_SELECTOR);
            if (this.touchIgnored) return;

            const touch = event.touches[0];
            this.startX = touch.clientX;
            this.startY = touch.clientY;
            this.currentX = touch.clientX;
            this.currentY = touch.clientY;

            this.holdTimer = window.setTimeout(() => {
                this.holdActive = true;
                this.suppressNextSelect = true;
                this.modeManager.current.onHoldStart?.(this.startX, this.startY);
            }, HOLD_DELAY_MS);
            return;
        }

        if (event.touches.length === 2) {
            // A second finger turns the gesture into a pinch; the hold (pending
            // or active) is cancelled so both never fight over the touch.
            this.cancelHold();
            if (this.touchIgnored) return;

            const target = event.target as HTMLElement | null;
            if (target?.closest(UI_SELECTOR)) return;

            this.pinchStartDistance = this.touchDistance(event.touches);
            this.pinchActive = true;
            this.suppressNextSelect = true;
            this.modeManager.current.onPinchStart?.();

            event.preventDefault();
            return;
        }

        // Three or more fingers: drop the hold, let the pinch pause until
        // the extra finger lifts.
        this.cancelHold();
    }

    private onTouchMove(event: TouchEvent): void {
        if (this.pinchActive && event.touches.length === 2) {
            const distance = this.touchDistance(event.touches);
            const referencePx =
                Math.min(window.innerWidth, window.innerHeight) * PINCH_SPREAD_FRACTION;

            const pinch: PinchState = {
                ratio: this.pinchStartDistance > 0 ? distance / this.pinchStartDistance : 1,
                deltaNormalized: (distance - this.pinchStartDistance) / referencePx,
            };
            this.modeManager.current.onPinchMove?.(pinch);

            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (event.touches.length === 1 && !this.touchIgnored) {
            const touch = event.touches[0];
            this.currentX = touch.clientX;
            this.currentY = touch.clientY;

            if (this.holdActive) {
                this.modeManager.current.onHoldMove?.(
                    this.currentX - this.startX,
                    this.currentY - this.startY,
                );
                event.preventDefault();
                event.stopPropagation();
            }
        }
    }

    private onTouchEnd(event: TouchEvent): void {
        // Lock in the pinch as soon as it breaks (one finger lifts), but keep
        // suppressing selects until all fingers are up so the trailing touch
        // can't fire a stray pick.
        if (this.pinchActive && event.touches.length < 2) {
            this.pinchActive = false;
            this.modeManager.current.onPinchEnd?.();
        }

        if (this.holdActive || this.suppressNextSelect) {
            event.preventDefault();
            event.stopPropagation();
        }

        this.cancelHold();

        if (event.touches.length === 0) {
            this.touchIgnored = false;
        }
    }

    private cancelHold(): void {
        if (this.holdTimer !== null) {
            clearTimeout(this.holdTimer);
            this.holdTimer = null;
        }
        if (this.holdActive) {
            this.holdActive = false;
            this.modeManager.current.onHoldEnd?.();
        }
    }

    private touchDistance(touches: TouchList): number {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.hypot(dx, dy);
    }
}
