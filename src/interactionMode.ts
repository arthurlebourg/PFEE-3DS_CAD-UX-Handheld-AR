/**
 * Contract between the GestureRecognizer and the interaction modes.
 *
 * The recognizer owns raw touch input and classifies it into gestures; the
 * active mode gives each gesture its meaning (Edit: place/scale/rotate the
 * scene — Inspect: pick/explode/hide pieces). Handlers are optional: a mode
 * simply ignores the gestures it does not use.
 */
export type ModeName = 'edit' | 'inspect';

export interface PinchState {
    /** currentDistance / startDistance — multiplicative factor, for scaling. */
    ratio: number;
    /**
     * Spread delta normalized to a fraction of the short screen edge —
     * linear factor, for the exploded view.
     */
    deltaNormalized: number;
}

export interface InteractionMode {
    readonly name: ModeName;

    /** Called when the mode becomes active. */
    enter(): void;
    /** Called when the mode is left. */
    exit(): void;

    onTap?(inputSource?: XRInputSource): void;
    onDoubleTap?(inputSource?: XRInputSource): void;

    onHoldStart?(x: number, y: number): void;
    onHoldMove?(dx: number, dy: number): void;
    onHoldEnd?(): void;

    onPinchStart?(): void;
    onPinchMove?(pinch: PinchState): void;
    onPinchEnd?(): void;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
