// test/schedule.test.mjs — F2 validation. Run: `node --test test/schedule.test.mjs`
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { translate } from '../js/morse.js';
import {
  schedule,
  flashGuard,
  eventIndexAt,
  dotMsOf,
  SPEED_STEPS,
  SPEED_STEP_ORDER,
  DEFAULT_STEP_ID,
  DOT_MS_PER_WPM,
  WPM_HARD_CAP,
  PHOTOSAFETY_THRESHOLD_HZ,
} from '../js/schedule.js';

const closeTo = (actual, expected, ok = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < ok, `${actual} ≈ ${expected}`);

/** Split an event list into ON-periods and gap-periods, in dot-units. */
function unitSpans(events, dotMs) {
  const marks = [];
  const gaps = [];
  for (let i = 0; i < events.length; i += 2) {
    marks.push((events[i + 1].tMs - events[i].tMs) / dotMs);
    if (i + 2 < events.length) {
      gaps.push((events[i + 2].tMs - events[i + 1].tMs) / dotMs);
    }
  }
  return { marks, gaps };
}

describe('F2 · speed steps and constants', () => {
  test('committed steps are LEARNER 5 / STANDARD 8 / BRISK 12, default LEARNER', () => {
    assert.deepEqual(SPEED_STEPS.LEARNER, { id: 'LEARNER', wpm: 5 });
    assert.deepEqual(SPEED_STEPS.STANDARD, { id: 'STANDARD', wpm: 8 });
    assert.deepEqual(SPEED_STEPS.BRISK, { id: 'BRISK', wpm: 12 });
    assert.deepEqual(SPEED_STEP_ORDER, ['LEARNER', 'STANDARD', 'BRISK']);
    assert.equal(DEFAULT_STEP_ID, 'LEARNER');
  });

  test('every committed step is within the hard cap; PARIS dot lengths are exact', () => {
    assert.equal(WPM_HARD_CAP, 12);
    for (const step of Object.values(SPEED_STEPS)) {
      assert.ok(step.wpm <= WPM_HARD_CAP, `${step.id} within cap`);
      assert.equal(dotMsOf(step.wpm), DOT_MS_PER_WPM / step.wpm);
    }
    assert.equal(DOT_MS_PER_WPM, 1200); // PARIS: 50 units/word → unit = 60000/(50·WPM)
    assert.equal(dotMsOf(5), 240);
    assert.equal(dotMsOf(8), 150);
    assert.equal(dotMsOf(12), 100);
    assert.equal(PHOTOSAFETY_THRESHOLD_HZ, 3);
  });
});

describe('F2 · ratios in dot-units (1/3/1/3/7)', () => {
  // "HI YOU" exercises every unit kind: dots, dashes, symbol gaps (1),
  // letter gaps (3) and a word gap (7).
  //   H=....  I=..  Y=-.--  O=---  U=..-
  const HI_YOU_MARKS = [1, 1, 1, 1, 1, 1, 3, 1, 3, 3, 3, 3, 3, 1, 1, 3];
  const HI_YOU_GAPS = [1, 1, 1, 3, 1, 7, 1, 1, 1, 3, 1, 1, 3, 1, 1];

  for (const step of Object.values(SPEED_STEPS)) {
    test(`"HI YOU" at ${step.id} (${step.wpm} WPM, dot ${dotMsOf(step.wpm)} ms)`, () => {
      const s = schedule(translate('HI YOU').tokens, step);
      const { marks, gaps } = unitSpans(s.events, s.dotMs);
      assert.deepEqual(marks, HI_YOU_MARKS);
      assert.deepEqual(gaps, HI_YOU_GAPS);
    });
  }

  test('dot = 1 unit, dash = 3 units ("A")', () => {
    const s = schedule(translate('A').tokens, 'LEARNER');
    const { marks, gaps } = unitSpans(s.events, s.dotMs);
    assert.deepEqual(marks, [1, 3]);
    assert.deepEqual(gaps, [1]); // the single symbol gap inside A
  });

  test('letter gap = 3 units between letters ("EE")', () => {
    const s = schedule(translate('EE').tokens, 'LEARNER');
    assert.deepEqual(unitSpans(s.events, s.dotMs).gaps, [3]);
  });

  test('word gap = 7 units ("E E")', () => {
    const s = schedule(translate('E E').tokens, 'LEARNER');
    assert.deepEqual(unitSpans(s.events, s.dotMs).gaps, [7]);
  });
});

