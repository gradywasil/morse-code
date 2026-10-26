// js/decoder.js — streaming Morse decoder (pure logic, DOM-free).
//
// Task F1 of docs/ultron/run2-receiver/plan.md. The receiving half of the
// register: durations in, letters out. Importable from the browser
// (ES module) and from Node's built-in test runner.
//
// Input contract — the watcher (js/watcher.js) turns camera luminance into
// timestamped light edges; this module consumes the resulting periods:
//
//   feedMark(ms)  — an ON period (light seen) has ended after `ms`.
//   feedGap(ms)   — an OFF period (darkness) has ended after `ms`.
//   flush()       — the stream has gone quiet; emit any pending letter.
//
// Classification (research D7, docs/ultron/run2-receiver/research/r3):
// ITU-midpoint boundaries against the current dot-unit estimate û —
//   marks:  dot  d < 2û · dash 2û ≤ d < 6û · anomaly d ≥ 6û (flagged,
//           never decoded, never fed to any estimator);
//   gaps:   symbol g < 2û · letter 2û ≤ g < 5û · word g ≥ 5û.
// The ±33 ms one-frame quantization math that makes these safe at 30 fps
// for 5/8/12 WPM machine-timed senders is in r3 §Q2.
//
// The unit is not fixed: `unitMs` may be a number OR a function returning
// the current estimate (resolved per classification). F2's zero-
// coordination clock recovery (research D6) plugs in as that function; F1
// alone is the known-unit contract.
//
// Emissions — each feed returns the array of what it produced, and the
// same objects go to an optional `onEvent` hook (I2 punches the tape from
// them):
//
//   {type:'mark',  mark:'dot'|'dash', ms, unitMs}
//   {type:'anomaly', ms, unitMs}              — over-long mark, letter voided
//   {type:'letter', char:string|null, known:boolean, code:string|null,
//                  marks:Array<'dot'|'dash'>}
//   {type:'word'}                            — a word gap: emit a space
//
// Unknown patterns mirror morse.js's unknown discipline: flagged
// (`known:false, char:null, code:'<pattern>'`), never silently dropped.
//
// Known ITU ambiguity: '.' (period) and '+' (plus) share the code
// '.-.-.' in International Morse. A received '.-.-.' decodes to the
// table's LAST entry for that code ('+' — Object.entries order), with
// `known:true`; there is no evidence in the light to disambiguate. This
// is the receive-side mirror of v1's send-side unknown flagging: the
// grammar is honest about what the signal cannot carry.

import { MORSE } from './morse.js';

/** Classification boundaries in multiples of the dot unit (research D7). */
export const CLASSIFY = Object.freeze({
  MARK_DOT_MAX: 2,   // d <  2û → dot
  MARK_DASH_MAX: 6,  // d ≥  6û → anomaly (never decoded, never estimated)
  GAP_SYMBOL_MAX: 2, // g <  2û → symbol gap
  GAP_LETTER_MAX: 5, // g ≥  5û → word gap (2û–5û → letter gap)
});

/** Reverse ITU table: Morse code string → character. Built from MORSE. */
export const REVERSE_MORSE = (() => {
  const reverse = {};
  for (const [char, code] of Object.entries(MORSE)) reverse[code] = char;
  return Object.freeze(reverse);
})();

/**
 * Classify an ON-period duration against a dot unit.
 * @returns {'dot'|'dash'|'anomaly'}
 * @throws {TypeError} non-finite/non-positive arguments.
 */
export function classifyMark(ms, unitMs) {
  assertDuration(ms, 'classifyMark(ms, unitMs)');
  assertUnit(unitMs, 'classifyMark(ms, unitMs)');
  if (ms < CLASSIFY.MARK_DOT_MAX * unitMs) return 'dot';
  if (ms < CLASSIFY.MARK_DASH_MAX * unitMs) return 'dash';
  return 'anomaly';
}

