// test/decoder.test.mjs — T-F1 acceptance (run-2 plan).
//
// 1. REVERSE_MORSE completeness against an independent build from MORSE.
// 2. Every ITU character round-trips from schedule()-generated durations
//    at all three WPM steps (the run-2 compatibility contract, F1 half:
//    known unit).
// 3. Full messages (words, punctuation, unknown-free) round-trip to text.
// 4. Seeded jitter corpus: ±1 frame (33.3 ms) on every duration at every
//    step still decodes (D7 margins, r3 §Q2 math).
// 5. Classification boundaries exact at 2û / 6û / 5û.
// 6. Anomaly marks void the letter; unknown patterns flagged never dropped.
// 7. flush() emits pending symbols; TypeError discipline; DOM-free source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { MORSE, translate } from '../js/morse.js';
import { schedule, SPEED_STEPS, SPEED_STEP_ORDER, dotMsOf } from '../js/schedule.js';
import {
  CLASSIFY, REVERSE_MORSE, classifyMark, classifyGap, createDecoder,
} from '../js/decoder.js';

const FRAME_MS = 1000 / 30; // 33.33… — one camera frame at 30 fps

// Codes shared by several characters (the ITU '.'/'+' collision is the
// one that exists in MORSE). A received shared code decodes to the
// table's last entry — computed independently here from entry order.
const canonicalByCode = new Map();
const ambiguousChars = new Set();
for (const [char, code] of Object.entries(MORSE)) {
  if (canonicalByCode.has(code)) ambiguousChars.add(char);
  canonicalByCode.set(code, char);
}
const expectedChar = (char) => canonicalByCode.get(MORSE[char]);

// schedule() events → alternating mark/gap periods (events start with ON).
function eventsToPeriods(events) {
  const periods = [];
  for (let i = 0; i < events.length; i += 2) {
    const on = events[i];
    const off = events[i + 1];
    periods.push({ kind: 'mark', ms: off.tMs - on.tMs });
    if (i + 2 < events.length) {
      periods.push({ kind: 'gap', ms: events[i + 2].tMs - off.tMs });
    }
  }
  return periods;
}

// Deterministic mulberry32 — same seed, same corpus, every run.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function decodePeriods(periods, unitMs) {
  const decoder = createDecoder({ unitMs });
  let text = '';
  for (const p of periods) {
    const events = p.kind === 'mark' ? decoder.feedMark(p.ms) : decoder.feedGap(p.ms);
    for (const e of events) {
      if (e.type === 'letter') text += e.known ? e.char : '\uFFFD';
      if (e.type === 'word') text += ' ';
    }
  }
  for (const e of decoder.flush()) {
    if (e.type === 'letter') text += e.known ? e.char : '\uFFFD';
  }
  return text;
}

test('REVERSE_MORSE is a complete, frozen inverse of MORSE', () => {
  const independent = {};
  for (const [char, code] of Object.entries(MORSE)) independent[code] = char;
  assert.equal(Object.keys(MORSE).length, 54);
  assert.deepEqual({ ...REVERSE_MORSE }, independent);
  assert.ok(Object.isFrozen(REVERSE_MORSE));
  assert.ok(Object.isFrozen(CLASSIFY));
});

test('every ITU character round-trips at every WPM step (known unit)', () => {
  for (const stepId of SPEED_STEP_ORDER) {
    const unitMs = dotMsOf(SPEED_STEPS[stepId].wpm);
    for (const [char] of Object.entries(MORSE)) {
      const { events } = schedule(translate(char).tokens, stepId);
      const text = decodePeriods(eventsToPeriods(events), unitMs);
      // ITU ambiguity: shared codes decode to the canonical representative.
      assert.equal(text, expectedChar(char), `${char} @ ${stepId}`);
    }
  }
  assert.deepEqual([...ambiguousChars], ['+']); // '.' is the overwritten entry
});

test('messages with words and punctuation round-trip at every step', () => {
  const messages = [
    'HELLO DARK ROOM',
    'SOS',
    'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG',
    'PARIS 5 ? OK & $ @',
  ];
  for (const stepId of SPEED_STEP_ORDER) {
    const unitMs = dotMsOf(SPEED_STEPS[stepId].wpm);
    for (const message of messages) {
      const { events } = schedule(translate(message).tokens, stepId);
      const expected = [...message].map((c) => expectedChar(c) ?? c).join('');
      assert.equal(decodePeriods(eventsToPeriods(events), unitMs), expected);
    }
  }
});

