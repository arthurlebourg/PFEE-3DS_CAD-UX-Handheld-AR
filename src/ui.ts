/**
 * UIManager: Manages the 2D HTML buttons overlaying the WebXR scene.
 */
export class UIManager {
    public isPlacementMode = true;
    public showPickingColors = false;

    private container = document.createElement('div');
    private btnMode = document.createElement('button');
    private btnDebug = document.createElement('button');

    private onModeCallback: (isPlacement: boolean) => void;
    private onDebugCallback: (showColors: boolean) => void;

    /**
     * Initializes the UI buttons and their event listeners.
     */
    constructor(onModeCallback: (p: boolean) => void, onDebugCallback: (d: boolean) => void) {
        this.onModeCallback = onModeCallback;
        this.onDebugCallback = onDebugCallback;

        this.container.style.cssText = 'position:absolute;bottom:120px;left:50%;transform:translateX(-50%);z-index:100;display:none;flex-direction:column;gap:10px;';
        
        const style = 'padding:12px 24px;font-size:18px;border-radius:8px;border:none;color:white;font-weight:bold;pointer-events:auto;';
        this.btnMode.style.cssText = style;
        this.btnDebug.style.cssText = style;

        this.btnMode.addEventListener('touchstart', (event) => this.toggleMode(event));
        this.btnMode.addEventListener('click', (event) => this.toggleMode(event));

        this.btnDebug.addEventListener('touchstart', (event) => this.toggleDebug(event));
        this.btnDebug.addEventListener('click', (event) => this.toggleDebug(event));

        this.updateUI();
        this.container.append(this.btnMode, this.btnDebug);
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
        this.isPlacementMode = !this.isPlacementMode;
        this.updateUI();
        this.onModeCallback(this.isPlacementMode);
    }

    /**
     * Toggles the debug visualization of the picking scene.
     */
    private toggleDebug(event: Event) {
        event.stopPropagation();
        this.showPickingColors = !this.showPickingColors;
        this.updateUI();
        this.onDebugCallback(this.showPickingColors);
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
            this.updateUI();
        }
    }
}
