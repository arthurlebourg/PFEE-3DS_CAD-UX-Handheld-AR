/**
 * Animated gesture glyphs for the tutorial and the cheat sheet.
 *
 * Text cannot teach "twist two fingers" or "drag two fingers together" —
 * the motion is the whole point of the gesture and prose hides it. These
 * loops show it.
 *
 * Everything animates through CSS keyframes on transform / opacity /
 * stroke-dashoffset only: the test tablet is already pinned at ~30 fps by its
 * passthrough camera, so the tutorial must not add a rAF loop competing for
 * the frame budget.
 */

export type GlyphName = 'tap' | 'double-tap' | 'twist' | 'tilt' | 'pinch' | 'slide-y' | 'ui-tap' | 'check';

/** Inline SVG markup for a glyph, inheriting the card's accent via currentColor. */
export function glyphSvg(name: GlyphName): string {
    switch (name) {
        case 'tap':
            return `<svg class="ar-tg" viewBox="0 0 64 64" aria-hidden="true">
                <circle class="ar-tg-ripple" cx="32" cy="32" r="11"/>
                <circle class="ar-tg-dot" cx="32" cy="32" r="7"/>
            </svg>`;

        case 'double-tap':
            return `<svg class="ar-tg" viewBox="0 0 64 64" aria-hidden="true">
                <circle class="ar-tg-ripple d1" cx="32" cy="32" r="11"/>
                <circle class="ar-tg-ripple d2" cx="32" cy="32" r="11"/>
                <circle class="ar-tg-dot" cx="32" cy="32" r="7"/>
            </svg>`;

        case 'twist':
            return `<svg class="ar-tg" viewBox="0 0 64 64" aria-hidden="true">
                <path class="ar-tg-arrow" d="M14 22a21 21 0 0 1 12-9M50 42a21 21 0 0 1-12 9"/>
                <g class="ar-tg-twist">
                    <circle class="ar-tg-dot" cx="21" cy="32" r="7"/>
                    <circle class="ar-tg-dot" cx="43" cy="32" r="7"/>
                </g>
            </svg>`;

        case 'tilt':
            return `<svg class="ar-tg" viewBox="0 0 64 64" aria-hidden="true">
                <path class="ar-tg-arrow" d="M32 9v6M32 49v6"/>
                <g class="ar-tg-tilt">
                    <circle class="ar-tg-dot" cx="21" cy="32" r="7"/>
                    <circle class="ar-tg-dot" cx="43" cy="32" r="7"/>
                </g>
            </svg>`;

        case 'pinch':
            return `<svg class="ar-tg" viewBox="0 0 64 64" aria-hidden="true">
                <circle class="ar-tg-pinch a" cx="25" cy="25" r="7"/>
                <circle class="ar-tg-pinch b" cx="39" cy="39" r="7"/>
            </svg>`;

        case 'slide-y':
            return `<svg class="ar-tg" viewBox="0 0 64 64" aria-hidden="true">
                <path class="ar-tg-rail" d="M32 14v36"/>
                <circle class="ar-tg-notch" cx="32" cy="14" r="2.5"/>
                <circle class="ar-tg-notch" cx="32" cy="32" r="2.5"/>
                <circle class="ar-tg-notch" cx="32" cy="50" r="2.5"/>
                <g class="ar-tg-slide-y">
                    <circle class="ar-tg-dot" cx="32" cy="50" r="7"/>
                </g>
            </svg>`;

        case 'ui-tap':
            return `<svg class="ar-tg" viewBox="0 0 64 64" aria-hidden="true">
                <circle class="ar-tg-target" cx="32" cy="32" r="17"/>
                <circle class="ar-tg-ripple" cx="32" cy="32" r="17"/>
                <circle class="ar-tg-dot" cx="32" cy="32" r="6"/>
            </svg>`;

        case 'check':
            return `<svg class="ar-tg" viewBox="0 0 64 64" aria-hidden="true">
                <circle class="ar-tg-target" cx="32" cy="32" r="22"/>
                <path class="ar-tg-check" d="M21 33l8 8 15-16"/>
            </svg>`;
    }
}

