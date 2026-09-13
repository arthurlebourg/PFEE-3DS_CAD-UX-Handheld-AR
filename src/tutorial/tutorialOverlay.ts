import type { ModeName } from '../modes/interactionMode.js';
import type { UITarget } from '../ui/uiManager.js';
import { glyphSvg } from './gestureGlyphs.js';
import type { TutorialStep } from './tutorialSteps.js';
import { injectTutorialStyles } from './tutorialStyles.js';

export interface TutorialOverlayCallbacks {
    /** "Commencer" on the welcome card. */
    onStart: () => void;
    /** "Plus tard" / "Quitter": leave the tour without finishing it. */
    onQuit: () => void;
    onSkipStep: () => void;
    /** "Tout réinitialiser" on the finish card. */
    onResetScene: () => void;
    /** "Terminer" on the finish card. */
    onClose: () => void;
}

const ACCENTS: Record<ModeName, string> = {
    edit: '#007bff',
    inspect: '#28a745',
};

const MODE_LABELS: Record<ModeName, string> = {
    edit: 'Édition',
    inspect: 'Inspection',
};

/**
 * TutorialOverlay: everything the tutorial draws.
 *
 * Two rules shape the layout. The card sits at the *top* — the bottom third
 * already holds the quick column (right) and the contextual Supprimer /
 * Réinitialiser (left), and the middle has to stay clear to practise in. And
 * the card is `pointer-events: none` except for its own buttons, so a tap
 * aimed at the scene during a practice step goes to the scene.
 */
export class TutorialOverlay {
    private readonly callbacks: TutorialOverlayCallbacks;
    private readonly spotlightRect: (target: UITarget) => DOMRect | null;

    private root = document.createElement('div');
    private spot = document.createElement('div');
    private card = document.createElement('div');
    private modal = document.createElement('div');
    private modalCard = document.createElement('div');

    private glyphBox = document.createElement('div');
    private kicker = document.createElement('div');
    private title = document.createElement('div');
    private body = document.createElement('div');
    private note = document.createElement('div');
    private dots = document.createElement('div');
    private btnSkipStep = document.createElement('button');
    private btnQuit = document.createElement('button');

    private currentTarget: UITarget | null = null;
    private currentScrim = false;
    private readonly onResize = () => {
        this.positionSpotlight();
    };

    constructor(
        callbacks: TutorialOverlayCallbacks,
        spotlightRect: (target: UITarget) => DOMRect | null,
    ) {
        this.callbacks = callbacks;
        this.spotlightRect = spotlightRect;

        injectTutorialStyles();
        this.buildCard();
        this.buildModal();

        this.root.className = 'ar-tutorial-root';
        this.root.append(this.spot, this.card, this.modal);

        // The overlay lives above the AR canvas; XR select events must not
        // leak through it, exactly as the main UI already guards itself.
        for (const element of [this.card, this.modal]) {
            element.addEventListener('beforexrselect', (event) => {
                event.preventDefault();
            });
        }
    }

    public attach(parent: HTMLElement): void {
        parent.appendChild(this.root);
        window.addEventListener('resize', this.onResize);
    }

    public destroy(): void {
        window.removeEventListener('resize', this.onResize);
        this.root.remove();
    }

    // -------------------------------------------------------------------------
    // Cards
    // -------------------------------------------------------------------------

    public showWelcome(stepCount: number): void {
        this.card.classList.remove('visible');
        this.setSpotlight(null, false);
        this.setAccent('edit');

        this.renderModal({
            kicker: 'Prise en main',
            title: `${stepCount} gestes, une minute`,
            body: "Un guide pas à pas vous fait essayer chaque geste directement sur la scène. Vous pouvez le quitter à tout moment, et le relancer via le bouton ? en haut à droite.",
            glyph: 'ui-tap',
            actions: [
                { label: 'Plus tard', primary: false, action: () => this.callbacks.onQuit() },
                { label: 'Commencer', primary: true, action: () => this.callbacks.onStart() },
            ],
        });
    }

    public showFinish(): void {
        this.card.classList.remove('visible');
        this.setSpotlight('help', false);

        this.renderModal({
            kicker: 'Terminé',
            title: 'Vous avez tous les gestes en main',
            body: "Le bouton ? en haut à droite les rappelle à tout moment. La scène a été modifiée pendant le guide : vous pouvez la remettre à zéro.",
            glyph: 'check',
            actions: [
                {
                    label: 'Tout réinitialiser',
                    primary: false,
                    action: () => this.callbacks.onResetScene(),
                },
                { label: 'Terminer', primary: true, action: () => this.callbacks.onClose() },
            ],
        });
    }

    /** Clears card, modal and spotlight without tearing the overlay down. */
    public hideAll(): void {
        this.card.classList.remove('visible');
        this.modal.classList.remove('visible');
        this.setSpotlight(null, false);
    }

    public showStep(
        step: TutorialStep,
        index: number,
        total: number,
        mode: ModeName,
    ): void {
        this.modal.classList.remove('visible');
        this.setAccent(mode);

        this.glyphBox.innerHTML = glyphSvg(step.glyph);
        this.kicker.textContent = `Étape ${String(index + 1)} / ${String(total)}`;
        this.title.textContent = step.title;
        this.body.textContent = step.body;
        this.setNote(null);
        this.renderDots(index, total);

        this.setSpotlight(step.spotlight ?? null, step.scrim ?? false);
        this.card.classList.add('visible');
        this.btnSkipStep.classList.remove('visible');
    }