test('a trailing mark with no gap still flushes as a letter', () => {
  const unitMs = dotMsOf(SPEED_STEPS.LEARNER.wpm);
  const decoder = createDecoder({ unitMs });
  decoder.feedMark(unitMs); decoder.feedMark(unitMs); // ".." = I, no gap after
  const out = decoder.flush();
  assert.equal(out.length, 1);
  assert.equal(out[0].char, 'I');
  assert.ok(out[0].known);
  assert.deepEqual(out[0].marks, ['dot', 'dot']);
});

test('jitter corpus: ±1 frame on every duration decodes at every step', () => {
  const rand = mulberry32(0xC0DEC0DE);
  const messages = ['HELLO DARK ROOM', 'SOS SOS', 'WHAT HATH GOD WROUGHT'];
  for (const stepId of SPEED_STEP_ORDER) {
    const unitMs = dotMsOf(SPEED_STEPS[stepId].wpm);
    for (const message of messages) {
      for (let trial = 0; trial < 50; trial++) {
        const { events } = schedule(translate(message).tokens, stepId);
        const jittered = eventsToPeriods(events).map((p) => ({
          kind: p.kind,
          // Worst-case midpoint stamping: each measured duration is off by
          // up to a full frame in either direction, independently.
          ms: Math.max(1, p.ms + (rand() * 2 - 1) * FRAME_MS),
        }));
        assert.equal(decodePeriods(jittered, unitMs), message,
          `${message} @ ${stepId} trial ${trial}`);
      }
    }
  }
});

test('classification boundaries are exact at the ITU midpoints (D7)', () => {
  const u = 100;
  assert.equal(classifyMark(199.999, u), 'dot');
  assert.equal(classifyMark(200, u), 'dash');       // 2û ≤ d → dash
  assert.equal(classifyMark(599.999, u), 'dash');
  assert.equal(classifyMark(600, u), 'anomaly');    // d ≥ 6û → anomaly
  assert.equal(classifyGap(199.999, u), 'symbol');
  assert.equal(classifyGap(200, u), 'letter');      // 2û ≤ g < 5û
  assert.equal(classifyGap(499.999, u), 'letter');
  assert.equal(classifyGap(500, u), 'word');        // g ≥ 5û
  assert.equal(classifyGap(5000, u), 'word');       // long silence is still a word gap
});

test('anomaly marks void the letter and are flagged, never decoded', () => {
  const unitMs = dotMsOf(SPEED_STEPS.STANDARD.wpm);
  const decoder = createDecoder({ unitMs });
  const seen = [];
  const d = createDecoder({ unitMs, onEvent: (e) => seen.push(e) });
  decoder.feedMark(unitMs);            // .
  const out = decoder.feedGap(3 * unitMs);
  assert.equal(out.find((e) => e.type === 'letter').char, 'E');
  assert.equal(out.find((e) => e.type === 'gap').gap, 'letter');

  d.feedMark(unitMs);                  // starts a letter
  d.feedGap(unitMs);                   // symbol gap
  const anomalyOut = d.feedMark(6.5 * unitMs); // anomaly: ≥ 6û
  assert.equal(anomalyOut[0].type, 'anomaly');
  const letters = d.feedGap(3 * unitMs);
  const voidLetter = letters.find((e) => e.type === 'letter');
  assert.equal(voidLetter.type, 'letter');
  assert.equal(voidLetter.known, false);
  assert.equal(voidLetter.char, null);
  assert.ok(seen.some((e) => e.type === 'anomaly'));
});

test('unknown Morse patterns are flagged, never dropped or guessed', () => {
  const unitMs = dotMsOf(SPEED_STEPS.LEARNER.wpm);
  const decoder = createDecoder({ unitMs });
  for (let i = 0; i < 6; i++) { // "......" — six dots is not ITU
    decoder.feedMark(unitMs);
    if (i < 5) decoder.feedGap(unitMs);
  }
  const out = decoder.flush();
  assert.equal(out.length, 1);
  assert.equal(out[0].known, false);
  assert.equal(out[0].char, null);
  assert.equal(out[0].code, '......');
});

test('word gaps emit space events between letters', () => {
  const unitMs = dotMsOf(SPEED_STEPS.BRISK.wpm);
  const decoder = createDecoder({ unitMs });
  const all = [];
  const feed = (fn, ms) => all.push(...fn(ms));
  feed((ms) => decoder.feedMark(ms), 3 * unitMs);  // T
  feed((ms) => decoder.feedGap(ms), 7 * unitMs);   // word gap → T + space
  feed((ms) => decoder.feedMark(ms), unitMs);      // E
  feed((ms) => decoder.feedGap(ms), 7 * unitMs);   // word gap → E + space
  feed((ms) => decoder.feedMark(ms), unitMs);      // E (pending)
  all.push(...decoder.flush());
  assert.equal(all.filter((e) => e.type === 'letter' || e.type === 'word')
    .map((e) => (e.type === 'word' ? ' ' : e.char)).join(''), 'T E E');
});

