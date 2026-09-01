// test/copy.test.mjs — U1 validation: the copy pack is COMPLETE against the
// modules that define the surface it must cover, and it holds the register
// voice laws and the two load-bearing honesty facts.
//
// Completeness is checked against the LIVE exports, not literals:
//   - js/states.js  STATE_LIST (all 15 states) + ARM_MATRIX framings + the
//                   denied offerScreen cell
//   - js/torch.js   TORCH_FALLBACK_REASONS (all 10 reasons)
//   - js/schedule.js SPEED_STEPS / SPEED_STEP_ORDER / WPM_HARD_CAP /
//                   PHOTOSAFETY_THRESHOLD_HZ / flashGuard (numbers in copy
//                   are derived from these — asserted, not trusted)
// Copy-quality guards: plate-line length cap, the hazard imperative +
// advisory content, the why-camera no-recording fact, no exclamation hype,
// no apology, deep-frozen data, data-only source (no DOM tokens).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { COPY, speedLine, progressLine, unknownCharsLine, fallbackLine } from '../js/copy.js';
import { STATES, STATE_LIST, ARM_MATRIX, ARM_FRAMINGS } from '../js/states.js';
import { TORCH_FALLBACK_REASONS } from '../js/torch.js';
import {
  SPEED_STEPS,
  SPEED_STEP_ORDER,
  WPM_HARD_CAP,
  PHOTOSAFETY_THRESHOLD_HZ,
  flashGuard,
} from '../js/schedule.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every string in the copy tree, depth-first. */
function collectStrings(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) collectStrings(node[key], out);
  }
  return out;
}

test('copy pack is deeply frozen', () => {
  assert.ok(Object.isFrozen(COPY));
  const walk = (node) => {
    if (node && typeof node === 'object') {
      assert.ok(Object.isFrozen(node), `not frozen: ${JSON.stringify(node).slice(0, 60)}`);
      for (const key of Object.keys(node)) walk(node[key]);
    }
  };
  walk(COPY);
});

test('every leaf is a string (sole exception: null cautions on non-BRISK steps)', () => {
  const check = (node, path) => {
    if (node === null) {
      assert.match(path, /^(?:\w+\.)*steps\.(LEARNER|STANDARD)\.caution$/, `unexpected null at ${path}`);
      return;
    }
    if (typeof node === 'object') {
      for (const key of Object.keys(node)) check(node[key], `${path}.${key}`);
      return;
    }
    assert.equal(typeof node, 'string', `non-string leaf at ${path}`);
  };
  check(COPY, 'COPY');
});

// ---------------------------------------------------------------------------
// Completeness against js/states.js

test('state completeness: every F8 state has legend + line, and no extras', () => {
  const copyStates = Object.keys(COPY.states);
  assert.deepEqual([...copyStates].sort(), [...STATE_LIST].sort());
  for (const state of STATE_LIST) {
    const block = COPY.states[state];
    assert.ok(block, `no copy for state ${state}`);
    assert.equal(typeof block.legend, 'string', `no legend for ${state}`);
    assert.equal(typeof block.line, 'string', `no line for ${state}`);
    assert.ok(block.legend.length > 0 && block.line.length > 0, `empty copy for ${state}`);
  }
});

test('no undefined access for any state, checked by direct lookup', () => {
  for (const state of STATE_LIST) {
    assert.notEqual(COPY.states[state].legend, undefined);
    assert.notEqual(COPY.states[state].line, undefined);
  }
});

test('doneReason and error kinds have copy (the phase-scoped carriers F8 renders)', () => {
  assert.equal(typeof COPY.done.complete, 'string');
  assert.equal(typeof COPY.done.stopped, 'string');
  assert.equal(typeof COPY.error.arm, 'string');
  assert.equal(typeof COPY.error.broadcast, 'string');
  assert.equal(typeof COPY.error.internal, 'string');
  assert.equal(typeof COPY.error.recover, 'string');
});

