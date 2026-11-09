import { createIcons, Settings, Layers, Eye, Activity, RotateCcw, FlipHorizontal, Undo, Redo, CircleQuestionMark, X, LogOut } from 'lucide';
import type { ModeName } from '../modes/interactionMode.js';
import { ModelPicker } from './modelPicker.js';

export interface UIManagerCallbacks {
    /** A model was chosen in the model picker. */
    onModelSelect: (modelName: string) => void;
    /** Resets the whole scene (view, models, explode, hidden pieces). */
    onReset: () => void;
    /** Inverts the piece selection. */
    onInvertSelection: () => void;
    /** Reveals every hidden piece. */
    onShowAll: () => void;
    /** Clears the selection, back to the Scene state. */
    onCloseSelection: () => void;
    /** Leaves the AR session. */
    onExit: () => void;
    /** Undo the last action. */
    onUndo: () => void;
    /** Redo the last undone action. */
    onRedo: () => void;
    /** Dev only: toggle the picking-colours debug view. */
    onDebugToggle?: (showColors: boolean) => void;
    /** Dev only: toggle the perf stats overlay. */
    onPerfToggle?: (showPerf: boolean) => void;
    /** Opens the gesture cheat sheet. */
    onHelp?: () => void;
}

/**
 * UI landmarks the tutorial can ring with its spotlight. Declared here because
 * this class owns the buttons; the tutorial only asks where they are.
 */
export type UITarget = 'models' | 'reset' | 'toolbar' | 'help';

/**
 * UIManager: Manages the 2D HTML buttons overlaying the WebXR scene.
 *
 * What shows follows the interaction state, never a mode button:
 *   - Scene (nothing selected): the quick column, bottom right, with
 *     Réinitialiser (the whole scene) and Modèles (the model picker).
 *   - Selection: the toolbar, bottom centre, with Inverser and Fermer; the
 *     quick column hides to free the view.
 *   - "Tout afficher (n)" joins the toolbar in both states while pieces are
 *     hidden: a hidden piece can no longer be tapped to bring it back.
 * Always there: Quitter and help (top left), Undo / Redo (top right).
 * Dev mode adds a gear radial menu with the debug buttons (picking colours,
 * perf stats); in prod the gear is omitted entirely.
 *
 * Activated via isDevMode (driven by ?dev=TOKEN in the URL, see devMode.ts).
 */
export class UIManager {
    public showPickingColors = false;
    public showPerf = false;

    private quickContainer = document.createElement('div');
    private btnReset = document.createElement('button');
    private btnModel = document.createElement('button');
    private btnHelp = document.createElement('button');
    private btnExit = document.createElement('button');
    private readonly modelPicker: ModelPicker;

    // Bottom-centre toolbar
    private toolbar = document.createElement('div');
    private btnInvert = document.createElement('button');
    private btnShowAll = document.createElement('button');
    private showAllLabel = document.createElement('span');
    private btnClose = document.createElement('button');

    // History buttons (Undo / Redo)
    private historyContainer = document.createElement('div');
    private btnUndo = document.createElement('button');
    private btnRedo = document.createElement('button');

    // Dev-only gear radial menu
    private container = document.createElement('div');
    private btnGear = document.createElement('button');
    private btnDebug: HTMLButtonElement | null = null;
    private btnPerf: HTMLButtonElement | null = null;

    private isOpen = false;
    private sessionActive = false;
    private activeModelName = '';
    private mode: ModeName = 'scene';
    private hiddenCount = 0;
    /** True while a model is dragged: the trash takes the toolbar's place. */
    private moving = false;
    private readonly isDevMode: boolean;

    private readonly callbacks: UIManagerCallbacks;

