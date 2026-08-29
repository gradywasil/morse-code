// js/morse.js — Morse translator (pure logic, DOM-free).
//
// Task F1 of docs/ultron/plan.md. Importable from the browser (ES module)
// and from Node's built-in test runner (`node --test test/morse.test.mjs`).
//
// Full ITU International Morse map: A–Z, 0–9, and the punctuation set
// `. , ? ' ! / ( ) & : ; = + - _ " $ @`. Case-insensitive; no prosigns
// (scope decision — see PRODUCT.md "Capabilities and Constraints").
//
// Output structure — designed for its two consumers:
//
//   - F2 (js/schedule.js) walks `result.tokens` in order. Every token is a
//     time period in dot-units: a `mark` is an ON period (dot=1, dash=3),
//     a `gap` is an OFF period (symbol=1, letter=3, word=7). Marks carry
//     `mark`/`charIdx`/`letterIdx` so F2 can emit its event objects
//     `[{tMs, on, mark, charIdx, letterIdx}]` without re-deriving anything.
//     The sequence is exact: symbol gaps appear between the marks of one
//     letter, letter/word gaps between letters, and there is never a
//     trailing gap after the last mark.
//
//   - I1/I2 (the tape UI) read `result.letters`: one punch group per
//     non-whitespace character of the input, in order, including unknown
//     characters (flagged `known:false`, no marks — never dropped).
//     `charIdx` indexes the original input string, so the read-head can
//     highlight the character currently being broadcast; `letterIdx`
//     indexes `result.letters` itself.
//
// Normalization rules (scheduling semantics):
//   - Runs of whitespace collapse to a single word gap (7 units).
//   - Leading/trailing whitespace emits no gap tokens (nothing to separate).
//   - An unknown character contributes no ON time; it acts as a letter
//     boundary between its neighbours (a letter gap — unless whitespace
//     intervenes, in which case the word gap wins, being longer).

/** ITU International Morse code table. Keys are uppercase; '.'=dot, '-'=dash. */
export const MORSE = Object.freeze({
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.',
  G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..',
  M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.',
  S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
  5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.', ',': '--..--', '?': '..--..', "'": '.----.',
  '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-',
  '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-',
  '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.',
  '$': '...-..-', '@': '.--.-.',
});

/** ON-period lengths in dot-units, keyed by mark name. */
export const MARK_UNITS = Object.freeze({ dot: 1, dash: 3 });

/** OFF-period lengths in dot-units, keyed by gap kind (ITU 1/3/7 ratios). */
export const GAP_UNITS = Object.freeze({ symbol: 1, letter: 3, word: 7 });

const WHITESPACE = /\s/;

/**
 * Translate text into a Morse token stream plus per-character groups.
 *
 * @param {string} text - the message, any case; unknown characters are
 *   flagged, never dropped.
 * @returns {{
 *   text: string,
 *   tokens: Array<{type:'mark', mark:'dot'|'dash', units:1|3, charIdx:number, letterIdx:number, symbolIdx:number}
 *          |{type:'gap', gap:'symbol'|'letter'|'word', units:1|3|7}>,
 *   letters: Array<{char:string, charIdx:number, letterIdx:number, known:boolean, marks:Array<'dot'|'dash'>, code:string|null}>,
 *   unknown: Array<{char:string, charIdx:number}>
 * }}
 * @throws {TypeError} if `text` is not a string.
 */
export function translate(text) {
  if (typeof text !== 'string') {
    throw new TypeError(`translate(text) expects a string, got ${typeof text}`);
  }

  const tokens = [];
  const letters = [];
  const unknown = [];

  // Gap pending before the next mark-bearing letter: null = none yet,
  // 'letter' after a letter or unknown char, 'word' after whitespace
  // (word wins — it is the longer boundary).
  let pendingGap = null;
  let emittedAnyMark = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (WHITESPACE.test(ch)) {
      if (emittedAnyMark) pendingGap = 'word';
      continue;
    }

    const code = MORSE[ch.toUpperCase()] ?? null;
    const letterIdx = letters.length;

    if (code === null) {
      // Unknown character: flagged, kept as a tape group, contributes no
      // marks — only a boundary between its neighbours.
      letters.push({ char: ch, charIdx: i, letterIdx, known: false, marks: [], code: null });
      unknown.push({ char: ch, charIdx: i });
      if (emittedAnyMark && pendingGap !== 'word') pendingGap = 'letter';
      continue;
    }

    if (emittedAnyMark) {
      tokens.push({ type: 'gap', gap: pendingGap, units: GAP_UNITS[pendingGap] });
    }

    const marks = [];
    for (let s = 0; s < code.length; s++) {
      if (s > 0) {
        tokens.push({ type: 'gap', gap: 'symbol', units: GAP_UNITS.symbol });
      }
      const mark = code[s] === '.' ? 'dot' : 'dash';
      marks.push(mark);
      tokens.push({ type: 'mark', mark, units: MARK_UNITS[mark], charIdx: i, letterIdx, symbolIdx: s });
    }

    letters.push({ char: ch, charIdx: i, letterIdx, known: true, marks, code });
    emittedAnyMark = true;
    pendingGap = 'letter';
  }

  return { text, tokens, letters, unknown };
}
