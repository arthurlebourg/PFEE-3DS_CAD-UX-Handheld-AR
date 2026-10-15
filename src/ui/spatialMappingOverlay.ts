import type { Camera } from 'three';

/** Share of the bar camera motion alone can fill; the rest requires a real surface. */
const MOTION_CAP = 0.6;
/** Progress per frame of camera motion, before any surface is seen (~2 s to the cap at 30 fps). */
const MOTION_STEP = 0.01;
/** Per-frame displacement (m) that counts as the user moving the device. */
const MOTION_THRESHOLD = 0.002;
/** Surface score needed to validate placement (~0.7 s of steady hits at 30 fps). */
const SURFACE_TARGET = 20;
/** A missed hit costs less than a hit earns, so brief flicker doesn't reset the score. */
const SURFACE_DECAY = 0.5;
/** Time without a surface in view before suggesting where to aim. */
const HINT_DELAY_MS = 7000;
/** Fraction of the gap the displayed bar closes each frame, so jumps animate. */
const BAR_SMOOTHING = 0.25;

const MSG_MOVE = 'Déplacez lentement la caméra pour cartographier la pièce';
const MSG_STABILIZING = 'Surface détectée, stabilisation...';
const MSG_HINT = 'Pointez vers le sol ou une table bien éclairée';
const MSG_DONE = 'Espace cartographié !';

/**
 * SpatialMappingOverlay: onboarding overlay shown until a placement surface is found.
 *
 * Camera motion fills the bar up to MOTION_CAP to reassure the user while tracking
 * warms up; the remainder only fills while the centre-screen hit test keeps finding
 * a surface, so completion guarantees there is somewhere to place a model.
 */
export class SpatialMappingOverlay {
    public isComplete = false;