/**
 * Classify an OFF-period duration against a dot unit. Gaps longer than a
 * word gap are still 'word' — how long the silence lasted is session
 * semantics (F3), not grammar.
 * @returns {'symbol'|'letter'|'word'}
 * @throws {TypeError} non-finite/non-positive arguments.
 */
export function classifyGap(ms, unitMs) {
  assertDuration(ms, 'classifyGap(ms, unitMs)');
  assertUnit(unitMs, 'classifyGap(ms, unitMs)');
  if (ms < CLASSIFY.GAP_SYMBOL_MAX * unitMs) return 'symbol';
  if (ms < CLASSIFY.GAP_LETTER_MAX * unitMs) return 'letter';
  return 'word';
}

/**
 * Create a streaming decoder. One instance per receive session; no shared
 * module state.
 *
 * @param {{unitMs?: number|(() => number), onEvent?: Function}} [options]
 *   unitMs — the dot-unit estimate (number) or a provider (function),
 *   resolved fresh for every classification so F2's tracker can adapt
 *   mid-message. onEvent — synchronous sink for every emission.
 * @throws {TypeError} if unitMs is present but neither a positive finite
 *   number nor a function, or onEvent is present but not a function.
 */
export function createDecoder(options = {}) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('createDecoder(options) expects an options object');
  }
  const unitSpec = options.unitMs ?? defaultUnitProvider;
  let unitProvider;
  if (typeof unitSpec === 'function') {
    unitProvider = unitSpec; // resolved fresh per classification (F2's tracker)
  } else {
    assertUnit(unitSpec, 'createDecoder({unitMs})');
    unitProvider = () => unitSpec;
  }
  const onEvent = options.onEvent ?? null;
  if (onEvent !== null && typeof onEvent !== 'function') {
    throw new TypeError('createDecoder({onEvent}) expects a function');
  }

  // Pending letter: the dots/dashes seen since the last letter/word gap.
  let symbol = '';      // '.'/'-' characters
  let marks = [];       // 'dot'/'dash' in arrival order
  let voided = false;   // an anomaly mark invalidated this letter
  let wordEmitted = false;

  const emit = (event) => {
    if (onEvent !== null) onEvent(event);
    return [event];
  };

  const flushLetter = () => {
    if (symbol === '' && !voided) return [];
    const code = symbol;
    const char = voided ? null : (REVERSE_MORSE[code] ?? null);
    const out = emit({
      type: 'letter',
      char,
      known: char !== null,
      code: char !== null ? code : (code === '' ? '(empty)' : code),
      marks,
    });
    symbol = '';
    marks = [];
    voided = false;
    return out;
  };

  const advanceGap = (ms, unitMs = unitProvider()) => {
    assertDuration(ms, 'advanceGap(ms)');
    const gap = classifyGap(ms, unitMs);
    if (gap === 'symbol') return [];
    const out = flushLetter();
    if (gap === 'word' && !wordEmitted) {
      wordEmitted = true;
      out.push(...emit({ type: 'word' }));
    }
    return out;
  };

  return {
    /** An ON period of `ms` has ended. */
    feedMark(ms) {
      assertDuration(ms, 'feedMark(ms)');
      wordEmitted = false;
      const unitMs = unitProvider();
      assertUnit(unitMs, 'decoder unit provider');
      const mark = classifyMark(ms, unitMs);
      if (mark === 'anomaly') {
        voided = true;
        return emit({ type: 'anomaly', ms, unitMs });
      }
      symbol += mark === 'dot' ? '.' : '-';
      marks.push(mark);
      return emit({ type: 'mark', mark, ms, unitMs });
    },

    /** An OFF period of `ms` has ended. */
    feedGap(ms) {
      assertDuration(ms, 'feedGap(ms)');
      const unitMs = unitProvider();
      assertUnit(unitMs, 'decoder unit provider');
      const gap = classifyGap(ms, unitMs);
      const out = emit({ type: 'gap', gap, ms });
      out.push(...advanceGap(ms, unitMs));
      return out;
    },

    /** Elapsed silence, without adding an unfinished gap to the clock tracker. */
    advanceGap,

    /** The stream went quiet: emit any pending letter. */
    flush: flushLetter,

    /** Pending, unflushed symbol characters (diagnostics/tests). */
    get pending() { return symbol; },
  };
}

