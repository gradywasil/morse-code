// test/morse.test.mjs — F1 validation. Run: `node --test test/morse.test.mjs`
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { translate, MORSE, MARK_UNITS, GAP_UNITS } from '../js/morse.js';

// Ground-truth ITU International Morse map, written out literally so the
// module's table is verified against the standard (not against itself).
const ITU = {
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
};

const marksOf = (r) => r.tokens.filter((t) => t.type === 'mark').map((t) => t.mark);
const codeOf = (r) => r.letters.filter((l) => l.known).map((l) => l.code).join(' ');

describe('F1 · map completeness', () => {
  test('module map is exactly the 50-entry ITU set (26+10+14)', () => {
    assert.equal(Object.keys(MORSE).length, 54); // 26 letters + 10 digits + 18 punctuation
    assert.deepEqual(MORSE, ITU);
  });

  test('timing constants carry the 1/3/1/3/7 ratios', () => {
    assert.deepEqual(MARK_UNITS, { dot: 1, dash: 3 });
    assert.deepEqual(GAP_UNITS, { symbol: 1, letter: 3, word: 7 });
  });
});

describe('F1 · full-map fidelity (every mapped char → correct dot/dash string)', () => {
  for (const [char, code] of Object.entries(ITU)) {
    test(`"${char}" → ${code}`, () => {
      const r = translate(char);
      assert.equal(r.letters.length, 1);
      const letter = r.letters[0];
      assert.equal(letter.char, char);
      assert.equal(letter.code, code);
      assert.equal(letter.known, true);
      assert.equal(letter.charIdx, 0);
      assert.equal(letter.letterIdx, 0);

      // marks match the code string, in order
      assert.deepEqual(letter.marks, [...code].map((c) => (c === '.' ? 'dot' : 'dash')));
      assert.deepEqual(marksOf(r), letter.marks);

      // tokens: mark/gap/mark/…, symbol gaps (1 unit) between marks, no outer gaps
      const markTokens = r.tokens.filter((t) => t.type === 'mark');
      assert.equal(markTokens.length, code.length);
      r.tokens.forEach((t, i) => {
        if (t.type === 'mark') {
          assert.equal(t.units, t.mark === 'dot' ? 1 : 3);
          assert.equal(t.charIdx, 0);
          assert.equal(t.letterIdx, 0);
          assert.equal(t.symbolIdx, i / 2 | 0);
        } else {
          assert.equal(t.gap, 'symbol');
          assert.equal(t.units, 1);
        }
      });
      assert.equal(r.tokens.at(-1).type, 'mark'); // no trailing gap
      assert.deepEqual(r.unknown, []);
    });
  }

  test('lowercase input maps to the same code (case-insensitive)', () => {
    for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
      const r = translate(ch);
      assert.equal(r.letters[0].code, ITU[ch.toUpperCase()]);
      assert.equal(r.letters[0].char, ch); // tape shows the typed character
      assert.deepEqual(r.unknown, []);
    }
  });
});

describe('F1 · token structure', () => {
  test('"SOS" yields the exact mark/gap sequence', () => {
    const r = translate('SOS');
    assert.deepEqual(r.tokens, [
      { type: 'mark', mark: 'dot', units: 1, charIdx: 0, letterIdx: 0, symbolIdx: 0 },
      { type: 'gap', gap: 'symbol', units: 1 },
      { type: 'mark', mark: 'dot', units: 1, charIdx: 0, letterIdx: 0, symbolIdx: 1 },
      { type: 'gap', gap: 'symbol', units: 1 },
      { type: 'mark', mark: 'dot', units: 1, charIdx: 0, letterIdx: 0, symbolIdx: 2 },
      { type: 'gap', gap: 'letter', units: 3 },
      { type: 'mark', mark: 'dash', units: 3, charIdx: 1, letterIdx: 1, symbolIdx: 0 },
      { type: 'gap', gap: 'symbol', units: 1 },
      { type: 'mark', mark: 'dash', units: 3, charIdx: 1, letterIdx: 1, symbolIdx: 1 },
      { type: 'gap', gap: 'symbol', units: 1 },
      { type: 'mark', mark: 'dash', units: 3, charIdx: 1, letterIdx: 1, symbolIdx: 2 },
      { type: 'gap', gap: 'letter', units: 3 },
      { type: 'mark', mark: 'dot', units: 1, charIdx: 2, letterIdx: 2, symbolIdx: 0 },
      { type: 'gap', gap: 'symbol', units: 1 },
      { type: 'mark', mark: 'dot', units: 1, charIdx: 2, letterIdx: 2, symbolIdx: 1 },
      { type: 'gap', gap: 'symbol', units: 1 },
      { type: 'mark', mark: 'dot', units: 1, charIdx: 2, letterIdx: 2, symbolIdx: 2 },
    ]);
    assert.equal(r.text, 'SOS');
    assert.equal(r.letters.length, 3);
    assert.equal(codeOf(r), '... --- ...');
  });

  test('adjacent letters get exactly one letter gap (3 units), placed between them', () => {
    const { tokens } = translate('AB');
    const letterGaps = tokens.filter((t) => t.type === 'gap' && t.gap === 'letter');
    assert.deepEqual(letterGaps, [{ type: 'gap', gap: 'letter', units: 3 }]);
    const i = tokens.findIndex((t) => t.gap === 'letter');
    assert.equal(tokens[i - 1].type, 'mark');   // last mark of A
    assert.equal(tokens[i - 1].letterIdx, 0);
    assert.equal(tokens[i + 1].type, 'mark');   // first mark of B
    assert.equal(tokens[i + 1].letterIdx, 1);
    assert.equal(tokens[i + 1].symbolIdx, 0);
  });

  test('original text is passed through unchanged', () => {
    const text = 'a B#c 9?';
    assert.equal(translate(text).text, text);
  });
});

