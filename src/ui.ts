import { createIcons, Settings, Layers, MousePointer, Eye, Activity } from 'lucide';
import type { ModeName } from './interactionMode.js';

/**
 * UIManager: Manages the 2D HTML buttons overlaying the WebXR scene.
 *
 * In prod mode  → gear + Modèles + Mode (Édition/Inspection)
 * In dev mode   → gear + Modèles + Mode + Couleurs picking + Statistiques perf
 *
 * The mode button only *requests* a toggle; the ModeManager is the source of
 * truth and reflects the actual mode back through {@link setMode}, which also
 * drives the always-visible mode badge at the top of the screen.
 *
 * Activated via isDevMode (driven by ?dev=TOKEN in the URL, see devMode.ts).
 */
export class UIManager {
    public showPickingColors = false;
    public showPerf = false;

    private container = document.createElement('div');
    private btnGear = document.createElement('button');
    private btnModel = document.createElement('button');
    private btnMode = document.createElement('button');
    private btnDebug: HTMLButtonElement | null = null;
    private btnPerf: HTMLButtonElement | null = null;
    private modelSelectionPanel = document.createElement('div');
    private modeBadge = document.createElement('div');

    private isOpen = false;
    private isModelPanelOpen = false;
    private activeModelName = '';
    private mode: ModeName = 'edit';
    private readonly isDevMode: boolean;

    private onModeToggle: () => void;
    private onDebugCallback: (showColors: boolean) => void;
    private onModelCallback: (modelName: string) => void;
    private onPerfCallback: (showPerf: boolean) => void;

    constructor(
        onModeToggle: () => void,
        onDebugCallback: (d: boolean) => void,
        onModelCallback: (m: string) => void,
        onPerfCallback: (s: boolean) => void,
        models: string[],
        isDevMode = false
    ) {
        this.onModeToggle = onModeToggle;
        this.onDebugCallback = onDebugCallback;
        this.onModelCallback = onModelCallback;
        this.onPerfCallback = onPerfCallback;
        this.isDevMode = isDevMode;

        this.injectStyles();

        // Container
        this.container.className = 'ar-menu-container';
        this.container.style.display = 'none';

        // Gear button (main toggle)
        this.btnGear.className = 'ar-menu-btn ar-btn-gear';
        this.btnGear.innerHTML = `<i data-lucide="settings"></i>`;

        // Prod buttons — always present
        this.btnModel = this.createRadialButton('btn-model', 'layers',        'Modèles');
        this.btnMode  = this.createRadialButton('btn-mode',  'mouse-pointer', 'Mode: Édition');

        // Dev-only buttons
        if (isDevMode) {
            this.btnDebug = this.createRadialButton('btn-debug', 'eye',      'Couleurs: OFF');
            this.btnPerf  = this.createRadialButton('btn-perf',  'activity', 'Statistiques: OFF');
        }

        // Persistent mode indicator (modal UIs need a strong "which mode am I
        // in" signal, since the same pinch means scale or explode).
        this.modeBadge.className = 'ar-mode-badge edit';
        this.modeBadge.textContent = 'ÉDITION';
        this.modeBadge.style.display = 'none';

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
        this.addPointerDownListener(this.btnGear,  () => this.toggleGear());
        this.addPointerDownListener(this.btnModel, () => this.toggleModelPanel());
        this.addPointerDownListener(this.btnMode,  () => this.onModeToggle());
        if (this.btnDebug) this.addPointerDownListener(this.btnDebug, () => this.toggleDebug());
        if (this.btnPerf)  this.addPointerDownListener(this.btnPerf,  () => this.togglePerf());

        // Prevent XR select events from bubbling through the overlay
        this.container.addEventListener('beforexrselect', (e) => e.preventDefault());
        this.modelSelectionPanel.addEventListener('beforexrselect', (e) => e.preventDefault());

        this.updateUI();

        // Assemble — dev buttons only appended when present
        const buttons: HTMLButtonElement[] = [this.btnGear, this.btnModel, this.btnMode];
        if (this.btnDebug) buttons.push(this.btnDebug);
        if (this.btnPerf)  buttons.push(this.btnPerf);
        this.container.append(...buttons);
    }

