import type { AimTarget, NextEnd } from '../scene/measureTool.js';

const HINTS: Record<NextEnd, string> = {
    first: 'Tap + to place the first end',
    second: 'Tap + to place the second end',
    new: 'Tap + to start a new ruler',
};
const NO_TARGET_HINT = 'Aim at a part or a surface';

/**
 * MeasureOverlay: the Measure state's crosshair and hint.
 *
 * The crosshair sits at the screen centre, where the hit-test ray and the
 * model probe aim; it dims while nothing is under it and turns blue on a model
 * piece. The hint above the toolbar says what + will do. Purely visual:
 * pointer-events none, the touches go through to the scene.
 */
export class MeasureOverlay {
    private readonly crosshair = document.createElement('div');
    private readonly hint = document.createElement('div');

    private target: AimTarget | undefined;
    private hintText = '';

    constructor() {
        this.crosshair.className = 'ar-measure-crosshair';
        this.crosshair.innerHTML = '<div class="ar-measure-dot"></div>';
        this.hint.className = 'ar-measure-hint';
        this.setVisible(false);
        this.injectStyles();
    }

    public attach(parent: HTMLElement): void {
        parent.append(this.crosshair, this.hint);
    }

    public setVisible(visible: boolean): void {
        this.crosshair.classList.toggle('visible', visible);
        this.hint.classList.toggle('visible', visible);
    }

    /** Per frame; touches the DOM only when something changed. */
    public update(target: AimTarget, nextEnd: NextEnd): void {
        if (target !== this.target) {
            this.target = target;
            this.crosshair.dataset.target = target ?? 'none';
        }

        const text = target === null ? NO_TARGET_HINT : HINTS[nextEnd];
        if (text !== this.hintText) {
            this.hintText = text;
            this.hint.textContent = text;
        }
    }

    private injectStyles(): void {
        const id = 'ar-measure-overlay-styles';
        if (document.getElementById(id)) return;
        const style = document.createElement('style');
        style.id = id;
        style.textContent = `
            .ar-measure-crosshair {
                position: absolute;
                left: 50%;
                top: 50%;
                width: 34px;
                height: 34px;
                margin: -17px 0 0 -17px;
                border-radius: 50%;
                border: 2px solid #fff;
                box-shadow: 0 0 6px rgba(0, 0, 0, 0.5);
                display: none;
                align-items: center;
                justify-content: center;
                pointer-events: none;
                z-index: 950;
                transition: opacity 0.15s, border-color 0.15s;
            }
            .ar-measure-crosshair.visible { display: flex; }
            .ar-measure-crosshair[data-target="none"] { opacity: 0.4; }
            .ar-measure-crosshair[data-target="model"] { border-color: #4dabff; }

            .ar-measure-dot {
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: #fff;
            }
            .ar-measure-crosshair[data-target="model"] .ar-measure-dot { background: #4dabff; }

            .ar-measure-hint {
                position: absolute;
                left: 50%;
                bottom: calc(max(24px, env(safe-area-inset-bottom, 24px)) + 84px);
                transform: translateX(-50%);
                display: none;
                padding: 6px 12px;
                border-radius: 10px;
                background: rgba(15, 15, 20, 0.8);
                color: #fff;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 13px;
                font-weight: 600;
                white-space: nowrap;
                pointer-events: none;
                z-index: 950;
            }
            .ar-measure-hint.visible { display: block; }
        `;
        document.head.appendChild(style);
    }
}