test('takeover causes have copy (torch-lost and manual-switch rows)', () => {
  assert.equal(typeof COPY.broadcast.takeoverTorchLost, 'string');
  assert.equal(typeof COPY.broadcast.takeoverManualSwitch, 'string');
  assert.equal(typeof COPY.broadcast.takeoverPositionKept, 'string');
});

test('ARM_MATRIX framings: every framing in the matrix has copy, key set exact', () => {
  const usedFramings = new Set();
  const offeringCells = [];
  for (const row of Object.values(ARM_MATRIX)) {
    for (const cell of Object.values(row)) {
      usedFramings.add(cell.framing);
      if (cell.offerScreen) offeringCells.push(cell);
    }
  }
  assert.deepEqual([...Object.keys(COPY.framings)].sort(), [...Object.values(ARM_FRAMINGS)].sort());
  for (const framing of usedFramings) {
    assert.equal(typeof COPY.framings[framing], 'string', `no copy for framing ${framing}`);
    assert.ok(COPY.framings[framing].length > 0);
  }
  // the denied cell offers the screen — the offer must exist as copy
  assert.ok(offeringCells.length >= 1, 'matrix unexpectedly has no offering cell');
  assert.equal(typeof COPY.denied.offer, 'string');
  assert.equal(typeof COPY.denied.offerLine, 'string');
  assert.match(COPY.denied.offerLine, /SCREEN/);
});

// ---------------------------------------------------------------------------
// Completeness against js/torch.js

test('fallback completeness: every TORCH_FALLBACK_REASONS value has a machine line', () => {
  const reasons = Object.values(TORCH_FALLBACK_REASONS);
  const copyKeys = Object.keys(COPY.fallback);
  for (const reason of reasons) {
    assert.ok(copyKeys.includes(reason), `no fallback copy for ${reason}`);
    assert.equal(typeof COPY.fallback[reason], 'string', `fallback copy for ${reason} not a string`);
    assert.ok(COPY.fallback[reason].length > 0);
  }
  // no reason strings beyond the vocabulary + the generic default
  assert.deepEqual(
    [...copyKeys].sort(),
    [...reasons, 'generic'].sort()
  );
});

test('fallbackLine never returns undefined, known or unknown reason', () => {
  for (const reason of Object.values(TORCH_FALLBACK_REASONS)) {
    assert.equal(fallbackLine(reason), COPY.fallback[reason]);
  }
  assert.equal(fallbackLine('a-reason-from-the-future'), COPY.fallback.generic);
  assert.equal(fallbackLine(undefined), COPY.fallback.generic);
});

// ---------------------------------------------------------------------------
// Completeness against js/schedule.js (numbers derived, not retyped)

test('speed steps: copy exists for every step, keyed by F2 ids', () => {
  assert.deepEqual([...Object.keys(COPY.steps)].sort(), [...SPEED_STEP_ORDER].sort());
  for (const id of SPEED_STEP_ORDER) {
    const step = COPY.steps[id];
    assert.equal(typeof step.label, 'string');
    assert.equal(typeof step.description, 'string');
  }
});

test('step copy carries the committed WPM values and honest flash rates', () => {
  for (const id of SPEED_STEP_ORDER) {
    assert.ok(
      COPY.steps[id].description.includes(`${SPEED_STEPS[id].wpm} WPM`),
      `${id} description must name ${SPEED_STEPS[id].wpm} WPM`
    );
  }
  const hz = (id) => flashGuard(SPEED_STEPS[id].wpm).sustainedDotHz.toFixed(1);
  assert.ok(COPY.steps.STANDARD.description.includes(hz('STANDARD')), 'STANDARD names its flash rate');
  assert.ok(COPY.steps.BRISK.caution.includes(hz('BRISK')), 'BRISK caution names its flash rate');
  assert.ok(COPY.speed.cap.includes(`${WPM_HARD_CAP}`), 'cap note names the hard cap');
});

