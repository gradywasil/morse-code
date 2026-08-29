// js/schedule.js — Schedule engine (pure logic, DOM-free).
//
// Task F2 of docs/ultron/plan.md. Turns the F1 token stream (js/morse.js
// `translate()`) plus a WPM step into a timed event list one conductor can
// drive every channel from. Importable from the browser (ES module) and
// from Node's built-in test runner (`node --test test/schedule.test.mjs`).
//
// Timing standard (PARIS): dot = 1200/WPM ms; ratios dot 1 / dash 3 /
// symbol gap 1 / letter gap 3 / word gap 7 — all in dot-units. Times are
// accumulated in integer dot-units and multiplied by dotMs once, so every
// tMs is exact (no floating-point drift inside a schedule).
//
// Event list — `events` is a list of *edges*, not periods:
//
//     [{ tMs, on, mark, charIdx, letterIdx, symbolIdx }, …]
//
//   - `on:true`  — a mark starts at tMs (light up / tone on).
//   - `on:false` — that mark ends at tMs (light down / tone off).
//   - Gaps emit no events: the silence between an OFF edge and the next
//     ON edge *is* the gap (its length in dot-units is derivable, and the
//     ratio tests do exactly that). The list always alternates
//     on/off/on/off…, starts with `on:true` and ends with `on:false`
//     (F1 guarantees no trailing gap, so the broadcast ends when the last
//     mark ends — `durationMs === events.at(-1).tMs` for non-empty input).
//   - Mark identity (`mark/charIdx/letterIdx/symbolIdx`, straight from the
//     F1 mark token) rides BOTH edges: the ON edge says which mark is
//     starting, the OFF edge says which mark just ended. This is a
//     superset of the plan's five-field shape, so a single event stream
//     can drive:
//       - F5 (audio): tone at each ON tMs, release at each OFF tMs.
//       - F6 (conductor): screen + audio fire at exact tMs, torch commands
//         at tMs − TORCH_LEAD_MS (F6's own constant); `eventIndexAt()`
//         below re-anchors after a visibilitychange pause; `durationMs`
//         bounds progress and the done transition.
//       - I2 (tape read-head): letterIdx/charIdx/symbolIdx on every edge
//         give the head position, current character, and symbol within it.
//       - U1/F7: `SPEED_STEPS` ids + the `flash` guard block below.
//
// Speed steps (committed per R2, 2026-08-28 — docs/ultron/research/
// r2-latency-wpm-sync.md): LEARNER 5 (default) / STANDARD 8 / BRISK 12,
// hard cap 12 WPM. Named steps only in the UI (never a slider); the engine
// itself also accepts a bare WPM number so long as it is ≤ the hard cap.
//
// Flash-frequency guard (photosafety):
//   - REJECT: `schedule()` throws RangeError for any WPM above the hard
//     cap of 12 (at 15 WPM, torch jitter is ~41% of a dot and sustained
//     dots flash at 6.25 Hz — R2 §4).
//   - FLAG (not reject): the fastest pattern this engine can emit is a
//     sustained run of dots — one flash per 2 dot-units (dot ON + symbol
//     gap OFF) — i.e. WPM/2.4 flashes per second. `flash.aboveThreshold`
//     reports whether that exceeds the 3 Hz general-flash threshold
//     (WCAG 2.2 SC 2.3.1): LEARNER 5 → 2.08 Hz (below; the default is
//     safe by design), STANDARD 8 → 3.33 Hz (above), BRISK 12 → 5.0 Hz
//     (above). The plan assigns the rapid-flash hazard copy to BRISK —
//     that opt-in choice is U1's; this module reports the numbers.
//   - `flashGuard(wpm)` is the queryable form (it reports `withinHardCap:
//     false` instead of throwing, so F8/U1 can inspect an over-cap value).

/** PARIS standard: one dot-unit is 1200/WPM milliseconds. */
export const DOT_MS_PER_WPM = 1200;

/** Hard speed ceiling (WPM). Committed per R2: 12, down from 15. */
export const WPM_HARD_CAP = 12;

/** WCAG 2.2 SC 2.3.1 general-flash threshold in flashes/second. */
export const PHOTOSAFETY_THRESHOLD_HZ = 3;

