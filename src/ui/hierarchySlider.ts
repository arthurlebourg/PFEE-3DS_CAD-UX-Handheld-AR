import * as THREE from 'three';
import type { AssemblyStep } from '../scene/assemblyTree.js';

/** Rail line distance from the left edge (plus the safe area): clear of Android's back gesture. */
const RAIL_X = 32;
/** Touch zone: from 12 px left of the rail to 44 px inward, never reaching the edge. */
const HIT_LEFT = RAIL_X - 12;
const HIT_WIDTH = 56;
/** Gap between two step dots; also the vertical touch target of each dot. */
const DOT_SPACING = 48;
/** Room above the top dot and below the bottom one, so end dots keep a full target. */
const END_PAD = 22;
/** The rail never grows taller than this share of the viewport. */
const MAX_HEIGHT_RATIO = 0.6;

/**
 * HierarchySlider: a vertical rail near the left edge stepping through the
 * granularity of the current Inspect selection, from the picked piece (bottom
 * dot) up to the whole model (top dot), as built by the assembly tree.
 *
 * Shown while a piece is selected, hidden on deselection. A tap anywhere on
 * the rail jumps to the nearest dot; dragging follows the finger and snaps to
 * the dots. The touch zone starts 20 px from the edge, so a drag never begins
 * where the system back gesture lives. The root keeps the
 * `ar-hierarchy-slider` class, which the GestureRecognizer treats as UI.
 *
 * No label: the rail only shows how high the selection sits in the CAD
 * hierarchy; screen readers get the step and its piece count.
 *
 * Tapping another piece keeps the current height: if the selection sits two
 * steps above its piece, the new selection is the new piece's ancestor two
 * steps up (bounded by the root).
 */
export class HierarchySlider {
    private root = document.createElement('div');
    private rail = document.createElement('div');
    private handle = document.createElement('div');
    private dots: HTMLDivElement[] = [];

    private steps: AssemblyStep[] = [];
    private levelIndex = 0; // 0 = piece (bottom dot), steps.length - 1 = whole model
    private trackLength = 0;
    private dragging = false;

    private readonly onLevelChange: (step: AssemblyStep, level: number) => void;

    constructor(onLevelChange: (step: AssemblyStep, level: number) => void) {
        this.onLevelChange = onLevelChange;
        this.injectStyles();

        this.root.className = 'ar-hierarchy-slider';
        this.root.tabIndex = 0;
        this.root.setAttribute('role', 'slider');
        this.root.setAttribute('aria-orientation', 'vertical');
        this.root.setAttribute('aria-label', 'Granularité de la sélection');
        this.root.setAttribute('aria-valuemin', '0');

        this.rail.className = 'ar-hs-rail';
        this.handle.className = 'ar-hs-handle';
        this.root.append(this.rail, this.handle);
    }

    public attach(parent: HTMLElement): void {
        parent.appendChild(this.root);

        this.root.addEventListener('pointerdown', (event) => {
            if (!event.isPrimary || this.steps.length < 2) return;
            event.stopPropagation();
            event.preventDefault();

            this.dragging = true;
            this.root.classList.add('dragging');
            this.root.setPointerCapture(event.pointerId);
            this.updateFromClientY(event.clientY);
        });

        this.root.addEventListener('pointermove', (event) => {
            if (!this.dragging) return;
            event.stopPropagation();
            event.preventDefault();
            this.updateFromClientY(event.clientY);
        });

        const endDrag = (event: PointerEvent) => {
            if (!this.dragging) return;
            event.stopPropagation();
            this.dragging = false;
            this.root.classList.remove('dragging');
            this.placeHandle(this.dotY(this.levelIndex));
        };
        this.root.addEventListener('pointerup', endDrag);
        this.root.addEventListener('pointercancel', endDrag);

        this.root.addEventListener('keydown', (event) => this.onKeyDown(event));
        this.root.addEventListener('beforexrselect', (event) => event.preventDefault());

        // Orientation changes resize the viewport, hence the rail.
        window.addEventListener('resize', () => {
            if (this.steps.length > 0) this.layout();
        });
    }

    /**
     * Shows the steps of a freshly picked piece. While the rail is already up,
     * the current height is kept (bounded by the new chain) and re-applied, so
     * the selection becomes the new piece's ancestor at that height.
     */
    public setHierarchy(steps: AssemblyStep[]): void {
        const wasVisible = this.steps.length > 0;
        const level = wasVisible ? Math.min(this.levelIndex, steps.length - 1) : 0;

        this.steps = steps;
        this.levelIndex = level;

        for (const dot of this.dots) dot.remove();
        this.dots = steps.map(() => {
            const dot = document.createElement('div');
            dot.className = 'ar-hs-dot';
            this.root.insertBefore(dot, this.handle);
            return dot;
        });

        const flat = steps.length < 2;
        this.root.classList.toggle('disabled', flat);
        this.root.setAttribute('aria-disabled', String(flat));
        this.root.setAttribute('aria-valuemax', String(Math.max(0, steps.length - 1)));
        this.root.classList.add('visible');

        this.layout();
        this.applyLevel();

        if (level > 0) {
            this.onLevelChange(steps[level], level);
        }
    }

    /** Hides the rail and forgets the chain and its height. */
    public hide(): void {
        this.steps = [];
        this.levelIndex = 0;
        this.dragging = false;
        this.root.classList.remove('visible', 'dragging');
    }

    // -------------------------------------------------------------------------
    // Layout
    // -------------------------------------------------------------------------

