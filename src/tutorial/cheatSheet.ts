import type { ModeName } from '../modes/interactionMode.js';
import type { GlyphName } from './gestureGlyphs.js';
import { glyphSvg } from './gestureGlyphs.js';
import { injectTutorialStyles } from './tutorialStyles.js';

interface CheatItem {
    glyph: GlyphName;
    gesture: string;
    effect: string;
}

/** Gestures that work everywhere, then those of each interaction state. */
type SectionName = 'view' | ModeName;

const SECTION_LABELS: Record<SectionName, string> = {
    view: 'Partout',
    scene: 'Sans sélection',
    selection: 'Avec une sélection',
};

/**
 * The view gestures mean the same everywhere; the one-finger gestures depend
 * on whether something is selected. So the sheet opens with the view, then
 * lists the state you are in before the other one.
 */
const CHEATSHEET: Record<SectionName, CheatItem[]> = {
    view: [
        {
            glyph: 'pinch',
            gesture: 'Pincer à deux doigts',
            effect: "Ajuster l'échelle perçue de la scène, de 10 % à 1000 %.",
        },
        {
            glyph: 'twist',
            gesture: 'Tourner à deux doigts',
            effect: 'Faire pivoter la scène autour de la verticale.',
        },
        {
            glyph: 'tilt',
            gesture: 'Glisser deux doigts vers le haut ou le bas',
            effect: 'Incliner la scène, jusqu’à 90°.',
        },
    ],
    scene: [
        {
            glyph: 'tap',
            gesture: 'Toucher',
            effect: 'Poser le modèle choisi, ou sélectionner une pièce.',
        },
        {
            glyph: 'drag',
            gesture: 'Glisser un doigt sur un modèle',
            effect: 'Le déplacer sur la surface. Le lâcher sur la corbeille le supprime.',
        },
        {
            glyph: 'ui-tap',
            gesture: 'Réinitialiser',
            effect: 'Remettre toute la scène à zéro : vue, modèles, pièces.',
        },
    ],
    selection: [
        {
            glyph: 'tap',
            gesture: 'Toucher',
            effect: 'Ajouter ou retirer une pièce. Toucher le vide désélectionne tout.',
        },
        {
            glyph: 'slide-y',
            gesture: 'Glisser sur le rail gauche',
            effect: 'Élargir la sélection à l’ensemble qui contient la pièce.',
        },
        {
            glyph: 'hold-up',
            gesture: 'Maintenir ½ s, puis glisser',
            effect: 'Vers le haut : éclater le modèle. Vers le bas : le rassembler.',
        },
        { glyph: 'double-tap', gesture: 'Double-toucher', effect: 'Masquer la pièce visée.' },
    ],
};

/**
 * CheatSheet: the permanent reference behind the ? button.
 *
 * The guided tour runs once; this stays. It is a modal on purpose — it is read,
 * not practised against, so it may cover the scene.
 */
export class CheatSheet {
    private readonly onReplay: () => void;

    private root = document.createElement('div');
    private card = document.createElement('div');
    private isOpen = false;

    constructor(onReplay: () => void) {
        this.onReplay = onReplay;

        injectTutorialStyles();

        this.root.className = 'ar-cheatsheet';
        this.card.className = 'ar-cs-card';
        this.root.appendChild(this.card);

        this.root.addEventListener('beforexrselect', (event) => {
            event.preventDefault();
        });
        // Tapping the backdrop closes, tapping the card does not.
        this.root.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
            if (event.target === this.root) this.close();
        });
    }

    public attach(parent: HTMLElement): void {
        parent.appendChild(this.root);
    }

    public open(mode: ModeName): void {
        this.render(mode);
        this.isOpen = true;
        this.root.classList.add('open');
    }

    public close(): void {
        this.isOpen = false;
        this.root.classList.remove('open');
    }

    public toggle(mode: ModeName): void {
        if (this.isOpen) {
            this.close();
        } else {
            this.open(mode);
        }
    }

    private render(mode: ModeName): void {
        const ordered: SectionName[] = mode === 'scene'
            ? ['view', 'scene', 'selection']
            : ['view', 'selection', 'scene'];

        this.card.innerHTML = `
            <div class="ar-cs-head">
                <div class="ar-cs-title">Gestes</div>
            </div>
            ${ordered.map((name) => this.renderSection(name)).join('')}
        `;

        const close = document.createElement('button');
        close.className = 'ar-cs-close';
        close.textContent = '✕';
        close.setAttribute('aria-label', 'Fermer');
        this.onPointerDown(close, () => this.close());
        this.card.querySelector('.ar-cs-head')?.appendChild(close);

        const replay = document.createElement('button');
        replay.className = 'ar-tut-btn primary';
        replay.textContent = 'Revoir le guide';
        this.onPointerDown(replay, () => {
            this.close();
            this.onReplay();
        });

        const foot = document.createElement('div');
        foot.className = 'ar-cs-foot';
        foot.appendChild(replay);
        this.card.appendChild(foot);
    }

    private renderSection(section: SectionName): string {
        const rows = CHEATSHEET[section]
            .map(
                (item) => `
                <div class="ar-cs-row">
                    <div class="ar-cs-glyph">${glyphSvg(item.glyph)}</div>
                    <div>
                        <div class="ar-cs-gesture">${item.gesture}</div>
                        <div class="ar-cs-effect">${item.effect}</div>
                    </div>
                </div>`,
            )
            .join('');

        return `
            <div class="ar-cs-section" data-section="${section}">
                <div class="ar-cs-section-title">${SECTION_LABELS[section]}</div>
                ${rows}
            </div>`;
    }

    private onPointerDown(element: HTMLElement, callback: () => void): void {
        element.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
            event.preventDefault();
            callback();
        });
    }
}