/** The committed named speed steps (ids are stable — F7 hashes them). */
export const SPEED_STEPS = Object.freeze({
  LEARNER: Object.freeze({ id: 'LEARNER', wpm: 5 }),   // default; ≈2.08 Hz sustained dots
  STANDARD: Object.freeze({ id: 'STANDARD', wpm: 8 }), // NATO directional-signalling speed
  BRISK: Object.freeze({ id: 'BRISK', wpm: 12 }),      // naval visual-copy ceiling; hazard copy per U1
});

/** Step ids in UI order (slow → fast). */
export const SPEED_STEP_ORDER = Object.freeze(['LEARNER', 'STANDARD', 'BRISK']);

/** The default step (photosafety: sustained dots stay under 3 Hz). */
export const DEFAULT_STEP_ID = 'LEARNER';

/** Dot length in ms for a WPM (PARIS standard). */
export function dotMsOf(wpm) {
  assertPositiveWpm(wpm);
  return DOT_MS_PER_WPM / wpm;
}

/**
 * Flash-frequency guard for a WPM value. Reports the sustained-dot flash
 * rate (the fastest pattern the engine can emit) against the photosafety
 * threshold, and whether the WPM is within the hard cap. Does NOT throw
 * for over-cap WPM — `schedule()` is the rejecting half of the guard.
 *
 * @param {number} wpm
 * @returns {{wpm:number, dotMs:number, sustainedDotHz:number,
 *   thresholdHz:number, aboveThreshold:boolean,
 *   hardCapWpm:number, withinHardCap:boolean, minElementMs:number}}
 * @throws {TypeError} if `wpm` is not a positive finite number.
 */
export function flashGuard(wpm) {
  assertPositiveWpm(wpm);
  const dotMs = DOT_MS_PER_WPM / wpm;
  // Sustained dots: one flash per (1 unit ON + 1 unit OFF) = 2 × dotMs.
  // 1000 / (2 × 1200/wpm) === wpm / 2.4.
  const sustainedDotHz = wpm / 2.4;
  return {
    wpm,
    dotMs,
    sustainedDotHz,
    thresholdHz: PHOTOSAFETY_THRESHOLD_HZ,
    aboveThreshold: sustainedDotHz > PHOTOSAFETY_THRESHOLD_HZ,
    hardCapWpm: WPM_HARD_CAP,
    withinHardCap: wpm <= WPM_HARD_CAP,
    // Smallest ON/OFF period any schedule at this WPM can contain (1 unit):
    // the minimum spacing between torch commands (R2: ≥ the ~34 ms
    // frame+IPC floor at every committed step).
    minElementMs: dotMs,
  };
}

/**
 * Build the broadcast schedule: F1 tokens + WPM step → timed event list.
 *
 * @param {Array<{type:'mark',mark:'dot'|'dash',units:number,charIdx:number,letterIdx:number,symbolIdx:number}
 *        |{type:'gap',gap:'symbol'|'letter'|'word',units:number}>} tokens
 *   — the `tokens` array from `translate()` (js/morse.js).
 * @param {string|{id?:string,wpm:number}|number} [step]
 *   — a step id ('LEARNER'|'STANDARD'|'BRISK'), a step object from
 *     SPEED_STEPS, or a bare WPM number (must be ≤ WPM_HARD_CAP). Defaults
 *     to the LEARNER step.
 * @returns {{
 *   stepId: string|null, wpm: number, dotMs: number,
 *   events: Array<{tMs:number, on:boolean, mark:'dot'|'dash', charIdx:number, letterIdx:number, symbolIdx:number}>,
 *   durationMs: number, markCount: number,
 *   flash: ReturnType<typeof flashGuard>
 * }}
 * @throws {TypeError} unknown step id, malformed tokens, or non-positive
 *   WPM.
 * @throws {RangeError} WPM above the hard cap of 12 (photosafety).
 */