test('BRISK alone carries the rapid-flash caution; LEARNER is the stated default', () => {
  assert.equal(typeof COPY.steps.BRISK.caution, 'string');
  assert.match(COPY.steps.BRISK.caution, /RAPID FLASH/);
  assert.ok(COPY.steps.BRISK.caution.includes(`${PHOTOSAFETY_THRESHOLD_HZ}-HERTZ`), 'caution names the threshold');
  assert.equal(COPY.steps.LEARNER.caution, null);
  assert.equal(COPY.steps.STANDARD.caution, null);
  assert.match(COPY.steps.LEARNER.description, /default/i);
});

// ---------------------------------------------------------------------------
// Copy-quality guards

test('plate-line law: no string in the pack exceeds 120 characters', () => {
  for (const text of collectStrings(COPY)) {
    assert.ok(
      text.length <= 120,
      `string over 120 chars (${text.length}): ${text}`
    );
  }
});

test('register voice: no exclamation marks, no apology, no marketing hype tokens', () => {
  for (const text of collectStrings(COPY)) {
    assert.ok(!text.includes('!'), `exclamation mark in: ${text}`);
    assert.ok(!/sorry|unfortunate|apolog/i.test(text), `apology token in: ${text}`);
    assert.ok(!/amazing|awesome|wow|magic/i.test(text), `hype token in: ${text}`);
  }
});

test('hazard plate: one imperative line + advisory, mentioning flashing light, who must not watch, and the speed steps', () => {
  const { hazard } = COPY;
  assert.match(hazard.title, /FLASHING LIGHT/i);
  // the imperative: starts with DO NOT, names the flashing trigger and the seizure risk
  assert.match(hazard.imperative, /^DO NOT WATCH/);
  assert.match(hazard.imperative, /FLASHING LIGHT/);
  assert.match(hazard.imperative, /SEIZURE/);
  // the advisory: who should not watch
  assert.match(hazard.advisory, /photosensitive/i);
  assert.match(hazard.advisory, /not watch/i);
  // the speed steps, by label and committed WPM
  for (const id of SPEED_STEP_ORDER) {
    assert.ok(hazard.steps.includes(`${id} ${SPEED_STEPS[id].wpm}`), `hazard steps missing ${id} ${SPEED_STEPS[id].wpm}`);
  }
  // honest rates per step against the live guard
  for (const id of SPEED_STEP_ORDER) {
    assert.ok(
      hazard.rates.includes(flashGuard(SPEED_STEPS[id].wpm).sustainedDotHz.toFixed(1)),
      `hazard rates missing the ${id} rate`
    );
  }
  assert.ok(hazard.rates.includes(`${PHOTOSAFETY_THRESHOLD_HZ}`), 'rates line names no threshold integer');
  assert.match(hazard.threshold, new RegExp(`${PHOTOSAFETY_THRESHOLD_HZ} flashes per second`));
  assert.equal(typeof hazard.pictogramAlt, 'string');
  assert.ok(hazard.pictogramAlt.length > 0);
  assert.equal(typeof hazard.acknowledge, 'string');
  assert.equal(typeof hazard.decline, 'string');
});

test('why-camera: the two privacy facts survive verbatim, and it precedes the prompt', () => {
  const joined = `${COPY.whyCamera.title} ${COPY.whyCamera.lines.join(' ')}`.toLowerCase();
  // fact 1 — browsers expose the torch only through the camera stream
  assert.ok(joined.includes('camera stream'), 'must state the torch-only-through-camera-stream fact');
  assert.ok(joined.includes('torch'), 'must name the torch');
  // fact 2 — no video is recorded or sent (exact facts)
  assert.ok(joined.includes('no video is recorded'), 'must state: no video is recorded');
  assert.ok(joined.includes('no video is sent'), 'must state: no video is sent');
  // structure: an action that leads into the browser prompt
  assert.equal(typeof COPY.whyCamera.proceed, 'string');
  assert.equal(typeof COPY.states[STATES.AWAITING_PERMISSION].line, 'string');
  assert.equal(typeof COPY.framings[ARM_FRAMINGS.WHY_CAMERA], 'string');
});

