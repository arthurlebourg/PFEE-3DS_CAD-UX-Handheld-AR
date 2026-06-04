/**
 * UIManager: Manages the 2D HTML buttons overlaying the WebXR scene.
 */
export class UIManager {
    public isPlacementMode = true;
    public showPickingColors = false;
    public showPerf = false;

    private container = document.createElement('div');
    private btnMode = document.createElement('button');
    private btnDebug = document.createElement('button');
    private btnPerf = document.createElement('button');
    private selectModel = document.createElement('select');

    private onModeCallback: (isPlacement: boolean) => void;
    private onDebugCallback: (showColors: boolean) => void;
    private onModelCallback: (modelName: string) => void;
    private onPerfCallback: (showPerf: boolean) => void;

    /**
     * Initializes the UI buttons and their event listeners.
     */
    constructor(
        onModeCallback: (p: boolean) => void,
        onDebugCallback: (d: boolean) => void,
        onModelCallback: (m: string) => void,
        onPerfCallback: (s: boolean) => void,
        models: string[]
    ) {
        this.onModeCallback = onModeCallback;
        this.onDebugCallback = onDebugCallback;
        this.onModelCallback = onModelCallback;
        this.onPerfCallback = onPerfCallback;

        this.container.style.cssText = 'position:absolute;bottom:120px;left:50%;transform:translateX(-50%);z-index:100;display:none;flex-direction:column;gap:10px;';
        
        const style = 'padding:12px 24px;font-size:18px;border-radius:8px;border:none;color:white;font-weight:bold;pointer-events:auto;';
        this.btnMode.style.cssText = style;
        this.btnDebug.style.cssText = style;
        this.btnPerf.style.cssText = style;

        this.selectModel.style.cssText = 'padding:12px;font-size:16px;border-radius:8px;border:none;pointer-events:auto;background:white;color:black;font-weight:bold;';
        
        for (const model of models) {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model.replace('.glb', '').replace(/_/g, ' ').toUpperCase();
            this.selectModel.appendChild(option);
        }

        this.btnMode.addEventListener('touchstart', (event) => this.toggleMode(event));
        this.btnMode.addEventListener('click', (event) => this.toggleMode(event));

        this.btnDebug.addEventListener('touchstart', (event) => this.toggleDebug(event));
        this.btnDebug.addEventListener('click', (event) => this.toggleDebug(event));

        this.btnPerf.addEventListener('touchstart', (event) => this.togglePerf(event));
        this.btnPerf.addEventListener('click', (event) => this.togglePerf(event));

        this.selectModel.addEventListener('change', (event) => {
            event.stopPropagation();
            this.onModelCallback(this.selectModel.value);
        });

        // In a dom-overlay XR session, a tap on an overlay element still emits an
        // XR 'select' event (which would place/pick) unless we cancel the
        // beforexrselect the browser dispatches first. It bubbles, so one
        // listener on the container covers every button and the dropdown.
        this.container.addEventListener('beforexrselect', (event) => event.preventDefault());

        this.updateUI();
        this.container.append(this.selectModel, this.btnMode, this.btnDebug, this.btnPerf);
    }

    /**
     * Attaches the UI container to the DOM.
     */
    public attach(parent: HTMLElement) {
        parent.appendChild(this.container);
    }

    /**
     * Toggles between placement mode and selection mode.
     */
    private toggleMode(event: Event) {
        event.stopPropagation();
        event.preventDefault();
        this.isPlacementMode = !this.isPlacementMode;
        this.updateUI();
        this.onModeCallback(this.isPlacementMode);
    }

    /**
     * Toggles the debug visualization of the picking scene.
     */
    private toggleDebug(event: Event) {
        event.stopPropagation();
        event.preventDefault();
        this.showPickingColors = !this.showPickingColors;
        this.updateUI();
        this.onDebugCallback(this.showPickingColors);
    }

    /**
     * Toggles the performance HUD overlay.
     */
    private togglePerf(event: Event) {
        event.stopPropagation();
        event.preventDefault();
        this.showPerf = !this.showPerf;
        this.updateUI();
        this.onPerfCallback(this.showPerf);
    }

    /**
     * Forces the UI into a specific placement mode state.
     */
    public forcePlacementMode(placement: boolean) {
        this.isPlacementMode = placement;
        this.updateUI();
    }

    /**
     * Updates the visual appearance (text and color) of the buttons.
     */
    private updateUI() {
        if (this.isPlacementMode) {
            this.btnMode.textContent = 'Mode: Place';
            this.btnMode.style.backgroundColor = '#007bff';
        } else {
            this.btnMode.textContent = 'Mode: Select';
            this.btnMode.style.backgroundColor = '#28a745';
        }

        if (this.showPickingColors) {
            this.btnDebug.textContent = 'Colors: ON';
            this.btnDebug.style.backgroundColor = '#dc3545';
        } else {
            this.btnDebug.textContent = 'Colors: OFF';
            this.btnDebug.style.backgroundColor = '#6c757d';
        }

        if (this.showPerf) {
            this.btnPerf.textContent = 'Perf: ON';
            this.btnPerf.style.backgroundColor = '#dc3545';
        } else {
            this.btnPerf.textContent = 'Perf: OFF';
            this.btnPerf.style.backgroundColor = '#6c757d';
        }
    }

    /**
     * Shows or hides the entire UI container.
     */
    public toggleVisibility(show: boolean) {
        if (show) {
            this.container.style.display = 'flex';
        } else {
            this.container.style.display = 'none';
            this.isPlacementMode = true;
            this.showPickingColors = false;
            this.showPerf = false;
            this.updateUI();
        }
    }
}
