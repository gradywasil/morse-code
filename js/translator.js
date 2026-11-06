// js/translator.js — text ⇄ written Morse (pure logic, DOM-free).
//
// The written form is the one people already paste into a chat:
//
//     .... . .-.. .-.. --- / .-- --- .-. .-.. -..
//
// dots and dashes, ONE space between letters, " / " between words. The
// reader is forgiving: it also takes the typographic dots and dashes that
// phone keyboards produce (· • – —), underscores for dashes, "|" for word
// breaks, and a run of three or more spaces or a new line as a word gap.
//
// Both directions return the same `items` shape so the UI can show the
// letter-to-signal correspondence the same way whichever side was typed:
//
//     {char: 'H', code: '....', known: true}   one letter
//     {gap: 'word'}                            a word break
//
// The reverse table is the decoder's, so the translator and the light
// receiver never disagree about a code. Unknown signs are flagged ("?"),
// never silently dropped — except on the way TO Morse, where a character
// with no sign stays unspoken exactly as it does on the tape.

import { translate } from './morse.js';
import { REVERSE_MORSE } from './decoder.js';

/** Longest input the translator will read (keeps live typing instant). */
export const MAX_INPUT_CHARS = 5000;

const MARK_ALIASES = Object.freeze({
  '·': '.', '•': '.', '∙': '.', '●': '.',
  '−': '-', '–': '-', '—': '-', '‒': '-', '_': '-', '▬': '-', '━': '-',
});
const ALIAS_PATTERN = new RegExp(`[${Object.keys(MARK_ALIASES).join('')}]`, 'g');
const WORD_BREAK = /\s*[/|]\s*|\r?\n\s*|\s{3,}/;

/**
 * @param {string} text
 * @returns {{morse: string, items: Array<object>, unknown: string[]}}
 */
export function textToMorse(text) {
  const source = String(text ?? '').slice(0, MAX_INPUT_CHARS);
  const { letters } = translate(source);
  const items = [];
  const unknown = [];
  let previous = null;
  for (const letter of letters) {
    if (!letter.known) {
      unknown.push(letter.char);
      continue;
    }
    if (previous && /\s/.test(source.slice(previous.charIdx + 1, letter.charIdx))) {
      items.push({ gap: 'word' });
    }
    items.push({ char: letter.char.toUpperCase(), code: letter.code, known: true });
    previous = letter;
  }
  return { morse: formatMorse(items), items, unknown };
}

/**
 * @param {string} input pasted dots and dashes
 * @returns {{text: string, items: Array<object>, unknown: string[]}}
 */
export function morseToText(input) {
  const source = String(input ?? '').slice(0, MAX_INPUT_CHARS).replace(ALIAS_PATTERN, (c) => MARK_ALIASES[c]);
  const items = [];
  const unknown = [];
  let words = 0;
  for (const word of source.split(WORD_BREAK)) {
    const codes = word.split(/\s+/).filter(Boolean);
    if (codes.length === 0) continue;
    if (words > 0) items.push({ gap: 'word' });
    words += 1;
    for (const code of codes) {
      const char = /^[.-]+$/.test(code) ? REVERSE_MORSE[code] ?? null : null;
      if (char === null) unknown.push(code);
      items.push({ char: char ?? '?', code, known: char !== null });
    }
  }
  return { text: formatText(items), items, unknown };
}

/** Items → "…. . .-.. / …" (letters by a space, words by " / "). */
export function formatMorse(items) {
  return items.map((item) => (item.gap ? '/' : item.code)).join(' ');
}

/** Items → plain text (word gaps become one space). */
export function formatText(items) {
  return items.map((item) => (item.gap ? ' ' : item.char)).join('');
}
