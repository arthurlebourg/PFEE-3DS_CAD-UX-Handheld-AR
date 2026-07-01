import { createIcons, Settings, Layers, MousePointer, Eye, Activity, Trash2, RotateCcw } from 'lucide';

/**
 * UIManager: Manages the 2D HTML buttons overlaying the WebXR scene.
 *
 * In prod mode  → gear + Modèles + Mode
 * In dev mode   → gear + Modèles + Mode + Couleurs picking + Statistiques perf
 *
 * Activated via isDevMode (driven by ?dev=TOKEN in the URL, see devMode.ts).
 */
export class UIManager {
    public isPlacementMode = true;
    public showPickingColors = false;
    public showPerf = false;

    private container = document.createElement('div');
    private btnGear = document.createElement('button');
    private btnModel = document.createElement('button');
    private btnMode = document.createElement('button');
    private btnDebug: HTMLButtonElement | null = null;
    private btnPerf: HTMLButtonElement | null = null;
    private btnDelete = document.createElement('button');
    private btnReset = document.createElement('button');
    private modelSelectionPanel = document.createElement('div');

    private isOpen = false;
    private isModelPanelOpen = false;
    private activeModelName = '';
    private readonly isDevMode: boolean;

    // Scale controls
    private sliderContainer = document.createElement('div');
    private sliderHeader = document.createElement('div');
    private sliderLabel = document.createElement('span');
    private sliderValText = document.createElement('span');
    private sliderInput = document.createElement('input');

    private onModeCallback: (isPlacement: boolean) => void;
    private onDebugCallback: (showColors: boolean) => void;
    private onModelCallback: (modelName: string) => void;
    private onPerfCallback: (showPerf: boolean) => void;
    private onScaleCallback: (rigScale: number) => void;
    private onDeleteCallback: () => void;
    private onResetCallback: () => void;

    constructor(
        onModeCallback: (p: boolean) => void,
        onDebugCallback: (d: boolean) => void,
        onModelCallback: (m: string) => void,
        onPerfCallback: (s: boolean) => void,
        onScaleCallback: (scale: number) => void,
        onDeleteCallback: () => void,
        onResetCallback: () => void,
        models: string[],
        isDevMode = false
    ) {
        this.onModeCallback = onModeCallback;
        this.onDebugCallback = onDebugCallback;
        this.onModelCallback = onModelCallback;
        this.onPerfCallback = onPerfCallback;
        this.onScaleCallback = onScaleCallback;
        this.onDeleteCallback = onDeleteCallback;
        this.onResetCallback = onResetCallback;
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
        this.btnMode  = this.createRadialButton('btn-mode',  'mouse-pointer', 'Mode: Placer');

        // Delete button
        this.btnDelete.className = 'ar-delete-btn';
        this.btnDelete.innerHTML = `<i data-lucide="trash-2"></i><span class="ar-delete-label">Supprimer le modèle</span>`;

        // Reset button
        this.btnReset.className = 'ar-reset-btn';
        this.btnReset.innerHTML = `<i data-lucide="rotate-ccw"></i><span class="ar-reset-label">Réinitialiser le modèle</span>`;

        // Dev-only buttons
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

        // Scale slider
        this.sliderContainer.className = 'ar-scale-panel';
        this.sliderHeader.className = 'ar-scale-header';
        this.sliderLabel.textContent = 'Échelle perçue';
        this.sliderValText.textContent = '100%';
        this.sliderHeader.append(this.sliderLabel, this.sliderValText);

        this.sliderInput.type = 'range';
        this.sliderInput.min = '10';
        this.sliderInput.max = '1000';
        this.sliderInput.value = '100';
        this.sliderInput.step = '10';
        this.sliderContainer.append(this.sliderHeader, this.sliderInput);

            const displayName = model.replace('.glb', '').replace(/_/g, ' ').toUpperCase();
            card.innerHTML = `<i data-lucide="layers"></i><span>${displayName}</span>`;

            this.addPointerDownListener(card, () => this.selectModel(model));
            this.modelSelectionPanel.appendChild(card);
        }

        if (models.length > 0) {
            this.activeModelName = models[0];
        }

        this.sliderInput.addEventListener('input', (event) => {
            event.stopPropagation();

            const perceivedPercent = Number.parseInt(this.sliderInput.value, 10);
            this.sliderValText.textContent = `${perceivedPercent}%`;

            // The camera rig scale is the inverse of the perceived model scale.
            this.onScaleCallback(100 / perceivedPercent);
        });

