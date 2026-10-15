import type { ModeName } from '../modes/interactionMode.js';
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
    /** Accumulated absolute yaw applied through the joystick, in radians. */
    rotationRad: number;
    /** Widest perceived-scale ratio reached since the step started (>= 1). */
    scaleSpread: number;
    /** Largest explode-factor swing since the step started. */
    explodeDelta: number;
}

export interface TutorialStep {
    id: string;
    /**
     * Mode the gesture belongs to. The step is not blocking — if the user
     * wanders into the other mode the card nudges them back instead of
     * trapping them.
     */
    mode?: ModeName;
    title: string;
    body: string;
    glyph: GlyphName;
    /** UI element to ring. Only set it for elements that are actually visible. */
    spotlight?: UITarget;
    /** Dim the scene around the spotlight. UI steps only — see the note below. */
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
/** An explosion counts at a fifth of the maximum factor. */
const MIN_EXPLODE_DELTA = 0.3;

/**
 * The eight gestures, in the only order the app allows: nothing can be scaled,
 * rotated or inspected before a model exists in the scene.
 *
 * Only step 5 dims the scene. Dimming passthrough while asking someone to aim
 * at a real table is actively hostile, so gesture steps get a ring and no scrim.
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
    {
        id: 'place',
        mode: 'edit',
        title: 'Poser le modèle',
        body: "Visez une surface plane : un aperçu translucide apparaît. Touchez l'écran pour poser le modèle.",
        glyph: 'tap',
        hint: "Aucun aperçu ? Reculez un peu et visez un sol ou une table bien éclairés.",
        needsAR: true,
        isComplete: (event) => event.kind === 'model-placed',
    },
    {
        id: 'scale',
        mode: 'edit',
        title: "Ajuster l'échelle",
        body: 'Pincez à deux doigts pour agrandir ou réduire la scène entière.',
        glyph: 'pinch',
        hint: "Posez deux doigts sur l'écran, puis écartez-les franchement.",
        isComplete: (_event, progress) => progress.scaleSpread >= MIN_SCALE_SPREAD,
    },
    {
        id: 'rotate',
        mode: 'edit',
        title: 'Faire tourner la scène',
        body: 'Maintenez un doigt appuyé une seconde : un joystick apparaît. Glissez ensuite vers la gauche ou la droite.',
        glyph: 'hold-drag',
        hint: 'Gardez le doigt immobile une seconde complète, sans le lever, puis glissez horizontalement.',
        isComplete: (_event, progress) => progress.rotationRad >= MIN_ROTATION_RAD,
    },
    {
        id: 'select',
        mode: 'edit',
        title: 'Sélectionner un modèle',
        body: 'Touchez le modèle posé. Les boutons Supprimer et Réinitialiser apparaissent alors à gauche.',
        glyph: 'tap',
        hint: 'Visez bien le modèle : toucher le vide annule la sélection.',
        isComplete: (event) => event.kind === 'model-selected' && event.selected,
    },
    {
        id: 'switch-mode',
        title: 'Passer en Inspection',
        body: "Le mode Inspection sert à analyser un modèle : sélectionner ses pièces, les masquer, éclater la vue.",
        glyph: 'ui-tap',
        spotlight: 'mode',
        scrim: true,
        hint: "Le bouton de mode se trouve en bas à droite de l'écran.",
        isComplete: (event) => event.kind === 'mode-changed' && event.mode === 'inspect',
    },
    {
        id: 'pick-part',
        mode: 'inspect',
        title: 'Sélectionner une pièce',
        body: 'Touchez une pièce du modèle pour la mettre en évidence. Touchez le vide pour tout désélectionner.',
        glyph: 'tap',
        hint: 'Approchez-vous du modèle pour viser une pièce précise.',
        isComplete: (event) => event.kind === 'part-picked',
    },
    {
        id: 'hide-part',
        mode: 'inspect',
        title: 'Masquer une pièce',
        body: 'Double-touchez une pièce pour la masquer et découvrir ce qu\'elle recouvre.',
        glyph: 'double-tap',
        hint: 'Enchaînez les deux touchers rapidement, au même endroit.',
        isComplete: (event) => event.kind === 'part-hidden',
    },
    {
        id: 'explode',
        mode: 'inspect',
        title: 'Éclater la vue',
        body: "Pincez à deux doigts : le même geste qu'en Édition, mais ici il écarte les pièces les unes des autres.",
        glyph: 'pinch',
        hint: 'Écartez les deux doigts progressivement pour doser l\'éclatement.',
        isComplete: (_event, progress) => progress.explodeDelta >= MIN_EXPLODE_DELTA,
    },
];