export function schedule(tokens, step = DEFAULT_STEP_ID) {
  const { stepId, wpm } = resolveStep(step);
  assertTokens(tokens);

  const dotMs = DOT_MS_PER_WPM / wpm;
  const events = [];
  let units = 0; // integer accumulation → exact tMs for every step

  for (const token of tokens) {
    if (token.type === 'gap') {
      units += token.units; // silence: no events, time simply passes
      continue;
    }
    const identity = {
      mark: token.mark,
      charIdx: token.charIdx,
      letterIdx: token.letterIdx,
      symbolIdx: token.symbolIdx,
    };
    events.push({ tMs: units * dotMs, on: true, ...identity });
    units += token.units;
    events.push({ tMs: units * dotMs, on: false, ...identity });
  }

  return {
    stepId,
    wpm,
    dotMs,
    events,
    durationMs: units * dotMs,
    markCount: events.length / 2,
    flash: flashGuard(wpm),
  };
}

/**
 * Index of the first event at or after `tMs` (events.length if none) —
 * the re-anchor point for F6's pause/resume: after a visibilitychange
 * pause at wall-time T, resume firing from `events[eventIndexAt(events, T)]`.
 * Binary search; events are sorted by construction.
 *
 * @param {Array<{tMs:number}>} events
 * @param {number} tMs
 * @returns {number}
 * @throws {TypeError} if `events` is not an array or `tMs` not a finite
 *   number.
 */
export function eventIndexAt(events, tMs) {
  if (!Array.isArray(events)) {
    throw new TypeError(`eventIndexAt(events, tMs) expects an array, got ${typeof events}`);
  }
  if (typeof tMs !== 'number' || !Number.isFinite(tMs)) {
    throw new TypeError(`eventIndexAt(events, tMs) expects a finite number, got ${tMs}`);
  }
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].tMs < tMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Internals

function assertPositiveWpm(wpm) {
  if (typeof wpm !== 'number' || !Number.isFinite(wpm) || wpm <= 0) {
    throw new TypeError(`WPM must be a positive finite number, got ${wpm}`);
  }
}

function assertWithinHardCap(wpm) {
  if (wpm > WPM_HARD_CAP) {
    throw new RangeError(
      `WPM ${wpm} exceeds the hard cap of ${WPM_HARD_CAP} (photosafety, per R2); ` +
        `fastest committed step is BRISK at ${WPM_HARD_CAP}.`
    );
  }
}

function resolveStep(step) {
  if (typeof step === 'string') {
    const named = SPEED_STEPS[step];
    if (!named) {
      throw new TypeError(
        `Unknown speed step "${step}". Known steps: ${SPEED_STEP_ORDER.join(', ')}.`
      );
    }
    return { stepId: named.id, wpm: named.wpm };
  }
  if (typeof step === 'number') {
    assertPositiveWpm(step);
    assertWithinHardCap(step);
    return { stepId: null, wpm: step };
  }
  if (step !== null && typeof step === 'object' && typeof step.wpm === 'number') {
    assertPositiveWpm(step.wpm);
    assertWithinHardCap(step.wpm);
    return { stepId: typeof step.id === 'string' ? step.id : null, wpm: step.wpm };
  }
  throw new TypeError(
    'schedule(tokens, step) expects a step id, a SPEED_STEPS entry, or a WPM number.'
  );
}

function assertTokens(tokens) {
  if (!Array.isArray(tokens)) {
    throw new TypeError(
      `schedule(tokens) expects the token array from translate(), got ${typeof tokens}`
    );
  }
  for (const token of tokens) {
    if (token === null || typeof token !== 'object') {
      throw new TypeError('schedule(tokens): every token must be an object');
    }
    if (!Number.isFinite(token.units) || token.units <= 0) {
      throw new TypeError(
        `schedule(tokens): token units must be a positive number, got ${token.units}`
      );
    }
    if (token.type === 'mark') {
      if (token.mark !== 'dot' && token.mark !== 'dash') {
        throw new TypeError(`schedule(tokens): mark must be 'dot' or 'dash', got ${token.mark}`);
      }
      if (!Number.isInteger(token.charIdx) || token.charIdx < 0) {
        throw new TypeError(`schedule(tokens): mark charIdx must be a non-negative integer`);
      }
      if (!Number.isInteger(token.letterIdx) || token.letterIdx < 0) {
        throw new TypeError(`schedule(tokens): mark letterIdx must be a non-negative integer`);
      }
    } else if (token.type !== 'gap') {
      throw new TypeError(
        `schedule(tokens): token type must be 'mark' or 'gap', got ${String(token.type)}`
      );
    }
  }
}
