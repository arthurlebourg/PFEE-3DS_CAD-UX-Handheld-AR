import type { ModeName } from '../modes/interactionMode.js';
import type { UITarget } from '../ui/uiManager.js';
import { CheatSheet } from './cheatSheet.js';
import type { TutorialEvent, TutorialEventBus } from './tutorialEvents.js';
import { TutorialOverlay } from './tutorialOverlay.js';
import type { StepProgress, TutorialStep } from './tutorialSteps.js';
import { TUTORIAL_STEPS } from './tutorialSteps.js';

/** Versioned: changing a gesture can deliberately re-onboard everyone. */
const STORAGE_KEY = 'ar-tutorial-v1-completed';
/** How long a user may flounder before the hint and the step escape appear. */
const HINT_DELAY_MS = 15000;

export interface TutorialManagerDeps {
    events: TutorialEventBus;
    spotlightRect: (target: UITarget) => DOMRect | null;
    currentMode: () => ModeName;
    /** Undoes what the tour did to the scene (explode, hidden parts, scale). */
    resetScene: () => void;
    /** Dev mode has no hit-testing, so AR-only steps are unreachable there. */
    isDevMode?: boolean;
}

/** Steps are matched against a blank progress to test them out of order. */
const NO_PROGRESS: StepProgress = { rotationRad: 0, scaleSpread: 1, explodeDelta: 0 };

/**
 * TutorialManager: the guided tour's state machine.
 *
 * It observes; it never intercepts. The real modes keep handling every gesture,
 * so each step is validated by the effect the user just watched happen in the
 * scene — which is also why the tour is impossible to fake your way through.
 *
 * It is deliberately forgiving: a step whose event arrives early is remembered
 * and skipped when reached, wandering into the wrong mode nudges instead of
 * trapping, and every step can be skipped once the user is visibly stuck.
 */
export class TutorialManager {
    private readonly deps: TutorialManagerDeps;
    private readonly steps: TutorialStep[];
    private readonly overlay: TutorialOverlay;
    private readonly cheatSheet: CheatSheet;

    private unsubscribe: (() => void) | null = null;
    private index = 0;
    private running = false;

    private progress: StepProgress = { ...NO_PROGRESS };
    private baselineScale = 1;
    private baselineExplode = 0;
    private lastScale = 1;
    private lastExplode = 0;

    private hintTimer: number | null = null;
    private hintShown = false;
    /** Steps the user performed before being asked to. */
    private readonly satisfied = new Set<string>();

    constructor(deps: TutorialManagerDeps) {
        this.deps = deps;
        this.steps = deps.isDevMode
            ? TUTORIAL_STEPS.filter((step) => !step.needsAR)
            : TUTORIAL_STEPS;

        this.overlay = new TutorialOverlay(
            {
                onStart: () => this.begin(),
                onQuit: () => this.dismiss(),
                onSkipStep: () => this.goto(this.index + 1),
                onResetScene: () => this.deps.resetScene(),
                onClose: () => this.overlay.hideAll(),
            },
            deps.spotlightRect,
        );

        this.cheatSheet = new CheatSheet(() => this.replay());
    }

    public attach(parent: HTMLElement): void {
        this.overlay.attach(parent);
        this.cheatSheet.attach(parent);
    }

    /** Offers the tour unless the user already saw it through. */
    public offerOnFirstRun(): void {
        if (this.hasSeenTutorial()) return;
        this.overlay.showWelcome(this.steps.length);
    }

    /** Restarts the tour from the beginning, on demand. */
    public replay(): void {
        this.teardown();
        this.satisfied.clear();
        this.overlay.showWelcome(this.steps.length);
    }

    public toggleCheatSheet(): void {
        this.cheatSheet.toggle(this.deps.currentMode());
    }

    /** Leaving the AR session ends the tour without marking it done. */
    public stop(): void {
        this.teardown();
        this.overlay.hideAll();
        this.cheatSheet.close();
    }

    // -------------------------------------------------------------------------
    // Flow
    // -------------------------------------------------------------------------

    private begin(): void {
        this.teardown();
        this.running = true;
        this.unsubscribe = this.deps.events.subscribe((event) => {
            this.onEvent(event);
        });
        this.goto(0);
    }

