// js/themes.js — the interface's colour: a MODE (light, dark, high contrast)
// and an ACCENT hue, combined into one set of design tokens.
//
// css/main.css :root IS the default look (dark, amber). Every other combination
// is a map of the same tokens built here and set on <html>: the accent re-tints
// the whole palette (ground, panels, keys, the paper tape, the lamp) by turning
// its hue, keeping each colour's lightness, so every accent reads like the
// original. Where turning the hue would leave text too faint (a green or blue
// lamp on cream), the text colour is nudged lighter or darker until it clears
// WCAG AA 4.5:1. No rule in the stylesheet knows which theme is active.
//
// Pure functions only, so test/themes.test.mjs can check every combination.

export const MODES = Object.freeze([
  { id: 'auto', label: 'AUTO' },
  { id: 'light', label: 'LIGHT' },
  { id: 'dark', label: 'DARK' },
  { id: 'contrast', label: 'CONTRAST' },
]);

// hue: degrees; sat: how much of the accent's colour the lamp keeps; tint: how
// much of it reaches the neutrals (ground, keys, paper). Amber is the original.
export const ACCENTS = Object.freeze([
  { id: 'amber', label: 'AMBER', hue: null, swatch: '#ffb454' },
  { id: 'blue', label: 'BLUE', hue: 212, sat: 1, tint: 0.7, swatch: '#54a8ff' },
  { id: 'teal', label: 'TEAL', hue: 174, sat: 0.95, tint: 0.7, swatch: '#3fd9c4' },
  { id: 'green', label: 'GREEN', hue: 136, sat: 0.95, tint: 0.65, swatch: '#5be07c' },
  { id: 'violet', label: 'VIOLET', hue: 264, sat: 1, tint: 0.7, swatch: '#a98bff' },
  { id: 'rose', label: 'ROSE', hue: 338, sat: 1, tint: 0.7, swatch: '#ff7fa6' },
]);

export const DEFAULT_MODE_ID = 'dark';
export const DEFAULT_ACCENT_ID = 'amber';

export const modeById = (id) => MODES.find((m) => m.id === id) ?? MODES.find((m) => m.id === DEFAULT_MODE_ID);
export const accentById = (id) => ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];

/** AUTO follows the phone: light when it is set to light, dark otherwise. */
export function resolveModeId(id, prefersLight) {
  const mode = modeById(id);
  if (mode.id !== 'auto') return mode.id;
  return prefersLight ? 'light' : 'dark';
}

// ---------------------------------------------------------------------------
// The base palettes (hex and "r, g, b" tokens; everything else is derived).

/** The default look. Must equal css/main.css :root (a test enforces it). */
export const BASE_DARK = Object.freeze({
  'ground': '#171008', 'ground-deep': '#0f0a05', 'panel-hi': '#241a10', 'panel-lo': '#1e150c',
  'metal-hi': '#3f2f1d', 'metal-lo': '#2c2013', 'cream': '#eee0c2', 'cream-dim': '#b3a17c',
  'lamp': '#ffb454', 'lamp-lit': '#ffc879', 'lamp-dim': '#8a6c3c', 'lamp-off': '#3a2b19',
  'paper': '#e2d3a8', 'paper-hi': '#e6d7b0', 'paper-lo': '#cbb98b', 'paper-edge': '#453317',
  'ink': '#2b2013', 'ink-sent': '#645637', 'ink-current': '#7a4a0c',
  'ground-glow': '#1d150b', 'ground-low': '#120c06', 'ground-vignette': '#1c140b',
  'field-edge': '#43301d', 'field-edge-hover': '#55402a', 'field-edge-off': '#3f2e1b', 'placeholder': '#97866a',
  'paper-mid-a': '#ddcca1', 'paper-mid-b': '#d9c89d',
  'key-top': '#302214', 'key-bot': '#241a0f', 'key-edge': '#4a3620',
  'key-hover-top': '#3a2a18', 'key-hover-bot': '#2b1f11', 'key-edge-hover': '#5f4627',
  'sel-top': '#3a2a16', 'sel-bot': '#2b1f10',
  'primary-top': '#ffc879', 'primary-bot': '#f2a23c', 'primary-edge': '#a86f24',
  'primary-top-hover': '#ffd28f', 'primary-edge-hover': '#bd7f2b', 'on-primary': '#221407',
  'flash-highlight': '#ffe6b5', 'selection-ink': '#fff6e4',
  'lamp-rgb': '255, 180, 84', 'shade-rgb': '0, 0, 0', 'hi-rgb': '255, 240, 210',
  'paper-ink-rgb': '66, 50, 26', 'backdrop-rgb': '8, 5, 2', 'hairline-rgb': '240, 214, 166',
});

