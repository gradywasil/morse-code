// js/receive-session.js — the receive brain (pure logic, DOM-free).
//
// Task F3 of docs/ultron/run2-receiver/plan.md. Owns everything the
// decoder and clock tracker deliberately do not: session truth.
//
//   D8 (mid-join): if light was ALREADY ON when listening began, the
//   first mark is truncated and its following gap unmeasurable — both
//   are discarded, the session is flagged PARTIAL from there. A leading
//   gap (light off) is simply never seen — nothing to discard.
//
//   D9 (text gate): startup waits for coherent mark/gap timing. At the
//   first lock, replay buffered periods once through a fresh decoder and
//   rebuild the tape from its marks, letters, and spaces. Later confidence
//   changes never replay the established record. The decoder keeps tracking
//   the pace, and frame-driven silence settles each completed letter.
//   A session that ends without recovery and with enough marks gets
//   one forced cluster bootstrap at completion if timing never stabilized.
//
//   D9 (noise triad): SILENCE = nothing decodable heard; NOISE = marks
//   accumulating with no coherent unit (≥8 marks, not locked); DECODING
//   = locked and text flowing.
//
//   D10 (auto-complete): 5 s of continuous silence (committed at the
//   research gate; ≈3× the longest scheduled gap 1.68 s at LEARNER —
//   derivation from schedule constants below) finalizes the session.
//   Manual stop finalizes whatever was heard. PARTIAL at the end =
//   joined mid-mark OR a symbol still unresolved when the session ended.
//
// Timeline: feedMark/feedGap take the period length AND its end
// timestamp (watcher edge times); noteFrame(tMs, {lightOn}) advances the clock
// between periods so an open trailing silence can be measured. All
// timestamps are the host's (performance.now-class) monotonic ms.

import { createDecoder, createClockTracker } from './decoder.js';
import { GAP_UNITS } from './morse.js';
import { dotMsOf, SPEED_STEPS } from './schedule.js';

// Longest scheduled gap at the slowest committed step: 7 units at LEARNER.
// 5 s ≈ 3× that margin (research D10, user-committed 2026-09-01).
const LONGEST_SCHEDULED_GAP_MS = GAP_UNITS.word * dotMsOf(SPEED_STEPS.LEARNER.wpm);
export const SILENCE_AUTO_COMPLETE_MS = 5000;
export const DERIVED_FROM_LONGEST_GAP = LONGEST_SCHEDULED_GAP_MS; // ≈1680

/** D9 gates. */
export const SESSION = Object.freeze({
  NOISE_MIN_MARKS: 8,       // marks without a coherent unit → noise
  COHERENCE_TARGET: 0.75,   // share of marks within ±1 frame of û/3û (r3: 70–80%)
  COHERENCE_FRAME_MS: 1000 / 30,
  MAX_REPLAY_PERIODS: 400,  // bounded pre-lock raw buffer
  FORCED_BOOTSTRAP_MIN_MARKS: 4, // end-of-session cluster bootstrap floor
});

export const METER = Object.freeze({
  SILENCE: 'silence',
  NOISE: 'noise',
  DECODING: 'decoding',
});

/**
 * Create a receive session. One per listening run.
 *
 * @param {{onEvent?: Function, lightOnAtBegin?: boolean}} [options]
 *   onEvent — synchronous sink for every session emission:
 *     {type:'mark', mark:'dot'|'dash', ms}       (always — tape punches)
 *     {type:'anomaly', ms}                        (always)
 *     {type:'letter', char, known, code?, replay?:boolean}
 *     {type:'word', replay?:boolean}
 *     {type:'meter', meter}
 *     {type:'partial', reason:'joined-mid-mark'}
 *     {type:'complete', source:'silence'|'stop', partial:boolean, text}
 *   lightOnAtBegin — the light state when listening started (D8).
 */