describe('F1 · whitespace → word gap', () => {
  test('single space between words emits one word gap (7 units)', () => {
    const gaps = translate('A B').tokens.filter((t) => t.type === 'gap' && t.gap !== 'symbol');
    assert.deepEqual(gaps, [{ type: 'gap', gap: 'word', units: 7 }]);
  });

  test('runs of whitespace collapse to a single word gap', () => {
    for (const text of ['A  B', 'A \t\n B', 'AB  \n CD']) {
      const gaps = translate(text).tokens.filter((t) => t.type === 'gap' && t.gap === 'word');
      assert.equal(gaps.length, 1, text);
      assert.equal(gaps[0].units, 7, text);
    }
  });

  test('leading/trailing whitespace emits no gap tokens', () => {
    const r = translate('  SOS  ');
    assert.equal(r.tokens[0].type, 'mark');
    assert.equal(r.tokens.at(-1).type, 'mark');
    assert.deepEqual(r.unknown, []);
  });

  test('whitespace never becomes a letter group on the tape', () => {
    assert.equal(translate('A B').letters.length, 2);
    assert.equal(translate('A  B ').letters.map((l) => l.char).join(''), 'AB');
  });
});

describe('F1 · unknown characters: flagged, never dropped', () => {
  test('unknown char is reported and kept as a flagged, mark-less group', () => {
    const r = translate('A#B');
    assert.deepEqual(r.unknown, [{ char: '#', charIdx: 1 }]);
    assert.equal(r.letters.length, 3);
    assert.deepEqual(r.letters[1], { char: '#', charIdx: 1, letterIdx: 1, known: false, marks: [], code: null });
    // neighbours still transmit
    assert.equal(codeOf(r), '.- -...');
  });

  test('unknown between letters contributes one letter gap, not two', () => {
    const gaps = translate('A#B').tokens.filter((t) => t.type === 'gap' && t.gap !== 'symbol');
    assert.deepEqual(gaps, [{ type: 'gap', gap: 'letter', units: 3 }]);
  });

  test('a run of unknowns still contributes just one letter gap total', () => {
    const r = translate('A##¿B');
    const gaps = r.tokens.filter((t) => t.type === 'gap' && t.gap !== 'symbol');
    assert.deepEqual(gaps, [{ type: 'gap', gap: 'letter', units: 3 }]);
    assert.deepEqual(r.unknown, [
      { char: '#', charIdx: 1 },
      { char: '#', charIdx: 2 },
      { char: '¿', charIdx: 3 },
    ]);
  });

  test('message consisting only of unknowns transmits nothing but reports all', () => {
    const r = translate('##');
    assert.deepEqual(r.tokens, []);
    assert.deepEqual(r.unknown, [{ char: '#', charIdx: 0 }, { char: '#', charIdx: 1 }]);
    assert.equal(r.letters.length, 2);
  });

  test('whitespace boundary wins over an unknown boundary (word gap, 7)', () => {
    const gaps = translate('A # B').tokens.filter((t) => t.type === 'gap' && t.gap !== 'symbol');
    assert.deepEqual(gaps, [{ type: 'gap', gap: 'word', units: 7 }]);
  });

  test('letterIdx counts unknowns too, so charIdx/letterIdx stay consistent', () => {
    const r = translate('A#B C');
    const b = r.letters[2];   // 'B'
    assert.equal(b.letterIdx, 2);
    assert.equal(b.charIdx, 2);
    const bMarks = r.tokens.filter((t) => t.type === 'mark' && t.letterIdx === 2);
    assert.ok(bMarks.every((t) => t.charIdx === 2));
    assert.equal(bMarks.length, ITU.B.length);
    const c = r.letters[3];   // 'C'
    assert.equal(c.letterIdx, 3);
  });

  test('unicode outside the map is unknown, not a crash', () => {
    const r = translate('Ä∞');
    assert.deepEqual(r.unknown, [{ char: 'Ä', charIdx: 0 }, { char: '∞', charIdx: 1 }]);
  });
});

describe('F1 · edge cases', () => {
  test('empty string → empty stream', () => {
    const r = translate('');
    assert.deepEqual(r, { text: '', tokens: [], letters: [], unknown: [] });
  });

  test('whitespace-only string → empty stream (no dangling gaps)', () => {
    const r = translate(" \t\n ");
    assert.deepEqual(r.tokens, []);
    assert.deepEqual(r.letters, []);
    assert.deepEqual(r.unknown, []);
  });

  test('non-string input throws TypeError', () => {
    for (const bad of [undefined, null, 42, {}, ['S'], Symbol('x')]) {
      assert.throws(() => translate(bad), TypeError);
    }
  });
});
