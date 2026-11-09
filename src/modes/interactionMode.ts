/**
 * Contract between the GestureRecognizer and the interaction states.
 *
 * The recognizer owns raw touch input and classifies it into gestures; the
 * active state gives each gesture its meaning. There are no user-facing modes
 * any more: the state follows the selection. Scene (nothing selected): place,
 * move and delete models. Selection (pieces selected): hide, explode, widen.
 * Two-finger view gestures (zoom / rotate / tilt) mean the same in both.
 * Handlers are optional: a state simply ignores the gestures it does not use.
 */
export type ModeName = 'scene' | 'selection';

export interface PinchState {
    /** currentDistance / startDistance — multiplicative factor, for scaling. */
    ratio: number;
    /** Spread delta normalized to a fraction of the short screen edge. */
    deltaNormalized: number;
    /**
     * Engagement-gated components, for direct manipulation. Each stays neutral
     * until its own threshold is crossed, then counts from that point, so a
     * pinch doesn't drift the rotation and vice versa. Zoom and twist may run
     * together; a tilt locks both out (and is locked out by them).
     */
    /** Distance ratio since the zoom engaged; 1 until then. */
    zoomRatio: number;
    /** Finger-pair rotation since the twist engaged, counter-clockwise on screen, in radians. */
    twist: number;
    /**
     * Vertical travel of both fingers since the tilt engaged, as a fraction of
     * the short screen edge; positive downwards.
     */
    tilt: number;
}

export interface InteractionMode {
    readonly name: ModeName;

    /** Called when the state becomes active. */
    enter(): void;
    /** Called when the state is left. */
    exit(): void;

    onTap?(inputSource?: XRInputSource): void;
    onDoubleTap?(inputSource?: XRInputSource): void;

    /**
     * A still finger started the hold countdown (for feedback under the
     * finger); onHoldCancel follows if it moves or lifts first. Only sent to
     * states that handle holds.
     */
    onHoldPending?(x: number, y: number): void;
    onHoldCancel?(): void;
    onHoldStart?(x: number, y: number): void;
    /** Offset from the hold position, in CSS pixels. */
    onHoldMove?(dx: number, dy: number): void;
    onHoldEnd?(): void;

    /**
     * A finger moved before the hold delay. Returns whether the state takes
     * the drag (e.g. there is a model under the finger); a refused drag is
     * dropped for the rest of the touch.
     */
    onDragStart?(x: number, y: number): boolean;
    onDragMove?(x: number, y: number): void;
    onDragEnd?(x: number, y: number): void;

    onPinchStart?(): void;
    onPinchMove?(pinch: PinchState): void;
    onPinchEnd?(): void;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
