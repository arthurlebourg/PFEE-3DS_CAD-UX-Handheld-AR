import { createIcons, Settings, Layers, Eye, Activity, Pencil, Search, Trash2, RotateCcw } from 'lucide';
import type { ModeName } from '../modes/interactionMode.js';

export interface UIManagerCallbacks {
    /**
     * Requests an Edit/Inspect toggle. The ModeManager stays the source of
     * truth and reflects the actual mode back through {@link UIManager.setMode}.
     */
    onModeToggle: () => void;
    /** A model was chosen in the carousel. */
    onModelSelect: (modelName: string) => void;
    /** Delete the model currently selected in Edit mode. */
    onDelete: () => void;
    /** Reset the model currently selected in Edit mode. */
    onReset: () => void;
    /** Dev only: toggle the picking-colours debug view. */
    onDebugToggle?: (showColors: boolean) => void;
    /** Dev only: toggle the perf stats overlay. */
    onPerfToggle?: (showPerf: boolean) => void;
}

/**
 * UIManager: Manages the 2D HTML buttons overlaying the WebXR scene.
 *
 * Quick-access column (always visible in session):
 *   - Mode toggle: shows the current mode at a glance (icon + colour + caption)
 *   - Modèles: opens the model carousel
 * Dev mode adds a gear radial menu with the debug buttons (picking colours,
 * perf stats); in prod the gear is omitted entirely.
 *
 * The mode button only *requests* a toggle; the ModeManager is the source of
 * truth and reflects the actual mode back through {@link setMode}.
 *
 * Activated via isDevMode (driven by ?dev=TOKEN in the URL, see devMode.ts).
 */
export class UIManager {
    public showPickingColors = false;
    public showPerf = false;

    private quickContainer = document.createElement('div');
    private btnMode = document.createElement('button');
    private modeCaption = document.createElement('span');
    private btnModel = document.createElement('button');
    private modelSelectionPanel = document.createElement('div');

    // Contextual buttons, shown while a placed model is selected in Edit mode
    private btnDelete = document.createElement('button');
    private btnReset = document.createElement('button');

    // Dev-only gear radial menu
    private container = document.createElement('div');
    private btnGear = document.createElement('button');
    private btnDebug: HTMLButtonElement | null = null;
    private btnPerf: HTMLButtonElement | null = null;

    private isOpen = false;
    private isModelPanelOpen = false;
    private activeModelName = '';
    private mode: ModeName = 'edit';
    private readonly isDevMode: boolean;

    private readonly callbacks: UIManagerCallbacks;

    constructor(callbacks: UIManagerCallbacks, models: string[], isDevMode = false) {
        this.callbacks = callbacks;
        this.isDevMode = isDevMode;

        this.injectStyles();

        // Quick-access column: mode toggle + model carousel button
        this.quickContainer.className =
            'ar-quick-container' + (isDevMode ? ' with-gear' : '');
        this.quickContainer.style.display = 'none';

        this.btnMode.className = 'ar-quick-btn btn-mode edit';
        this.modeCaption.className = 'ar-quick-caption';
        const modeItem = document.createElement('div');
        modeItem.className = 'ar-quick-item';
        modeItem.append(this.btnMode, this.modeCaption);

        this.btnModel.className = 'ar-quick-btn btn-model';
        this.btnModel.innerHTML = `<i data-lucide="layers"></i>`;
        const modelCaption = document.createElement('span');
        modelCaption.className = 'ar-quick-caption';
        modelCaption.textContent = 'Modèles';
        const modelItem = document.createElement('div');
        modelItem.className = 'ar-quick-item';
        modelItem.append(this.btnModel, modelCaption);

        this.quickContainer.append(modeItem, modelItem);

        // Contextual Delete/Reset buttons (hidden until a model is selected)
        this.btnDelete.className = 'ar-delete-btn';
        this.btnDelete.innerHTML = `<i data-lucide="trash-2">`;
        this.btnReset.className = 'ar-reset-btn';
        this.btnReset.innerHTML = `<i data-lucide="rotate-ccw">`;

        // Dev-only gear radial menu (debug buttons)
        this.container.className = 'ar-menu-container';
        this.container.style.display = 'none';
        this.btnGear.className = 'ar-menu-btn ar-btn-gear';
        this.btnGear.innerHTML = `<i data-lucide="settings"></i>`;
        if (isDevMode) {
            this.btnDebug = this.createRadialButton('btn-debug', 'eye',      'Couleurs: OFF');
            this.btnPerf  = this.createRadialButton('btn-perf',  'activity', 'Statistiques: OFF');
        }

        // Model selection panel
        this.modelSelectionPanel.className = 'ar-model-panel';
        for (const model of models) {
            const card = document.createElement('div');
            card.className = 'ar-model-card';
            card.setAttribute('data-model', model);

            const displayName = model.replace('.glb', '').replace(/_/g, ' ').toUpperCase();
            card.innerHTML = `<i data-lucide="layers"></i><span>${displayName}</span>`;

            this.addPointerDownListener(card, () => this.selectModel(model));
            this.modelSelectionPanel.appendChild(card);
        }

        if (models.length > 0) {
            this.activeModelName = models[0];
        }

        // Wire up events
        this.addPointerDownListener(this.btnMode,  () => this.callbacks.onModeToggle());
        this.addPointerDownListener(this.btnModel, () => this.toggleModelPanel());
        this.addPointerDownListener(this.btnGear,  () => this.toggleGear());
        this.addPointerDownListener(this.btnDelete, () => this.callbacks.onDelete());
        this.addPointerDownListener(this.btnReset,  () => this.callbacks.onReset());
        if (this.btnDebug) this.addPointerDownListener(this.btnDebug, () => this.toggleDebug());
        if (this.btnPerf)  this.addPointerDownListener(this.btnPerf,  () => this.togglePerf());

        // Prevent XR select events from bubbling through the overlay
        this.quickContainer.addEventListener('beforexrselect', (e) => e.preventDefault());
        this.container.addEventListener('beforexrselect', (e) => e.preventDefault());
        this.modelSelectionPanel.addEventListener('beforexrselect', (e) => e.preventDefault());
        this.btnDelete.addEventListener('beforexrselect', (e) => e.preventDefault());
        this.btnReset.addEventListener('beforexrselect', (e) => e.preventDefault());

        this.updateUI();

        const buttons: HTMLButtonElement[] = [this.btnGear];
        if (this.btnDebug) buttons.push(this.btnDebug);
        if (this.btnPerf)  buttons.push(this.btnPerf);
        this.container.append(...buttons);
    }