test('first-visit notice is distinct from the returning re-arm beat', () => {
  assert.equal(typeof COPY.notice.firstVisit, 'string');
  assert.equal(typeof COPY.notice.returning, 'string');
  assert.notEqual(COPY.notice.firstVisit, COPY.notice.returning);
  assert.ok(COPY.notice.firstVisit.length > 0 && COPY.notice.returning.length > 0);
});

test('screen mode is framed positively (hold-it-up energy, no consolation)', () => {
  assert.match(COPY.screenMode.line, /HOLD IT UP/);
  assert.match(COPY.screenMode.line, /LAMP/);
  assert.match(COPY.framings[ARM_FRAMINGS.SCREEN_POSITIVE], /SCREEN LIGHT/);
  assert.match(COPY.states[STATES.SCREEN_MODE].line, /HOLD IT UP/);
  assert.match(COPY.states[STATES.UNSUPPORTED].line, /SCREEN CARRIES THE SIGNAL/);
});

test('takeover line keeps the committed wording: light source lost, continuing on screen', () => {
  assert.match(COPY.broadcast.takeoverTorchLost, /LIGHT SOURCE LOST/);
  assert.match(COPY.broadcast.takeoverTorchLost, /CONTINUING ON SCREEN/);
  assert.match(COPY.broadcast.takeoverManualSwitch, /CONTINUING ON SCREEN/);
});

test('standby / caution / GO choreography beats exist in orderable form', () => {
  assert.equal(COPY.choreography.standby.legend, 'STANDBY');
  assert.equal(COPY.choreography.caution.legend, 'CAUTION');
  assert.equal(COPY.choreography.go.legend, 'GO');
  for (const beat of ['standby', 'caution', 'go']) {
    assert.equal(typeof COPY.choreography[beat].line, 'string');
    assert.ok(COPY.choreography[beat].line.length > 0);
  }
});

test('instrument, composer, transport, share, and shared-link blocks are present strings', () => {
  for (const key of ['title', 'subtitle', 'foot']) {
    assert.equal(typeof COPY.instrument[key], 'string');
  }
  for (const key of ['label', 'placeholder', 'empty', 'unknownLead', 'unknownNote']) {
    assert.equal(typeof COPY.input[key], 'string');
  }
  for (const key of [
    'broadcast', 'stop', 'pause', 'resume', 'replay', 'share',
    'copyLink', 'reset', 'cancel', 'tone', 'toneOff', 'switchScreen', 'switchHint',
  ]) {
    assert.equal(typeof COPY.transport[key], 'string', `transport.${key} missing`);
  }
  for (const key of ['copied', 'copyFailed', 'carries']) {
    assert.equal(typeof COPY.share[key], 'string');
  }
  for (const key of ['loaded', 'unreadable']) {
    assert.equal(typeof COPY.shared[key], 'string');
  }
});

// ---------------------------------------------------------------------------
// Parameterized helpers

test('speedLine formats every step from SPEED_STEPS, rejects unknown ids', () => {
  for (const id of SPEED_STEP_ORDER) {
    assert.equal(speedLine(id), `${COPY.steps[id].label} — ${SPEED_STEPS[id].wpm} WPM`);
  }
  assert.throws(() => speedLine('FAST'), TypeError);
  assert.throws(() => speedLine('learner'), TypeError);
  assert.throws(() => speedLine(undefined), TypeError);
});

test('progressLine formats marks and validates bounds', () => {
  assert.equal(progressLine(3, 29), 'MARK 3 OF 29');
  assert.equal(progressLine(0, 1), 'MARK 0 OF 1');
  assert.equal(progressLine(5, 5), 'MARK 5 OF 5');
  for (const bad of [[6, 5], [-1, 5], [1, 0], [1.5, 5], ['1', 5], [1, undefined]]) {
    assert.throws(() => progressLine(...bad), TypeError, `expected TypeError for ${JSON.stringify(bad)}`);
  }
});