// The F1 default: a mid-range unit so misuse fails visibly in tests rather
// than decoding everything as one letter. Real sessions always pass an
// explicit unit or F2's provider. The default is deliberately safe for
// classification at ALL THREE committed steps (a û of 150 ms classifies
// every machine-timed duration of 5/8/12 WPM correctly — the ratio
// boundaries at 2û/5û never flip), so early marks feed the tracker sane
// samples while it converges.
export const DEFAULT_UNIT_MS = 150;

function defaultUnitProvider() {
  return DEFAULT_UNIT_MS;
}

// ---------------------------------------------------------------------------
// F2 — zero-coordination clock recovery (research D6).
//
// Composite of three verified prior-art mechanisms:
//   - fldigi's validated-pair gate: the unit estimate updates only on a
//     consecutive mark pair whose duration ratio lies in [2,4] — a
//     misclassified element cannot corrupt the estimate unless its RATIO
//     to its neighbour is also plausible;
//   - morse-pro's linearly-weighted moving average (span of 20–30, newer
//     samples heavier) over per-character unit samples;
//   - OZ1JHM's acceptance band 0.6×–6× as soft rejects.
//
// Snap: when consecutive validated pair-estimates agree within 15%, the
// tracker reports `snapped` (the committed speeds 240/150/100 ms are
// separated by ratios 1.5–1.6, so agreement cannot cross hypotheses).
// Drift reopen: if a snapped tracker sees validated pairs drifting >20%
// for 2 consecutive pairs, it wipes its history and re-seeds from the
// drifting pair (K4ICY's one-character re-lock behavior). Never a hard
// lock — morse-pro keeps lockSpeed optional for a reason.
//
// Bootstrap: no estimate exists until the first validated pair; after 7
// marks without one, a cluster fallback splits the sorted mark durations
// at the largest inter-value ratio and takes the lower cluster's median.
//
// Word gaps never feed the estimator (over-long pauses are unreliable —
// morse-pro excludes them the same way); anomaly marks never reach it
// (the decoder voids them before emission) and the 0.6–6× band guards
// the remainder.

/** Clock-tracker constants (research D6; values pinned by test corpus). */
export const TRACKER = Object.freeze({
  PAIR_RATIO_MIN: 2,     // fldigi gate: ratio ∈ [2,4] validates a pair
  PAIR_RATIO_MAX: 4,
  PAIR_ABS_MIN_MS: 40,   // absolute plausibility of a pair estimate (~30 WPM)
  PAIR_ABS_MAX_MS: 500,  // (~2.4 WPM) — wider than the relative band so
                         // validated drift evidence can always re-lock
  MA_WINDOW: 25,         // weighted moving-average span (20–30)
  MIN_MARK_RATIO: 0.6,   // OZ1JHM acceptance band floor
  MAX_MARK_RATIO: 6,     // ceiling (decoder anomalies already ≥6û)
  SNAP_AGREE: 0.15,      // consecutive estimates within 15% → snapped
  DRIFT_REOPEN: 0.2,     // >20% drift for 2 pairs → reopen
  BOOTSTRAP_FALLBACK_MARKS: 7, // cluster split after 6–8 unpaired marks
  LOCKED_MIN_MARKS: 5,   // D9: ≥5 marks + an estimate → locked
});

/**
 * Create a clock tracker. Feed it the decoder's emissions; read the unit
 * through `unitMs()` wired as the decoder's unit provider — the adaptive
 * loop (classify → sample → re-estimate) is the standard prior-art shape.
 */
