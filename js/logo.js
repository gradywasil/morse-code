// js/logo.js — the Morse mark, drawn from the theme's own colours.
//
// The mark is the paper tape punching M (— —) under a plate rim, with the lamp
// jewel in the corner. It used to be a fixed image; now it is built from four
// colours, so it follows the selected mode and accent:
//
//   plate  the machine body        tape  the paper strip
//   rim    the bezel over the tape  lamp  the jewel
//
// The header draws it with CSS variables (so it re-colours the instant the theme
// changes); the browser-tab icon is the same drawing with resolved colours.
// favicon.svg is the default look, kept for app icons that cannot be themed.

/** Colours as CSS variables, for the in-page mark. */
export const LOGO_VARS = Object.freeze({
  plate: 'var(--logo-plate)',
  tape: 'var(--paper)',
  rim: 'var(--logo-rim)',
  lamp: 'var(--logo-lamp)',
});

/**
 * Resolved logo colours for a mode and a full token map. Light interfaces keep a
 * dark plate (the mark is a machine, not a page), so the plate and rim switch to
 * the ink tones there.
 */
export function logoColors(mode, tokens) {
  const light = mode === 'light';
  return {
    plate: light ? tokens.ink : tokens.ground,
    tape: tokens.paper,
    rim: light ? tokens['ink-sent'] : tokens.ink,
    lamp: light ? tokens['primary-bot'] : tokens.lamp,
  };
}

/**
 * @param {{plate: string, tape: string, rim: string, lamp: string}} colors
 *   any CSS colour (a hex, or var(--name) for the live in-page mark)
 * @param {string} [id] unique id for the clip path (two marks on one page must differ)
 */
export function logoSvg(colors, id = 'logo') {
  const hole = (cx) => `<circle cx="${cx}" cy="24.5" r="1.8" style="fill:${colors.plate}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" focusable="false">`
    + `<defs><clipPath id="${id}-plate"><rect width="64" height="64" rx="14"/></clipPath></defs>`
    + `<g clip-path="url(#${id}-plate)">`
    + `<rect width="64" height="64" style="fill:${colors.plate}"/>`
    + `<rect y="20" width="64" height="24" style="fill:${colors.tape}"/>`
    + [9, 18, 27, 36, 45, 54].map(hole).join('')
    + `<rect x="9" y="30.5" width="18" height="7" rx="3.5" style="fill:${colors.plate}"/>`
    + `<rect x="37" y="30.5" width="18" height="7" rx="3.5" style="fill:${colors.plate}"/>`
    + `<rect x="1.5" y="1.5" width="61" height="61" rx="12.5" style="fill:none;stroke:${colors.rim};stroke-width:3"/>`
    + `<circle cx="50.5" cy="10.5" r="3.2" style="fill:${colors.lamp}"/>`
    + `</g></svg>`;
}

/** A data: URL for <link rel="icon">. */
export const logoDataUrl = (colors) => `data:image/svg+xml,${encodeURIComponent(logoSvg(colors, 'icon'))}`;
