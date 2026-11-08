import type { ModeManager } from '../modes/modeManager.js';
import type { PinchState } from '../modes/interactionMode.js';

/** Delay before a still finger becomes a hold. */
const HOLD_DELAY_MS = 1000;
/** Two taps closer than this in time form a double tap. */
const DOUBLE_TAP_WINDOW_MS = 300;
/** A pinch reaches full scale once fingers spread across ~60% of the short screen edge. */
const PINCH_SPREAD_FRACTION = 0.6;
/** The zoom engages once the finger distance changes by 5%. */
const ZOOM_ENGAGE_RATIO = 0.05;
/** The twist engages once the finger pair turns by 12°. */
const TWIST_ENGAGE_RAD = (12 * Math.PI) / 180;
/** The tilt engages once both fingers travel 20 px vertically in the same direction. */
const TILT_ENGAGE_PX = 20;
/** Touches starting on interactive UI never become scene gestures. */
const UI_SELECTOR =
    '.ar-menu-container, .ar-model-panel, .ar-quick-container, .ar-delete-btn, .ar-reset-btn, ' +
    '.ar-scan-overlay, .ar-scan-toast, .ar-scan-card, .ar-invert-btn, .ar-history-container, .ar-history-btn, ' +
    '.ar-help-btn, .ar-tutorial-card, .ar-tutorial-modal, .ar-cheatsheet, .ar-hierarchy-slider';

/**
 * Gesture vocabulary, as classified here. Observers get the raw gesture — what
 * the fingers did — not what it achieved in the scene.
 */