    constructor(callbacks: UIManagerCallbacks, models: string[], isDevMode = false) {
        this.callbacks = callbacks;
        this.isDevMode = isDevMode;

        this.injectStyles();

        // Quick-access column: reset + model picker button
        this.quickContainer.className =
            'ar-quick-container' + (isDevMode ? ' with-gear' : '');

        this.btnReset.className = 'ar-quick-btn btn-reset';
        this.btnReset.innerHTML = `<i data-lucide="rotate-ccw"></i>`;
        this.btnReset.setAttribute('aria-label', 'Réinitialiser la scène');

        this.btnModel.className = 'ar-quick-btn btn-model';
        this.btnModel.innerHTML = `<i data-lucide="layers"></i>`;
        this.btnModel.setAttribute('aria-label', 'Choisir un modèle');
        this.btnModel.setAttribute('aria-haspopup', 'dialog');
        this.btnModel.setAttribute('aria-expanded', 'false');

        this.quickContainer.append(
            this.quickItem(this.btnReset, 'Réinitialiser'),
            this.quickItem(this.btnModel, 'Modèles'),
        );

        // Quitter and help share the top-left corner, away from the toolbar.
        this.btnExit.className = 'ar-exit-btn';
        this.btnExit.innerHTML = `<i data-lucide="log-out"></i>`;
        this.btnExit.setAttribute('aria-label', 'Quitter la réalité augmentée');

        this.btnHelp.className = 'ar-help-btn';
        this.btnHelp.innerHTML = `<i data-lucide="circle-question-mark"></i>`;
        this.btnHelp.setAttribute('aria-label', 'Aide : gestes');

        // Toolbar: selection actions, plus "Tout afficher" while pieces are hidden
        this.toolbar.className = 'ar-toolbar';
        this.toolbar.setAttribute('role', 'toolbar');

        this.btnInvert.className = 'ar-tool-btn btn-invert';
        this.btnInvert.innerHTML = `<i data-lucide="flip-horizontal"></i><span>Inverser</span>`;
        this.btnInvert.setAttribute('aria-label', 'Inverser la sélection');

        this.btnShowAll.className = 'ar-tool-btn btn-show-all';
        this.btnShowAll.innerHTML = `<i data-lucide="eye"></i>`;
        this.btnShowAll.appendChild(this.showAllLabel);

        this.btnClose.className = 'ar-tool-btn btn-close';
        this.btnClose.innerHTML = `<i data-lucide="x"></i><span>Fermer</span>`;
        this.btnClose.setAttribute('aria-label', 'Fermer la sélection');

        this.toolbar.append(this.btnInvert, this.btnShowAll, this.btnClose);

        // History buttons (Undo / Redo)
        this.historyContainer.className = 'ar-history-container';

        this.btnUndo.className = 'ar-history-btn btn-undo disabled';
        this.btnUndo.innerHTML = `<i data-lucide="undo"></i>`;
        this.btnUndo.title = 'Annuler (Undo)';
        this.btnUndo.setAttribute('aria-label', 'Annuler');

        this.btnRedo.className = 'ar-history-btn btn-redo disabled';
        this.btnRedo.innerHTML = `<i data-lucide="redo"></i>`;
        this.btnRedo.title = 'Rétablir (Redo)';
        this.btnRedo.setAttribute('aria-label', 'Rétablir');

        this.historyContainer.append(this.btnUndo, this.btnRedo);

        // Dev-only gear radial menu (debug buttons)
        this.container.className = 'ar-menu-container';
        this.btnGear.className = 'ar-menu-btn ar-btn-gear';
        this.btnGear.innerHTML = `<i data-lucide="settings"></i>`;
        if (isDevMode) {
            this.btnDebug = this.createRadialButton('btn-debug', 'eye',      'Couleurs: OFF');
            this.btnPerf  = this.createRadialButton('btn-perf',  'activity', 'Statistiques: OFF');
        }

        // Model picker modal
        this.modelPicker = new ModelPicker(models, {
            onSelect: (model) => this.selectModel(model),
            onClose: () => {
                this.btnModel.classList.remove('active');
                this.btnModel.setAttribute('aria-expanded', 'false');
            },
        });

        if (models.length > 0) {
            this.activeModelName = models[0];
        }

        // Wire up events
        this.addPointerDownListener(this.btnModel,   () => this.toggleModelPanel());
        // pointerdown never fires from the keyboard; a click handler would
        // double-toggle after a tap, so Enter/Space are wired explicitly.
        this.btnModel.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                this.toggleModelPanel();
            }
        });
        this.addPointerDownListener(this.btnReset,   () => this.callbacks.onReset());
        this.addPointerDownListener(this.btnGear,    () => this.toggleGear());
        this.addPointerDownListener(this.btnInvert,  () => this.callbacks.onInvertSelection());
        this.addPointerDownListener(this.btnShowAll, () => this.callbacks.onShowAll());
        this.addPointerDownListener(this.btnClose,   () => this.callbacks.onCloseSelection());
        this.addPointerDownListener(this.btnExit,    () => this.callbacks.onExit());
        this.addPointerDownListener(this.btnUndo,    () => {
            if (!this.btnUndo.classList.contains('disabled')) {
                this.callbacks.onUndo();
            }
        });
        this.addPointerDownListener(this.btnRedo,    () => {
            if (!this.btnRedo.classList.contains('disabled')) {
                this.callbacks.onRedo();
            }
        });
        this.addPointerDownListener(this.btnHelp,    () => this.callbacks.onHelp?.());
        if (this.btnDebug) this.addPointerDownListener(this.btnDebug, () => this.toggleDebug());
        if (this.btnPerf)  this.addPointerDownListener(this.btnPerf,  () => this.togglePerf());

        // Prevent XR select events from bubbling through the overlay
        for (const element of [
            this.quickContainer, this.container, this.toolbar, this.historyContainer,
            this.btnHelp, this.btnExit,
        ]) {
            element.addEventListener('beforexrselect', (e) => e.preventDefault());
        }

        const buttons: HTMLButtonElement[] = [this.btnGear];
        if (this.btnDebug) buttons.push(this.btnDebug);
        if (this.btnPerf)  buttons.push(this.btnPerf);
        this.container.append(...buttons);

        this.updateUI();
    }

    /**
     * Attaches the UI to the DOM and hydrates Lucide icon placeholders.
     */
    public attach(parent: HTMLElement): void {
        parent.appendChild(this.quickContainer);
        if (this.isDevMode) {
            parent.appendChild(this.container);
        }
        this.modelPicker.attach(parent);
        parent.appendChild(this.toolbar);
        parent.appendChild(this.historyContainer);
        parent.appendChild(this.btnExit);
        parent.appendChild(this.btnHelp);

        this.hydrateIcons();
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /** Reflects the active interaction state (called by the ModeManager's onChange). */
    public setMode(mode: ModeName): void {
        this.mode = mode;
        if (mode === 'selection') {
            this.modelPicker.close();
        }
        this.updateUI();
    }

    /** Number of hidden pieces: shows "Tout afficher (n)" while it is not 0. */
    public setHiddenCount(count: number): void {
        this.hiddenCount = count;
        this.updateUI();
    }

    /** Hides the toolbar while a model is dragged, so it never covers the trash. */
    public setMoving(moving: boolean): void {
        this.moving = moving;
        this.updateUI();
    }

    /**
     * Bounding box of a UI landmark, for the tutorial's spotlight ring.
     * A hidden element reports an empty rect, which the overlay reads as
     * "nothing to point at".
     */
    public getSpotlightRect(target: UITarget): DOMRect | null {
        switch (target) {
            case 'models':
                return this.btnModel.getBoundingClientRect();
            case 'reset':
                return this.btnReset.getBoundingClientRect();
            case 'toolbar':
                return this.toolbar.getBoundingClientRect();
            case 'help':
                return this.btnHelp.getBoundingClientRect();
        }
    }

    /** Updates the enabled state of the Undo and Redo buttons. */
    public updateHistoryState(canUndo: boolean, canRedo: boolean): void {
        this.btnUndo.classList.toggle('disabled', !canUndo);
        this.btnRedo.classList.toggle('disabled', !canRedo);
    }

    public toggleVisibility(show: boolean): void {
        this.sessionActive = show;
        if (!show) {
            this.isOpen = false;
            this.container.classList.remove('open');
            this.modelPicker.close();
            this.showPickingColors = false;
            this.showPerf = false;
        }
        this.updateUI();
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private quickItem(button: HTMLButtonElement, caption: string): HTMLDivElement {
        const label = document.createElement('span');
        label.className = 'ar-quick-caption';
        label.textContent = caption;
        const item = document.createElement('div');
        item.className = 'ar-quick-item';
        item.append(button, label);
        return item;
    }

    private hydrateIcons(): void {
        createIcons({
            icons: {
                Settings, Layers, Eye, Activity, RotateCcw, FlipHorizontal,
                Undo, Redo, CircleQuestionMark, X, LogOut,
            }
        });
    }

    private createRadialButton(className: string, iconName: string, labelText: string): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className = `ar-menu-btn ar-radial-btn ${className}`;
        btn.innerHTML = `<i data-lucide="${iconName}"></i><span class="ar-radial-label">${labelText}</span>`;
        return btn;
    }

    private addPointerDownListener(element: HTMLElement, callback: () => void): void {
        element.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
            event.preventDefault();

            callback();
        });
    }

    private toggleGear(): void {
        this.isOpen = !this.isOpen;
        this.container.classList.toggle('open', this.isOpen);
    }

    private toggleModelPanel(): void {
        if (this.modelPicker.isOpen) {
            this.modelPicker.close();
            return;
        }
        this.modelPicker.open(this.activeModelName, this.btnModel);
        this.btnModel.classList.add('active');
        this.btnModel.setAttribute('aria-expanded', 'true');
    }

    private selectModel(modelName: string): void {
        this.activeModelName = modelName;
        this.callbacks.onModelSelect(modelName);
        this.modelPicker.close();
    }

    private toggleDebug(): void {
        this.showPickingColors = !this.showPickingColors;
        this.updateUI();
        this.callbacks.onDebugToggle?.(this.showPickingColors);
    }

    private togglePerf(): void {
        this.showPerf = !this.showPerf;
        this.updateUI();
        this.callbacks.onPerfToggle?.(this.showPerf);
    }

    // -------------------------------------------------------------------------
    // UI state sync
    // -------------------------------------------------------------------------

    private updateUI(): void {
        const selecting = this.mode === 'selection';
        const active = this.sessionActive;

        this.quickContainer.classList.toggle('visible', active && !selecting);
        this.historyContainer.classList.toggle('visible', active);
        this.btnHelp.classList.toggle('visible', active);
        this.btnExit.classList.toggle('visible', active && !this.isDevMode);
        this.container.style.display = active && this.isDevMode ? 'block' : 'none';

        this.btnInvert.classList.toggle('shown', selecting);
        this.btnClose.classList.toggle('shown', selecting);
        this.btnShowAll.classList.toggle('shown', this.hiddenCount > 0);
        this.showAllLabel.textContent = `Tout afficher (${String(this.hiddenCount)})`;
        this.btnShowAll.setAttribute(
            'aria-label',
            `Tout afficher : ${String(this.hiddenCount)} pièce(s) masquée(s)`,
        );
        this.toolbar.classList.toggle(
            'visible',
            active && !this.moving && (selecting || this.hiddenCount > 0),
        );

        // Debug button (dev only)
        if (this.btnDebug) {
            const debugLabel = this.btnDebug.querySelector('.ar-radial-label')!;
            if (this.showPickingColors) {
                this.btnDebug.className = 'ar-menu-btn ar-radial-btn btn-debug active-red';
                debugLabel.textContent = 'Couleurs: ON';
            } else {
                this.btnDebug.className = 'ar-menu-btn ar-radial-btn btn-debug';
                debugLabel.textContent = 'Couleurs: OFF';
            }
        }

        // Perf button (dev only)
        if (this.btnPerf) {
            const perfLabel = this.btnPerf.querySelector('.ar-radial-label')!;
            if (this.showPerf) {
                this.btnPerf.className = 'ar-menu-btn ar-radial-btn btn-perf active-red';
                perfLabel.textContent = 'Statistiques: ON';
            } else {
                this.btnPerf.className = 'ar-menu-btn ar-radial-btn btn-perf';
                perfLabel.textContent = 'Statistiques: OFF';
            }
        }
    }

    // -------------------------------------------------------------------------
    // CSS injection
    // -------------------------------------------------------------------------

    private injectStyles(): void {
        const styleId = 'ar-ui-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;

        style.textContent = `
            .ar-quick-container {
                position: absolute;
                bottom: 30px;
                right: 30px;
                display: none;
                flex-direction: column;
                align-items: center;
                gap: 18px;
                z-index: 1000;
            }

            .ar-quick-container.visible { display: flex; }

            /* Leave room for the dev gear menu below */
            .ar-quick-container.with-gear { bottom: 115px; }

            .ar-quick-item {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 5px;
            }

            .ar-quick-btn {
                width: 60px;
                height: 60px;
                border-radius: 50%;
                border: 1px solid rgba(255, 255, 255, 0.25);
                background: rgba(20, 20, 25, 0.75);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                color: #fff;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
                transition: background 0.3s, border-color 0.3s, box-shadow 0.3s;
                pointer-events: auto;
                outline: none;
                padding: 0;
            }

            .ar-quick-btn:active { transform: scale(0.92); }

            .ar-quick-btn.btn-model.active {
                background: rgba(0, 123, 255, 0.35);
                border-color: rgba(0, 123, 255, 0.6);
            }

            .ar-quick-caption {
                background: rgba(15, 15, 20, 0.9);
                border: 1px solid rgba(255, 255, 255, 0.15);
                color: #fff;
                padding: 3px 9px;
                border-radius: 6px;
                font-size: 10px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-weight: 600;
                white-space: nowrap;
                pointer-events: none;
            }

            .ar-help-btn,
            .ar-exit-btn {
                position: absolute;
                top: max(20px, env(safe-area-inset-top, 20px));
                width: 44px;
                height: 44px;
                border-radius: 50%;
                border: 1px solid rgba(255, 255, 255, 0.25);
                background: rgba(20, 20, 25, 0.75);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                color: rgba(255, 255, 255, 0.85);
                display: none;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
                z-index: 1000;
                outline: none;
                padding: 0;
            }

            .ar-exit-btn { left: max(20px, env(safe-area-inset-left, 20px)); }
            /* Help sits next to Quitter; in dev mode (no Quitter) it takes the corner. */
            .ar-help-btn { left: max(20px, env(safe-area-inset-left, 20px)); }
            .ar-exit-btn.visible ~ .ar-help-btn { left: calc(max(20px, env(safe-area-inset-left, 20px)) + 56px); }

            .ar-help-btn.visible,
            .ar-exit-btn.visible { display: flex; }
            .ar-help-btn:active,
            .ar-exit-btn:active { transform: scale(0.92); }
            .ar-help-btn svg,
            .ar-exit-btn svg { width: 22px; height: 22px; }

            .ar-toolbar {
                position: absolute;
                left: 50%;
                bottom: max(24px, env(safe-area-inset-bottom, 24px));
                transform: translate(-50%, 16px);
                display: flex;
                gap: 6px;
                padding: 6px;
                border-radius: 18px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                background: rgba(20, 20, 25, 0.8);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
                z-index: 1000;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.25s, transform 0.25s;
            }

            .ar-toolbar.visible {
                opacity: 1;
                transform: translate(-50%, 0);
                pointer-events: auto;
            }

            .ar-tool-btn {
                display: none;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 4px;
                min-width: 72px;
                min-height: 56px;
                padding: 6px 10px;
                border: none;
                border-radius: 12px;
                background: transparent;
                color: #fff;
                font-size: 11px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-weight: 600;
                white-space: nowrap;
                cursor: pointer;
                outline: none;
            }

            .ar-tool-btn.shown { display: flex; }
            .ar-tool-btn:active { background: rgba(255, 255, 255, 0.15); }
            .ar-tool-btn svg { width: 22px; height: 22px; stroke: currentColor; }
            .ar-tool-btn.btn-invert { color: #ffa500; }

            .ar-menu-container {
                position: absolute;
                bottom: 30px;
                right: 30px;
                width: 60px;
                height: 60px;
                z-index: 1000;
                pointer-events: none;
            }

            .ar-menu-btn {
                width: 60px;
                height: 60px;
                border-radius: 50%;
                border: 1px solid rgba(255, 255, 255, 0.25);
                background: rgba(20, 20, 25, 0.75);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                color: #fff;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
                transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                pointer-events: auto;
                outline: none;
                padding: 0;
            }

            .ar-menu-btn:active { transform: scale(0.92); }

            .ar-btn-gear {
                position: absolute;
                top: 0;
                left: 0;
                z-index: 10;
                background: rgba(30, 30, 40, 0.85);
            }

            .ar-btn-gear svg {
                transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            }

            .ar-menu-container.open .ar-btn-gear svg { transform: rotate(180deg); }
            .ar-menu-container.open .ar-btn-gear {
                background: rgba(40, 40, 55, 0.95);
                box-shadow: 0 0 15px rgba(255, 255, 255, 0.2);
            }

            .ar-radial-btn {
                position: absolute;
                top: 5px;
                left: 5px;
                width: 50px;
                height: 50px;
                z-index: 5;
                transform: translate(0, 0) scale(0);
                opacity: 0;
                pointer-events: none;
                background: rgba(25, 25, 30, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.18);
                box-shadow: 0 4px 16px 0 rgba(0, 0, 0, 0.2);
                transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s, background 0.3s;
            }

            .ar-radial-btn.active-red { background: rgba(220, 53, 69, 0.85); border-color: rgba(220, 53, 69, 0.5); box-shadow: 0 0 12px rgba(220, 53, 69, 0.4); }

            .ar-menu-container.open .ar-radial-btn { pointer-events: auto; opacity: 1; }

            .ar-menu-container.open .btn-debug { transform: translate(-115px, 0) scale(1); }
            .ar-menu-container.open .btn-perf  { transform: translate(-81.3px, -81.3px) scale(1); }

            .ar-radial-label {
                position: absolute;
                right: 60px;
                top: 50%;
                transform: translateY(-50%) scale(0.8);
                background: rgba(15, 15, 20, 0.9);
                border: 1px solid rgba(255, 255, 255, 0.15);
                color: #fff;
                padding: 5px 10px;
                border-radius: 6px;
                font-size: 11px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-weight: 600;
                white-space: nowrap;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.3s, transform 0.3s;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
            }

            .ar-menu-container.open .ar-radial-btn .ar-radial-label {
                opacity: 1;
                transform: translateY(-50%) scale(1);
            }

            .ar-history-container {
                position: absolute;
                top: max(20px, env(safe-area-inset-top, 20px));
                right: max(20px, env(safe-area-inset-right, 20px));
                display: none;
                align-items: center;
                gap: 10px;
                z-index: 1000;
                pointer-events: auto;
            }

            .ar-history-container.visible { display: flex; }

            .ar-history-btn {
                width: 42px;
                height: 42px;
                border-radius: 50%;
                border: 1px solid rgba(255, 255, 255, 0.25);
                background: rgba(20, 20, 25, 0.75);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                color: #fff;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                box-shadow: 0 4px 20px 0 rgba(0, 0, 0, 0.3);
                transition: background 0.25s, border-color 0.25s, opacity 0.25s, transform 0.15s, box-shadow 0.25s;
                pointer-events: auto;
                outline: none;
                padding: 0;
            }

            .ar-history-btn svg {
                width: 20px;
                height: 20px;
                stroke: currentColor;
                transition: transform 0.2s;
            }

            .ar-history-btn:not(.disabled):hover {
                background: rgba(40, 40, 55, 0.85);
                border-color: rgba(255, 255, 255, 0.4);
                box-shadow: 0 0 12px rgba(255, 255, 255, 0.2);
            }

            .ar-history-btn:not(.disabled):active {
                transform: scale(0.9);
            }

            .ar-history-btn.disabled {
                opacity: 0.3;
                cursor: default;
                pointer-events: none;
                box-shadow: none;
                border-color: rgba(255, 255, 255, 0.1);
            }
        `;
        document.head.appendChild(style);
    }
}
