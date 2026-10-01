/**
 * Rotates only UI icons so they remain upright when the phone is turned.
 *
 * The UI itself never moves.
 * Upside-down portrait (180°) is intentionally ignored.
 */
export class OrientationLayer {
    public readonly element = document.createElement('div');

    private rotation = 0;

    constructor() {
        this.element.className = 'orientation-icon-layer';

        this.element.style.cssText = `
            position: fixed;
            inset: 0;
            pointer-events: none;
            z-index: 1;
            --ui-icon-rotation: 0deg;
        `;

        this.injectStyles();
    }

    public attach(parent: HTMLElement): void {
        parent.appendChild(this.element);

        this.update();

        window.addEventListener('orientationchange', this.update);
        screen.orientation?.addEventListener?.('change', this.update);
        window.addEventListener('deviceorientation', this.onDeviceOrientation, true);
    }

    private update = (): void => {
        const angle = screen.orientation?.angle;

        if (angle === 90) {
            this.setRotation(-90);
        } else if (angle === 270 || angle === -90) {
            this.setRotation(90);
        } else if (angle === 0) {
            this.setRotation(0);
        }

        // 180° is deliberately ignored.
    };

    private onDeviceOrientation = (event: DeviceOrientationEvent): void => {
        if (event.gamma == null || event.beta == null) return;

        // Higher threshold = less sensitive / less accidental rotation.
        if (event.gamma > 65) {
            this.setRotation(-90);
        } else if (event.gamma < -65) {
            this.setRotation(90);
        } else if (
            Math.abs(event.gamma) < 25 &&
            event.beta > 45 &&
            event.beta < 135
        ) {
            this.setRotation(0);
        }

        // Everything else is ignored, including upside-down portrait.
    };

    private setRotation(degrees: number): void {
        if (degrees === this.rotation) return;

        this.rotation = degrees;
        this.element.style.setProperty(
            '--ui-icon-rotation',
            `${degrees}deg`
        );

        const panels = document.querySelectorAll<HTMLElement>(
            '.orientation-aware-panel'
        );

        const orientation =
            degrees === -90 ? 'left' :
            degrees === 90 ? 'right' :
            'portrait';

        panels.forEach(panel => {
            panel.dataset.orientation = orientation;
        });
    }

    private injectStyles(): void {
        if (document.getElementById('orientation-icon-styles')) return;

        const style = document.createElement('style');
        style.id = 'orientation-icon-styles';

        style.textContent = `
            .orientation-icon-layer .lucide {
                transform: rotate(var(--ui-icon-rotation));
                transform-origin: center;
                transition:
                    transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1);
            }

            .orientation-aware-panel {
                transition:
                    transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1),
                    left 420ms ease,
                    right 420ms ease,
                    top 420ms ease,
                    bottom 420ms ease;
            }

            .orientation-aware-panel[data-orientation="left"] {
                transform: rotate(-90deg);
            }

            .orientation-aware-panel[data-orientation="right"] {
                transform: rotate(90deg);
            }

            .orientation-aware-panel[data-orientation="portrait"] {
                transform: rotate(0deg);
            }
        `;

        document.head.appendChild(style);
    }
}