export function createClockTracker({ bootstrapFromGaps = false } = {}) {
  let estimate = null;        // weighted-MA unit estimate (ms)
  let samples = [];           // MA buffer (span-capped)
  let snapped = false;
  let lastPairEstimate = null;
  let consecutiveAgree = 0;
  let pairCount = 0;
  let driftCount = 0;
  let marksSeen = 0;
  let markDurations = [];     // bootstrap fallback pool
  let prevMark = null;        // {ms, mark} awaiting its pair partner
  const openingGaps = [];
  let gapBootstrap = false;

  const maValue = () => {
    if (samples.length === 0) return null;
    let num = 0;
    let den = 0;
    samples.forEach((s, i) => { const w = i + 1; num += s.value * w; den += w; });
    return num / den;
  };

  const withinAcceptance = (value) => {
    if (estimate === null) return true;
    return value >= estimate * TRACKER.MIN_MARK_RATIO
      && value <= estimate * TRACKER.MAX_MARK_RATIO;
  };

  const pushSample = (value) => {
    if (!withinAcceptance(value)) return;
    samples.push({ value });
    if (samples.length > TRACKER.MA_WINDOW) samples.shift();
    estimate = maValue();
  };

  const resetTo = (pairEstimate, mark) => {
    samples = [];
    estimate = null;
    snapped = false;
    lastPairEstimate = null;
    consecutiveAgree = 0;
    pairCount = 0;
    driftCount = 0;
    markDurations = [];
    marksSeen = 0;
    openingGaps.length = 0;
    gapBootstrap = false;
    pushSample(pairEstimate);
    prevMark = { ms: mark.ms, mark: mark.mark };
  };

  const considerPair = (ms, mark) => {
    if (prevMark !== null) {
      const a = prevMark;
      const b = { ms, mark };
      const short = a.ms < b.ms ? a : b;
      const long = a.ms < b.ms ? b : a;
      const ratio = long.ms / short.ms;
      if (ratio >= TRACKER.PAIR_RATIO_MIN && ratio <= TRACKER.PAIR_RATIO_MAX) {
        const pairEstimate = (short.ms + long.ms / 3) / 2;
        // Absolute plausibility (NOT relative to the current estimate):
        // a validated pair is strong evidence by itself, and drift
        // evidence must be able to contradict a stale estimate.
        if (pairEstimate >= TRACKER.PAIR_ABS_MIN_MS && pairEstimate <= TRACKER.PAIR_ABS_MAX_MS) {
          pairCount += 1;
          if (lastPairEstimate !== null) {
            const agree = Math.abs(pairEstimate - lastPairEstimate) / lastPairEstimate <= TRACKER.SNAP_AGREE;
            if (agree) consecutiveAgree += 1;
            else consecutiveAgree = 0;
          }
          lastPairEstimate = pairEstimate;
          if (consecutiveAgree >= 1 && pairCount >= 2) snapped = true;
          // Drift gate: any LOCKED tracker (not only pair-snapped ones —
          // an all-dots message never forms a pair yet locks via the
          // cluster fallback) must re-open on contradicting evidence.
          if (estimate !== null && marksSeen >= TRACKER.LOCKED_MIN_MARKS) {
            const drift = Math.abs(pairEstimate - estimate) / estimate;
            if (drift > TRACKER.DRIFT_REOPEN) {
              driftCount += 1;
              if (driftCount >= 2) {
                resetTo(pairEstimate, b);
                return;
              }
            } else {
              driftCount = 0;
            }
          }
          pushSample(pairEstimate);
        }
      }
    }
    prevMark = { ms, mark };
  };

  const clusterFallback = () => {
    if (markDurations.length < TRACKER.BOOTSTRAP_FALLBACK_MARKS) return;
    const sorted = [...markDurations].sort((x, y) => x - y);
    let bestIdx = -1;
    let bestRatio = 1;
    for (let i = 1; i < sorted.length; i++) {
      const r = sorted[i] / sorted[i - 1];
      if (r > bestRatio) { bestRatio = r; bestIdx = i; }
    }
    if (bestIdx <= 0) {
      pushSample(sorted[Math.floor(sorted.length / 2)]); // one cluster
    } else {
      const lower = sorted.slice(0, bestIdx);
      pushSample(lower[Math.floor(lower.length / 2)]);
    }
  };

  return {
    /** Feed a decoder emission; gap events update the estimate by kind. */
    observe(event) {
      if (event === null || typeof event !== 'object') {
        throw new TypeError('tracker.observe(event) expects a decoder emission');
      }
      if (event.type === 'mark') {
        marksSeen += 1;
        markDurations.push(event.ms);
        if (estimate === null) clusterFallback();
        considerPair(event.ms, event.mark);
        return;
      }
      if (event.type === 'gap') {
        if (bootstrapFromGaps && estimate === null) {
          openingGaps.push(event.ms);
          if (marksSeen >= 3 && openingGaps.length >= 2) {
            const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
            const candidates = [1, 3].flatMap(markRatio => [1, 3, 7].map(gapRatio =>
              (median(markDurations) / markRatio + median(openingGaps) / gapRatio) / 2)).sort((a, b) => b - a);
            // Average both sides of the pulse: frame quantization can lengthen
            // a dot while shortening its gap by the same amount.
            const unit = candidates.find(candidate => {
              const tolerance = Math.max(1000 / 30, candidate * 0.2) + 1e-6;
              const fits = (ms, ratios) => ratios.some(ratio => Math.abs(ms - ratio * candidate) <= tolerance);
              return candidate >= TRACKER.PAIR_ABS_MIN_MS && candidate <= TRACKER.PAIR_ABS_MAX_MS
                && markDurations.every(ms => fits(ms, [1, 3]))
                && openingGaps.every(ms => fits(ms, [1, 3, 7]));
            });
            if (unit !== undefined) {
              pushSample(unit);
              gapBootstrap = estimate !== null;
            }
          }
        }
        // Gap samples are derived from the classification (gap/1 or gap/3)
        // — before a mark-based bootstrap exists, classifications ride the
        // DEFAULT unit and would poison the estimate. Marks first.
        if (event.gap === 'symbol' && estimate !== null) pushSample(event.ms);
        else if (event.gap === 'letter' && estimate !== null) pushSample(event.ms / 3);
        // word gaps never feed the estimator (over-long pauses are
        // unreliable — morse-pro excludes them the same way)
        if (event.gap !== 'symbol') prevMark = null;
        return;
      }
      if (event.type === 'anomaly' || event.type === 'letter' || event.type === 'word') {
        prevMark = null; // a letter boundary invalidates pending pairs
      }
    },

    /** Unit for the decoder's provider socket: estimate or the safe default. */
    unitMs() {
      return estimate ?? DEFAULT_UNIT_MS;
    },

    /** The raw estimate — null until the first validated sample. */
    rawUnitMs() {
      return estimate;
    },

    status() {
      return {
        estimate,
        // The D9 session gate: an estimate plus enough marks observed.
        // (`snapped` alone is insufficient — SOS legitimately contains no
        // dot/dash adjacency, so no validated pair ever forms, yet the
        // cluster fallback estimates the unit and the text decodes.)
        locked: estimate !== null && (marksSeen >= TRACKER.LOCKED_MIN_MARKS || gapBootstrap),
        snapped,
        pairCount,
        samples: samples.length,
        marks: marksSeen,
      };
    },
  };
}

function assertDuration(ms, who) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) {
    throw new TypeError(`${who} expects a positive finite duration, got ${ms}`);
  }
}

function assertUnit(unitMs, who) {
  if (typeof unitMs !== 'number' || !Number.isFinite(unitMs) || unitMs <= 0) {
    throw new TypeError(`${who} expects a positive finite unit, got ${unitMs}`);
  }
}