const BASE_LIGHT = Object.freeze({
  ...BASE_DARK,
  'ground': '#f2ede2', 'ground-deep': '#fffdf7', 'panel-hi': '#faf6ec', 'panel-lo': '#f5f0e4',
  'metal-hi': '#e6dcc6', 'metal-lo': '#d8cdb4', 'cream': '#2b1f0e', 'cream-dim': '#66553a',
  'lamp': '#9a5000', 'lamp-lit': '#b86200', 'lamp-dim': '#8f7340', 'lamp-off': '#d4c7a6',
  'ground-glow': '#fbf8f0', 'ground-low': '#e8e1d0', 'ground-vignette': '#f6f1e6',
  'field-edge': '#cdbf9f', 'field-edge-hover': '#b9a982', 'field-edge-off': '#ddd2b8', 'placeholder': '#7d6d50',
  'key-top': '#fffaf0', 'key-bot': '#eee4cf', 'key-edge': '#c4b48e',
  'key-hover-top': '#ffffff', 'key-hover-bot': '#f5ecd8', 'key-edge-hover': '#ae9b70',
  'sel-top': '#fff0d2', 'sel-bot': '#fbe3b0',
  'primary-top': '#ffc766', 'primary-bot': '#f0a22e', 'primary-edge': '#b87510',
  'primary-top-hover': '#ffd486', 'primary-edge-hover': '#a2650a', 'on-primary': '#2a1700',
  'flash-highlight': '#ffe6b5', 'selection-ink': '#1c1204',
  'lamp-rgb': '154, 80, 0', 'shade-rgb': '90, 66, 30', 'hi-rgb': '255, 255, 255',
  'backdrop-rgb': '40, 28, 10', 'hairline-rgb': '70, 52, 24',
  'hole': '#3a2c18',
  'hairline-strong': 'rgba(var(--hairline-rgb), 0.3)',
  'lamp-glow': 'rgba(var(--lamp-rgb), 0.2)',
});

/** High contrast ignores the accent: black, white, one yellow. */
const CONTRAST = Object.freeze({
  ...BASE_DARK,
  'ground': '#000000', 'ground-deep': '#000000', 'panel-hi': '#0d0d0d', 'panel-lo': '#080808',
  'metal-hi': '#2a2a2a', 'metal-lo': '#1c1c1c', 'cream': '#ffffff', 'cream-dim': '#e6e6e6',
  'lamp': '#ffe14d', 'lamp-lit': '#fff08a', 'lamp-dim': '#bfa800', 'lamp-off': '#3a3a3a',
  'paper': '#ffffff', 'paper-hi': '#ffffff', 'paper-lo': '#e8e8e8', 'paper-edge': '#000000',
  'ink': '#000000', 'ink-sent': '#4d4d4d', 'ink-current': '#8a3b00',
  'ground-glow': '#000000', 'ground-low': '#000000', 'ground-vignette': '#000000',
  'field-edge': '#bdbdbd', 'field-edge-hover': '#ffffff', 'field-edge-off': '#6b6b6b', 'placeholder': '#b8b8b8',
  'paper-mid-a': '#f4f4f4', 'paper-mid-b': '#f0f0f0',
  'key-top': '#1f1f1f', 'key-bot': '#141414', 'key-edge': '#bdbdbd',
  'key-hover-top': '#2c2c2c', 'key-hover-bot': '#1c1c1c', 'key-edge-hover': '#ffffff',
  'sel-top': '#3b3300', 'sel-bot': '#2a2400',
  'primary-top': '#fff07a', 'primary-bot': '#ffd600', 'primary-edge': '#ffffff',
  'primary-top-hover': '#fff7a8', 'primary-edge-hover': '#ffffff', 'on-primary': '#000000',
  'flash-highlight': '#ffffff', 'selection-ink': '#000000',
  'lamp-rgb': '255, 225, 77', 'hi-rgb': '255, 255, 255', 'paper-ink-rgb': '0, 0, 0',
  'backdrop-rgb': '0, 0, 0', 'hairline-rgb': '255, 255, 255',
  'hairline': 'rgba(255, 255, 255, 0.55)',
  'hairline-strong': 'rgba(255, 255, 255, 0.85)',
});

/** Tokens that carry the accent colour itself (the rest are tinted neutrals). */
const ACCENT_TOKENS = new Set([
  'lamp', 'lamp-lit', 'lamp-dim', 'lamp-rgb', 'primary-top', 'primary-bot', 'primary-edge',
  'primary-top-hover', 'primary-edge-hover', 'flash-highlight', 'ink-current', 'sel-top', 'sel-bot',
]);

