import * as THREE from 'three';
import { gestureArbiter, GestureType } from './gestureArbiter.js';

/**
 * HierarchySlider: a thin vertical strip against the left screen edge that
 * lets the user step through the ancestor chain of the currently selected
 * model part (e.g. Window -> Door -> Shell -> Car), snapping to discrete
 * levels. Mirrors VirtualJoycon/PinchScale's touch-handling conventions,
 * claiming the Button slot in the GestureArbiter for the duration of a drag.
 */
export class HierarchySlider {
    private track = document.createElement('div');
    private knob = document.createElement('div');

    private chain: THREE.Object3D[] = [];
    private levelIndex = 0; // 0 = leaf (bottom of track), chain.length-1 = top ancestor
    private dragging = false;

    private readonly onLevelChange: (node: THREE.Object3D) => void;

    constructor(onLevelChange: (node: THREE.Object3D) => void) {
        this.onLevelChange = onLevelChange;
        this.injectStyles();

        this.track.className = 'ar-hierarchy-slider';
        this.knob.className = 'ar-hierarchy-knob';
        this.track.appendChild(this.knob);
    }

    public attach(parent: HTMLElement): void {
        parent.appendChild(this.track);

        this.track.addEventListener('pointerdown', (event) => {
            if (this.chain.length < 2) return;
            event.stopPropagation();
            event.preventDefault();
            if (!gestureArbiter.tryStart(GestureType.Button)) return;

            this.dragging = true;
            this.track.classList.add('dragging');
            this.track.setPointerCapture(event.pointerId);
            this.updateFromClientY(event.clientY);
        }, { passive: false });

        this.track.addEventListener('pointermove', (event) => {
            if (!this.dragging) return;
            event.stopPropagation();
            event.preventDefault();
            this.updateFromClientY(event.clientY);
        }, { passive: false });

        const endDrag = (event: PointerEvent) => {
            if (!this.dragging) return;
            event.stopPropagation();
            this.dragging = false;
            this.track.classList.remove('dragging');
            this.updateKnobPosition();
            gestureArbiter.end(GestureType.Button);
        };
        this.track.addEventListener('pointerup', endDrag);
        this.track.addEventListener('pointercancel', endDrag);

        this.track.addEventListener('beforexrselect', (event) => event.preventDefault());
    }

    /**
     * Rebuilds the slider for a new ancestor chain (as produced by
     * PickHelper.getSelectableAncestorChain). chain[0] is the leaf and
     * becomes the bottom/initial level; the last entry is the topmost
     * meaningful ancestor and becomes the top of the track. Hides itself
     * when there's nothing to navigate (a single-level model).
     */
    public setHierarchy(chain: THREE.Object3D[]): void {
        this.chain = chain;
        this.levelIndex = 0;
        this.updateKnobPosition();
        this.track.style.display = chain.length >= 2 ? 'block' : 'none';
    }

    /** Hides the slider and drops its hierarchy reference. */
    public hide(): void {
        this.chain = [];
        this.levelIndex = 0;
        this.track.style.display = 'none';
    }

    private updateFromClientY(clientY: number): void {
        const rect = this.track.getBoundingClientRect();
        const ratio = 1 - THREE.MathUtils.clamp((clientY - rect.top) / rect.height, 0, 1);
        const levels = this.chain.length;

        this.knob.style.top = `${(1 - ratio) * 100}%`;

        const index = Math.round(ratio * (levels - 1));
        if (index !== this.levelIndex) {
            this.levelIndex = index;
            this.onLevelChange(this.chain[this.levelIndex]);
        }
    }
    private updateKnobPosition(): void {
        const levels = this.chain.length;
        const ratio = levels > 1 ? this.levelIndex / (levels - 1) : 0;
        // Knob travels from bottom (leaf, 0%) to top (highest ancestor, 100%).
        this.knob.style.top = `${(1 - ratio) * 100}%`;
    }

    private injectStyles(): void {
        const styleId = 'ar-hierarchy-slider-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .ar-hierarchy-slider {
                position: fixed;
                left: 0;
                top: 6vh;
                bottom: 6vh;
                width: 28px;
                z-index: 900;
                display: none;
                touch-action: none;
                pointer-events: auto;
            }
            .ar-hierarchy-slider::before {
                content: '';
                position: absolute;
                left: 6px;
                top: 0;
                bottom: 0;
                width: 3px;
                border-radius: 2px;
                background: rgba(255, 255, 255, 0.12);
                transition: background 0.25s;
            }
            .ar-hierarchy-slider.dragging::before {
                background: rgba(255, 255, 255, 0.35);
            }
            .ar-hierarchy-knob {
                position: absolute;
                left: 7.5px;
                width: 14px;
                height: 14px;
                border-radius: 50%;
                background: rgba(0, 123, 255, 0.55);
                border: 1px solid rgba(255, 255, 255, 0.4);
                transform: translate(-50%, -50%) scale(1);
                transition: transform 0.18s cubic-bezier(0.175, 0.885, 0.32, 1.275),
                            background 0.2s,
                            top 0.22s cubic-bezier(0.34, 1.56, 0.64, 1); /* ADD */
                box-shadow: 0 0 8px rgba(0, 0, 0, 0.3);
            }
            .ar-hierarchy-slider.dragging .ar-hierarchy-knob {
                transition: transform 0.18s cubic-bezier(0.175, 0.885, 0.32, 1.275),
                            background 0.2s;
            }
            .ar-hierarchy-slider.dragging .ar-hierarchy-knob {
                transform: translate(-50%, -50%) scale(1.7);
                background: rgba(0, 123, 255, 0.9);
            }
        `;
        document.head.appendChild(style);
    }
}