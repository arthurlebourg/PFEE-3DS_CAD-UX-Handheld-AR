import { ThumbnailRenderer, preloadThumbnails } from './modelThumbnails.js';

export interface ModelPickerCallbacks {
    /** A card was chosen. The owner selects the model, then closes the picker. */
    onSelect: (modelName: string) => void;
    /** The picker closed, whichever way (selection, ✕, backdrop, Escape). */
    onClose: () => void;
}

/** Card preview lifecycle, mirrored on `data-state` for the CSS. */
type CardState = 'idle' | 'loading' | 'ready' | 'error';

/** Hover/focus must settle this long before a GLB is parsed for a live spin. */
const LIVE_DWELL_MS = 350;

/** Same breakpoint as the CSS: landscape phones and desktop get the side panel. */
const SIDE_PANEL_QUERY = '(orientation: landscape), (hover: hover) and (pointer: fine)';
/** Travel before a touch turns into a sheet drag (lets taps through). */
const DRAG_SLOP_PX = 12;
/** A press that travels further than this is not a tap. */
const TAP_SLOP_PX = 10;
/** How long the click synthesized after a closing tap is waited for. */
const GHOST_CLICK_MS = 400;
/** Released below the half sheet by min(this, ratio × its height), it closes. */
const DRAG_CLOSE_PX = 120;
const DRAG_CLOSE_RATIO = 0.3;
/** A flick this fast moves the sheet one position: up to full, down to half or closed. */
const DRAG_FLICK_VELOCITY = 0.5; // px/ms

interface DragState {
    /** Visible sheet height when the touch began. */
    startHeight: number;
    startY: number;
    lastY: number;
    lastTime: number;
    /** Smoothed, px/ms, positive downward. */
    velocity: number;
    /** Past the slop: the sheet follows the finger. */
    active: boolean;
}

/**
 * ModelPicker: the modal grid behind the "Modèles" button.
 *
 * Each card shows a snapshot of its model. Snapshots are rendered in the
 * background from launch and stored across launches (see preloadThumbnails),
 * so the picker opens on ready images; a card still missing one asks for it
 * first. The hovered (mouse) or keyboard-focused card spins live. Touch has
 * neither, so phones only get the snapshots: a live spin on the card focused
 * at open would parse a GLB on every open, which the AR scene would feel.
 *
 * Cards, ✕ and the backdrop act on taps (see {@link onTap}) rather than on
 * `pointerdown` like the other AR buttons, since the grid scrolls on phones
 * and a swipe must not pick the card it starts on; nor on `click`, which a
 * touch that began elsewhere can deliver.
 * The backdrop keeps the `ar-model-panel` class that GestureRecognizer already
 * treats as UI, so touches on the picker never reach the scene.
 *
 * Layout: a bottom sheet in portrait, opening half high; dragged by its grip
 * (the strip around the handle at the top, and nothing else, so scrolling the
 * grid never moves the sheet) it expands to full height, goes back to half or
 * closes. A right side
 * panel in landscape and on desktop. A drag release that closes goes through
 * {@link close}, like ✕ does.
 */
export class ModelPicker {
    private readonly callbacks: ModelPickerCallbacks;

    private root = document.createElement('div');
    private dialog = document.createElement('div');
    private head = document.createElement('div');
    /** The only place a sheet drag starts: a full-width strip around the handle. */
    private grip = document.createElement('div');
    private grid = document.createElement('div');
    private btnClose = document.createElement('button');
    private liveCanvas = document.createElement('canvas');
    private cards = new Map<string, HTMLButtonElement>();

    private thumbnails: ThumbnailRenderer | null = null;
    private observer: IntersectionObserver | null = null;
    private returnFocus: HTMLElement | null = null;
    private liveCard: HTMLButtonElement | null = null;
    private liveTimer: number | null = null;
    private opened = false;
    private drag: DragState | null = null;
    /** Bottom sheet at full height rather than half. */
    private expanded = false;
    /** Zero-width probes resolving the CSS sheet heights (dvh, safe areas) in px. */
    private halfProbe = document.createElement('div');
    private fullProbe = document.createElement('div');
    /** Set by a sheet drag, so the card under the finger is not picked on release. */
    private suppressTap = false;