/** The tape stays paper-pale: it takes only part of the tint the neutrals take. */
const PAPER_TOKENS = new Set(['paper', 'paper-hi', 'paper-lo', 'paper-mid-a', 'paper-mid-b']);

/** Text-on-surface pairs that must clear WCAG AA. The text moves, unless the
 *  pair says 'bg' (dark text on a button face: the face lightens instead). */
export const CONTRAST_PAIRS = Object.freeze([
  ['cream', 'ground'], ['cream-dim', 'ground'], ['lamp', 'ground'],
  ['cream', 'panel-hi'], ['cream-dim', 'panel-hi'], ['lamp', 'panel-hi'],
  ['cream', 'key-top'], ['cream', 'key-bot'], ['cream-dim', 'key-bot'], ['lamp', 'key-top'], ['lamp', 'key-bot'],
  ['lamp', 'sel-bot'], ['cream', 'sel-bot'],
  ['placeholder', 'ground-deep'], ['cream', 'ground-deep'], ['lamp', 'ground-deep'],
  ['on-primary', 'primary-top', 'bg'], ['on-primary', 'primary-bot', 'bg'],
  ['ink', 'paper'], ['ink-sent', 'paper-mid-a'], ['ink-current', 'paper-mid-a'],
]);
export const MIN_CONTRAST = 4.5;

// ---------------------------------------------------------------------------
// Colour maths

const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v);
const isTriplet = (v) => /^\d+, \d+, \d+$/.test(v);

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbToHex = ([r, g, b]) => `#${[r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')}`;

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hslToRgb([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

const linear = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const BASE_HUE = 38; // the hue of the original warm palette

function retint(value, name, accent) {
  const asTriplet = isTriplet(value);
  const rgb = asTriplet ? value.split(', ').map(Number) : hexToRgb(value);
  const [h, s, l] = rgbToHsl(rgb);
  const k = ACCENT_TOKENS.has(name) ? accent.sat : PAPER_TOKENS.has(name) ? accent.tint * 0.55 : accent.tint;
  const moved = hslToRgb([(accent.hue + (h - BASE_HUE) + 360) % 360, Math.min(1, s * k), l]).map(Math.round);
  return asTriplet ? moved.join(', ') : rgbToHex(moved);
}

/** Nudge a text colour's lightness until it clears `min` against its surface. */
function fitContrast(tokens, fg, bg, min, move = 'fg') {
  if (!isHex(tokens[fg]) || !isHex(tokens[bg])) return;
  if (contrastRatio(tokens[fg], tokens[bg]) >= min) return;
  const [mover, fixed] = move === 'bg' ? [bg, fg] : [fg, bg];
  const [h, s, l] = rgbToHsl(hexToRgb(tokens[mover]));
  const darker = luminance(tokens[mover]) < luminance(tokens[fixed]);
  for (let step = 1; step <= 100; step++) {
    const next = Math.max(0, Math.min(1, l + (darker ? -step : step) / 100));
    const candidate = rgbToHex(hslToRgb([h, s, next]));
    if (contrastRatio(candidate, tokens[fixed]) >= min) {
      tokens[mover] = candidate;
      if (mover === 'lamp') tokens['lamp-rgb'] = hexToRgb(candidate).join(', ');
      return;
    }
  }
}

/**
 * The full token map for a resolved mode ('light' | 'dark' | 'contrast') and an
 * accent id. Empty for the default (dark, amber), which css/main.css already is.
 */
export function buildTokens(modeId, accentId) {
  if (modeId === 'contrast') return { ...CONTRAST };
  const accent = accentById(accentId);
  if (modeId !== 'light' && accent.hue === null) return {};
  const base = modeId === 'light' ? BASE_LIGHT : BASE_DARK;
  const tokens = { ...base };
  if (accent.hue !== null) {
    for (const [name, value] of Object.entries(base)) {
      if (isHex(value) || isTriplet(value)) tokens[name] = retint(value, name, accent);
    }
  }
  // The hole colour is a literal in light mode; keep its tint with the accent.
  for (const [fg, bg, move] of CONTRAST_PAIRS) fitContrast(tokens, fg, bg, MIN_CONTRAST, move);
  return tokens;
}

/** Whether the system bars should draw dark icons (a light interface). */
export const isLightMode = (modeId) => modeId === 'light';

/** A flat style string for the tokens, so a native launch can paint before JS runs. */
export function tokensToCss(tokens) {
  return Object.entries(tokens).map(([name, value]) => `--${name}:${value}`).join(';');
}