    private root = document.createElement('div');
    private barFill!: HTMLElement;
    private subtitle!: HTMLElement;
    private percentLabel!: HTMLElement;
    private motionProgress = 0;
    private surfaceScore = 0;
    private displayedProgress = 0;
    private lastSurfaceTime = 0;
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
        this.motionProgress = 0;
        this.surfaceScore = 0;
        this.displayedProgress = 0;
        this.lastSurfaceTime = performance.now();
        this.lastPos = undefined;
        this.updateUI(0, MSG_MOVE);
        this.barFill.classList.remove('complete');
        this.root.classList.remove('fade-out');
        this.root.style.display = 'flex';
    }

    public hide(): void {
        this.root.style.display = 'none';
    }

    /** Feeds one WebXR frame: viewer motion plus whether the hit test found a surface. */
    public updateWebXR(frame: XRFrame, refSpace: XRReferenceSpace, hasSurface: boolean): void {
        const pose = frame.getViewerPose(refSpace);
        this.update(pose ? this.hasMoved(pose.transform.position) : false, hasSurface);
    }

    /**
     * Feeds one Dev Mode frame. There is no hit testing on desktop, so orbiting
     * the camera stands in for seeing a surface.
     */
    public updateDev(camera: Camera): void {
        const moved = this.hasMoved(camera.position);
        this.update(moved, moved);
    }

    private update(moved: boolean, hasSurface: boolean): void {
        if (this.isComplete) return;

        if (hasSurface) {
            // A surface implies tracking is up: skip the rest of the motion phase.
            this.motionProgress = MOTION_CAP;
            this.surfaceScore = Math.min(SURFACE_TARGET, this.surfaceScore + 1);
            this.lastSurfaceTime = performance.now();
        } else {
            if (moved) {
                this.motionProgress = Math.min(MOTION_CAP, this.motionProgress + MOTION_STEP);
            }
            this.surfaceScore = Math.max(0, this.surfaceScore - SURFACE_DECAY);
        }

        if (this.surfaceScore >= SURFACE_TARGET) {
            this.complete();
            return;
        }

        const target = this.motionProgress + (1 - MOTION_CAP) * (this.surfaceScore / SURFACE_TARGET);
        this.displayedProgress += (target - this.displayedProgress) * BAR_SMOOTHING;

        let msg = MSG_MOVE;
        if (this.surfaceScore > 0) {
            msg = MSG_STABILIZING;
        } else if (performance.now() - this.lastSurfaceTime > HINT_DELAY_MS) {
            msg = MSG_HINT;
        }
        this.updateUI(this.displayedProgress, msg);
    }

    private complete(): void {
        if (this.isComplete) return;
        this.isComplete = true;
        this.barFill.classList.add('complete');
        this.updateUI(1, MSG_DONE);
        this.onComplete?.();

        setTimeout(() => {
            this.root.classList.add('fade-out');
            setTimeout(() => this.hide(), 400);
        }, 700);
    }

    private hasMoved(pos: { x: number; y: number; z: number }): boolean {
        const moved = this.lastPos !== undefined &&
            Math.hypot(pos.x - this.lastPos.x, pos.y - this.lastPos.y, pos.z - this.lastPos.z) > MOTION_THRESHOLD;
        this.lastPos = { x: pos.x, y: pos.y, z: pos.z };
        return moved;
    }

    private updateUI(p: number, msg: string): void {
        const pct = Math.round(p * 100);
        this.barFill.style.width = `${pct}%`;
        this.percentLabel.textContent = `${pct}%`;
        this.subtitle.textContent = msg;
    }


    private buildDOM(isDevMode: boolean): void {
        this.root.className = 'ar-scan-overlay';
        this.root.style.display = 'none';
        this.root.innerHTML = `
            <div class="ar-scan-card">
                <div class="ar-scan-graphic">
                    <svg viewBox="0 0 120 100" class="scan-svg" fill="none">
                        <ellipse cx="60" cy="80" rx="44" ry="14" stroke="rgba(56,189,248,0.35)" stroke-width="1.5" stroke-dasharray="3 3"/>
                        <ellipse cx="60" cy="80" rx="26" ry="8" stroke="rgba(56,189,248,0.55)" stroke-width="1.5"/>
                        <path d="M 34 80 A 26 8 0 0 1 86 80" class="radar-arc" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round"/>
                        <g class="phone-wrapper">
                            <rect x="46" y="16" width="28" height="48" rx="5" fill="rgba(15,23,42,0.95)" stroke="#38bdf8" stroke-width="2"/>
                            <rect x="49" y="21" width="22" height="34" rx="2" fill="rgba(56,189,248,0.2)"/>
                            <circle cx="60" cy="59" r="2" fill="rgba(255,255,255,0.6)"/>
                            <polygon points="50,55 70,55 84,80 36,80" class="scan-beam" fill="url(#beamGrad)" opacity="0.45"/>
                        </g>
                        <defs>
                            <linearGradient id="beamGrad" x1="60" y1="55" x2="60" y2="80" gradientUnits="userSpaceOnUse">
                                <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.8"/>
                                <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.05"/>
                            </linearGradient>
                        </defs>
                    </svg>
                </div>
                <h3 class="ar-scan-title">Cartographie de l'espace</h3>
                <p class="ar-scan-sub"></p>
                <div class="ar-scan-bar"><div class="ar-scan-fill"></div></div>
                <div class="ar-scan-meta"><span>Scan en cours</span><span class="ar-scan-pct">0%</span></div>
                ${isDevMode ? '<button class="ar-scan-skip">Passer (Dev)</button>' : ''}
            </div>
        `;
        this.barFill = this.root.querySelector('.ar-scan-fill')!;
        this.subtitle = this.root.querySelector('.ar-scan-sub')!;
        this.percentLabel = this.root.querySelector('.ar-scan-pct')!;

        const skip = this.root.querySelector<HTMLButtonElement>('.ar-scan-skip');
        if (skip) skip.onclick = (e) => { e.stopPropagation(); this.complete(); };

        this.root.addEventListener('beforexrselect', (e) => e.preventDefault());
    }

    private injectStyles(): void {
        if (document.getElementById('ar-scan-styles')) return;
        const style = document.createElement('style');
        style.id = 'ar-scan-styles';
        style.textContent = `
            .ar-scan-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 2000; transition: opacity 0.4s ease; }
            .ar-scan-overlay.fade-out { opacity: 0; }
            .ar-scan-card { width: 85%; max-width: 330px; padding: 22px 20px; background: rgba(15,15,24,0.88); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); border: 1px solid rgba(255,255,255,0.18); border-radius: 20px; color: #fff; text-align: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; box-shadow: 0 16px 40px rgba(0,0,0,0.5); pointer-events: auto; }
            .ar-scan-graphic { width: 120px; height: 90px; margin: 0 auto 8px; display: flex; align-items: center; justify-content: center; }
            .scan-svg { width: 100%; height: 100%; overflow: visible; }
            .phone-wrapper { transform-origin: 60px 80px; animation: scanSway 2.4s ease-in-out infinite alternate; }
            @keyframes scanSway { 0% { transform: rotate(-18deg) translateX(-12px); } 50% { transform: rotate(0deg) translateX(0); } 100% { transform: rotate(18deg) translateX(12px); } }
            .scan-beam { animation: beamPulse 1.2s ease-in-out infinite alternate; }
            @keyframes beamPulse { from { opacity: 0.2; } to { opacity: 0.6; } }
            .radar-arc { animation: radarSweep 2.4s ease-in-out infinite alternate; transform-origin: 60px 80px; }
            @keyframes radarSweep { 0% { opacity: 0.3; transform: scaleX(0.7); } 100% { opacity: 1; transform: scaleX(1.1); } }
            .ar-scan-title { margin: 0 0 6px; font-size: 18px; font-weight: 700; }
            .ar-scan-sub { margin: 0 0 16px; font-size: 13px; color: rgba(255,255,255,0.75); min-height: 36px; display: flex; align-items: center; justify-content: center; }
            .ar-scan-bar { height: 8px; background: rgba(255,255,255,0.12); border-radius: 999px; overflow: hidden; margin-bottom: 10px; }
            .ar-scan-fill { height: 100%; width: 0%; border-radius: 999px; background: linear-gradient(90deg, #38bdf8, #2563eb); transition: width 0.15s ease-out, background 0.3s; }
            .ar-scan-fill.complete { background: #10b981; }
            .ar-scan-meta { display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; color: #38bdf8; }
            .ar-scan-skip { margin-top: 14px; padding: 6px 12px; font-size: 11px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff; cursor: pointer; }
        `;
        document.head.appendChild(style);
    }
}