    constructor(models: string[], callbacks: ModelPickerCallbacks) {
        this.callbacks = callbacks;

        this.injectStyles();

        this.root.className = 'ar-model-panel ar-model-picker';

        this.dialog.className = 'ar-mp-dialog';
        this.dialog.setAttribute('role', 'dialog');
        this.dialog.setAttribute('aria-modal', 'true');
        this.dialog.setAttribute('aria-labelledby', 'ar-mp-title');

        this.head.className = 'ar-mp-head';
        this.grip.className = 'ar-mp-grip';
        this.grip.setAttribute('aria-hidden', 'true');
        const handle = document.createElement('span');
        handle.className = 'ar-mp-handle';
        this.grip.appendChild(handle);
        const heading = document.createElement('div');
        heading.className = 'ar-mp-heading';
        const title = document.createElement('h2');
        title.className = 'ar-mp-title';
        title.id = 'ar-mp-title';
        title.textContent = 'Modèles';
        const count = document.createElement('span');
        count.className = 'ar-mp-count';
        count.textContent = `${models.length} modèle${models.length > 1 ? 's' : ''}`;
        heading.append(title, count);
        this.btnClose.type = 'button';
        this.btnClose.className = 'ar-mp-close';
        this.btnClose.textContent = '✕';
        this.btnClose.setAttribute('aria-label', 'Fermer');
        this.head.append(this.grip, heading, this.btnClose);

        this.grid.className = 'ar-mp-grid';
        this.grid.setAttribute('role', 'group');
        this.grid.setAttribute('aria-labelledby', 'ar-mp-title');
        for (const model of models) {
            const card = this.createCard(model);
            this.cards.set(model, card);
            this.grid.appendChild(card);
        }

        this.liveCanvas.className = 'ar-mp-live';
        this.liveCanvas.width = 256;
        this.liveCanvas.height = 256;
        this.liveCanvas.setAttribute('aria-hidden', 'true');

        this.dialog.append(this.head, this.grid);
        this.halfProbe.className = 'ar-mp-probe half';
        this.fullProbe.className = 'ar-mp-probe full';
        this.root.append(this.dialog, this.halfProbe, this.fullProbe);

        preloadThumbnails(models);

        // Tapping the backdrop closes, tapping the dialog does not.
        this.root.addEventListener('pointerdown', (event) => event.stopPropagation());
        this.onTap(this.root, () => this.close(), {
            startsOn: (target) => target === this.root,
            keyboard: false,
        });
        this.root.addEventListener('beforexrselect', (event) => event.preventDefault());
        this.root.addEventListener('keydown', (event) => this.onKeyDown(event));
        this.onTap(this.btnClose, () => this.close());

        this.dialog.addEventListener('touchstart', (event) => this.onDragStart(event), { passive: true });
        this.dialog.addEventListener('touchmove', (event) => this.onDragMove(event), { passive: false });
        this.dialog.addEventListener('touchend', () => this.onDragEnd(false));
        this.dialog.addEventListener('touchcancel', () => this.onDragEnd(true));
    }

    public get isOpen(): boolean {
        return this.opened;
    }

    public attach(parent: HTMLElement): void {
        parent.appendChild(this.root);
    }