test('decoder instances carry no shared state (purity)', () => {
  const unitMs = dotMsOf(SPEED_STEPS.STANDARD.wpm);
  const a = createDecoder({ unitMs });
  const b = createDecoder({ unitMs });
  a.feedMark(unitMs); a.feedGap(unitMs); a.feedMark(unitMs); // "I" pending in a
  assert.equal(a.pending, '..');
  assert.equal(b.pending, '');
  a.flush(); b.flush();
});

test('TypeError discipline on construction and feeding', () => {
  assert.throws(() => createDecoder({ unitMs: 0 }), TypeError);
  assert.throws(() => createDecoder({ unitMs: -100 }), TypeError);
  assert.throws(() => createDecoder({ unitMs: Number.NaN }), TypeError);
  assert.throws(() => createDecoder({ onEvent: 'nope' }), TypeError);
  assert.throws(() => createDecoder(null), TypeError);
  const decoder = createDecoder({ unitMs: 150 });
  assert.throws(() => decoder.feedMark(0), TypeError);
  assert.throws(() => decoder.feedGap(-5), TypeError);
  assert.throws(() => decoder.feedMark(Number.NaN), TypeError);
  assert.throws(() => classifyMark(100, 0), TypeError);
  assert.throws(() => classifyGap('100', 150), TypeError);
  assert.throws(() => classifyMark(100), TypeError);
});

test('unit provider functions are resolved per classification', () => {
  let current = 100;
  const decoder = createDecoder({ unitMs: () => current });
  decoder.feedMark(100);              // dot at û=100
  decoder.feedGap(100);               // symbol gap at û=100
  current = 250;                      // sender slowed (LEARNER joined view)
  decoder.feedMark(700);              // dash at û=250 (2û=500 ≤ 700 < 6û=1500)
  const out = decoder.feedGap(750);   // letter gap at û=250 (500 ≤ 750 < 1250)
  const letter = out.find((e) => e.type === 'letter');
  assert.equal(letter.char, 'A');     // ".−"
  assert.equal(out.find((e) => e.type === 'gap').gap, 'letter');
  assert.deepEqual(decoder.flush(), []);
});

test('decoder source is DOM-free (v1 discipline)', () => {
  const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'decoder.js'), 'utf8');
  for (const token of ['document', 'window', 'localStorage', 'navigator', 'HTMLElement', 'addEventListener']) {
    assert.ok(!source.includes(token), `js/decoder.js must not reference ${token}`);
  }
});

// ---------------------------------------------------------------------------
// F2 — zero-coordination clock recovery (research D6).

import { TRACKER, createClockTracker, DEFAULT_UNIT_MS } from '../js/decoder.js';

function decodeWithTracker(periods) {
  const tracker = createClockTracker();
  const decoder = createDecoder({
    unitMs: () => tracker.unitMs(),
    onEvent: (e) => tracker.observe(e),
  });
  let text = '';
  const emit = (events) => {
    for (const e of events) {
      if (e.type === 'letter') text += e.known ? e.char : '\uFFFD';
      if (e.type === 'word') text += ' ';
    }
  };
  for (const p of periods) {
    emit(p.kind === 'mark' ? decoder.feedMark(p.ms) : decoder.feedGap(p.ms));
  }
  emit(decoder.flush());
  return { text, tracker };
}

test('F2: tracker defaults to the safe mid-range unit before any evidence', () => {
  const tracker = createClockTracker();
  assert.equal(tracker.unitMs(), DEFAULT_UNIT_MS);
  assert.equal(tracker.rawUnitMs(), null);
  assert.equal(tracker.status().snapped, false);
});

test('F2: zero-coordination decode + convergence at every step (no jitter)', () => {
  for (const stepId of SPEED_STEP_ORDER) {
    const { wpm } = SPEED_STEPS[stepId];
    const message = 'HELLO DARK ROOM';
    const { events } = schedule(translate(message).tokens, stepId);
    const { text, tracker } = decodeWithTracker(eventsToPeriods(events));
    assert.equal(text, message, stepId);
    const trueUnit = dotMsOf(wpm);
    const error = Math.abs(tracker.rawUnitMs() - trueUnit) / trueUnit;
    assert.ok(error <= 0.15, `${stepId}: estimate ${tracker.rawUnitMs()} vs ${trueUnit} (${(error * 100).toFixed(1)}% off)`);
    assert.equal(tracker.status().locked, true, stepId);
  }
});

