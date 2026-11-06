// js/flash-color.js — the colours the SCREEN light may flash.
//
// An accessibility choice for the sender: white is harsh for some eyes, a
// warmer or cooler light is gentler. It applies to the screen only — a phone
// flashlight is a white LED and stays white.
//
// The receiver finds Morse by watching brightness (luma), so a colour is only
// offered if the camera still sees a strong, clean on/off swing in it. Every
// entry clears MIN_FLASH_LUMA. Deliberately absent:
//   - saturated red: the colour with the strictest flash-safety limits
//     (WCAG 2.3.1 treats saturated-red flashing as a hazard in its own right)
//     and weak luma besides;
//   - blue and violet: luma so low a camera barely registers the swing, so
//     messages would silently fail to arrive.
// test/flash-color.test.mjs enforces both rules for every colour listed.

export const DEFAULT_FLASH_COLOR_ID = 'WHITE';

/** Lowest Rec.601 luma (0–255) a flash colour may have. */
export const MIN_FLASH_LUMA = 150;

export const FLASH_COLORS = Object.freeze([
  Object.freeze({ id: 'WHITE', label: 'WHITE', hex: '#ffffff' }),
  Object.freeze({ id: 'AMBER', label: 'AMBER', hex: '#ffc040' }),
  Object.freeze({ id: 'GREEN', label: 'GREEN', hex: '#4cff7a' }),
  Object.freeze({ id: 'CYAN', label: 'CYAN', hex: '#40f0ff' }),
  Object.freeze({ id: 'PINK', label: 'PINK', hex: '#ff70e0' }),
]);

/** Rec.601 luma of a #rrggbb colour — the same weights the receiver uses. */
export function lumaOfHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (77 * r + 150 * g + 29 * b) / 256;
}

/** Look a colour up by id; anything unknown (or tampered) is white. */
export function flashColorById(id) {
  return FLASH_COLORS.find((color) => color.id === id)
    ?? FLASH_COLORS.find((color) => color.id === DEFAULT_FLASH_COLOR_ID);
}
