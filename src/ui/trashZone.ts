import { createIcons, Trash2 } from 'lucide';

/** Extra reach around the trash, so a drop near its edge still counts. */
const HIT_MARGIN_PX = 24;

/**
 * TrashZone: the drop target that deletes a model being moved.
 *
 * Shown only while a model is dragged, bottom centre (where the toolbar sits
 * in the Selection state, never shown at the same time), and highlighted
 * while the finger is over it. Purely visual: the drag keeps the touch, and
 * main asks {@link contains} where the finger is.
 */
export class TrashZone {
    private root = document.createElement('div');

    constructor() {
        this.injectStyles();
        this.root.className = 'ar-trash';
        this.root.setAttribute('aria-hidden', 'true');
        this.root.innerHTML = `<i data-lucide="trash-2"></i><span>Supprimer</span>`;
    }

    public attach(parent: HTMLElement): void {
        parent.appendChild(this.root);
        createIcons({ icons: { Trash2 } });
    }

    public show(): void {
        this.root.classList.add('visible');
        this.root.classList.remove('hot');
    }

    public hide(): void {
        this.root.classList.remove('visible', 'hot');
    }

    /** Highlights the trash while a drop would delete. */
    public setHot(hot: boolean): void {
        this.root.classList.toggle('hot', hot);
    }

    /** Whether a finger at (x, y), in CSS pixels, is over the trash. */
    public contains(x: number, y: number): boolean {
        if (!this.root.classList.contains('visible')) return false;
        const rect = this.root.getBoundingClientRect();
        return x >= rect.left - HIT_MARGIN_PX && x <= rect.right + HIT_MARGIN_PX &&
            y >= rect.top - HIT_MARGIN_PX && y <= rect.bottom + HIT_MARGIN_PX;
    }

    private injectStyles(): void {
        const styleId = 'ar-trash-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .ar-trash {
                position: absolute;
                left: 50%;
                bottom: max(24px, env(safe-area-inset-bottom, 24px));
                width: 76px;
                height: 76px;
                border-radius: 50%;
                border: 1px solid rgba(220, 53, 69, 0.5);
                background: rgba(220, 53, 69, 0.25);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                color: #ff4a5a;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 2px;
                font-size: 10px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-weight: 600;
                z-index: 1000;
                pointer-events: none;
                opacity: 0;
                transform: translateX(-50%) scale(0.6);
                transition: opacity 0.2s, transform 0.2s, background 0.2s;
            }

            .ar-trash svg { width: 26px; height: 26px; stroke: currentColor; }

            .ar-trash.visible {
                opacity: 1;
                transform: translateX(-50%) scale(1);
            }

            .ar-trash.hot {
                background: rgba(220, 53, 69, 0.85);
                color: #fff;
                transform: translateX(-50%) scale(1.15);
                box-shadow: 0 0 20px rgba(220, 53, 69, 0.6);
            }
        `;
        document.head.appendChild(style);
    }
}