    /**
     * Opens on `activeModel`'s card. `returnFocus` gets the focus back on close.
     */
    public open(activeModel: string, returnFocus: HTMLElement | null = null): void {
        if (this.opened) return;
        this.opened = true;
        this.returnFocus = returnFocus;

        let activeCard: HTMLButtonElement | null = null;
        for (const [model, card] of this.cards) {
            const isActive = model === activeModel;
            card.classList.toggle('active', isActive);
            if (isActive) {
                card.setAttribute('aria-current', 'true');
                activeCard = card;
            } else {
                card.removeAttribute('aria-current');
            }
        }

        this.thumbnails = new ThumbnailRenderer((model, url) => this.applyResult(model, url));
        this.root.classList.add('open');
        document.addEventListener('focusin', this.onFocusIn);

        // Only cards in (or near) view get a preview; cancelled when scrolled away.
        this.observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                const card = entry.target as HTMLButtonElement;
                const model = card.dataset.model!;
                const state = card.dataset.state as CardState;
                if (entry.isIntersecting && state === 'idle') {
                    card.dataset.state = 'loading';
                    this.thumbnails?.request(model);
                } else if (!entry.isIntersecting && state === 'loading') {
                    card.dataset.state = 'idle';
                    this.thumbnails?.cancel(model);
                }
            }
        }, { root: this.grid, rootMargin: '64px' });
        for (const card of this.cards.values()) {
            this.observer.observe(card);
        }

        const first = activeCard ?? this.cards.values().next().value ?? null;
        if (first) {
            this.setRoving(first);
            first.focus({ preventScroll: true });
            first.scrollIntoView({ block: 'nearest' });
        } else {
            this.btnClose.focus({ preventScroll: true });
        }
    }

    /** Closes and releases every preview resource. Safe to call when closed. */
    public close(): void {
        if (!this.opened) return;
        this.opened = false;

        const hadFocus = this.root.contains(document.activeElement);

        this.drag = null;
        this.dialog.classList.remove('dragging');
        this.dialog.style.transform = '';
        this.dialog.style.height = '';
        this.setExpanded(false);
        this.root.classList.remove('open');
        document.removeEventListener('focusin', this.onFocusIn);

        this.stopLive();
        this.observer?.disconnect();
        this.observer = null;
        this.thumbnails?.dispose();
        this.thumbnails = null;

        // Requests in flight died with the renderer: ask again next time.
        for (const card of this.cards.values()) {
            if (card.dataset.state === 'loading') card.dataset.state = 'idle';
        }

        if (hadFocus) {
            this.returnFocus?.focus({ preventScroll: true });
        }
        this.returnFocus = null;

        this.callbacks.onClose();
    }

    // -------------------------------------------------------------------------
    // Cards
    // -------------------------------------------------------------------------

    private createCard(model: string): HTMLButtonElement {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'ar-mp-card';
        card.tabIndex = -1;
        card.dataset.model = model;
        card.dataset.state = 'idle';

        const media = document.createElement('span');
        media.className = 'ar-mp-media';
        media.innerHTML = `<span class="ar-mp-placeholder" aria-hidden="true"><i data-lucide="layers"></i></span>`;

        const img = document.createElement('img');
        img.className = 'ar-mp-img';
        img.alt = '';
        img.draggable = false;
        img.addEventListener('load', () => { card.dataset.state = 'ready'; });
        img.addEventListener('error', () => { card.dataset.state = 'error'; });
        media.appendChild(img);

        const name = document.createElement('span');
        name.className = 'ar-mp-name';
        name.textContent = model.replace('.glb', '').replace(/_/g, ' ').toUpperCase();

        const badge = document.createElement('span');
        badge.className = 'ar-mp-badge';
        badge.textContent = 'Actuel';
        badge.setAttribute('aria-hidden', 'true');

        card.append(media, name, badge);

        this.onTap(card, () => this.callbacks.onSelect(model));
        card.addEventListener('focus', () => {
            this.setRoving(card);
            if (card.matches(':focus-visible')) this.scheduleLive(card);
        });
        card.addEventListener('blur', () => this.stopLive(card));
        card.addEventListener('pointerenter', (event) => {
            if (event.pointerType === 'mouse') this.scheduleLive(card);
        });
        card.addEventListener('pointerleave', (event) => {
            if (event.pointerType === 'mouse') this.stopLive(card);
        });

        return card;
    }

    /**
     * Pointer taps: down and up on `element`, under TAP_SLOP_PX of travel, not
     * cancelled by a scroll (pointercancel) nor turned into a sheet drag.
     *
     * Unlike `click`, a tap cannot come from a touch that began elsewhere: the
     * press that opens the picker on pointerdown would otherwise land, as the
     * click Chrome synthesizes on release, on whatever card slid under the
     * finger. Keyboard activation still arrives as a click with `detail === 0`.
     */
    private onTap(
        element: HTMLElement,
        callback: () => void,
        options: { startsOn?: (target: EventTarget | null) => boolean; keyboard?: boolean } = {},
    ): void {
        const { startsOn = () => true, keyboard = true } = options;
        let start: { id: number; x: number; y: number } | null = null;

        element.addEventListener('pointerdown', (event) => {
            start = event.isPrimary && event.button === 0 && startsOn(event.target)
                ? { id: event.pointerId, x: event.clientX, y: event.clientY }
                : null;
        });
        element.addEventListener('pointercancel', () => {
            start = null;
        });
        element.addEventListener('pointerup', (event) => {
            const tap = start;
            start = null;
            if (!tap || tap.id !== event.pointerId || this.suppressTap) return;
            if (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > TAP_SLOP_PX) return;

            this.swallowNextClick();
            callback();
        });
        if (keyboard) {
            element.addEventListener('click', (event) => {
                if (event.detail === 0) callback();
            });
        }
    }

    /**
     * Every tap here closes the picker, and the click Chrome synthesizes right
     * after lands on whatever was underneath (in landscape, possibly ARButton's
     * ✕, which would end the session). Eat that one click, keyboard ones aside.
     */
    private swallowNextClick(): void {
        const swallow = (event: MouseEvent) => {
            if (event.detail === 0) return;
            event.preventDefault();
            event.stopPropagation();
            remove();
        };
        const remove = () => {
            window.removeEventListener('click', swallow, true);
            window.clearTimeout(timer);
        };
        window.addEventListener('click', swallow, true);
        const timer = window.setTimeout(remove, GHOST_CLICK_MS);
    }

    private applyResult(model: string, url: string | null): void {
        const card = this.cards.get(model);
        if (!card) return;

        const img = card.querySelector<HTMLImageElement>('.ar-mp-img')!;
        if (!url) {
            card.dataset.state = 'error';
        } else if (img.getAttribute('src') === url) {
            card.dataset.state = 'ready';
        } else {
            img.src = url;
        }
    }

    /** Roving tabindex: the grid is a single Tab stop, arrows move inside. */
    private setRoving(card: HTMLButtonElement): void {
        for (const other of this.cards.values()) {
            other.tabIndex = other === card ? 0 : -1;
        }
    }

    // -------------------------------------------------------------------------
    // Live preview
    // -------------------------------------------------------------------------

    private scheduleLive(card: HTMLButtonElement): void {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        if (this.liveTimer !== null) window.clearTimeout(this.liveTimer);
        this.liveTimer = window.setTimeout(() => {
            this.liveTimer = null;
            if (!this.thumbnails) return;

            this.liveCard = card;
            // Wipe the previous model's last frame before the canvas moves.
            this.liveCanvas.getContext('2d')?.clearRect(0, 0, this.liveCanvas.width, this.liveCanvas.height);
            card.querySelector('.ar-mp-media')!.appendChild(this.liveCanvas);
            this.thumbnails.setLive(card.dataset.model!, this.liveCanvas);
        }, LIVE_DWELL_MS);
    }

    /** Stops the live preview, or only if it belongs to `card` when given. */
    private stopLive(card?: HTMLButtonElement): void {
        if (this.liveTimer !== null) {
            window.clearTimeout(this.liveTimer);
            this.liveTimer = null;
        }
        if (card && this.liveCard !== card) return;

        this.liveCard = null;
        this.liveCanvas.remove();
        this.thumbnails?.setLive(null);
    }

    // -------------------------------------------------------------------------
    // Sheet drag (bottom sheet only): half, full, or closed
    // -------------------------------------------------------------------------

    private onDragStart(event: TouchEvent): void {
        this.suppressTap = false;
        this.drag = null;
        if (event.touches.length !== 1 || window.matchMedia(SIDE_PANEL_QUERY).matches) return;

        if (!this.grip.contains(event.target as Node)) return;

        const y = event.touches[0].clientY;
        this.drag = {
            startHeight: this.dialog.getBoundingClientRect().height,
            startY: y,
            lastY: y,
            lastTime: event.timeStamp,
            velocity: 0,
            active: false,
        };
    }

    private onDragMove(event: TouchEvent): void {
        const drag = this.drag;
        if (!drag) return;
        if (event.touches.length !== 1) {
            this.onDragEnd(true);
            return;
        }

        const y = event.touches[0].clientY;
        const dy = y - drag.startY;

        if (!drag.active) {
            if (dy === 0) return;
            if (!event.cancelable) {
                this.drag = null;
                return;
            }
            event.preventDefault();
            if (Math.abs(dy) < DRAG_SLOP_PX) return;

            drag.active = true;
            this.suppressTap = true;
            this.dialog.classList.add('dragging');
        }

        if (event.cancelable) event.preventDefault();

        const dt = event.timeStamp - drag.lastTime;
        if (dt > 0) {
            drag.velocity = 0.8 * ((y - drag.lastY) / dt) + 0.2 * drag.velocity;
        }
        drag.lastY = y;
        drag.lastTime = event.timeStamp;

        // Above half high the sheet grows; below it, it slides down to close.
        const half = this.halfProbe.offsetHeight;
        const full = this.fullProbe.offsetHeight;
        const visible = drag.startHeight - dy;
        if (visible >= half) {
            this.dialog.style.height = `${Math.min(visible, full)}px`;
            this.dialog.style.transform = '';
        } else {
            this.dialog.style.height = `${half}px`;
            this.dialog.style.transform = `translateY(${half - visible}px)`;
        }
    }

    private onDragEnd(cancelled: boolean): void {
        const drag = this.drag;
        this.drag = null;
        if (!drag?.active) return;

        const half = this.halfProbe.offsetHeight;
        const full = this.fullProbe.offsetHeight;
        const visible = drag.startHeight - (drag.lastY - drag.startY);

        let next: 'full' | 'half' | 'closed';
        if (cancelled) {
            next = this.expanded ? 'full' : 'half';
        } else if (drag.velocity < -DRAG_FLICK_VELOCITY) {
            next = 'full';
        } else if (drag.velocity > DRAG_FLICK_VELOCITY) {
            next = this.expanded && visible >= half ? 'half' : 'closed';
        } else if (visible > (half + full) / 2) {
            next = 'full';
        } else if (visible >= half - Math.min(DRAG_CLOSE_PX, half * DRAG_CLOSE_RATIO)) {
            next = 'half';
        } else {
            next = 'closed';
        }

        // Dropping the inline size hands the move back to the CSS transition:
        // from where the finger left it to the chosen position.
        this.dialog.classList.remove('dragging');
        this.dialog.style.height = '';
        this.dialog.style.transform = '';
        if (next === 'closed') {
            // The release may still be read as a tap by the browser.
            this.swallowNextClick();
            this.close();
        } else {
            this.setExpanded(next === 'full');
        }
    }

    private setExpanded(expanded: boolean): void {
        this.expanded = expanded;
        this.dialog.classList.toggle('expanded', expanded);
    }

    // -------------------------------------------------------------------------
    // Keyboard & focus
    // -------------------------------------------------------------------------

    private onKeyDown(event: KeyboardEvent): void {
        this.suppressTap = false;

        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.close();
            return;
        }

        if (event.key === 'Tab') {
            this.trapTab(event);
            return;
        }

        const cards = [...this.cards.values()];
        const index = cards.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0) return;

        const columns = this.columnCount(cards);
        let next: number;
        switch (event.key) {
            case 'ArrowRight': next = index + 1; break;
            case 'ArrowLeft': next = index - 1; break;
            case 'ArrowDown': next = index + columns; break;
            case 'ArrowUp': next = index - columns; break;
            case 'Home': next = 0; break;
            case 'End': next = cards.length - 1; break;
            default: return;
        }
        event.preventDefault();

        const target = cards[Math.max(0, Math.min(cards.length - 1, next))];
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'nearest' });
    }

    /** Tab cycles between the ✕ button and the grid's roving card. */
    private trapTab(event: KeyboardEvent): void {
        const roving = [...this.cards.values()].find((card) => card.tabIndex === 0);
        const focusables: HTMLElement[] = roving ? [this.btnClose, roving] : [this.btnClose];
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (event.shiftKey && (active === first || !this.dialog.contains(active))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (active === last || !this.dialog.contains(active))) {
            event.preventDefault();
            first.focus();
        }
    }

    /** Pulls focus back if it escapes the dialog while open (e.g. a click outside). */
    private onFocusIn = (event: FocusEvent): void => {
        if (!this.opened || this.dialog.contains(event.target as Node)) return;
        const roving = [...this.cards.values()].find((card) => card.tabIndex === 0);
        (roving ?? this.btnClose).focus({ preventScroll: true });
    };

    /** Columns of the responsive grid: cards sharing the first card's row. */
    private columnCount(cards: HTMLButtonElement[]): number {
        const top = cards[0].offsetTop;
        let columns = 0;
        for (const card of cards) {
            if (card.offsetTop !== top) break;
            columns++;
        }
        return Math.max(1, columns);
    }

    // -------------------------------------------------------------------------
    // CSS injection
    // -------------------------------------------------------------------------

    private injectStyles(): void {
        const styleId = 'ar-model-picker-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;

        // No backdrop-filter anywhere: blurring the camera feed every frame is
        // too costly in AR. The veil is a flat colour that fades with the panel.
        style.textContent = `
            .ar-model-picker {
                position: fixed;
                inset: 0;
                z-index: 1100;
                background: rgba(0, 0, 0, 0);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                visibility: hidden;
                pointer-events: none;
                transition: background-color 0.2s ease-out, visibility 0s linear 0.22s;
            }

            .ar-model-picker.open {
                background: rgba(0, 0, 0, 0.5);
                visibility: visible;
                pointer-events: auto;
                transition: background-color 0.2s ease-out;
            }

            /* Portrait: bottom sheet */
            .ar-mp-dialog {
                position: absolute;
                left: 0;
                right: 0;
                bottom: 0;
                height: 55vh;
                height: 55dvh;
                display: flex;
                flex-direction: column;
                box-sizing: border-box;
                padding: 0 env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
                background: rgba(18, 18, 18, 0.92);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-bottom: none;
                border-radius: 20px 20px 0 0;
                box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.35);
                color: rgba(255, 255, 255, 0.87);
                transform: translateY(100%);
                transition: transform 0.22s cubic-bezier(0.2, 0, 0, 1), height 0.22s cubic-bezier(0.2, 0, 0, 1);
                will-change: transform;
            }

            .ar-model-picker.open .ar-mp-dialog { transform: translateY(0); }
            .ar-mp-dialog.dragging { transition: none; }

            /* Dragged up: full height, under the status bar / notch */
            .ar-mp-dialog.expanded,
            .ar-mp-probe.full {
                height: calc(100vh - 24px);
                height: calc(100dvh - env(safe-area-inset-top, 0px) - 24px);
            }

            .ar-mp-probe {
                position: absolute;
                top: 0;
                left: 0;
                width: 0;
                visibility: hidden;
                pointer-events: none;
            }

            .ar-mp-probe.half {
                height: 55vh;
                height: 55dvh;
            }

            .ar-mp-head {
                position: relative;
                flex: none;
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 28px 6px 4px 16px;
            }

            /* Grip: full width above the title row, so it never covers ✕ */
            .ar-mp-grip {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 28px;
                touch-action: none;
                cursor: grab;
            }

            .ar-mp-handle {
                position: absolute;
                top: 10px;
                left: 50%;
                width: 36px;
                height: 4px;
                margin-left: -18px;
                border-radius: 999px;
                background: rgba(255, 255, 255, 0.3);
            }

            .ar-mp-heading {
                flex: 1;
                min-width: 0;
                display: flex;
                align-items: baseline;
                gap: 8px;
            }

            .ar-mp-title {
                margin: 0;
                font-size: 15px;
                font-weight: 700;
                color: #fff;
            }

            .ar-mp-count {
                font-size: 12px;
                font-weight: 600;
                color: rgba(255, 255, 255, 0.6);
            }

            .ar-mp-close {
                width: 44px;
                height: 44px;
                flex: none;
                border-radius: 50%;
                border: none;
                background: transparent;
                color: rgba(255, 255, 255, 0.87);
                font-size: 16px;
                cursor: pointer;
                padding: 0;
                touch-action: manipulation;
            }

            .ar-mp-close:active { background: rgba(255, 255, 255, 0.1); }

            .ar-mp-close:focus-visible,
            .ar-mp-card:focus-visible {
                outline: 2px solid #fff;
                outline-offset: 2px;
            }

            .ar-mp-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
                align-content: start;
                gap: 12px;
                padding: 8px 16px 16px;
                min-height: 0;
                overflow-y: auto;
                overscroll-behavior: contain;
                -webkit-overflow-scrolling: touch;
            }

            .ar-mp-card {
                appearance: none;
                position: relative;
                display: flex;
                flex-direction: column;
                gap: 8px;
                min-width: 0;
                padding: 6px 6px 8px;
                border-radius: 14px;
                border: 1.5px solid transparent;
                background: rgba(255, 255, 255, 0.04);
                color: rgba(255, 255, 255, 0.87);
                font: inherit;
                cursor: pointer;
                user-select: none;
                -webkit-user-select: none;
                touch-action: manipulation;
                transition: background 0.15s, border-color 0.15s, transform 0.1s;
            }

            @media (hover: hover) {
                .ar-mp-card:hover { background: rgba(255, 255, 255, 0.07); }
                .ar-mp-close:hover { background: rgba(255, 255, 255, 0.06); }
            }

            .ar-mp-card:active {
                transform: scale(0.97);
                background: rgba(255, 255, 255, 0.1);
            }

            /* The one accent: the model currently loaded */
            .ar-mp-card.active {
                border-color: #007bff;
                background: rgba(0, 123, 255, 0.1);
            }

            .ar-mp-badge {
                position: absolute;
                top: 12px;
                left: 12px;
                z-index: 1;
                display: none;
                padding: 2px 7px;
                border-radius: 6px;
                background: #007bff;
                color: #fff;
                font-size: 10px;
                font-weight: 700;
                line-height: 1.4;
                pointer-events: none;
            }

            .ar-mp-card.active .ar-mp-badge { display: block; }

            .ar-mp-media {
                position: relative;
                display: block;
                aspect-ratio: 1;
                border-radius: 10px;
                overflow: hidden;
                background: #1e1e1e;
            }

            .ar-mp-placeholder,
            .ar-mp-img,
            .ar-mp-live {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
            }

            .ar-mp-placeholder {
                display: flex;
                align-items: center;
                justify-content: center;
                color: rgba(255, 255, 255, 0.38);
            }

            .ar-mp-placeholder svg { width: 28px; height: 28px; }

            .ar-mp-img {
                object-fit: contain;
                opacity: 0;
                transition: opacity 0.2s;
            }

            .ar-mp-live { object-fit: contain; }

            .ar-mp-card[data-state="ready"] .ar-mp-img { opacity: 1; }
            .ar-mp-card[data-state="ready"] .ar-mp-placeholder { display: none; }
            .ar-mp-card:not([data-state="ready"]) .ar-mp-live { display: none; }

            /* Skeleton while the preview is pending; the error state stays still */
            .ar-mp-card[data-state="idle"] .ar-mp-media,
            .ar-mp-card[data-state="loading"] .ar-mp-media {
                animation: ar-mp-pulse 1.4s ease-in-out infinite;
            }

            @keyframes ar-mp-pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.55; }
            }

            .ar-mp-name {
                display: -webkit-box;
                -webkit-box-orient: vertical;
                -webkit-line-clamp: 2;
                line-clamp: 2;
                overflow: hidden;
                overflow-wrap: anywhere;
                min-height: 2.6em;
                font-size: 12px;
                font-weight: 600;
                line-height: 1.3;
                text-align: center;
            }

            /* Landscape and desktop: right side panel, full height */
            @media ${SIDE_PANEL_QUERY} {
                .ar-mp-dialog {
                    top: 0;
                    left: auto;
                    width: min(calc(360px + env(safe-area-inset-right, 0px)), 100%);
                    height: auto;
                    padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) 0;
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-right: none;
                    border-radius: 20px 0 0 20px;
                    box-shadow: -4px 0 24px rgba(0, 0, 0, 0.35);
                    transform: translateX(100%);
                }

                .ar-model-picker.open .ar-mp-dialog { transform: translateX(0); }
                .ar-mp-dialog.expanded { height: auto; }
                .ar-mp-grip { display: none; }
                .ar-mp-head { padding-top: 10px; }
            }

            @media (prefers-reduced-motion: reduce) {
                .ar-model-picker,
                .ar-model-picker.open,
                .ar-mp-dialog,
                .ar-mp-card,
                .ar-mp-img { transition: none; }
                .ar-mp-card .ar-mp-media { animation: none; }
            }
        `;
        document.head.appendChild(style);
    }
}