/** Glyph stylesheet, injected once by the tutorial overlay. */
export const GLYPH_STYLES = `
    .ar-tg {
        display: block;
        width: 100%;
        height: 100%;
        color: var(--ar-tut-accent, #007bff);
        overflow: visible;
    }

    /* Percentage transform-origins need a box; SVG shapes have none by default. */
    .ar-tg circle,
    .ar-tg path,
    .ar-tg g {
        transform-box: fill-box;
        transform-origin: center;
    }

    .ar-tg-dot { fill: currentColor; }

    .ar-tg-ripple {
        fill: none;
        stroke: currentColor;
        stroke-width: 3;
        opacity: 0;
        animation: ar-tg-ripple 1.8s cubic-bezier(0.2, 0.6, 0.3, 1) infinite;
    }

    .ar-tg-ripple.d2 { animation-delay: 0.26s; }

    @keyframes ar-tg-ripple {
        0%   { transform: scale(0.55); opacity: 0.9; }
        70%  { opacity: 0; }
        100% { transform: scale(2.1); opacity: 0; }
    }

    /* Twist: the finger pair turns around its midpoint, both ways. */
    .ar-tg-twist { animation: ar-tg-twist 2.8s ease-in-out infinite; }

    @keyframes ar-tg-twist {
        0%, 10%  { transform: rotate(0deg); }
        40%, 55% { transform: rotate(40deg); }
        85%      { transform: rotate(-40deg); }
        100%     { transform: rotate(0deg); }
    }

    /* Tilt: both fingers travel up, then down, together. */
    .ar-tg-tilt { animation: ar-tg-tilt 2.8s ease-in-out infinite; }

    @keyframes ar-tg-tilt {
        0%, 10%  { transform: translateY(0); }
        40%, 55% { transform: translateY(-12px); }
        85%      { transform: translateY(12px); }
        100%     { transform: translateY(0); }
    }

    /* Granularity: the thumb climbs the rail, notch by notch. */
    .ar-tg-rail {
        fill: none;
        stroke: currentColor;
        stroke-width: 3;
        stroke-linecap: round;
        opacity: 0.3;
    }

    .ar-tg-notch { fill: currentColor; opacity: 0.45; }

    .ar-tg-slide-y { animation: ar-tg-slide-y 2.8s ease-in-out infinite; }

    @keyframes ar-tg-slide-y {
        0%, 10%   { transform: translateY(0); }
        45%, 70%  { transform: translateY(-36px); }
        100%      { transform: translateY(0); }
    }

    .ar-tg-arrow {
        fill: none;
        stroke: currentColor;
        stroke-width: 3;
        stroke-linecap: round;
        opacity: 0.35;
    }

    .ar-tg-pinch { fill: currentColor; }
    .ar-tg-pinch.a { animation: ar-tg-pinch-a 2s ease-in-out infinite; }
    .ar-tg-pinch.b { animation: ar-tg-pinch-b 2s ease-in-out infinite; }

    @keyframes ar-tg-pinch-a {
        0%, 100% { transform: translate(0, 0); }
        50%      { transform: translate(-9px, -9px); }
    }

    @keyframes ar-tg-pinch-b {
        0%, 100% { transform: translate(0, 0); }
        50%      { transform: translate(9px, 9px); }
    }

    .ar-tg-target {
        fill: none;
        stroke: currentColor;
        stroke-width: 2.5;
        opacity: 0.4;
    }

    .ar-tg-check {
        fill: none;
        stroke: currentColor;
        stroke-width: 5;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-dasharray: 40;
        stroke-dashoffset: 40;
        animation: ar-tg-check 0.5s ease-out 0.15s forwards;
    }

    @keyframes ar-tg-check { to { stroke-dashoffset: 0; } }

    @media (prefers-reduced-motion: reduce) {
        .ar-tg * { animation: none !important; }
        .ar-tg-ripple { opacity: 0.5; }
        .ar-tg-check { stroke-dashoffset: 0; }
    }
`;