    private goto(target: number): void {
        let index = target;
        while (index < this.steps.length && this.satisfied.has(this.steps[index].id)) {
            index++;
        }

        if (index >= this.steps.length) {
            this.complete();
            return;
        }

        this.index = index;
        this.progress = { ...NO_PROGRESS };
        this.baselineScale = this.lastScale;
        this.baselineExplode = this.lastExplode;

        this.overlay.showStep(
            this.steps[index],
            index,
            this.steps.length,
            this.steps[index].mode ?? this.deps.currentMode(),
        );
        this.updateBlocked();
        this.startHintTimer();
    }

    private complete(): void {
        this.teardown();
        this.rememberTutorialSeen();
        this.overlay.showFinish();
    }

    /** "Plus tard" / "Quitter": the ? button remains, so this must not nag. */
    private dismiss(): void {
        this.teardown();
        this.rememberTutorialSeen();
        this.overlay.hideAll();
    }

    private teardown(): void {
        this.running = false;
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.clearHintTimer();
    }

    // -------------------------------------------------------------------------
    // Event handling
    // -------------------------------------------------------------------------

    private onEvent(event: TutorialEvent): void {
        if (!this.running) return;

        this.track(event);
        this.markSatisfiedAhead(event);

        if (event.kind === 'mode-changed') {
            this.updateBlocked();
        }

        const step = this.steps[this.index];
        // A gesture performed in the wrong mode does something else entirely,
        // so it cannot count for this step.
        if (step.mode && step.mode !== this.deps.currentMode()) return;

        if (step.isComplete(event, this.progress)) {
            this.goto(this.index + 1);
        }
    }

    /** Accumulates the continuous gestures the thresholds are measured against. */
    private track(event: TutorialEvent): void {
        switch (event.kind) {
            case 'scale-changed': {
                this.lastScale = event.perceived;
                const spread = Math.max(
                    event.perceived / this.baselineScale,
                    this.baselineScale / event.perceived,
                );
                this.progress.scaleSpread = Math.max(this.progress.scaleSpread, spread);
                break;
            }
            case 'scene-rotated':
                this.progress.rotationRad += Math.abs(event.deltaRad);
                break;
            case 'explode-changed':
                this.lastExplode = event.factor;
                this.progress.explodeDelta = Math.max(
                    this.progress.explodeDelta,
                    Math.abs(event.factor - this.baselineExplode),
                );
                break;
            default:
                break;
        }
    }

    /**
     * Credits later steps the user performs on their own initiative. Matching
     * against a blank progress keeps the threshold steps out of it: a pinch
     * done early is not proof the user understood scaling.
     */
    private markSatisfiedAhead(event: TutorialEvent): void {
        for (let i = this.index + 1; i < this.steps.length; i++) {
            const step = this.steps[i];
            if (step.mode && step.mode !== this.deps.currentMode()) continue;
            if (step.isComplete(event, NO_PROGRESS)) {
                this.satisfied.add(step.id);
            }
        }
    }

    private updateBlocked(): void {
        const step = this.steps[this.index];
        const blocked = step.mode && step.mode !== this.deps.currentMode();

        if (blocked) {
            this.overlay.setBlocked(step.mode ?? null);
            return;
        }

        this.overlay.setBlocked(null);
        // Un-blocking wipes the note, so put the hint back if it had appeared.
        if (this.hintShown) {
            this.overlay.showHint(step.hint);
        }
    }

    // -------------------------------------------------------------------------
    // Hints
    // -------------------------------------------------------------------------

    private startHintTimer(): void {
        this.clearHintTimer();
        this.hintShown = false;

        // In dev mode the XR select events that drive taps never fire, so the
        // escape has to be there from the start to iterate on the copy.
        const delay = this.deps.isDevMode ? 0 : HINT_DELAY_MS;
        this.hintTimer = window.setTimeout(() => {
            this.hintShown = true;
            this.overlay.showHint(this.steps[this.index].hint);
        }, delay);
    }

    private clearHintTimer(): void {
        if (this.hintTimer !== null) {
            clearTimeout(this.hintTimer);
            this.hintTimer = null;
        }
    }

    // -------------------------------------------------------------------------
    // Persistence (private browsing throws on access, so never trust it)
    // -------------------------------------------------------------------------

    private hasSeenTutorial(): boolean {
        try {
            return localStorage.getItem(STORAGE_KEY) === '1';
        } catch {
            return false;
        }
    }

    private rememberTutorialSeen(): void {
        try {
            localStorage.setItem(STORAGE_KEY, '1');
        } catch {
            // Storage unavailable: the tour simply offers itself again.
        }
    }
}
