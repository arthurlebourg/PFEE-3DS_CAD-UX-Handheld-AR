import type { GestureKind } from '../input/gestureRecognizer.js';
import type { ModeName } from '../modes/interactionMode.js';

/**
 * What the app did, as the tutorial cares about it.
 *
 * Steps validate against these rather than against touches: the lesson is
 * "the model got bigger", not "two fingers moved".
 */
export type TutorialEvent =
    | { kind: 'model-placed' }
    /** Perceived scene scale (1 = 100%), the inverse of the rig scale. */
    | { kind: 'scale-changed'; perceived: number }
    | { kind: 'scene-rotated'; deltaRad: number }
    | { kind: 'model-selected'; selected: boolean }
    | { kind: 'mode-changed'; mode: ModeName }
    | { kind: 'part-picked' }
    /** Granularity slider moved; level 0 is the picked piece, higher widens. */
    | { kind: 'granularity-changed'; level: number }
    | { kind: 'part-hidden' }
    | { kind: 'explode-changed'; factor: number }
    /**
     * What the fingers did, regardless of what it achieved. Never completes a
     * step on its own — a 2 px pinch is not a lesson learned. 'release' lets
     * the threshold steps wait for the fingers to lift before moving on, so
     * the next card never lands mid-gesture.
     */
    | { kind: 'gesture'; gesture: GestureKind };

export type TutorialListener = (event: TutorialEvent) => void;

/**
 * Tiny synchronous bus between the app and the tutorial.
 *
 * The tutorial observes; it never intercepts. Modes keep handling every
 * gesture themselves, so a step is validated by the real effect the user just
 * saw happen in the scene.
 */
export class TutorialEventBus {
    private listeners: TutorialListener[] = [];

    /** Returns an unsubscribe function. */
    public subscribe(listener: TutorialListener): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }

    public emit(event: TutorialEvent): void {
        for (const listener of this.listeners) {
            listener(event);
        }
    }
}
