import type { UITarget } from '../ui/uiManager.js';
import type { GlyphName } from './gestureGlyphs.js';
import type { TutorialEvent } from './tutorialEvents.js';

/**
 * What the user achieved since the current step became active.
 *
 * Continuous gestures are validated against these accumulators rather than
 * against a single event: without a threshold, a 2 px twitch of a pinch marks
 * "Adjust the scale" as learned and the user moves on having learned nothing.
 */
export interface StepProgress {
    /** Accumulated absolute yaw applied through the two-finger twist, in radians. */
    rotationRad: number;
    /** Accumulated absolute tilt applied through the two-finger vertical drag, in radians. */
    tiltRad: number;
    /** Widest perceived-scale ratio reached since the step started (>= 1). */
    scaleSpread: number;
    /** Largest explode-factor swing since the step started. */
    explodeDelta: number;
}

export interface TutorialStep {
    id: string;
    title: string;
    body: string;
    glyph: GlyphName;
    /** UI element to ring. Only set it for elements that are actually visible. */
    spotlight?: UITarget;
    /**
     * Dim the scene around the spotlight. UI steps only: dimming passthrough
     * while asking someone to aim at a real table is actively hostile.
     */
    scrim?: boolean;
    /** Shown after a while without progress, or immediately in dev mode. */
    hint: string;
    /** Impossible without AR hit-testing, so unreachable in dev mode. */
    needsAR?: boolean;
    isComplete(event: TutorialEvent, progress: StepProgress): boolean;
}

/** A pinch counts once the scene is a quarter bigger or smaller. */
const MIN_SCALE_SPREAD = 1.25;
/** A rotation counts at 20°: past any accidental drift, short of a chore. */
const MIN_ROTATION_RAD = (20 * Math.PI) / 180;
/** A tilt counts at 15°: the gesture has a 20 px dead zone already. */
const MIN_TILT_RAD = (15 * Math.PI) / 180;
/** An explosion counts at a fifth of the maximum factor. */
const MIN_EXPLODE_DELTA = 0.3;

/**
 * Continuous gestures complete when the fingers lift, not when the threshold
 * is crossed: the user is still adjusting, and swapping the card under their
 * fingers (or showing the finish screen) cuts the gesture short.
 */
const isRelease = (event: TutorialEvent): boolean =>
    event.kind === 'gesture' && event.gesture === 'release';

/**
 * The nine gestures, in the only order the app allows: nothing can be scaled,
 * rotated or moved before a model exists in the scene, and the granularity
 * rail and the exploded view only exist once a piece is picked.
 *
 * There are no modes to switch between: picking a piece is what brings the
 * selection gestures, so the tour simply walks from the scene to the pieces.
 * Deleting (dropping a model on the trash) stays out of it, as it would take
 * away the model the next steps need; the cheat sheet covers it.
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
    {
        id: 'place',
        title: 'Place the model',
        body: 'Aim at a flat surface: a translucent preview appears. Tap the screen to place the model.',
        glyph: 'tap',
        hint: 'No preview? Step back a little and aim at a well-lit floor or table.',
        needsAR: true,
        isComplete: (event) => event.kind === 'model-placed',
    },
    {
        id: 'scale',
        title: 'Adjust the scale',
        body: 'Pinch or spread two fingers to make the whole scene bigger or smaller.',
        glyph: 'pinch',
        hint: 'Put two fingers on the screen, then clearly spread them apart.',
        isComplete: (event, progress) => isRelease(event) && progress.scaleSpread >= MIN_SCALE_SPREAD,
    },
    {
        id: 'rotate',
        title: 'Rotate the scene',
        body: 'Put two fingers on the screen and twist them, as if turning a map.',
        glyph: 'twist',
        hint: 'Keep the same gap between your fingers and clearly turn them around their middle.',
        isComplete: (event, progress) => isRelease(event) && progress.rotationRad >= MIN_ROTATION_RAD,
    },
    {
        id: 'tilt',
        title: 'Tilt the scene',
        body: 'Drag two fingers together up or down to tilt the scene.',
        glyph: 'tilt',
        hint: 'Keep both fingers side by side and move them in the same direction.',
        isComplete: (event, progress) => isRelease(event) && progress.tiltRad >= MIN_TILT_RAD,
    },
    {
        id: 'move',
        title: 'Move the model',
        body: 'Put a finger on the model and drag it: it follows the surface.',
        glyph: 'drag',
        hint: 'Start dragging right away, without pausing on the model.',
        needsAR: true,
        isComplete: (event) => event.kind === 'model-moved',
    },
    {
        id: 'pick-part',
        title: 'Select a part',
        body: 'Tap a part of the model to select it. Tap empty space to deselect everything.',
        glyph: 'tap',
        hint: 'Move closer to the model to aim at a specific part.',
        isComplete: (event) => event.kind === 'part-picked',
    },
    {
        id: 'granularity',
        title: 'Expand the selection',
        body: 'Selecting a part brings up a rail on the left edge. Drag its handle up: the selection grows to the subassembly that contains the part.',
        glyph: 'slide-y',
        hint: 'Put your finger on the rail, at the far left of the screen, then drag up.',
        isComplete: (event) => event.kind === 'granularity-changed' && event.level > 0,
    },
    {
        id: 'explode',
        title: 'Explode the model',
        body: 'With a part selected, hold a finger for half a second, then drag up: the parts spread apart. Drag down to reassemble them.',
        glyph: 'hold-up',
        hint: 'Wait for the ring under your finger to fill before dragging.',
        isComplete: (event, progress) => isRelease(event) && progress.explodeDelta >= MIN_EXPLODE_DELTA,
    },
    {
        id: 'hide-part',
        title: 'Hide a part',
        body: 'Double-tap a part to hide it and see what is behind it. "Show all" at the bottom brings it back.',
        glyph: 'double-tap',
        hint: 'Tap twice quickly, in the same spot.',
        isComplete: (event) => event.kind === 'part-hidden',
    },
];
