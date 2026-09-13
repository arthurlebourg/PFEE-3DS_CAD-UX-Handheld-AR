import * as THREE from 'three';
import { gestureArbiter, GestureType } from './gestureArbiter.js';

/**
 * HierarchySlider: a Snap Map-style edge slider against the left screen edge
 * that lets the user step through the ancestor chain of the currently
 * selected model part (e.g. Window -> Door -> Shell -> Car). Discreet at
 * rest; on touch the rail widens, notches appear and a bubble shows the
 * current level's name. Dragging is relative (no jump on touch-down), the
 * thumb follows the finger freely, ticks a haptic pulse on each level and
 * springs to the nearest notch on release. Claims the Button slot in the
 * GestureArbiter for the duration of a drag.
 */
export class HierarchySlider {
    private track = document.createElement('div');
    private thumb = document.createElement('div');
    private label = document.createElement('div');
    private ticks: HTMLDivElement[] = [];

    private chain: THREE.Object3D[] = [];
    private levelIndex = 0; // 0 = leaf (bottom of track), chain.length-1 = top ancestor
    private dragging = false;
    private dragStartY = 0;
    private dragStartRatio = 0;

    private readonly onLevelChange: (node: THREE.Object3D) => void;

    constructor(onLevelChange: (node: THREE.Object3D) => void) {
        this.onLevelChange = onLevelChange;
        this.injectStyles();

        this.track.className = 'ar-hierarchy-slider';
        this.thumb.className = 'ar-hierarchy-thumb';
        this.label.className = 'ar-hierarchy-label';
        const knob = document.createElement('div');
        knob.className = 'ar-hierarchy-knob';
        this.thumb.append(knob, this.label);
        this.track.appendChild(this.thumb);
    }

    public attach(parent: HTMLElement): void {
        parent.appendChild(this.track);

        this.track.addEventListener('pointerdown', (event) => {
            if (this.chain.length < 2) return;
            event.stopPropagation();
            event.preventDefault();
            if (!gestureArbiter.tryStart(GestureType.Button)) return;

            this.dragging = true;
            this.dragStartY = event.clientY;
            this.dragStartRatio = this.levelRatio(this.levelIndex);
            this.track.classList.add('dragging');
            this.track.setPointerCapture(event.pointerId);
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
            this.setThumbRatio(this.levelRatio(this.levelIndex));
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

        for (const tick of this.ticks) tick.remove();
        this.ticks = chain.map((_, i) => {
            const tick = document.createElement('div');
            tick.className = 'ar-hierarchy-tick';
            tick.style.top = `${(1 - this.levelRatio(i)) * 100}%`;
            this.track.insertBefore(tick, this.thumb);
            return tick;
        });

        this.applyLevel();
        this.setThumbRatio(0);
        this.track.style.display = chain.length >= 2 ? 'block' : 'none';
    }

    /** Hides the slider and drops its hierarchy reference. */
    public hide(): void {
        this.chain = [];
        this.levelIndex = 0;
        this.track.style.display = 'none';
    }

    private updateFromClientY(clientY: number): void {
        const height = this.track.getBoundingClientRect().height;
        const ratio = THREE.MathUtils.clamp(this.dragStartRatio + (this.dragStartY - clientY) / height, 0, 1);
        this.setThumbRatio(ratio);

        const index = Math.round(ratio * (this.chain.length - 1));
        if (index !== this.levelIndex) {
            this.levelIndex = index;
            this.applyLevel();
            navigator.vibrate?.(8);
            this.onLevelChange(this.chain[this.levelIndex]);
        }
    }

    private applyLevel(): void {
        this.label.textContent = this.chain[this.levelIndex]?.name || 'Part';
        this.ticks.forEach((tick, i) => tick.classList.toggle('active', i === this.levelIndex));
    }

    private levelRatio(index: number): number {
        const levels = this.chain.length;
        return levels > 1 ? index / (levels - 1) : 0;
    }

    private setThumbRatio(ratio: number): void {
        // Thumb travels from bottom (leaf, 0) to top (highest ancestor, 1).
        this.thumb.style.top = `${(1 - ratio) * 100}%`;
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
                top: 18vh;
                bottom: 18vh;
                width: 36px;
                z-index: 900;
                display: none;
                touch-action: none;
                pointer-events: auto;
            }
            .ar-hierarchy-slider::before {
                content: '';
                position: absolute;
                left: 12px;
                top: 0;
                bottom: 0;
                width: 4px;
                border-radius: 2px;
                background: rgba(255, 255, 255, 0.25);
                box-shadow: 0 0 6px rgba(0, 0, 0, 0.35);
                transform: translateX(-50%);
                transition: width 0.2s, background 0.2s;
            }
            .ar-hierarchy-slider.dragging::before {
                width: 8px;
                background: rgba(255, 255, 255, 0.45);
            }
            .ar-hierarchy-tick {
                position: absolute;
                left: 12px;
                width: 4px;
                height: 4px;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.9);
                transform: translate(-50%, -50%) scale(0);
                transition: transform 0.2s;
                pointer-events: none;
            }
            .ar-hierarchy-slider.dragging .ar-hierarchy-tick {
                transform: translate(-50%, -50%) scale(1);
            }
            .ar-hierarchy-thumb {
                position: absolute;
                left: 12px;
                width: 0;
                height: 0;
                pointer-events: none;
                transition: top 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            .ar-hierarchy-slider.dragging .ar-hierarchy-thumb {
                transition: none;
            }
            .ar-hierarchy-knob {
                position: absolute;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: #fff;
                box-shadow: 0 1px 6px rgba(0, 0, 0, 0.45);
                transform: translate(-50%, -50%);
                transition: transform 0.18s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            }
            .ar-hierarchy-slider.dragging .ar-hierarchy-knob {
                transform: translate(-50%, -50%) scale(1.5);
            }
            .ar-hierarchy-label {
                position: absolute;
                left: 22px;
                padding: 5px 11px;
                border-radius: 14px;
                background: rgba(15, 15, 20, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.15);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                color: #fff;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 13px;
                font-weight: 600;
                white-space: nowrap;
                opacity: 0;
                transform: translate(-6px, -50%);
                transition: opacity 0.25s 0.6s, transform 0.25s 0.6s;
            }
            .ar-hierarchy-slider.dragging .ar-hierarchy-label {
                opacity: 1;
                transform: translate(0, -50%);
                transition: opacity 0.12s, transform 0.12s;
            }
        `;
        document.head.appendChild(style);
    }
}
