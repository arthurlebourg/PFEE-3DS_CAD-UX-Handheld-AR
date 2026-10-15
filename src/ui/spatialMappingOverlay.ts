import type { Camera } from 'three';

/** Per-frame displacement (m) that counts as the user moving the device. */
const MOTION_THRESHOLD = 0.002;
/** Surface score needed to validate placement (~0.7 s of steady hits at 30 fps). */
const SURFACE_TARGET = 20;
/** A missed hit costs less than a hit earns, so brief flicker doesn't reset the score. */
const SURFACE_DECAY = 0.5;
/** Time without a surface in view before suggesting where to aim. */
const HINT_DELAY_MS = 7000;
/** Time without a surface before the coaching animation comes back, so hit-test flicker doesn't blink it. */
const COACHING_RETURN_MS = 1500;

const MSG_MOVE = 'Déplacez lentement l\'appareil';
const MSG_HINT = 'Pointez vers le sol ou une table bien éclairée';

/**
 * SpatialMappingOverlay: lightweight coaching shown over the camera feed until a
 * placement surface is found, in the style of Apple Measure.
 *
 * While nothing is detected, a small phone animation invites the user to move
 * the device. As soon as the centre-screen hit test finds a surface the
 * animation fades out and the reticle takes over; completion still requires the
 * surface to stay detected, so there is always somewhere to place a model.
 */
export class SpatialMappingOverlay {
    public isComplete = false;

    private root = document.createElement('div');
    private coaching!: HTMLElement;
    private label!: HTMLElement;
    private surfaceScore = 0;
    private startTime = 0;
    private lastSurfaceTime = 0;
    private surfaceEverSeen = false;
    private lastPos?: { x: number; y: number; z: number };
    private onComplete?: () => void;

    constructor(onComplete?: () => void, isDevMode = false) {
        this.onComplete = onComplete;
        this.injectStyles();
        this.buildDOM(isDevMode);
    }

    public attach(parent: HTMLElement): void {
        parent.appendChild(this.root);
    }

    public start(): void {
        this.isComplete = false;
        this.surfaceScore = 0;
        this.startTime = performance.now();
        this.lastSurfaceTime = 0;
        this.surfaceEverSeen = false;
        this.lastPos = undefined;
        this.label.textContent = MSG_MOVE;
        this.coaching.classList.remove('hidden');
        this.root.style.display = 'flex';
    }

    public hide(): void {
        this.root.style.display = 'none';
    }

    /** Feeds one WebXR frame: whether the centre-screen hit test found a surface. */
    public updateWebXR(hasSurface: boolean): void {
        this.update(hasSurface);
    }

    /**
     * Feeds one Dev Mode frame. There is no hit testing on desktop, so orbiting
     * the camera stands in for seeing a surface.
     */
    public updateDev(camera: Camera): void {
        this.update(this.hasMoved(camera.position));
    }

    private update(hasSurface: boolean): void {
        if (this.isComplete) return;

        const now = performance.now();
        if (hasSurface) {
            this.surfaceEverSeen = true;
            this.lastSurfaceTime = now;
            this.surfaceScore = Math.min(SURFACE_TARGET, this.surfaceScore + 1);
        } else {
            this.surfaceScore = Math.max(0, this.surfaceScore - SURFACE_DECAY);
        }

        if (this.surfaceScore >= SURFACE_TARGET) {
            this.complete();
            return;
        }

        const lastSeen = this.surfaceEverSeen ? this.lastSurfaceTime : this.startTime;
        this.label.textContent = now - lastSeen > HINT_DELAY_MS ? MSG_HINT : MSG_MOVE;
        this.coaching.classList.toggle('hidden', !this.coachingVisible());
    }

    private coachingVisible(): boolean {
        return !this.surfaceEverSeen || performance.now() - this.lastSurfaceTime > COACHING_RETURN_MS;
    }

    private complete(): void {
        if (this.isComplete) return;
        this.isComplete = true;
        this.coaching.classList.add('hidden');
        this.onComplete?.();
        // Let the fade-out finish before taking the overlay out of the layout.
        setTimeout(() => {
            if (this.isComplete) this.hide();
        }, 400);
    }

    private hasMoved(pos: { x: number; y: number; z: number }): boolean {
        const moved = this.lastPos !== undefined &&
            Math.hypot(pos.x - this.lastPos.x, pos.y - this.lastPos.y, pos.z - this.lastPos.z) > MOTION_THRESHOLD;
        this.lastPos = { x: pos.x, y: pos.y, z: pos.z };
        return moved;
    }

    private buildDOM(isDevMode: boolean): void {
        this.root.className = 'ar-scan-overlay';
        this.root.style.display = 'none';
        this.root.innerHTML = `
            <div class="ar-scan-coaching">
                <svg viewBox="0 0 120 90" class="ar-scan-svg" fill="none">
                    <ellipse cx="60" cy="74" rx="40" ry="10" stroke="rgba(255,255,255,0.45)" stroke-width="1.5" stroke-dasharray="3 4"/>
                    <g class="ar-scan-phone">
                        <rect x="46" y="10" width="28" height="48" rx="6" stroke="#fff" stroke-width="2.5"/>
                        <line x1="56" y1="15" x2="64" y2="15" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
                    </g>
                </svg>
                <p class="ar-scan-label"></p>
            </div>
            ${isDevMode ? '<button class="ar-scan-skip">Passer (Dev)</button>' : ''}
        `;
        this.coaching = this.root.querySelector('.ar-scan-coaching')!;
        this.label = this.root.querySelector('.ar-scan-label')!;

        const skip = this.root.querySelector<HTMLButtonElement>('.ar-scan-skip');
        if (skip) skip.onclick = (e) => { e.stopPropagation(); this.complete(); };

        this.root.addEventListener('beforexrselect', (e) => e.preventDefault());
    }

    private injectStyles(): void {
        if (document.getElementById('ar-scan-styles')) return;
        const style = document.createElement('style');
        style.id = 'ar-scan-styles';
        style.textContent = `
            .ar-scan-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 2000; }
            .ar-scan-coaching { display: flex; flex-direction: column; align-items: center; gap: 10px; transition: opacity 0.35s ease, transform 0.35s ease; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.55)); }
            .ar-scan-coaching.hidden { opacity: 0; transform: scale(0.92); }
            .ar-scan-svg { width: 96px; height: 72px; overflow: visible; }
            .ar-scan-phone { transform-box: view-box; transform-origin: 60px 74px; animation: arScanSweep 2.4s ease-in-out infinite; }
            @keyframes arScanSweep {
                0%, 100% { transform: translateX(-18px) rotate(-10deg); }
                50% { transform: translateX(18px) rotate(10deg); }
            }
            .ar-scan-label { margin: 0; max-width: 260px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 15px; font-weight: 600; color: #fff; text-align: center; text-shadow: 0 1px 4px rgba(0,0,0,0.6); }
            .ar-scan-skip { position: fixed; bottom: 16px; right: 16px; padding: 6px 12px; font-size: 11px; background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; color: #fff; cursor: pointer; pointer-events: auto; }
        `;
        document.head.appendChild(style);
    }
}