export function createReceiveSession(options = {}) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('createReceiveSession(options) expects an options object');
  }
  const onEvent = options.onEvent ?? null;
  if (onEvent !== null && typeof onEvent !== 'function') {
    throw new TypeError('createReceiveSession({onEvent}) expects a function');
  }
  const lightOnAtBegin = options.lightOnAtBegin === true;

  const emit = (event) => { if (onEvent !== null) onEvent(event); };

  const tracker = createClockTracker({ bootstrapFromGaps: true });
  let activeDecoder = createDecoder({
    unitMs: () => tracker.unitMs(),
    onEvent: (e) => tracker.observe(e),
  });

  // Session state.
  let meter = METER.SILENCE;
  let completed = false;
  let joinedMidMark = lightOnAtBegin;
  let discardNextGap = lightOnAtBegin;   // D8: the gap after a truncated mark
  let firstMarkPending = lightOnAtBegin; // D8: the truncated mark itself
  let text = '';
  let wordPending = false;
  let recovered = false;
  let lastMarkEndTMs = null;
  let lastTimeTMs = null;
  let lastFrameTMs = null;
  let frameToleranceMs = SESSION.COHERENCE_FRAME_MS;
  const periodBuffer = [];               // raw {kind, ms} for the lock replay
  const markPool = [];                   // raw mark durations (coherence)

  if (joinedMidMark) emit({ type: 'partial', reason: 'joined-mid-mark' });

  const setMeter = (next) => {
    if (next !== meter) {
      meter = next;
      emit({ type: 'meter', meter });
    }
  };

  const addToText = (e) => {
    if (e.type === 'letter') {
      if (wordPending && text) text += ' ';
      text += e.known ? e.char : '\uFFFD';
      wordPending = false;
    } else if (e.type === 'word') wordPending = true;
  };

  /** D9 coherence: share of marks within one frame of û or 3û. */
  const coherence = () => {
    if (markPool.length === 0) return 0;
    const unit = tracker.unitMs();
    const f = frameToleranceMs + 1e-6;
    let hits = 0;
    for (const ms of markPool) {
      if (Math.abs(ms - unit) <= f || Math.abs(ms - 3 * unit) <= f) hits += 1;
    }
    return hits / markPool.length;
  };

  const sessionLocked = () => tracker.status().locked && coherence() >= SESSION.COHERENCE_TARGET;

  /** Run the buffered periods through a fresh decoder at the locked unit
 * and swap to it. No flush — the pending symbol carries over. */
  const replayAndSwap = (unitMs) => {
    if (periodBuffer.length === 0 || periodBuffer.length > SESSION.MAX_REPLAY_PERIODS) return;
    let replaying = true;
    const fresh = createDecoder({
      unitMs: () => replaying ? unitMs : tracker.unitMs(),
      onEvent: e => { if (!replaying) tracker.observe(e); },
    });
    emit({ type: 'replay-start' });
    for (const p of periodBuffer) {
      const events = p.kind === 'mark' ? fresh.feedMark(p.ms) : fresh.feedGap(p.ms);
      for (const e of events) {
        emit({ ...e, replay: true });
        addToText(e);
      }
    }
    activeDecoder = fresh; // future periods continue here — no double emission
    replaying = false;
    periodBuffer.length = 0;
  };

  const updateMeter = () => {
    if (sessionLocked()) setMeter(METER.DECODING);
    else if (markPool.length >= SESSION.NOISE_MIN_MARKS) setMeter(METER.NOISE);
    else setMeter(METER.SILENCE);
  };

  /** Feed one period; returns the events the host may punch/render. */
  const feed = (kind, ms, endTMs) => {
    if (completed) return [];
    if (typeof endTMs !== 'number' || !Number.isFinite(endTMs)) {
      throw new TypeError(`feed${kind === 'mark' ? 'Mark' : 'Gap'}(ms, endTMs) expects a finite end timestamp`);
    }
    lastTimeTMs = endTMs;

    if (kind === 'mark' && firstMarkPending) {
      firstMarkPending = false; // D8: truncated opening mark
      return [];
    }
    if (kind === 'gap' && discardNextGap) {
      discardNextGap = false;   // D8: the gap after it is unmeasurable
      return [];
    }

    if (!recovered) periodBuffer.push({ kind, ms });
    const events = kind === 'mark' ? activeDecoder.feedMark(ms) : activeDecoder.feedGap(ms);
    if (kind === 'mark') {
      markPool.push(ms);
      lastMarkEndTMs = endTMs;
    }

    const out = [];
    for (const e of events) {
      if (e.type === 'mark' || e.type === 'anomaly') {
        emit(e); // tape punches every heard flash, locked or not
        out.push(e);
      }
    }
    const swappedThisFeed = !recovered && sessionLocked();
    if (swappedThisFeed) {
      // The lock moment: recover the pre-lock record, then continue live.
      // The retired decoder's letters in THIS feed were re-derived by the
      // replay — emitting them again would double-count.
      replayAndSwap(tracker.unitMs());
      recovered = true;
    } else if (recovered) {
      for (const e of events) {
        if (e.type === 'letter' || e.type === 'word') {
          emit(e);
          addToText(e);
          out.push(e);
        }
      }
    }
    updateMeter();
    return out;
  };

  /** Cluster-estimate a unit from the raw mark pool (simple split). */
  const forcedUnit = () => {
    if (markPool.length < SESSION.FORCED_BOOTSTRAP_MIN_MARKS) return null;
    const sorted = [...markPool].sort((a, b) => a - b);
    let bestIdx = -1;
    let bestRatio = 1;
    for (let i = 1; i < sorted.length; i++) {
      const r = sorted[i] / sorted[i - 1];
      if (r > bestRatio) { bestRatio = r; bestIdx = i; }
    }
    if (bestIdx <= 0) return sorted[Math.floor(sorted.length / 2)];
    const lower = sorted.slice(0, bestIdx);
    return lower[Math.floor(lower.length / 2)];
  };

  const complete = (source) => {
    if (completed) return;
    completed = true;
    // At silence-complete the trailing silence IS the message's final
    // letter gap — the pending symbol flushes into the text, not into
    // PARTIAL. Only a manual stop can cut a symbol in half.
    const unresolved = source === 'stop' && activeDecoder.pending !== '';
    if (!unresolved) {
      // A completed stream flushes its final letter (silence IS the last
      // gap); a manual cut mid-symbol drops the pending symbol instead
      // of guessing — the honest void, flagged PARTIAL.
      for (const e of activeDecoder.flush()) {
        if (e.type === 'letter' || e.type === 'word') {
          if (recovered) {
            emit(e);
            addToText(e);
          }
        }
      }
    }
    if (!recovered && text === '') {
      // Never locked: one honest forced bootstrap before giving up.
      const unit = forcedUnit();
      if (unit !== null && periodBuffer.length <= SESSION.MAX_REPLAY_PERIODS) {
        emit({ type: 'replay-start' });
        const fresh = createDecoder({ unitMs: unit });
        for (const p of periodBuffer) {
          const events = p.kind === 'mark' ? fresh.feedMark(p.ms) : fresh.feedGap(p.ms);
          for (const e of events) {
            emit({ ...e, replay: true });
            addToText(e);
          }
        }
        if (source === 'silence') {
          // Silence IS the final gap; a manual stop drops the cut symbol.
          for (const e of fresh.flush()) {
            if (e.type === 'letter' || e.type === 'word') {
              emit({ ...e, replay: true });
              addToText(e);
            }
          }
        }
      }
    }
    emit({
      type: 'complete',
      source,
      partial: joinedMidMark || unresolved,
      text,
    });
  };

  return {
    /** An ON period of `ms` ended at `endTMs`. */
    feedMark: (ms, endTMs) => feed('mark', ms, endTMs),

    /** An OFF period of `ms` ended at `endTMs`. */
    feedGap: (ms, endTMs) => feed('gap', ms, endTMs),

    /** Host clock advance (a frame arrived at `tMs`). Drives auto-complete. */
    noteFrame(tMs, { lightOn = false } = {}) {
      if (completed) return;
      if (typeof tMs !== 'number' || !Number.isFinite(tMs)) {
        throw new TypeError('noteFrame(tMs) expects a finite timestamp');
      }
      const frameMs = lastFrameTMs === null ? 0 : tMs - lastFrameTMs;
      if (frameMs > 0 && frameMs <= 1000 / 15) {
        frameToleranceMs = Math.max(SESSION.COHERENCE_FRAME_MS, frameMs);
      }
      lastFrameTMs = tMs;
      lastTimeTMs = Math.max(lastTimeTMs ?? tMs, tMs);
      if (lightOn || lastMarkEndTMs === null) return;
      const silenceMs = lastTimeTMs - lastMarkEndTMs;
      if (silenceMs > 0 && recovered) {
        for (const e of activeDecoder.advanceGap(silenceMs)) {
          emit(e);
          addToText(e);
        }
      }
      if (lastMarkEndTMs !== null
          && lastTimeTMs - lastMarkEndTMs >= SILENCE_AUTO_COMPLETE_MS) {
        complete('silence');
      }
    },

    /** Manual STOP: finalize whatever was heard. */
    stop() {
      if (completed) return;
      complete('stop');
    },

    /** Live diagnostics for the host. */
    status() {
      return {
        meter,
        text,
        locked: sessionLocked(),
        marks: markPool.length,
        estimate: tracker.status().estimate,
        joinedMidMark,
        completed,
      };
    },
  };
}