describe('F2 · event list structure', () => {
  test('"SOS" at LEARNER is the exact edge list (hand-computed PARIS times)', () => {
    const d = 240; // dot at 5 WPM
    const e = (u, on, mark, charIdx, letterIdx, symbolIdx) => ({
      tMs: u * d, on, mark, charIdx, letterIdx, symbolIdx,
    });
    assert.deepEqual(schedule(translate('SOS').tokens, 'LEARNER').events, [
      e(0, true, 'dot', 0, 0, 0), e(1, false, 'dot', 0, 0, 0),
      e(2, true, 'dot', 0, 0, 1), e(3, false, 'dot', 0, 0, 1),
      e(4, true, 'dot', 0, 0, 2), e(5, false, 'dot', 0, 0, 2),
      e(8, true, 'dash', 1, 1, 0), e(11, false, 'dash', 1, 1, 0),
      e(12, true, 'dash', 1, 1, 1), e(15, false, 'dash', 1, 1, 1),
      e(16, true, 'dash', 1, 1, 2), e(19, false, 'dash', 1, 1, 2),
      e(22, true, 'dot', 2, 2, 0), e(23, false, 'dot', 2, 2, 0),
      e(24, true, 'dot', 2, 2, 1), e(25, false, 'dot', 2, 2, 1),
      e(26, true, 'dot', 2, 2, 2), e(27, false, 'dot', 2, 2, 2),
    ]);
  });

  for (const step of Object.values(SPEED_STEPS)) {
    test(`structural invariants at ${step.id}`, () => {
      const { events, markCount } = schedule(translate('PARIS, PARIS?').tokens, step);
      assert.ok(events.length > 0);
      assert.equal(markCount, events.length / 2);
      assert.equal(events[0].on, true);
      assert.equal(events.at(-1).on, false);
      for (let i = 0; i < events.length; i++) {
        assert.equal(events[i].on, i % 2 === 0, `alternation at ${i}`);
        if (i > 0) assert.ok(events[i].tMs > events[i - 1].tMs, `strictly increasing at ${i}`);
        // both edges of a mark share that mark's identity
        if (i % 2 === 0) {
          const { tMs, on, ...identity } = events[i];
          assert.deepEqual(events[i + 1], { tMs: events[i + 1].tMs, on: false, ...identity });
        }
      }
    });
  }

  test('OFF edges carry the ended mark identity (read-head can advance on OFF)', () => {
    const { events } = schedule(translate('AB').tokens, 'STANDARD');
    const offA = events[3]; // A has exactly two marks; this is the OFF of A's dash
    assert.equal(offA.on, false);
    assert.equal(offA.mark, 'dash');
    assert.equal(offA.charIdx, 0);
    assert.equal(offA.letterIdx, 0);
    assert.equal(offA.symbolIdx, 1);
  });
});

describe('F2 · duration math', () => {
  test('"PARIS" is exactly 43 units (the standard word minus its trailing word gap)', () => {
    // PARIS incl. trailing word gap = 50 units (the PARIS-standard word);
    // F1 emits no trailing gap → 43 units of transmission.
    for (const [wpm, dotMs] of [[5, 240], [8, 150], [12, 100]]) {
      const s = schedule(translate('PARIS').tokens, wpm);
      assert.equal(s.durationMs, 43 * dotMs, `${wpm} WPM`);
    }
    assert.equal(schedule(translate('PARIS').tokens, 'BRISK').durationMs, 4300);
  });

  test('"PARIS PARIS" = 43 + 7 + 43 = 93 units', () => {
    assert.equal(schedule(translate('PARIS PARIS').tokens, 'BRISK').durationMs, 9300);
  });

  test('"SOS" = 27 units; duration scales inversely with WPM', () => {
    assert.equal(schedule(translate('SOS').tokens, 'LEARNER').durationMs, 27 * 240); // 6480
    assert.equal(schedule(translate('SOS').tokens, 'STANDARD').durationMs, 27 * 150); // 4050
    assert.equal(schedule(translate('SOS').tokens, 'BRISK').durationMs, 27 * 100); // 3240
  });

  test('no trailing gap: durationMs is the last OFF edge (empty message → 0)', () => {
    const s = schedule(translate('HI YOU').tokens, 'BRISK');
    assert.equal(s.durationMs, s.events.at(-1).tMs);
    const empty = schedule(translate('').tokens, 'LEARNER');
    assert.deepEqual(empty.events, []);
    assert.equal(empty.durationMs, 0);
    assert.equal(empty.markCount, 0);
  });
});