test('unknownCharsLine joins flagged characters behind the lead', () => {
  assert.equal(unknownCharsLine(['#']), 'NO MORSE SIGN FOR: #');
  assert.equal(unknownCharsLine(['#', '%']), 'NO MORSE SIGN FOR: # %');
  assert.throws(() => unknownCharsLine([]), TypeError);
  assert.throws(() => unknownCharsLine(['']), TypeError);
  assert.throws(() => unknownCharsLine([7]), TypeError);
  assert.throws(() => unknownCharsLine('#'), TypeError);
});

// ---------------------------------------------------------------------------
// Data-only discipline (same source-scan stance as the F4–F8 suites)

test('source hygiene: copy.js is data-only — no DOM tokens outside comments', () => {
  const source = readFileSync(join(HERE, '..', 'js', 'copy.js'), 'utf8');
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  for (const token of [
    'document', 'window', 'navigator', 'querySelector', 'getElementById',
    'createElement', 'innerHTML', 'localStorage', 'addEventListener', 'setTimeout',
  ]) {
    assert.ok(!stripped.includes(token), `DOM/timer token "${token}" present in code`);
  }
});

// ---------------------------------------------------------------------------
// Run 2 — the receive copy pack (U1).

import { RECEIVE_STATE_LIST } from '../js/states.js';
import { METER, SILENCE_AUTO_COMPLETE_MS } from '../js/receive-session.js';
import { meterLine } from '../js/copy.js';

test('U1: receive copy covers every receive state (a new state cannot ship copyless)', () => {
  const keys = Object.keys(COPY.receive.states).sort();
  assert.deepEqual(keys, [...RECEIVE_STATE_LIST].sort());
  for (const state of RECEIVE_STATE_LIST) {
    const plate = COPY.receive.states[state];
    assert.equal(typeof plate.legend, 'string', `${state} legend`);
    assert.equal(typeof plate.line, 'string', `${state} line`);
    assert.ok(plate.legend.length > 0 && plate.line.length > 0);
  }
});

test('U1: meter copy covers every METER value; meterLine falls back safely', () => {
  assert.deepEqual(Object.keys(COPY.receive.meter).sort(), Object.values(METER).sort());
  for (const meter of Object.values(METER)) {
    assert.equal(typeof COPY.receive.meter[meter], 'string');
  }
  assert.equal(meterLine(METER.DECODING), 'HEARING LIGHT');
  assert.equal(meterLine('nonsense'), COPY.receive.meter[METER.SILENCE]);
});

test('U1: the auto-complete number is derived from the session constant', () => {
  const seconds = Math.round(SILENCE_AUTO_COMPLETE_MS / 1000);
  assert.ok(COPY.receive.quietClosed.includes(`FOR ${seconds} SECONDS`));
  assert.equal(seconds, 5);
});

test('U1: register voice holds over the receive pack (no exclamations, ≤120, no apology)', () => {
  const strings = [];
  (function walk(node) {
    if (typeof node === 'string') strings.push(node);
    else if (node && typeof node === 'object') for (const v of Object.values(node)) walk(v);
  })(COPY.receive);
  assert.ok(strings.length >= 30, `expected a full pack, got ${strings.length}`);
  for (const s of strings) {
    assert.ok(!s.includes('!'), `no exclamation marks: "${s}"`);
    assert.ok(s.length <= 120, `≤120 chars: "${s}"`);
    assert.ok(!/sorr|apolog|just a|merely/i.test(s), `no apology tokens: "${s}"`);
  }
  // Honesty facts present and verbatim.
  const why = COPY.receive.whyCamera.lines.join(' ');
  assert.ok(why.includes('Nothing is recorded. Nothing is sent anywhere.'));
  assert.ok(why.includes('The eye closes the moment you stop.'));
});