test('F2: jittered composite decodes the message tail at every step (±1 frame)', () => {
  const rand = mulberry32(0xF2C0FFEE);
  const messages = ['HELLO DARK ROOM', 'SOS SOS', 'WHAT HATH GOD WROUGHT'];
  for (const stepId of SPEED_STEP_ORDER) {
    for (const message of messages) {
      for (let trial = 0; trial < 40; trial++) {
        const { events } = schedule(translate(message).tokens, stepId);
        const jittered = eventsToPeriods(events).map((p) => ({
          kind: p.kind,
          ms: Math.max(1, p.ms + (rand() * 2 - 1) * FRAME_MS),
        }));
        const { text, tracker } = decodeWithTracker(jittered);
        // Cold-start misclassifications before the unit locks are expected
        // prior-art behavior (r3: "cold lock costs a few false E/T") —
        // D9's session gate (F3) owns suppressing them. The converged tail
        // must be letter-perfect.
        const lastWord = message.split(' ').pop();
        assert.ok(text.endsWith(lastWord), `${message} @ ${stepId} t${trial}: tail "${text}"`);
        assert.equal(tracker.status().locked, true, `${stepId} t${trial}`);
      }
    }
  }
});

test('F2: no validated pair → cluster fallback bootstraps after 7 marks', () => {
  const tracker = createClockTracker();
  const decoder = createDecoder({ unitMs: () => tracker.unitMs(), onEvent: (e) => tracker.observe(e) });
  // Seven dots in one very long symbol run is not a letter — feed them as
  // separate letters? No: dots with symbol gaps inside one letter void at
  // flush. Feed dot-letters (E) separated by letter gaps: no adjacent
  // mark pair ever has ratio in [2,4] (all marks equal).
  const unit = 240;
  for (let i = 0; i < 7; i++) {
    decoder.feedMark(unit);
    decoder.feedGap(3 * unit); // letter gap
  }
  const st = tracker.status();
  assert.equal(st.marks, 7);
  assert.ok(st.estimate !== null, 'cluster fallback fired');
  assert.ok(Math.abs(st.estimate - unit) / unit <= 0.001, `one cluster → median, got ${st.estimate}`);
});

test('F2: the pair gate rejects non-plausible ratios (no bogus updates)', () => {
  const tracker = createClockTracker();
  const decoder = createDecoder({ unitMs: () => tracker.unitMs(), onEvent: (e) => tracker.observe(e) });
  // Marks of 100 and 110 (ratio 1.1) — no valid pair; below the 7-mark
  // fallback threshold, so no estimate may exist.
  for (let i = 0; i < 3; i++) {
    decoder.feedMark(100);
    decoder.feedGap(3 * 100);
    decoder.feedMark(110);
    decoder.feedGap(3 * 100);
  }
  assert.equal(tracker.rawUnitMs(), null);
});

test('F2: drift reopen — a sender switch re-locks the tracker (D6)', () => {
  // LEARNER "HI" then, after a long quiet gap, BRISK "OK OK" — one
  // stream. The switch's first letters are soup (their marks were
  // classified against the stale unit before drift evidence existed —
  // the honest prior-art cost of re-locking); the tracker then re-locks
  // and the tail decodes letter-perfect.
  const learner = eventsToPeriods(schedule(translate('HI').tokens, 'LEARNER').events);
  const brisk = eventsToPeriods(schedule(translate('OK OK').tokens, 'BRISK').events);
  const stream = [
    ...learner,
    { kind: 'gap', ms: 3000 }, // quiet pause between senders
    ...brisk,
  ];
  const { text, tracker } = decodeWithTracker(stream);
  assert.ok(text.startsWith('HI'), `head intact, got "${text}"`);
  assert.ok(text.endsWith('OK'), `tail re-locked, got "${text}"`);
  const error = Math.abs(tracker.rawUnitMs() - 100) / 100; // BRISK û=100
  assert.ok(error <= 0.2, `re-locked to ~100, got ${tracker.rawUnitMs()}`);
  assert.equal(tracker.status().locked, true);
});

test('F2: TypeError discipline on the tracker', () => {
  const tracker = createClockTracker();
  assert.throws(() => tracker.observe(null), TypeError);
  assert.throws(() => tracker.observe('mark'), TypeError);
});