    /**
     * Attaches the UI to the DOM and hydrates Lucide icon placeholders.
     */
    public attach(parent: HTMLElement): void {
        parent.appendChild(this.quickContainer);
        if (this.isDevMode) {
            parent.appendChild(this.container);
        }
        parent.appendChild(this.modelSelectionPanel);
        parent.appendChild(this.btnDelete);
        parent.appendChild(this.btnReset);

        this.hydrateIcons();
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Reflects the active interaction mode (called by the ModeManager's
     * onChange). The toggle button itself carries the mode state: icon,
     * colour and caption.
     */
    public setMode(mode: ModeName): void {
        this.mode = mode;
        this.updateUI();
        this.hydrateIcons();
    }

    /** Shows/hides the contextual Delete/Reset buttons (Edit model selection). */
    public setModelActionsVisible(visible: boolean): void {
        this.btnDelete.classList.toggle('visible', visible);
        this.btnReset.classList.toggle('visible', visible);
    }

    public toggleVisibility(show: boolean): void {
        this.quickContainer.style.display = show ? 'flex' : 'none';
        if (this.isDevMode) {
            this.container.style.display = show ? 'block' : 'none';
        }
        if (!show) {
            this.isOpen = false;
            this.container.classList.remove('open');
            this.isModelPanelOpen = false;
            this.modelSelectionPanel.classList.remove('open');
            this.btnDelete.classList.remove('visible');
            this.btnReset.classList.remove('visible');
            this.showPickingColors = false;
            this.showPerf = false;
            this.updateUI();
        }
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private hydrateIcons(): void {
        createIcons({
            icons: { Settings, Layers, Eye, Activity, Pencil, Search, Trash2, RotateCcw }
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
        this.isModelPanelOpen = !this.isModelPanelOpen;
        this.modelSelectionPanel.classList.toggle('open', this.isModelPanelOpen);
        this.btnModel.classList.toggle('active', this.isModelPanelOpen);
    }

    private selectModel(modelName: string): void {
        this.activeModelName = modelName;
        this.updateUI();
        this.callbacks.onModelSelect(modelName);
        this.isModelPanelOpen = false;
        this.modelSelectionPanel.classList.remove('open');
        this.btnModel.classList.remove('active');
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
        // Mode toggle button: the button IS the mode indicator
        if (this.mode === 'edit') {
            this.btnMode.className = 'ar-quick-btn btn-mode edit';
            this.btnMode.innerHTML = `<i data-lucide="pencil"></i>`;
            this.modeCaption.textContent = 'Édition';
        } else {
            this.btnMode.className = 'ar-quick-btn btn-mode inspect';
            this.btnMode.innerHTML = `<i data-lucide="search"></i>`;
            this.modeCaption.textContent = 'Inspection';
        }

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

        // Model cards
        this.modelSelectionPanel.querySelectorAll('.ar-model-card').forEach((card) => {
            card.classList.toggle('active', card.getAttribute('data-model') === this.activeModelName);
        });
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
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 18px;
                z-index: 1000;
            }

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

            .ar-quick-btn.btn-mode.edit {
                background: rgba(0, 123, 255, 0.85);
                border-color: rgba(0, 123, 255, 0.5);
                box-shadow: 0 0 15px rgba(0, 123, 255, 0.5);
            }

            .ar-quick-btn.btn-mode.inspect {
                background: rgba(40, 167, 69, 0.85);
                border-color: rgba(40, 167, 69, 0.5);
                box-shadow: 0 0 15px rgba(40, 167, 69, 0.5);
            }

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

            .ar-model-panel {
                position: absolute;
                bottom: 30px;
                left: 50%;
                transform: translateX(-50%) translateY(120%);
                display: flex;
                gap: 15px;
                padding: 15px 20px;
                background: rgba(15, 15, 20, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 20px;
                backdrop-filter: blur(15px);
                -webkit-backdrop-filter: blur(15px);
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
                z-index: 1100;
                opacity: 0;
                pointer-events: none;
                transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s;
            }

            .ar-model-panel.open {
                transform: translateX(-50%) translateY(-70px);
                opacity: 1;
                pointer-events: auto;
            }

            .ar-model-card {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                width: 95px;
                height: 80px;
                padding: 10px;
                border-radius: 14px;
                border: 1.5px solid rgba(255, 255, 255, 0.1);
                background: rgba(255, 255, 255, 0.04);
                color: rgba(255, 255, 255, 0.7);
                cursor: pointer;
                transition: all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 11px;
                font-weight: bold;
                text-align: center;
                user-select: none;
            }

            .ar-model-card svg { margin-bottom: 6px; opacity: 0.7; transition: transform 0.25s; }
            .ar-model-card span { white-space: nowrap; }

            .ar-model-card:hover { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.25); color: #fff; }
            .ar-model-card:hover svg { transform: translateY(-2px); opacity: 1; }

            .ar-model-card.active {
                background: rgba(0, 123, 255, 0.2);
                border-color: #007bff;
                color: #007bff;
                box-shadow: 0 0 15px rgba(0, 123, 255, 0.4);
            }

            .ar-model-card.active svg { opacity: 1; stroke: #007bff; }

            .ar-delete-btn {
                position: absolute;
                bottom: 30px;
                left: 30px;
                width: 60px;
                height: 60px;
                border-radius: 50%;
                border: 1px solid rgba(220, 53, 69, 0.4);
                background: rgba(220, 53, 69, 0.25);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                color: #ff4a5a;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                box-shadow: 0 8px 32px 0 rgba(220, 53, 69, 0.2);
                z-index: 1000;
                opacity: 0;
                transform: scale(0);
                pointer-events: none;
                transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                outline: none;
                padding: 0;
            }

            .ar-delete-btn.visible {
                opacity: 1;
                transform: scale(1);
                pointer-events: auto;
            }

            .ar-delete-btn:active {
                transform: scale(0.9);
                background: rgba(220, 53, 69, 0.4);
                box-shadow: 0 0 15px rgba(220, 53, 69, 0.5);
            }

            .ar-delete-btn svg {
                width: 24px;
                height: 24px;
                stroke: currentColor;
            }

            .ar-delete-label {
                position: absolute;
                left: 70px;
                top: 50%;
                transform: translateY(-50%) scale(0.8);
                background: rgba(220, 53, 69, 0.85);
                border: 1px solid rgba(220, 53, 69, 0.4);
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

            .ar-delete-btn.visible .ar-delete-label {
                opacity: 1;
                transform: translateY(-50%) scale(1);
            }

            .ar-reset-btn {
                position: absolute;
                bottom: 105px;
                left: 30px;
                width: 60px;
                height: 60px;
                border-radius: 50%;
                border: 1px solid rgba(0, 123, 255, 0.4);
                background: rgba(0, 123, 255, 0.25);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                color: #38bdf8;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                box-shadow: 0 8px 32px 0 rgba(0, 123, 255, 0.2);
                z-index: 1000;
                opacity: 0;
                transform: scale(0);
                pointer-events: none;
                transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                outline: none;
                padding: 0;
            }

            .ar-reset-btn.visible {
                opacity: 1;
                transform: scale(1);
                pointer-events: auto;
            }

            .ar-reset-btn:active {
                transform: scale(0.9);
                background: rgba(0, 123, 255, 0.4);
                box-shadow: 0 0 15px rgba(0, 123, 255, 0.5);
            }

            .ar-reset-btn svg {
                width: 24px;
                height: 24px;
                stroke: currentColor;
            }

            .ar-reset-label {
                position: absolute;
                left: 70px;
                top: 50%;
                transform: translateY(-50%) scale(0.8);
                background: rgba(0, 123, 255, 0.85);
                border: 1px solid rgba(0, 123, 255, 0.4);
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

            .ar-reset-btn.visible .ar-reset-label {
                opacity: 1;
                transform: translateY(-50%) scale(1);
            }
        `;
        document.head.appendChild(style);
    }
}
