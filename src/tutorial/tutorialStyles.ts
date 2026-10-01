import { GLYPH_STYLES } from './gestureGlyphs.js';

/**
 * Stylesheet shared by the tutorial overlay and the cheat sheet.
 *
 * Both can be on screen without the other — the cheat sheet opens from the ?
 * button long after the tour is done — so the CSS lives in one idempotent
 * injection instead of being duplicated by whichever renders first.
 */
export function injectTutorialStyles(): void {
    const styleId = 'ar-tutorial-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
            .ar-tutorial-root {
                --ar-tut-accent: #007bff;
                position: fixed;
                inset: 0;
                z-index: 1200;
                pointer-events: none;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }

            /* The ring never takes pointer events: the spotlit button must stay
               tappable, scrim or no scrim. */
            .ar-tutorial-spot {
                position: absolute;
                /* Above the modal backdrop: the finish card rings the ? button,
                   and a ring painted under the dim is no ring at all. */
                z-index: 2;
                pointer-events: none;
                /* Keep the border inside the box so the ring stays centred on its target. */
                box-sizing: border-box;
                border: 2px solid var(--ar-tut-accent);
                opacity: 0;
                transition: opacity 0.3s;
                animation: ar-tut-pulse 1.8s ease-in-out infinite;
            }

            .ar-tutorial-spot.visible { opacity: 1; }
            .ar-tutorial-spot.scrim { box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55); }

            @keyframes ar-tut-pulse {
                0%, 100% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0); }
                50%      { box-shadow: 0 0 18px 2px var(--ar-tut-accent); }
            }

            .ar-tutorial-spot.scrim {
                animation: none;
            }

            .ar-tutorial-card {
                position: absolute;
                top: 16px;
                left: 76px;
                right: 16px;
                max-width: 520px;
                padding: 14px 16px;
                border-radius: 18px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-left: 3px solid var(--ar-tut-accent);
                background: rgba(15, 15, 20, 0.82);
                backdrop-filter: blur(14px);
                -webkit-backdrop-filter: blur(14px);
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
                color: #fff;
                pointer-events: none;
                opacity: 0;
                transform: translateY(-14px);
                transition: opacity 0.3s, transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
            }

            .ar-tutorial-card.visible { opacity: 1; transform: translateY(0); }

            .ar-tut-head { display: flex; gap: 14px; align-items: flex-start; }

            .ar-tut-glyph {
                flex: 0 0 46px;
                width: 46px;
                height: 46px;
                margin-top: 2px;
            }

            .ar-tut-glyph.big { width: 64px; height: 64px; flex: none; margin: 0 auto 10px; }

            .ar-tut-text { flex: 1; min-width: 0; }

            .ar-tut-kicker {
                font-size: 10px;
                font-weight: 700;
                letter-spacing: 0.09em;
                text-transform: uppercase;
                color: var(--ar-tut-accent);
                margin-bottom: 3px;
            }

            .ar-tut-title { font-size: 15px; font-weight: 700; margin-bottom: 4px; }

            .ar-tut-body {
                font-size: 13px;
                line-height: 1.45;
                color: rgba(255, 255, 255, 0.82);
            }

            .ar-tut-note {
                display: none;
                margin-top: 8px;
                padding: 7px 10px;
                border-radius: 9px;
                font-size: 12px;
                line-height: 1.4;
            }

            .ar-tut-note.visible { display: block; }
            .ar-tut-note.hint { background: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.8); }
            .ar-tut-note.blocked { background: rgba(255, 179, 0, 0.16); color: #ffcf5c; }

            .ar-tut-foot {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                margin-top: 12px;
            }

            .ar-tut-dots { display: flex; gap: 6px; }

            .ar-tut-dot {
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.22);
                transition: background 0.3s, width 0.3s;
            }

            .ar-tut-dot.done { background: rgba(255, 255, 255, 0.55); }
            .ar-tut-dot.current { width: 18px; border-radius: 3px; background: var(--ar-tut-accent); }

            .ar-tut-actions { display: flex; gap: 8px; }
            .ar-tut-actions.center { justify-content: center; margin-top: 16px; }

            .ar-tut-btn {
                pointer-events: auto;
                border-radius: 10px;
                padding: 8px 14px;
                font-size: 12px;
                font-weight: 600;
                font-family: inherit;
                cursor: pointer;
                outline: none;
                transition: background 0.25s, transform 0.15s;
            }

            .ar-tut-btn:active { transform: scale(0.94); }

            .ar-tut-btn.ghost {
                border: 1px solid rgba(255, 255, 255, 0.18);
                background: rgba(255, 255, 255, 0.06);
                color: rgba(255, 255, 255, 0.75);
            }

            .ar-tut-btn.primary {
                border: 1px solid var(--ar-tut-accent);
                background: var(--ar-tut-accent);
                color: #fff;
            }

            /* The per-step escape only appears once the user is visibly stuck. */
            .ar-tut-skip { display: none; }
            .ar-tut-skip.visible { display: block; }

            .ar-tutorial-modal {
                position: absolute;
                inset: 0;
                z-index: 1;
                display: none;
                align-items: center;
                justify-content: center;
                padding: 24px;
                background: rgba(0, 0, 0, 0.55);
                backdrop-filter: blur(3px);
                -webkit-backdrop-filter: blur(3px);
                pointer-events: auto;
            }

            .ar-tutorial-modal.visible { display: flex; }

            .ar-tutorial-modal.with-hole {
                -webkit-mask: radial-gradient(circle at var(--hole-x) var(--hole-y),
                    transparent var(--hole-r), #000 calc(var(--hole-r) + 1px));
                mask: radial-gradient(circle at var(--hole-x) var(--hole-y),
                    transparent var(--hole-r), #000 calc(var(--hole-r) + 1px));
            }

            .ar-tut-modal-card {
                width: 100%;
                max-width: 380px;
                max-height: 100%;
                overflow-y: auto;
                padding: 22px 20px;
                border-radius: 22px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                background: rgba(15, 15, 20, 0.94);
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.7);
                color: #fff;
                text-align: center;
            }

            .ar-tut-modal-card .ar-tut-body { margin-top: 6px; }

            @media (prefers-reduced-motion: reduce) {
                .ar-tutorial-card { transition: none; }
                .ar-tutorial-spot { animation: none; }
            }

            /* ---- Cheat sheet ---- */

            .ar-cheatsheet {
                position: fixed;
                inset: 0;
                z-index: 1250;
                display: none;
                align-items: center;
                justify-content: center;
                padding: 24px;
                background: rgba(0, 0, 0, 0.55);
                backdrop-filter: blur(3px);
                -webkit-backdrop-filter: blur(3px);
                pointer-events: auto;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }

            .ar-cheatsheet.open { display: flex; }

            .ar-cs-card {
                --ar-tut-accent: #007bff;
                width: 100%;
                max-width: 420px;
                max-height: 100%;
                overflow-y: auto;
                padding: 20px;
                border-radius: 22px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                background: rgba(15, 15, 20, 0.94);
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.7);
                color: #fff;
            }

            .ar-cs-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            }

            .ar-cs-title { font-size: 16px; font-weight: 700; }

            .ar-cs-close {
                width: 32px;
                height: 32px;
                flex: none;
                border-radius: 50%;
                border: 1px solid rgba(255, 255, 255, 0.18);
                background: rgba(255, 255, 255, 0.06);
                color: rgba(255, 255, 255, 0.75);
                font-size: 16px;
                font-family: inherit;
                line-height: 1;
                cursor: pointer;
                outline: none;
            }

            .ar-cs-section { margin-top: 18px; }
            .ar-cs-section[data-mode="edit"] { --ar-tut-accent: #007bff; }
            .ar-cs-section[data-mode="inspect"] { --ar-tut-accent: #28a745; }

            .ar-cs-section-title {
                font-size: 10px;
                font-weight: 700;
                letter-spacing: 0.09em;
                text-transform: uppercase;
                color: var(--ar-tut-accent);
                margin-bottom: 6px;
            }

            .ar-cs-row {
                display: flex;
                gap: 12px;
                align-items: center;
                padding: 10px 0;
                border-top: 1px solid rgba(255, 255, 255, 0.08);
            }

            .ar-cs-glyph { flex: 0 0 34px; width: 34px; height: 34px; }
            .ar-cs-gesture { font-size: 13px; font-weight: 600; }

            .ar-cs-effect {
                font-size: 12px;
                line-height: 1.4;
                color: rgba(255, 255, 255, 0.62);
            }

            .ar-cs-foot { margin-top: 20px; display: flex; justify-content: center; }

            ${GLYPH_STYLES}
    `;

    document.head.appendChild(style);
}