describe('F2 · flash-frequency guard', () => {
  test('sustained-dot rate = WPM/2.4 Hz: 5 → 2.08 (below 3), 8 → 3.33, 12 → 5.0', () => {
    const learner = flashGuard(5);
    closeTo(learner.sustainedDotHz, 5 / 2.4);
    assert.equal(learner.thresholdHz, 3);
    assert.equal(learner.aboveThreshold, false); // default step under the threshold
    assert.ok(learner.sustainedDotHz < 3);

    const standard = flashGuard(8);
    closeTo(standard.sustainedDotHz, 8 / 2.4);
    assert.equal(standard.aboveThreshold, true); // 3.33 Hz

    const brisk = flashGuard(12);
    closeTo(brisk.sustainedDotHz, 5);
    assert.equal(brisk.aboveThreshold, true); // 5 Hz — hazard copy per plan
  });

  test('default speed keeps sustained dots under 3 Hz (plan photosafety line)', () => {
    assert.equal(flashGuard(SPEED_STEPS[DEFAULT_STEP_ID].wpm).aboveThreshold, false);
  });

  test('guard flags around the 3 Hz boundary (7 → below, 7.5 → above)', () => {
    assert.equal(flashGuard(7).aboveThreshold, false);    // 2.92 Hz
    assert.equal(flashGuard(7.5).aboveThreshold, true);   // 3.125 Hz
  });

  test('schedule() embeds the guard; min element at cap is 100 ms (torch spacing floor)', () => {
    for (const step of Object.values(SPEED_STEPS)) {
      const s = schedule(translate('E').tokens, step);
      assert.deepEqual(s.flash, flashGuard(step.wpm));
    }
    assert.equal(flashGuard(12).minElementMs, 100);
    assert.equal(flashGuard(12).withinHardCap, true);
  });

  test('flashGuard reports over-cap WPM instead of throwing (queryable half of the guard)', () => {
    const g = flashGuard(15);
    assert.equal(g.withinHardCap, false);
    assert.equal(g.hardCapWpm, 12);
    closeTo(g.sustainedDotHz, 6.25);
    assert.equal(g.aboveThreshold, true);
  });

  test('flashGuard rejects meaningless WPM', () => {
    for (const bad of [0, -5, NaN, Infinity, -Infinity, '5', null, undefined]) {
      assert.throws(() => flashGuard(bad), TypeError);
    }
  });
});

describe('F2 · hard-cap enforcement (reject above 12 WPM)', () => {
  const tokens = translate('E').tokens;

  test('every committed step schedules cleanly, including BRISK at exactly the cap', () => {
    for (const step of Object.values(SPEED_STEPS)) {
      const s = schedule(tokens, step);
      assert.equal(s.wpm, step.wpm);
      assert.ok(s.durationMs > 0);
    }
    assert.equal(schedule(tokens, 12).wpm, 12); // exactly the cap is allowed
  });

  test('WPM above the cap throws RangeError (number, step object forms)', () => {
    for (const wpm of [12.0001, 13, 15, 100]) {
      assert.throws(() => schedule(tokens, wpm), RangeError, `wpm ${wpm}`);
      assert.throws(() => schedule(tokens, { id: 'LUDICROUS', wpm }), RangeError);
    }
  });

  test('meaningless WPM throws TypeError', () => {
    for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
      assert.throws(() => schedule(tokens, bad), TypeError);
    }
  });
});

describe('F2 · step resolution', () => {
  const tokens = translate('SOS').tokens;

  test('step id, step object and bare WPM are equivalent inputs', () => {
    const byId = schedule(tokens, 'LEARNER');
    assert.deepEqual(schedule(tokens, SPEED_STEPS.LEARNER), byId);
    const byWpm = schedule(tokens, 5);
    assert.deepEqual(byWpm.events, byId.events); // same broadcast…
    assert.equal(byWpm.durationMs, byId.durationMs);
    assert.equal(byWpm.dotMs, byId.dotMs);
    assert.equal(byId.stepId, 'LEARNER');
    assert.equal(byWpm.stepId, null); // …only the step id is absent for a bare number
  });

  test('default step is LEARNER (omitted second argument)', () => {
    assert.deepEqual(schedule(tokens), schedule(tokens, 'LEARNER'));
  });

  test('unknown step id throws TypeError naming the known steps', () => {
    assert.throws(() => schedule(tokens, 'FAST'), /LEARNER, STANDARD, BRISK/);
    assert.throws(() => schedule(tokens, 'learner'), TypeError); // ids are exact; F7 normalizes
    assert.throws(() => schedule(tokens, null), TypeError);
    assert.throws(() => schedule(tokens, true), TypeError);
  });
});

