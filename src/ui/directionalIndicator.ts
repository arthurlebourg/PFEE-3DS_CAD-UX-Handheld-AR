import * as THREE from 'three';

/**
 * DirectionalIndicator
 *
 * Displays a 2D HUD indicator when a placed 3D model is off-screen (outside camera frustum),
 * clamped to the screen edge with a directional arrow pointing toward the model.
 */
export class DirectionalIndicator {
    private container: HTMLDivElement;
    private arrowEl: HTMLDivElement;
    private distanceEl: HTMLSpanElement;

    private frustum = new THREE.Frustum();
    private projScreenMatrix = new THREE.Matrix4();
    private targetBox = new THREE.Box3();
    private targetCenter = new THREE.Vector3();
    private camPos = new THREE.Vector3();
    private camLocalPos = new THREE.Vector3();
    private ndcPos = new THREE.Vector3();

    private isVisible = false;

    constructor() {
        this.container = document.createElement('div');
        this.container.className = 'ar-directional-indicator';
        this.container.style.display = 'none';

        // Inner arrow / icon wrapper
        this.arrowEl = document.createElement('div');
        this.arrowEl.className = 'ar-directional-arrow';
        this.arrowEl.innerHTML = `
            <svg class="icon-arrow" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h14M13 5l7 7-7 7"/>
            </svg>
        `;

        // Distance text badge
        this.distanceEl = document.createElement('span');
        this.distanceEl.className = 'ar-directional-distance';

        this.container.appendChild(this.arrowEl);
        this.container.appendChild(this.distanceEl);

        this.injectStyles();
    }

    /** Mounts the indicator into the specified DOM overlay container (e.g. document.body). */
    public attach(parent: HTMLElement): void {
        parent.appendChild(this.container);
        this.container.addEventListener('beforexrselect', (e) => e.preventDefault());
    }

    /** Hides the indicator immediately. */
    public hide(): void {
        if (!this.isVisible) return;
        this.isVisible = false;
        this.container.classList.remove('visible');
        setTimeout(() => {
            if (!this.isVisible) {
                this.container.style.display = 'none';
            }
        }, 200);
    }

    /**
     * Updates the indicator position, orientation, and distance each frame.
     *
     * @param camera The active rendering perspective camera.
     * @param targetModel The 3D model to point to, or null if no model is placed.
     */
    public update(
        camera: THREE.PerspectiveCamera,
        targetModel: THREE.Object3D | null
    ): void {
        if (!targetModel || !targetModel.visible) {
            this.hide();
            return;
        }

        // Compute model's bounding box and center in world coordinates.
        let localBox = targetModel.userData.cachedBoundingBox as THREE.Box3 | undefined;
        if (!localBox) {
            localBox = new THREE.Box3().setFromObject(targetModel);
            const invWorld = targetModel.matrixWorld.clone().invert();
            localBox.applyMatrix4(invWorld);
            targetModel.userData.cachedBoundingBox = localBox;
        }

        this.targetBox.copy(localBox).applyMatrix4(targetModel.matrixWorld);
        if (this.targetBox.isEmpty()) {
            this.hide();
            return;
        }
        this.targetBox.getCenter(this.targetCenter);

        // Update frustum for camera visibility check
        camera.updateMatrixWorld();
        this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

        const inFrustum = this.frustum.intersectsBox(this.targetBox);

        // If the model is in front of the camera, it is clearly visible
        if (inFrustum) {
            this.hide();
            return;
        }

        // The model is off-screen: show directional indicator
        this.show();

        camera.getWorldPosition(this.camPos);
        const distance = this.camPos.distanceTo(this.targetCenter);
        this.distanceEl.textContent = distance < 10 ? `${distance.toFixed(1)}m` : `${Math.round(distance)}m`;

        // Position in camera local space (camera looks down -Z)
        this.camLocalPos.copy(this.targetCenter).applyMatrix4(camera.matrixWorldInverse);

        // Project target center to NDC coordinates [-1, 1]
        this.ndcPos.copy(this.targetCenter).project(camera);

        const width = window.innerWidth;
        const height = window.innerHeight;
        const cx = width / 2;
        const cy = height / 2;

        let dx = this.ndcPos.x;
        let dy = -this.ndcPos.y; // Invert Y because screen Y points downwards

        const marginX = 40;
        const marginY = 56;
        const halfW = cx - marginX;
        const halfH = cy - marginY;

        // If object is behind camera, invert vector
        if (this.camLocalPos.z >= 0) {
            dx = -dx;
            dy = -dy;
            if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) {
                dy = 1;
            }
        }

        const angleRad = Math.atan2(dy, dx);
        const angleDeg = angleRad * (180 / Math.PI);

        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        let scale = 1;
        if (absDx > 0.0001 || absDy > 0.0001) {
            const scaleX = absDx > 0 ? halfW / absDx : Infinity;
            const scaleY = absDy > 0 ? halfH / absDy : Infinity;
            scale = Math.min(scaleX, scaleY);
        }

        const screenX = cx + dx * scale;
        const screenY = cy + dy * scale;

        this.container.style.transform = `translate3d(${screenX}px, ${screenY}px, 0) translate(-50%, -50%)`;
        this.arrowEl.style.transform = `rotate(${angleDeg}deg)`;
    }

    private show(): void {
        if (!this.isVisible) {
            this.isVisible = true;
            this.container.style.display = 'flex';
            void this.container.offsetWidth;
            this.container.classList.add('visible');
        }
    }

    private injectStyles(): void {
        const style = document.createElement('style');
        style.textContent = `
            .ar-directional-indicator {
                position: fixed;
                top: 0;
                left: 0;
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 6px 10px;
                border-radius: 20px;
                background: rgba(18, 18, 18, 0.88);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                border: 1px solid rgba(0, 230, 118, 0.4);
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5), 0 0 10px rgba(0, 230, 118, 0.2);
                color: #ffffff;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 13px;
                font-weight: 600;
                pointer-events: none;
                user-select: none;
                z-index: 998;
                opacity: 0;
                transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                will-change: transform, opacity;
            }

            .ar-directional-indicator.visible {
                opacity: 1;
            }

            .ar-directional-arrow {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 22px;
                height: 22px;
                color: #00e676;
                transition: transform 0.05s linear;
            }

            .ar-directional-distance {
                font-variant-numeric: tabular-nums;
                color: #f1f5f9;
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
            }
        `;
        document.head.appendChild(style);
    }
}