    /**
     * Attaches the UI to the DOM and hydrates Lucide icon placeholders.
     */
    public attach(parent: HTMLElement): void {
        parent.appendChild(this.container);
        parent.appendChild(this.modelSelectionPanel);
        parent.appendChild(this.modeBadge);

        createIcons({
            icons: { Settings, Layers, MousePointer, Eye, Activity }
        });
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Reflects the active interaction mode (called by the ModeManager's
     * onChange). Updates the mode button and the persistent badge.
     */
    public setMode(mode: ModeName): void {
        this.mode = mode;
        this.updateUI();
    }

    public toggleVisibility(show: boolean): void {
        this.container.style.display = show ? 'block' : 'none';
        this.modeBadge.style.display = show ? 'block' : 'none';
        if (!show) {
            this.isOpen = false;
            this.container.classList.remove('open');
            this.isModelPanelOpen = false;
            this.modelSelectionPanel.classList.remove('open');
            this.showPickingColors = false;
            this.showPerf = false;
            this.updateUI();
        }
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

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
        if (!this.isOpen) {
            this.isModelPanelOpen = false;
            this.modelSelectionPanel.classList.remove('open');
        }
    }

    private toggleModelPanel(): void {
        this.isModelPanelOpen = !this.isModelPanelOpen;
        this.modelSelectionPanel.classList.toggle('open', this.isModelPanelOpen);
    }

    private selectModel(modelName: string): void {
        this.activeModelName = modelName;
        this.updateUI();
        this.onModelCallback(modelName);
        this.isModelPanelOpen = false;
        this.modelSelectionPanel.classList.remove('open');
    }

    private toggleDebug(): void {
        this.showPickingColors = !this.showPickingColors;
        this.updateUI();
        this.onDebugCallback(this.showPickingColors);
    }

    private togglePerf(): void {
        this.showPerf = !this.showPerf;
        this.updateUI();
        this.onPerfCallback(this.showPerf);
    }

    // -------------------------------------------------------------------------
    // UI state sync
    // -------------------------------------------------------------------------

    private updateUI(): void {
        // Mode button + badge
        const modeLabel = this.btnMode.querySelector('.ar-radial-label')!;
        if (this.mode === 'edit') {
            this.btnMode.className = 'ar-menu-btn ar-radial-btn btn-mode active-blue';
            modeLabel.textContent = 'Mode: Édition';
            this.modeBadge.className = 'ar-mode-badge edit';
            this.modeBadge.textContent = 'ÉDITION';
        } else {
            this.btnMode.className = 'ar-menu-btn ar-radial-btn btn-mode active-green';
            modeLabel.textContent = 'Mode: Inspection';
            this.modeBadge.className = 'ar-mode-badge inspect';
            this.modeBadge.textContent = 'INSPECTION';
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

        // Prod layout  : 2 radial buttons (model + mode)
        // Dev layout   : 4 radial buttons (model + mode + debug + perf)
        // Positions are on a quarter-circle arc, bottom-right origin.
        const prodPositions = `
            .ar-menu-container.open .btn-model { transform: translate(-115px, 0) scale(1); }
            .ar-menu-container.open .btn-mode  { transform: translate(-81.3px, -81.3px) scale(1); }
        `;
        const devPositions = `
            .ar-menu-container.open .btn-model { transform: translate(-115px, 0) scale(1); }
            .ar-menu-container.open .btn-mode  { transform: translate(-99.6px, -57.5px) scale(1); }
            .ar-menu-container.open .btn-debug { transform: translate(-57.5px, -99.6px) scale(1); }
            .ar-menu-container.open .btn-perf  { transform: translate(0, -115px) scale(1); }
        `;

        style.textContent = `
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

            .ar-radial-btn.active-blue  { background: rgba(0, 123, 255, 0.85); border-color: rgba(0, 123, 255, 0.5); box-shadow: 0 0 12px rgba(0, 123, 255, 0.4); }
            .ar-radial-btn.active-green { background: rgba(40, 167, 69, 0.85);  border-color: rgba(40, 167, 69, 0.5);  box-shadow: 0 0 12px rgba(40, 167, 69, 0.4); }
            .ar-radial-btn.active-red   { background: rgba(220, 53, 69, 0.85);  border-color: rgba(220, 53, 69, 0.5);  box-shadow: 0 0 12px rgba(220, 53, 69, 0.4); }

            .ar-menu-container.open .ar-radial-btn { pointer-events: auto; opacity: 1; }

            ${this.isDevMode ? devPositions : prodPositions}

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

            .ar-mode-badge {
                position: absolute;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                padding: 6px 18px;
                border-radius: 999px;
                border: 1px solid;
                color: #fff;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 12px;
                font-weight: 700;
                letter-spacing: 2px;
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
                z-index: 1000;
                pointer-events: none;
                transition: background 0.3s, border-color 0.3s;
            }

            .ar-mode-badge.edit {
                background: rgba(0, 123, 255, 0.55);
                border-color: rgba(0, 123, 255, 0.8);
            }

            .ar-mode-badge.inspect {
                background: rgba(40, 167, 69, 0.55);
                border-color: rgba(40, 167, 69, 0.8);
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
        `;
        document.head.appendChild(style);
    }
}
