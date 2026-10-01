import type { ModeName } from '../modes/interactionMode.js';
import type { GlyphName } from './gestureGlyphs.js';
import { glyphSvg } from './gestureGlyphs.js';
import { injectTutorialStyles } from './tutorialStyles.js';

interface CheatItem {
    glyph: GlyphName;
    gesture: string;
    effect: string;
}

const MODE_LABELS: Record<ModeName, string> = {
    edit: 'Mode Édition',
    inspect: 'Mode Inspection',
};

/**
 * The same gesture means different things per mode — a two-finger pinch scales
 * in Édition and explodes in Inspection — so the sheet is grouped by mode
 * rather than by gesture, with the mode you are in listed first.
 */
const CHEATSHEET: Record<ModeName, CheatItem[]> = {
    edit: [
        {
            glyph: 'tap',
            gesture: 'Toucher',
            effect: 'Poser le modèle armé, ou sélectionner un modèle déjà posé.',
        },
        {
            glyph: 'hold-drag',
            gesture: 'Maintenir 1 s, puis glisser',
            effect: 'Un joystick apparaît : faites tourner la scène horizontalement.',
        },
        {
            glyph: 'pinch',
            gesture: 'Pincer à deux doigts',
            effect: "Ajuster l'échelle perçue de la scène, de 10 % à 1000 %.",
        },
    ],
    inspect: [
        { glyph: 'tap', gesture: 'Toucher', effect: 'Sélectionner une pièce du modèle.' },
        { glyph: 'double-tap', gesture: 'Double-toucher', effect: 'Masquer la pièce visée.' },
        {
            glyph: 'pinch',
            gesture: 'Pincer à deux doigts',
            effect: 'Éclater la vue : les pièces s’écartent du centre du modèle.',
        },
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
        const ordered: ModeName[] = mode === 'edit' ? ['edit', 'inspect'] : ['inspect', 'edit'];

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

    private renderSection(mode: ModeName): string {
        const rows = CHEATSHEET[mode]
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
            <div class="ar-cs-section" data-mode="${mode}">
                <div class="ar-cs-section-title">${MODE_LABELS[mode]}</div>
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