export type GestureKind = 'tap' | 'doubleTap' | 'holdStart' | 'pinchStart' | 'release';

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
    /** Read-only observer (the tutorial). Never intercepts: modes still run. */
    private readonly onGesture?: (gesture: GestureKind) => void;

    private holdTimer: number | null = null;
    private holdActive = false;
    private pinchActive = false;
    /** True from a hold or pinch starting until every finger has lifted. */
    private continuousGesture = false;
    /** True while a finished hold/pinch must swallow its trailing XR select. */
    private suppressNextSelect = false;
    /** True when the current touch began on interactive UI. */
    private touchIgnored = false;
    /** Whether the latest primary pointer went down on interactive UI. */
    private pointerDownOnUI = false;

    private startX = 0;
    private startY = 0;
    private currentX = 0;
    private currentY = 0;

    private pinchStartDistance = 0;
    private lastTapTime = 0;

    /** Starting finger positions, to tell a two-finger vertical drag from a pinch. */
    private pinchStartPoints: [number, number, number, number] = [0, 0, 0, 0];
    private lastPairAngle = 0;
    /** Unwrapped finger-pair rotation since the pinch started, clockwise on screen. */
    private pairRotation = 0;

    private zoomEngaged = false;
    private twistEngaged = false;
    private tiltEngaged = false;
    private zoomBaseDistance = 0;
    private twistBaseRotation = 0;
    private tiltBaseY = 0;

    constructor(modeManager: ModeManager, onGesture?: (gesture: GestureKind) => void) {
        this.modeManager = modeManager;
        this.onGesture = onGesture;
    }

    public attach(parent: HTMLElement): void {
        // Capture phase, so this runs before any UI handler: buttons act on
        // pointerdown and may hide their own menu (the tutorial's "Commencer"
        // does), and once it is gone neither touchstart nor the browser's
        // beforexrselect hit test can tell the touch began on UI.
        parent.addEventListener('pointerdown', (event) => {
            if (event.isPrimary) {
                const target = event.target as HTMLElement | null;
                this.pointerDownOnUI = !!target?.closest(UI_SELECTOR);
            }
        }, { capture: true });

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
            this.onGesture?.('doubleTap');
            mode.onDoubleTap(inputSource);
            return;
        }

        this.lastTapTime = now;
        this.onGesture?.('tap');
        mode.onTap?.(inputSource);
    }

    private onTouchStart(event: TouchEvent): void {
        if (event.touches.length === 1) {
            // A fresh single-finger touch starts a new gesture: clear any
            // leftover select-suppression so it doesn't swallow this tap.
            this.suppressNextSelect = false;

            this.touchIgnored = this.pointerDownOnUI;
            if (this.touchIgnored) {
                // A tap on a menu must never reach the scene, even when the
                // menu hid itself before the XR select was hit-tested.
                this.suppressNextSelect = true;
                return;
            }

            const touch = event.touches[0];
            this.startX = touch.clientX;
            this.startY = touch.clientY;
            this.currentX = touch.clientX;
            this.currentY = touch.clientY;

            this.holdTimer = window.setTimeout(() => {
                this.holdActive = true;
                this.continuousGesture = true;
                this.suppressNextSelect = true;
                this.onGesture?.('holdStart');
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
            const [a, b] = [event.touches[0], event.touches[1]];
            this.pinchStartPoints = [a.clientY, b.clientY, a.clientX, b.clientX];
            this.lastPairAngle = this.touchAngle(event.touches);
            this.pairRotation = 0;
            this.zoomEngaged = false;
            this.twistEngaged = false;
            this.tiltEngaged = false;
            this.pinchActive = true;
            this.continuousGesture = true;
            this.suppressNextSelect = true;
            this.onGesture?.('pinchStart');
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

            const ratio = this.pinchStartDistance > 0 ? distance / this.pinchStartDistance : 1;
            const midY = (event.touches[0].clientY + event.touches[1].clientY) / 2;

            // Unwrap the pair angle so a twist through ±180° keeps accumulating.
            const angle = this.touchAngle(event.touches);
            let step = angle - this.lastPairAngle;
            if (step > Math.PI) step -= 2 * Math.PI;
            if (step < -Math.PI) step += 2 * Math.PI;
            this.pairRotation += step;
            this.lastPairAngle = angle;

            this.updateEngagement(event.touches, distance, ratio, midY);

            const pinch: PinchState = {
                ratio,
                deltaNormalized: (distance - this.pinchStartDistance) / referencePx,
                zoomRatio: this.zoomEngaged && this.zoomBaseDistance > 0
                    ? distance / this.zoomBaseDistance
                    : 1,
                twist: this.twistEngaged ? -(this.pairRotation - this.twistBaseRotation) : 0,
                tilt: this.tiltEngaged ? (midY - this.tiltBaseY) / referencePx : 0,
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
            if (this.continuousGesture) {
                this.continuousGesture = false;
                this.onGesture?.('release');
            }
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

    /**
     * Engages zoom, twist and tilt as their thresholds are crossed. Each one
     * rebases on the moment it engages, so crossing a threshold never makes
     * the scene jump. A tilt is a two-finger vertical drag (both fingers same
     * way): it only engages while nothing else has, then locks the rest out.
     */
    private updateEngagement(touches: TouchList, distance: number, ratio: number, midY: number): void {
        if (this.tiltEngaged) return;

        if (!this.zoomEngaged && !this.twistEngaged) {
            const [startYA, startYB, startXA, startXB] = this.pinchStartPoints;
            const dyA = touches[0].clientY - startYA;
            const dyB = touches[1].clientY - startYB;
            const dxA = touches[0].clientX - startXA;
            const dxB = touches[1].clientX - startXB;
            const sameDirection = Math.sign(dyA) === Math.sign(dyB);
            const vertical = Math.abs(dyA) > Math.abs(dxA) && Math.abs(dyB) > Math.abs(dxB);

            if (
                sameDirection && vertical &&
                Math.min(Math.abs(dyA), Math.abs(dyB)) >= TILT_ENGAGE_PX
            ) {
                this.tiltEngaged = true;
                this.tiltBaseY = midY;
                return;
            }
        }

        if (!this.zoomEngaged && Math.abs(ratio - 1) >= ZOOM_ENGAGE_RATIO) {
            this.zoomEngaged = true;
            this.zoomBaseDistance = distance;
        }

        if (!this.twistEngaged && Math.abs(this.pairRotation) >= TWIST_ENGAGE_RAD) {
            this.twistEngaged = true;
            this.twistBaseRotation = this.pairRotation;
        }
    }

    /** Screen angle of the finger pair; grows clockwise, as screen y points down. */
    private touchAngle(touches: TouchList): number {
        return Math.atan2(
            touches[1].clientY - touches[0].clientY,
            touches[1].clientX - touches[0].clientX,
        );
    }

    private touchDistance(touches: TouchList): number {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.hypot(dx, dy);
    }
}
