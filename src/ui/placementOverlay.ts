import * as THREE from 'three';

/** Physical distance (metres) beyond which placement is blocked. */
export const MAX_PLACEMENT_DISTANCE = 5.0;

const COLOR_IN_RANGE  = 0x00e676; // green
const COLOR_OUT_RANGE = 0xff3d00; // red-orange


export class PlacementOverlay {
    // ── Three.js reticle ─────────────────────────────────────────────────────
    private reticle: THREE.Group;
    private ringMat: THREE.MeshBasicMaterial;
    private dotMat: THREE.MeshBasicMaterial;

    // ── DOM elements ─────────────────────────────────────────────────────────
    private modeEl: HTMLDivElement;
    private distanceWarningEl: HTMLDivElement;

    constructor(scene: THREE.Scene) {
        // Flat ring (outer indicator)
        this.ringMat = new THREE.MeshBasicMaterial({
            color: COLOR_IN_RANGE,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
        });
        const ringGeo = new THREE.RingGeometry(0.06, 0.12, 36);
        ringGeo.rotateX(-Math.PI / 2);

        // Centre dot
        this.dotMat = new THREE.MeshBasicMaterial({
            color: COLOR_IN_RANGE,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.6,
            depthWrite: false,
        });
        const dotGeo = new THREE.CircleGeometry(0.02, 24);
        dotGeo.rotateX(-Math.PI / 2);

        this.reticle = new THREE.Group();
        this.reticle.add(new THREE.Mesh(ringGeo, this.ringMat));
        this.reticle.add(new THREE.Mesh(dotGeo, this.dotMat));
        this.reticle.visible = false;
        this.reticle.renderOrder = 1; // avoid z-fighting with the floor
        scene.add(this.reticle);

        // DOM mode indicator
        this.modeEl = document.createElement('div');
        this.modeEl.className = 'ar-mode-indicator';
        this.modeEl.style.display = 'none';

        // DOM distance warning
        this.distanceWarningEl = document.createElement('div');
        this.distanceWarningEl.className = 'ar-distance-warning';
        this.distanceWarningEl.textContent = 'Trop loin — rapprochez-vous';
        this.distanceWarningEl.style.display = 'none';

        this.injectStyles();
    }

    /** Mounts DOM elements into the dom-overlay root. */
    public attach(parent: HTMLElement): void {
        parent.appendChild(this.modeEl);
        parent.appendChild(this.distanceWarningEl);
        this.modeEl.addEventListener('beforexrselect', (e) => e.preventDefault());
        this.distanceWarningEl.addEventListener('beforexrselect', (e) => e.preventDefault());
    }

    /** Toggles all overlay elements (call on XR session start/end). */
    public setVisible(visible: boolean): void {
        this.modeEl.style.display = visible ? 'flex' : 'none';
        if (!visible) {
            this.hideReticle();
        }
    }

    /**
     * Updates reticle position and colour each frame.
     * @returns true when the position is within MAX_PLACEMENT_DISTANCE.
     */
    public updateReticle(
        posePosition: THREE.Vector3,
        poseRotation: THREE.Quaternion,
        rigScale: number
    ): boolean {
        this.reticle.visible = true;
        this.reticle.position.copy(posePosition).multiplyScalar(rigScale);
        this.reticle.quaternion.copy(poseRotation);

        const inRange = posePosition.length() <= MAX_PLACEMENT_DISTANCE;
        const color = inRange ? COLOR_IN_RANGE : COLOR_OUT_RANGE;
        this.ringMat.color.setHex(color);
        this.dotMat.color.setHex(color);
        this.distanceWarningEl.style.display = inRange ? 'none' : 'flex';
        return inRange;
    }

    /** Hides the reticle and distance warning when no hit-test result is available. */
    public hideReticle(): void {
        this.reticle.visible = false;
        this.distanceWarningEl.style.display = 'none';
    }

    /** Updates the mode pill label and colour. */
    public setMode(mode: 'edit' | 'inspect'): void {
        if (mode === 'edit') {
            this.modeEl.className = 'ar-mode-indicator mode-edit';
            this.modeEl.textContent = '⊕ Mode : Édition';
        } else {
            this.modeEl.className = 'ar-mode-indicator mode-inspect';
            this.modeEl.textContent = '◈ Mode : Inspection';
        }
    }

    private injectStyles(): void {
        const id = 'ar-placement-overlay-styles';
        if (document.getElementById(id)) return;
        const style = document.createElement('style');
        style.id = id;
        style.textContent = `
            .ar-mode-indicator {
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                display: flex;
                align-items: center;
                padding: 7px 18px;
                border-radius: 999px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 13px;
                font-weight: 700;
                letter-spacing: 0.03em;
                white-space: nowrap;
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                border: 1px solid rgba(255,255,255,0.2);
                box-shadow: 0 4px 20px rgba(0,0,0,0.4);
                z-index: 1200;
                pointer-events: none;
                user-select: none;
                transition: background 0.3s, border-color 0.3s;
                color: #fff;
            }

            .ar-mode-indicator.mode-edit {
                background: rgba(0, 100, 220, 0.75);
                border-color: rgba(100, 180, 255, 0.4);
            }

            .ar-mode-indicator.mode-inspect {
                background: rgba(30, 140, 60, 0.75);
                border-color: rgba(80, 220, 120, 0.4);
            }

            .ar-distance-warning {
                position: fixed;
                bottom: 110px;
                left: 50%;
                transform: translateX(-50%);
                display: flex;
                align-items: center;
                padding: 6px 16px;
                border-radius: 999px;
                background: rgba(200, 50, 0, 0.82);
                color: #fff;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 12px;
                font-weight: 600;
                white-space: nowrap;
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 100, 50, 0.5);
                box-shadow: 0 4px 16px rgba(0,0,0,0.4);
                z-index: 1200;
                pointer-events: none;
                user-select: none;
            }
        `;
        document.head.appendChild(style);
    }
}