    /** Nudges the user back to the mode the current gesture lives in. */
    public setBlocked(requiredMode: ModeName | null): void {
        if (!requiredMode) {
            this.setNote(null);
            return;
        }
        this.setNote(
            `Revenez en mode ${MODE_LABELS[requiredMode]} pour continuer.`,
            'blocked',
        );
    }

    /** Reveals the step's hint and the per-step skip escape. */
    public showHint(hint: string): void {
        if (!this.note.classList.contains('blocked')) {
            this.setNote(`Astuce : ${hint}`, 'hint');
        }
        this.btnSkipStep.classList.add('visible');
    }

    // -------------------------------------------------------------------------
    // Spotlight
    // -------------------------------------------------------------------------

    private setSpotlight(target: UITarget | null, scrim: boolean): void {
        this.currentTarget = target;
        this.currentScrim = scrim;
        this.positionSpotlight();
    }

    private positionSpotlight(): void {
        if (!this.currentTarget) {
            this.spot.classList.remove('visible');
            return;
        }

        const rect = this.spotlightRect(this.currentTarget);
        // Hidden contextual buttons are scaled to 0, so they report an empty
        // rect: ringing them would point at nothing.
        if (!rect || rect.width < 1 || rect.height < 1) {
            this.spot.classList.remove('visible');
            return;
        }

        const padding = 8;
        this.spot.style.left = `${String(rect.left - padding)}px`;
        this.spot.style.top = `${String(rect.top - padding)}px`;
        this.spot.style.width = `${String(rect.width + padding * 2)}px`;
        this.spot.style.height = `${String(rect.height + padding * 2)}px`;
        this.spot.style.borderRadius = `${String(Math.min(rect.width, rect.height) / 2 + padding)}px`;
        this.spot.classList.toggle('scrim', this.currentScrim);
        this.spot.classList.add('visible');
    }

    // -------------------------------------------------------------------------
    // Building blocks
    // -------------------------------------------------------------------------

    private buildCard(): void {
        this.card.className = 'ar-tutorial-card';
        this.spot.className = 'ar-tutorial-spot';

        this.glyphBox.className = 'ar-tut-glyph';
        this.kicker.className = 'ar-tut-kicker';
        this.title.className = 'ar-tut-title';
        this.body.className = 'ar-tut-body';
        this.note.className = 'ar-tut-note';
        this.dots.className = 'ar-tut-dots';

        const text = document.createElement('div');
        text.className = 'ar-tut-text';
        text.append(this.kicker, this.title, this.body, this.note);

        const head = document.createElement('div');
        head.className = 'ar-tut-head';
        head.append(this.glyphBox, text);

        this.btnSkipStep.className = 'ar-tut-btn ghost ar-tut-skip';
        this.btnSkipStep.textContent = "Passer l'étape";
        this.btnQuit.className = 'ar-tut-btn ghost';
        this.btnQuit.textContent = 'Quitter';
        this.onPointerDown(this.btnSkipStep, () => this.callbacks.onSkipStep());
        this.onPointerDown(this.btnQuit, () => this.callbacks.onQuit());

        const actions = document.createElement('div');
        actions.className = 'ar-tut-actions';
        actions.append(this.btnSkipStep, this.btnQuit);

        const foot = document.createElement('div');
        foot.className = 'ar-tut-foot';
        foot.append(this.dots, actions);

        this.card.append(head, foot);
    }

    private buildModal(): void {
        this.modal.className = 'ar-tutorial-modal';
        this.modalCard.className = 'ar-tut-modal-card';
        this.modal.appendChild(this.modalCard);
    }

    private renderModal(options: {
        kicker: string;
        title: string;
        body: string;
        glyph: Parameters<typeof glyphSvg>[0];
        actions: { label: string; primary: boolean; action: () => void }[];
    }): void {
        this.modalCard.innerHTML = `
            <div class="ar-tut-glyph big">${glyphSvg(options.glyph)}</div>
            <div class="ar-tut-kicker">${options.kicker}</div>
            <div class="ar-tut-title">${options.title}</div>
            <div class="ar-tut-body">${options.body}</div>
        `;

        const actions = document.createElement('div');
        actions.className = 'ar-tut-actions center';
        for (const { label, primary, action } of options.actions) {
            const button = document.createElement('button');
            button.className = `ar-tut-btn${primary ? ' primary' : ' ghost'}`;
            button.textContent = label;
            this.onPointerDown(button, action);
            actions.appendChild(button);
        }
        this.modalCard.appendChild(actions);

        this.modal.classList.add('visible');
    }

    private renderDots(index: number, total: number): void {
        this.dots.innerHTML = '';
        for (let i = 0; i < total; i++) {
            const dot = document.createElement('span');
            dot.className = 'ar-tut-dot';
            if (i < index) dot.classList.add('done');
            if (i === index) dot.classList.add('current');
            this.dots.appendChild(dot);
        }
    }

    private setNote(text: string | null, kind?: 'hint' | 'blocked'): void {
        this.note.className = 'ar-tut-note';
        if (!text) {
            this.note.textContent = '';
            return;
        }
        this.note.textContent = text;
        this.note.classList.add('visible');
        if (kind) this.note.classList.add(kind);
    }

    private setAccent(mode: ModeName): void {
        this.root.style.setProperty('--ar-tut-accent', ACCENTS[mode]);
    }

    private onPointerDown(element: HTMLElement, callback: () => void): void {
        element.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
            event.preventDefault();
            callback();
        });
    }
}