        // Wire up events
        this.addPointerDownListener(this.btnGear,  () => this.toggleGear());
        this.addPointerDownListener(this.btnModel, () => this.toggleModelPanel());
        this.addPointerDownListener(this.btnMode,  () => this.toggleMode());
        this.addPointerDownListener(this.btnDelete, () => this.onDeleteCallback());
        this.addPointerDownListener(this.btnReset, () => this.onResetCallback());
        if (this.btnDebug) this.addPointerDownListener(this.btnDebug, () => this.toggleDebug());
        if (this.btnPerf)  this.addPointerDownListener(this.btnPerf,  () => this.togglePerf());

        // Prevent XR select events from bubbling through the overlay
        this.container.addEventListener('beforexrselect', (e: Event) => e.preventDefault());
        this.modelSelectionPanel.addEventListener('beforexrselect', (e: Event) => e.preventDefault());
        this.btnDelete.addEventListener('beforexrselect', (e: Event) => e.preventDefault());
        this.btnReset.addEventListener('beforexrselect', (e: Event) => e.preventDefault());

        this.updateUI();

        // Assemble — dev buttons only appended when present
        const buttons: HTMLButtonElement[] = [this.btnGear, this.btnModel, this.btnMode];
        if (this.btnDebug) buttons.push(this.btnDebug);
        if (this.btnPerf)  buttons.push(this.btnPerf);
        this.container.append(...buttons, this.sliderContainer);
    }

    /**
     * Attaches the UI to the DOM and hydrates Lucide icon placeholders.
     */
    public attach(parent: HTMLElement): void {
        parent.appendChild(this.container);
        parent.appendChild(this.modelSelectionPanel);
        parent.appendChild(this.btnDelete);
        parent.appendChild(this.btnReset);

        createIcons({
            icons: { Settings, Layers, MousePointer, Eye, Activity, Trash2, RotateCcw }
        });
    }

    /**
     * Shows or hides the floating delete button.
     */
    public setDeleteButtonVisible(visible: boolean): void {
        this.btnDelete.classList.toggle('visible', visible);
    }

    /**
     * Shows or hides the floating reset button.
     */
    public setResetButtonVisible(visible: boolean): void {
        this.btnReset.classList.toggle('visible', visible);
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    public forcePlacementMode(placement: boolean): void {
        this.isPlacementMode = placement;
        this.updateUI();
    }

    /**
     * Synchronizes the scale slider with the current XR rig scale.
     */
    public setScale(rigScale: number): void {
        const perceivedPercent = Math.round(100 / rigScale);
        this.sliderInput.value = perceivedPercent.toString();
        this.sliderValText.textContent = `${perceivedPercent}%`;
    }

    public toggleVisibility(show: boolean): void {
        this.container.style.display = show ? 'block' : 'none';
        if (!show) {
            this.isOpen = false;
            this.container.classList.remove('open');
            this.isModelPanelOpen = false;
            this.modelSelectionPanel.classList.remove('open');
            this.isPlacementMode = true;
            this.showPickingColors = false;
            this.showPerf = false;
            this.setScale(1.0);
            this.btnDelete.classList.remove('visible');
            this.btnReset.classList.remove('visible');
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

    private toggleMode(): void {
        this.isPlacementMode = !this.isPlacementMode;
        this.updateUI();
        this.onModeCallback(this.isPlacementMode);
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
        // Mode button
        const modeLabel = this.btnMode.querySelector('.ar-radial-label')!;
        if (this.isPlacementMode) {
            this.btnMode.className = 'ar-menu-btn ar-radial-btn btn-mode active-blue';
            modeLabel.textContent = 'Mode: Placer';
        } else {
            this.btnMode.className = 'ar-menu-btn ar-radial-btn btn-mode active-green';
            modeLabel.textContent = 'Mode: Sélectionner';
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


            .ar-scale-panel {
                position: absolute;
                right: 0;
                bottom: 190px;
                width: 220px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                padding: 12px 14px;
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 12px;
                background: rgba(15, 15, 20, 0.9);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                color: #fff;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 12px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
                opacity: 0;
                transform: translateY(10px) scale(0.95);
                pointer-events: none;
                transition: opacity 0.25s, transform 0.25s;
            }

            .ar-menu-container.open .ar-scale-panel {
                opacity: 1;
                transform: translateY(0) scale(1);
                pointer-events: auto;
            }

            .ar-scale-header {
                display: flex;
                justify-content: space-between;
                font-weight: 600;
            }

            .ar-scale-panel input[type="range"] {
                width: 100%;
                cursor: pointer;
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
