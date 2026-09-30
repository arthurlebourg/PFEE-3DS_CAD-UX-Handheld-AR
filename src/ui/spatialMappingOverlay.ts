import type { Camera } from 'three';

/**
 * SpatialMappingOverlay: Lightweight onboarding overlay with scan animation and progress bar.
 * Prompts the user to move their phone to map the space before placing the 3D model.
 */
export class SpatialMappingOverlay {
    public isComplete = false;

    private root = document.createElement('div');
    private barFill!: HTMLElement;
    private subtitle!: HTMLElement;
    private percentLabel!: HTMLElement;
    private progress = 0;
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
        this.progress = 0;
        this.lastPos = undefined;
        this.updateUI(0, 'Déplacez lentement la caméra pour cartographier la pièce');
        this.barFill.classList.remove('complete');
        this.root.classList.remove('fade-out');
        this.root.style.display = 'flex';
    }

    public hide(): void {
        this.root.style.display = 'none';
    }

    /** Increments mapping progress. */
    public step(delta = 0.012): void {
        if (this.isComplete) return;

        this.progress = Math.min(1, this.progress + delta);
        const sub = this.progress > 0.65
            ? 'Surface détectée, stabilisation...'
            : 'Déplacez lentement la caméra pour cartographier la pièce';
        this.updateUI(this.progress, sub);

        if (this.progress >= 1) {
            this.isComplete = true;
            this.barFill.classList.add('complete');
            this.updateUI(1, 'Espace cartographié !');
            this.onComplete?.();

            setTimeout(() => {
                this.root.classList.add('fade-out');
                setTimeout(() => this.hide(), 400);
            }, 700);
        }
    }

    /** Tracks camera movement in WebXR sessions. */
    public updateWebXR(frame: XRFrame, refSpace: XRReferenceSpace, hasSurface: boolean): void {
        const pose = frame.getViewerPose(refSpace);
        if (pose) {
            this.trackMotion(pose.transform.position, hasSurface ? 0.016 : 0.010);
        } else if (hasSurface) {
            this.step(0.012);
        }
    }

    /** Tracks camera movement in Dev Mode via OrbitControls. */
    public updateDev(camera: Camera): void {
        this.trackMotion(camera.position, 0.02);
    }

    private trackMotion(pos: { x: number; y: number; z: number }, amount: number): void {
        if (this.isComplete) return;
        if (this.lastPos && Math.hypot(pos.x - this.lastPos.x, pos.y - this.lastPos.y, pos.z - this.lastPos.z) > 0.002) {
            this.step(amount);
        }
        this.lastPos = { x: pos.x, y: pos.y, z: pos.z };
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
        if (skip) skip.onclick = (e) => { e.stopPropagation(); this.step(1); };

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