    private layout(): void {
        const gaps = Math.max(1, this.steps.length - 1);
        const maxTrack = window.innerHeight * MAX_HEIGHT_RATIO - 2 * END_PAD;
        this.trackLength = this.steps.length < 2 ? 0 : Math.min(DOT_SPACING * gaps, maxTrack);

        this.root.style.height = `${this.trackLength + 2 * END_PAD}px`;
        this.dots.forEach((dot, i) => {
            dot.style.top = `${this.dotY(i)}px`;
        });
        this.placeHandle(this.dotY(this.levelIndex));
    }

    /** Dot centre, from the top of the root: step 0 at the bottom. */
    private dotY(index: number): number {
        const gaps = this.steps.length - 1;
        return END_PAD + (gaps > 0 ? (1 - index / gaps) * this.trackLength : 0);
    }

    private placeHandle(y: number): void {
        this.handle.style.top = `${y}px`;
    }

    // -------------------------------------------------------------------------
    // Interaction
    // -------------------------------------------------------------------------

    private updateFromClientY(clientY: number): void {
        const top = this.root.getBoundingClientRect().top;
        const y = THREE.MathUtils.clamp(clientY - top, END_PAD, END_PAD + this.trackLength);
        this.placeHandle(y);

        const ratio = this.trackLength > 0 ? 1 - (y - END_PAD) / this.trackLength : 0;
        this.setLevel(Math.round(ratio * (this.steps.length - 1)));
    }

    private onKeyDown(event: KeyboardEvent): void {
        if (this.steps.length < 2) return;

        let next: number;
        switch (event.key) {
            case 'ArrowUp': case 'ArrowRight': next = this.levelIndex + 1; break;
            case 'ArrowDown': case 'ArrowLeft': next = this.levelIndex - 1; break;
            case 'Home': next = 0; break;
            case 'End': next = this.steps.length - 1; break;
            default: return;
        }
        event.preventDefault();
        this.setLevel(THREE.MathUtils.clamp(next, 0, this.steps.length - 1));
        this.placeHandle(this.dotY(this.levelIndex));
    }

    private setLevel(index: number): void {
        if (index === this.levelIndex) return;
        this.levelIndex = index;
        this.applyLevel();
        navigator.vibrate?.(8);
        this.onLevelChange(this.steps[index], index);
    }

    private applyLevel(): void {
        this.dots.forEach((dot, i) => dot.classList.toggle('active', i === this.levelIndex));
        if (!this.dragging) this.placeHandle(this.dotY(this.levelIndex));

        const step = this.steps[this.levelIndex];
        const text = this.steps.length < 2
            ? 'Pas de sous-ensembles dans ce modèle'
            : `Niveau ${this.levelIndex + 1} sur ${this.steps.length}, ${step.pieces} pièce${step.pieces > 1 ? 's' : ''}`;
        this.root.setAttribute('aria-valuenow', String(this.levelIndex));
        this.root.setAttribute('aria-valuetext', text);
    }

    // -------------------------------------------------------------------------
    // CSS injection
    // -------------------------------------------------------------------------

    private injectStyles(): void {
        const styleId = 'ar-hierarchy-slider-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        // Same look as the model picker: dark, flat, one accent for the active step.
        style.textContent = `
            .ar-hierarchy-slider {
                position: fixed;
                left: calc(${HIT_LEFT}px + env(safe-area-inset-left, 0px));
                top: 50%;
                width: ${HIT_WIDTH}px;
                transform: translateY(-50%);
                z-index: 900;
                display: none;
                touch-action: none;
                pointer-events: auto;
                outline: none;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            .ar-hierarchy-slider.visible { display: block; }
            .ar-hierarchy-slider:focus-visible .ar-hs-handle { box-shadow: 0 0 0 3px #fff; }

            .ar-hs-rail {
                position: absolute;
                left: ${RAIL_X - HIT_LEFT}px;
                top: ${END_PAD}px;
                bottom: ${END_PAD}px;
                width: 2px;
                border-radius: 1px;
                background: rgba(255, 255, 255, 0.3);
                box-shadow: 0 0 4px rgba(0, 0, 0, 0.4);
                transform: translateX(-50%);
                pointer-events: none;
            }

            .ar-hs-dot {
                position: absolute;
                left: ${RAIL_X - HIT_LEFT}px;
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.6);
                box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
                transform: translate(-50%, -50%);
                pointer-events: none;
            }
            .ar-hs-dot.active { background: #007bff; }

            .ar-hs-handle {
                position: absolute;
                left: ${RAIL_X - HIT_LEFT}px;
                width: 22px;
                height: 22px;
                box-sizing: border-box;
                border-radius: 50%;
                border: 2px solid #007bff;
                background: rgba(18, 18, 18, 0.92);
                box-shadow: 0 1px 6px rgba(0, 0, 0, 0.45);
                transform: translate(-50%, -50%);
                transition: top 0.15s ease-out;
                pointer-events: none;
            }
            .ar-hierarchy-slider.dragging .ar-hs-handle { transition: none; }

            .ar-hierarchy-slider.disabled .ar-hs-rail,
            .ar-hierarchy-slider.disabled .ar-hs-dot { display: none; }
            .ar-hierarchy-slider.disabled .ar-hs-handle { border-color: rgba(255, 255, 255, 0.3); }

            @media (prefers-reduced-motion: reduce) {
                .ar-hs-handle { transition: none; }
            }
        `;
        document.head.appendChild(style);
    }
}