describe('F2 · token validation', () => {
  test('non-array tokens throw TypeError', () => {
    for (const bad of [undefined, null, 'E', 42, { type: 'mark' }]) {
      assert.throws(() => schedule(bad, 'LEARNER'), TypeError);
    }
  });

  test('malformed tokens throw TypeError', () => {
    for (const bad of [
      [{}],
      [{ type: 'mark', mark: 'dot' }],                                  // no units
      [{ type: 'mark', mark: 'dot', units: 0 }],                        // non-positive units
      [{ type: 'pause', units: 1 }],                                    // bad type
      [{ type: 'mark', mark: 'bleep', units: 1, charIdx: 0, letterIdx: 0 }],
      [{ type: 'mark', mark: 'dot', units: 1, charIdx: -1, letterIdx: 0 }],
      [{ type: 'mark', mark: 'dot', units: 1, charIdx: 0, letterIdx: 0.5 }],
      [null],
    ]) {
      assert.throws(() => schedule(bad, 'LEARNER'), TypeError, JSON.stringify(bad));
    }
  });
});

describe('F2 · integration with F1', () => {
  test('round trip: translate("HI YOU") → schedule keeps per-mark identity', () => {
    const { tokens, letters } = translate('HI YOU');
    const s = schedule(tokens, 'STANDARD');
    assert.equal(s.markCount, letters.reduce((n, l) => n + l.marks.length, 0)); // 16
    const hEvents = s.events.filter((ev) => ev.letterIdx === 0);
    assert.equal(hEvents.length, 8); // H = 4 marks × 2 edges
    assert.ok(hEvents.every((ev) => ev.charIdx === 0 && ev.letterIdx === 0));
    const yEvents = s.events.filter((ev) => ev.charIdx === 3); // 'Y' in "HI YOU"
    assert.equal(yEvents.length, 8);
  });

  test('unknown chars: no ON time, boundaries preserved (F1 semantics inherited)', () => {
    const s = schedule(translate('A#B').tokens, 'LEARNER');
    const { marks, gaps } = unitSpans(s.events, s.dotMs);
    assert.deepEqual(marks, [1, 3, 3, 1, 1, 1]); // A then B, nothing for '#'
    assert.deepEqual(gaps, [1, 3, 1, 1, 1]);     // single 3-unit letter gap
    const bMarks = s.events.filter((ev) => ev.on && ev.letterIdx === 2);
    assert.ok(bMarks.every((ev) => ev.charIdx === 2));
    assert.equal(bMarks.length, 4); // B = -...
  });

  test('whitespace-only message schedules to an empty, valid broadcast', () => {
    const s = schedule(translate('  \t ').tokens, 'BRISK');
    assert.deepEqual(s.events, []);
    assert.equal(s.durationMs, 0);
    assert.equal(s.flash.aboveThreshold, true); // guard is WPM-based, still reported
  });
});

describe('F2 · eventIndexAt (F6 re-anchor helper)', () => {
  const { events } = schedule(translate('SOS').tokens, 'LEARNER'); // 0…6480 ms

  test('boundary semantics: first event with tMs >= t', () => {
    assert.equal(eventIndexAt(events, 0), 0);
    assert.equal(eventIndexAt(events, -1), 0);
    assert.equal(eventIndexAt(events, 100), 1);    // mid first dot: next unfired is the OFF
    assert.equal(eventIndexAt(events, 240), 1);    // exactly the first OFF
    assert.equal(eventIndexAt(events, 300), 2);    // inside a symbol gap: next ON
    assert.equal(eventIndexAt(events, 1920), 6);   // O's first dash ON
    assert.equal(eventIndexAt(events, 6480), 17);  // the final OFF
    assert.equal(eventIndexAt(events, 6500), events.length); // past the end
  });

  test('matches a linear scan everywhere (binary-search correctness)', () => {
    for (let t = 0; t <= 7000; t += 137) {
      const linear = events.findIndex((ev) => ev.tMs >= t);
      assert.equal(eventIndexAt(events, t), linear === -1 ? events.length : linear, `t=${t}`);
    }
  });

  test('empty event list → 0 for any t', () => {
    assert.equal(eventIndexAt([], 1234), 0);
  });

  test('invalid input throws TypeError', () => {
    assert.throws(() => eventIndexAt(null, 0), TypeError);
    assert.throws(() => eventIndexAt(events, NaN), TypeError);
    assert.throws(() => eventIndexAt(events, '200'), TypeError);
  });
});
