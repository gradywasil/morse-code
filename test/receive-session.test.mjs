// test/receive-session.test.mjs — T-F3 acceptance (run-2 plan, D8/D9/D10).
//
// The session is driven exactly as I2 will drive it: watcher edges become
// (ms, endTMs) periods from schedule()-generated on/off times, and
// noteFrame advances the clock for silence measurement.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { translate } from '../js/morse.js';
import { schedule, SPEED_STEP_ORDER, dotMsOf } from '../js/schedule.js';
import {
  SILENCE_AUTO_COMPLETE_MS, DERIVED_FROM_LONGEST_GAP, SESSION, METER,
  createReceiveSession,
} from '../js/receive-session.js';

// schedule events → [{kind, ms, endTMs}] with a running clock.
function periodsOf(stepId, text, { startAt = 1000 } = {}) {
  const { events } = schedule(translate(text).tokens, stepId);
  const periods = [];
  for (let i = 0; i < events.length; i += 2) {
    const on = events[i];
    const off = events[i + 1];
    periods.push({ kind: 'mark', ms: off.tMs - on.tMs, endTMs: startAt + off.tMs });
    if (i + 2 < events.length) {
      periods.push({ kind: 'gap', ms: events[i + 2].tMs - off.tMs, endTMs: startAt + events[i + 2].tMs });
    }
  }
  return periods;
}

function runSession(periods, options = {}) {
  const events = [];
  const session = createReceiveSession({ onEvent: (e) => events.push(e), ...options });
  for (const p of periods) {
    if (p.kind === 'mark') session.feedMark(p.ms, p.endTMs);
    else session.feedGap(p.ms, p.endTMs);
  }
  return { session, events };
}

test('D10 constant is committed at 5 s with the derivation pinned', () => {
  assert.equal(SILENCE_AUTO_COMPLETE_MS, 5000);
  assert.ok(Math.abs(DERIVED_FROM_LONGEST_GAP - 1680) < 0.001); // 7 × 240
  assert.ok(SILENCE_AUTO_COMPLETE_MS >= 2.9 * DERIVED_FROM_LONGEST_GAP);
});

test('full sessions decode to exact text at every step (replay recovery)', () => {
  for (const stepId of SPEED_STEP_ORDER) {
    const message = 'HELLO DARK ROOM';
    const periods = periodsOf(stepId, message);
    const { session, events } = runSession(periods);
    // The sender went quiet: silence completes the message (D10 path).
    session.noteFrame(periods[periods.length - 1].endTMs + SILENCE_AUTO_COMPLETE_MS);
    const done = events.find((e) => e.type === 'complete');
    assert.equal(done.source, 'silence');
    assert.equal(done.text, message, stepId);
    assert.equal(done.partial, false, stepId);
    assert.equal(session.status().meter, METER.DECODING, stepId);
  }
});

test('short never-locked message finalizes via the forced bootstrap', () => {
  // LEARNER "HI": 6 marks, no dot/dash pair, cluster needs 7 — the
  // session never locks live; completion force-bootstraps the unit and
  // replays the whole buffer (both letters arrive as replay).
  const periods = periodsOf('LEARNER', 'HI');
  const { session, events } = runSession(periods);
  session.noteFrame(periods[periods.length - 1].endTMs + SILENCE_AUTO_COMPLETE_MS);
  const letters = events.filter((e) => e.type === 'letter');
  assert.equal(letters.length, 2);
  assert.equal(letters[0].char, 'H');
  assert.equal(letters[0].replay, true);
  assert.equal(letters[1].char, 'I');
  assert.equal(letters[1].replay, true);
  const done = events.find((e) => e.type === 'complete');
  assert.equal(done.text, 'HI');
  assert.equal(done.partial, false);
});

test('D8: joining mid-mark discards the truncated mark + gap, flags partial', () => {
  // Light was already ON when listening began: the watcher's first edge
  // is the END of a truncated mark. The session drops that mark and the
  // gap after it — O ("---") loses its first dash and honestly decodes
  // as M; K survives; PARTIAL is flagged with the void reason.
  const periods = periodsOf('STANDARD', 'OK');
  const { session, events } = runSession(periods, { lightOnAtBegin: true });
  // The sender finishes; silence auto-completes (K's final gap is the
  // trailing quiet, so K survives the void).
  session.noteFrame(periods[periods.length - 1].endTMs + SILENCE_AUTO_COMPLETE_MS);
  assert.ok(events.some((e) => e.type === 'partial' && e.reason === 'joined-mid-mark'));
  const done = events.find((e) => e.type === 'complete');
  assert.equal(done.partial, true);
  assert.equal(done.text, 'MK');
  assert.ok(!done.text.includes('O'), 'the truncated letter does not fabricate');
  assert.equal(session.status().joinedMidMark, true);
});

