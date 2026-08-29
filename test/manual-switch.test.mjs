// test/manual-switch.test.mjs — T-refine-4 manual-switch takeover pin.
//
// The T-refine-1 verifier finding (2026-08-29, P1-equivalent): pressing
// SWITCH TO SCREEN mid-broadcast never lit the screen — the machine moved
// to broadcasting-on-screen and its release-torch effect killed the LED
// (torch.release() emits 'released'), but the conductor only hears F3's
// 'lost' event, so it kept conducting a dead torch: a dark run wearing a
// truthful-sounding takeover note. The fix spans two files — conductor.js
// exposes the takeover as switchToScreen(); app.js's manual-switch handler
// dispatches SWITCH_CHANNEL first (the hardware kill), then calls it.
//
// The conductor's exact takeover mechanics are pinned behaviorally in
// test/conductor.test.mjs ('F6 manual switch to screen'); this suite pins
// the WIRING as source invariants over the shipped files (the
// speed-freeze.test.mjs / privacy-scan.test.mjs precedent — app.js is DOM
// glue in a dependency-free repo with no DOM rig), so the dark-run
// regression cannot ship silently.
//
// Pinned contract:
//   1. the SWITCH TO SCREEN control exists (index.html) and its takeover
//      copy is the manual-switch wording (copy.js, already correct).
//   2. conductor.js exposes switchToScreen() on its public surface and the
//      manual cause code 'manual-switch' (matching F8's takeover cause).
//   3. app.js's 'switch-screen' handler drives the REAL takeover: the
//      machine dispatch comes FIRST, the conductor call is gated on
//      .accepted and follows it.
//   4. app.js's onTakeover callback only dispatches TORCH_LOST when the
//      machine can still take it — a manual switch's report (which arrives
//      after SWITCH_CHANNEL already moved the machine) must never produce
//      a second transition or rewrite the takeover cause.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const conductor = readFileSync(path.join(ROOT, 'js/conductor.js'), 'utf8');
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const copy = readFileSync(path.join(ROOT, 'js/copy.js'), 'utf8');

/** Slice one ACTIONS entry out of app.js (from its key to the next key). */
function actionBody(src, key) {
  const start = src.indexOf(`'${key}':`);
  assert.ok(start !== -1, `${key} action located`);
  const end = src.indexOf("'", src.indexOf('},', start) + 2);
  return src.slice(start, end === -1 ? undefined : end);
}

test('T-refine-4: the SWITCH TO SCREEN control and its manual-switch copy ship', () => {
  assert.match(
    html,
    /<button class="key" type="button" data-action="switch-screen">/,
    'index.html mounts the switch key'
  );
  assert.match(copy, /takeoverManualSwitch:/, 'copy.js carries the manual-switch takeover lead');
  assert.match(copy, /takeoverPositionKept:/, 'copy.js carries the position-kept suffix');
});

test('T-refine-4: conductor exposes the manual takeover on its public surface', () => {
  assert.match(
    conductor,
    /export const TAKEOVER_CODES = Object\.freeze\(\{\s*\n\s*MANUAL_SWITCH: 'manual-switch',\s*\n\}\);/,
    'TAKEOVER_CODES.MANUAL_SWITCH is the exported manual cause code'
  );
  assert.match(
    conductor,
    /return \{ start, pause, resume, cancel, replay, switchToScreen, status, destroy \};/,
    'switchToScreen() is part of the conductor API'
  );
});

test('T-refine-4: the switch handler drives the real takeover — machine first, conductor gated on accepted', () => {
  const handler = actionBody(app, 'switch-screen');
  const dispatchAt = handler.indexOf('STATE_EVENTS.SWITCH_CHANNEL');
  const gateAt = handler.indexOf('.accepted');
  const callAt = handler.indexOf('conductor.switchToScreen()');
  assert.ok(dispatchAt !== -1, 'handler dispatches SWITCH_CHANNEL');
  assert.ok(gateAt !== -1, 'the conductor call is gated on the dispatch being accepted');
  assert.ok(callAt !== -1, 'handler calls conductor.switchToScreen() — the release alone is a dark run');
  assert.ok(
    dispatchAt < callAt && gateAt < callAt,
    'the machine moves FIRST (its release-torch effect is the hardware kill), the takeover follows'
  );
});

test('T-refine-4: onTakeover is guarded — the manual report never moves the machine twice', () => {
  const start = app.indexOf('onTakeover: (payload)');
  assert.ok(start !== -1, 'onTakeover callback located');
  const end = app.indexOf('},', start);
  const cb = app.slice(start, end);
  const guardAt = cb.indexOf('machine.can(STATE_EVENTS.TORCH_LOST)');
  const dispatchAt = cb.indexOf('machine.dispatch(STATE_EVENTS.TORCH_LOST');
  assert.ok(guardAt !== -1, 'the callback checks machine.can(TORCH_LOST)');
  assert.ok(dispatchAt !== -1, 'a genuine torch loss still dispatches TORCH_LOST');
  assert.ok(guardAt < dispatchAt, 'the guard runs before the dispatch');
});

test('T-refine-4 detector self-test: the wiring check catches the planted pre-fix shapes (non-vacuous)', () => {
  const drivesTakeover = (src) => {
    const h = actionBody(src, 'switch-screen');
    return (
      h.includes('STATE_EVENTS.SWITCH_CHANNEL') &&
      h.includes('conductor.switchToScreen()') &&
      h.indexOf('STATE_EVENTS.SWITCH_CHANNEL') < h.indexOf('conductor.switchToScreen()') &&
      h.indexOf('.accepted') < h.indexOf('conductor.switchToScreen()')
    );
  };
  // Pre-fix shape (the shipped bug): the dispatch alone, release effect
  // kills the LED, no conductor takeover — the screen never lights.
  const planted = `
  'switch-screen': () => {
    machine.dispatch(STATE_EVENTS.SWITCH_CHANNEL); // release effect follows
  },

  'replay': () => {},
`;
  assert.ok(!drivesTakeover(planted), 'detector must flag the release-only pre-fix handler');
  assert.ok(drivesTakeover(app), 'the shipped handler must pass its own detector');

  // Wrong order (conductor before the machine moved) must fail too: the
  // takeover report would dispatch TORCH_LOST first, mislabeling the cause
  // and skipping the release effect.
  const wrongOrder = `
  'switch-screen': () => {
    conductor.switchToScreen();
    machine.dispatch(STATE_EVENTS.SWITCH_CHANNEL).accepted;
  },

  'replay': () => {},
`;
  assert.ok(!drivesTakeover(wrongOrder), 'detector must flag machine-second ordering');
});
