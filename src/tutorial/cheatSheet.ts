import type { ModeName } from '../modes/interactionMode.js';
import type { GlyphName } from './gestureGlyphs.js';
import { glyphSvg } from './gestureGlyphs.js';
import { injectTutorialStyles } from './tutorialStyles.js';

interface CheatItem {
    glyph: GlyphName;
    title: string;
    description: string;
}

/** Gestures that work everywhere, then those of each interaction state. */
type SectionName = 'view' | ModeName;

const SECTION_LABELS: Record<SectionName, string> = {
    view: 'Everywhere',
    scene: 'No selection',
    selection: 'With selection',
    measure: 'Measuring',
};

/**
 * The view gestures mean the same everywhere; the one-finger gestures depend
 * on whether something is selected. So the sheet opens with the view, then
 * lists the state you are in before the other one.
 */
const CHEATSHEET: Record<SectionName, CheatItem[]> = {
    view: [
        {
            glyph: 'twist',
            title: 'Rotation',
            description: 'Twist two fingers to rotate the scene around the vertical axis.',
        },
        {
            glyph: 'pinch',
            title: 'Zoom / Scale',
            description: 'Pinch or spread two fingers to adjust the scene size (10% to 1000%).',
        },
        {
            glyph: 'tilt',
            title: 'Tilt',
            description: 'Drag two fingers up or down to tilt the scene.',
        },
        {
            glyph: 'ui-tap',
            title: 'Undo / Redo',
            description: 'Tap the arrows in the top-right to undo or redo an action.',
        },
    ],
    scene: [
        {
            glyph: 'tap',
            title: 'Place model',
            description: 'Aim at a detected flat surface and tap the screen to place the model.',
        },
        {
            glyph: 'tap',
            title: 'Select a part',
            description: 'Tap a part of the model to enter selection mode and show its tools.',
        },
        {
            glyph: 'drag',
            title: 'Move or delete',
            description: 'Drag a finger on a model to move it on the surface. Release over the trash to delete it.',
        },
        {
            glyph: 'ui-tap',
            title: 'Choose a model',
            description: 'Tap the "Models" button to open the 3D catalog.',
        },
        {
            glyph: 'ui-tap',
            title: 'Reset',
            description: 'Tap the "Reset" button to reset the whole scene.',
        },
    ],
    selection: [
        {
            glyph: 'hold-up',
            title: 'Exploded view',
            description: 'Hold for ½ s, then drag up to separate parts, down to reassemble them.',
        },
        {
            glyph: 'double-tap',
            title: 'Hide a part',
            description: 'Double-tap a part to temporarily hide it and see inside.',
        },
        {
            glyph: 'ui-tap',
            title: 'Show all parts',
            description: 'Tap "Show all" in the toolbar to reveal all hidden parts.',
        },
        {
            glyph: 'slide-y',
            title: 'Expand selection',
            description: 'Drag on the left vertical rail to expand selection to the subassembly or model.',
        },
        {
            glyph: 'tap',
            title: 'Edit selection',
            description: 'Tap a part to add or remove it. Tap empty space to deselect all.',
        },
        {
            glyph: 'ui-tap',
            title: 'Invert selection',
            description: 'Tap "Invert" in the toolbar to invert the selection.',
        },
    ],
    measure: [
        {
            glyph: 'ui-tap',
            title: 'Measure',
            description: 'With nothing selected, tap "Measure" to show a crosshair at the centre of the screen.',
        },
        {
            glyph: 'ui-tap',
            title: 'Place the ends',
            description: 'Aim the crosshair at a part or a surface and tap + for each end. The length shows in the middle.',
        },
        {
            glyph: 'ui-tap',
            title: 'New ruler',
            description: 'Tap + again to start a new ruler; it replaces the previous one.',
        },
        {
            glyph: 'ui-tap',
            title: 'Remove',
            description: 'Undo removes the last end placed. Reset removes the ruler.',
        },
        {
            glyph: 'ui-tap',
            title: 'Done',
            description: 'Tap "Done" to go back. The ruler stays where it is in the room.',
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
        const ordered: SectionName[] = mode === 'measure'
            ? ['view', 'measure', 'scene', 'selection']
            : mode === 'scene'
                ? ['view', 'scene', 'selection', 'measure']
                : ['view', 'selection', 'scene', 'measure'];

        this.card.innerHTML = `
            <div class="ar-cs-head">
                <div class="ar-cs-title">Help & Gestures</div>
            </div>
            ${ordered.map((name) => this.renderSection(name)).join('')}
        `;

        const close = document.createElement('button');
        close.className = 'ar-cs-close';
        close.textContent = '✕';
        close.setAttribute('aria-label', 'Close');
        this.onPointerDown(close, () => this.close());
        this.card.querySelector('.ar-cs-head')?.appendChild(close);

        const replay = document.createElement('button');
        replay.className = 'ar-tut-btn primary';
        replay.textContent = 'Replay guide';
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
                        <div class="ar-cs-item-title">${item.title}</div>
                        <div class="ar-cs-item-desc">${item.description}</div>
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