test('D10: auto-complete fires exactly at 5 s of silence — never mid-message', () => {
  for (const stepId of SPEED_STEP_ORDER) {
    const periods = periodsOf(stepId, 'HELLO DARK ROOM');
    let completes = 0;
    const events = [];
    const s = createReceiveSession({ onEvent: (e) => { events.push(e); if (e.type === 'complete') completes += 1; } });
    let lastMarkEnd = null;
    for (const p of periods) {
      if (p.kind === 'mark') { s.feedMark(p.ms, p.endTMs); lastMarkEnd = p.endTMs; }
      else {
        s.feedGap(p.ms, p.endTMs);
        // Advance a frame clock just past every gap — inside the message.
        s.noteFrame(p.endTMs - 1);
      }
    }
    assert.equal(completes, 0, `${stepId}: no auto-complete while the message streams`);
    // 1 ms short of the threshold: still holding.
    s.noteFrame(lastMarkEnd + SILENCE_AUTO_COMPLETE_MS - 1);
    assert.equal(completes, 0, `${stepId}: holds at threshold−1`);
    s.noteFrame(lastMarkEnd + SILENCE_AUTO_COMPLETE_MS);
    assert.equal(completes, 1, `${stepId}: completes at the threshold`);
    const done = events.find((e) => e.type === 'complete');
    assert.equal(done.source, 'silence');
    assert.equal(done.text, 'HELLO DARK ROOM');
    assert.equal(done.partial, false);
  }
});

test('manual stop finalizes heard-so-far; prefix-honest text', () => {
  const periods = periodsOf('STANDARD', 'SOS');
  const events = [];
  const session = createReceiveSession({ onEvent: (e) => events.push(e) });
  const cut = periods.slice(0, Math.floor(periods.length / 2) + 1);
  for (const p of cut) {
    if (p.kind === 'mark') session.feedMark(p.ms, p.endTMs);
    else session.feedGap(p.ms, p.endTMs);
  }
  session.stop();
  const done = events.find((e) => e.type === 'complete');
  assert.equal(done.source, 'stop');
  assert.equal(typeof done.partial, 'boolean');
  // Honest either way: the stopped text is a prefix of the truth (voids
  // from the cut mid-symbol collapse to nothing).
  assert.ok('SOS'.startsWith(done.text.replace(/\uFFFD/g, '')),
    `prefix-honest, got "${done.text}"`);
});

test('D9 meter triad: silence → decoding; unlocked mark pile → noise', () => {
  // Noise: irregular marks that never form a coherent unit (random-ish
  // durations, no 1:3 structure).
  const s = createReceiveSession({});
  const events = [];
  const session = createReceiveSession({ onEvent: (e) => events.push(e) });
  const junk = [50, 122, 87, 205, 63, 171, 95, 240, 58, 133]; // no 1:3 structure
  let t = 0;
  for (const ms of junk) {
    t += ms + 90;
    session.feedMark(ms, t);
    session.feedGap(90, t + 90);
    t += 90;
  }
  const meters = events.filter((e) => e.type === 'meter').map((e) => e.meter);
  assert.ok(meters.includes(METER.NOISE), `noise reached, got [${meters}]`);
  assert.equal(session.status().locked, false);

  // Silence → the initial meter.
  const fresh = createReceiveSession({});
  assert.equal(fresh.status().meter, METER.SILENCE);
});

test('TypeError discipline', () => {
  assert.throws(() => createReceiveSession(null), TypeError);
  assert.throws(() => createReceiveSession({ onEvent: 5 }), TypeError);
  const s = createReceiveSession({});
  assert.throws(() => s.feedMark(100, Number.NaN), TypeError);
  assert.throws(() => s.feedGap(100, 'x'), TypeError);
  assert.throws(() => s.noteFrame({}), TypeError);
});

test('session source is DOM-free (v1 discipline)', () => {
  const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'receive-session.js'), 'utf8');
  for (const token of ['document', 'window', 'localStorage', 'navigator', 'HTMLElement', 'addEventListener']) {
    assert.ok(!source.includes(token), `js/receive-session.js must not reference ${token}`);
  }
});
