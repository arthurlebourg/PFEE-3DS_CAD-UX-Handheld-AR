import type { UITarget } from '../ui/uiManager.js';
import type { GlyphName } from './gestureGlyphs.js';
import type { TutorialEvent } from './tutorialEvents.js';

/**
 * What the user achieved since the current step became active.
 *
 * Continuous gestures are validated against these accumulators rather than
 * against a single event: without a threshold, a 2 px twitch of a pinch marks
 * "ajuster l'échelle" as learned and the user moves on having learned nothing.
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
        title: 'Poser le modèle',
        body: "Visez une surface plane : un aperçu translucide apparaît. Touchez l'écran pour poser le modèle.",
        glyph: 'tap',
        hint: "Aucun aperçu ? Reculez un peu et visez un sol ou une table bien éclairés.",
        needsAR: true,
        isComplete: (event) => event.kind === 'model-placed',
    },
    {
        id: 'scale',
        title: "Ajuster l'échelle",
        body: 'Pincez à deux doigts pour agrandir ou réduire la scène entière.',
        glyph: 'pinch',
        hint: "Posez deux doigts sur l'écran, puis écartez-les franchement.",
        isComplete: (event, progress) => isRelease(event) && progress.scaleSpread >= MIN_SCALE_SPREAD,
    },
    {
        id: 'rotate',
        title: 'Faire tourner la scène',
        body: "Posez deux doigts sur l'écran et faites-les pivoter, comme pour tourner une carte.",
        glyph: 'twist',
        hint: "Gardez l'écart entre vos doigts et tournez-les franchement autour de leur milieu.",
        isComplete: (event, progress) => isRelease(event) && progress.rotationRad >= MIN_ROTATION_RAD,
    },
    {
        id: 'tilt',
        title: 'Incliner la scène',
        body: 'Glissez deux doigts ensemble vers le haut ou vers le bas pour incliner la scène.',
        glyph: 'tilt',
        hint: 'Gardez les deux doigts côte à côte et déplacez-les dans le même sens.',
        isComplete: (event, progress) => isRelease(event) && progress.tiltRad >= MIN_TILT_RAD,
    },
    {
        id: 'move',
        title: 'Déplacer le modèle',
        body: 'Posez un doigt sur le modèle et faites-le glisser : il suit la surface.',
        glyph: 'drag',
        hint: 'Commencez à glisser tout de suite, sans marquer de pause sur le modèle.',
        needsAR: true,
        isComplete: (event) => event.kind === 'model-moved',
    },
    {
        id: 'pick-part',
        title: 'Sélectionner une pièce',
        body: 'Touchez une pièce du modèle pour la sélectionner. Touchez le vide pour tout désélectionner.',
        glyph: 'tap',
        hint: 'Approchez-vous du modèle pour viser une pièce précise.',
        isComplete: (event) => event.kind === 'part-picked',
    },
    {
        id: 'granularity',
        title: 'Élargir la sélection',
        body: "Une pièce sélectionnée fait apparaître un rail au bord gauche. Glissez le curseur vers le haut : la sélection s'étend à l'ensemble qui contient la pièce.",
        glyph: 'slide-y',
        hint: 'Posez le doigt sur le rail, tout à gauche de l\'écran, puis glissez vers le haut.',
        isComplete: (event) => event.kind === 'granularity-changed' && event.level > 0,
    },
    {
        id: 'explode',
        title: 'Éclater le modèle',
        body: "Avec une pièce sélectionnée, maintenez un doigt une demi-seconde, puis glissez vers le haut : les pièces s'écartent. Vers le bas, elles se rassemblent.",
        glyph: 'hold-up',
        hint: "Attendez que l'anneau se remplisse sous le doigt avant de glisser.",
        isComplete: (event, progress) => isRelease(event) && progress.explodeDelta >= MIN_EXPLODE_DELTA,
    },
    {
        id: 'hide-part',
        title: 'Masquer une pièce',
        body: 'Double-touchez une pièce pour la masquer et découvrir ce qu\'elle recouvre. « Tout afficher », en bas, la fait revenir.',
        glyph: 'double-tap',
        hint: 'Enchaînez les deux touchers rapidement, au même endroit.',
        isComplete: (event) => event.kind === 'part-hidden',
    },
];
