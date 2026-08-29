// test/speed-freeze.test.mjs — T-refine-1 commitment-freeze pin.
//
// The critique finding (2026-08-29 snapshot, P2): the speed detents stayed
// interactive through a committed run, so a mid-run tap could rewrite the
// live progress line to a speed that was not the one speaking (a false
// instrument reading, photosafety-adjacent — it could silently arm the
// above-3-Hz BRISK step for replay). The fix is wiring in app.js (DOM glue
// with no DOM test rig in this dependency-free repo), so this suite pins it
// as source invariants over the shipped files — the privacy-scan.test.mjs
// precedent: a regression cannot ship silently.
//
// Pinned contract:
//   1. index.html ships the three-detent radio control the freeze governs.
//   2. app.js freezes the radios in EXACTLY the composer-freeze states
//      (FROZEN_STATES: ready / broadcasting / broadcasting-on-screen /
//      paused / paused-on-screen) via a render() disable pass.
//   3. The change handler guards a committed run BEFORE stepId can mutate
//      (disabled radios never fire — the guard is belt and suspenders),
//      restores the armed step's checked state, and never rewrites the
//      progress line from a speed change (the line belongs to the run).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const css = readFileSync(path.join(ROOT, 'css/main.css'), 'utf8');
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

test('T-refine-1: index.html ships the three named speed detents as radios', () => {
  const radios = [...html.matchAll(/<input class="step-radio"[^>]*name="speed"[^>]*>/g)].map((m) => m[0]);
  assert.equal(radios.length, 3, 'exactly three speed radios (LEARNER/STANDARD/BRISK)');
  for (const id of ['step-learner', 'step-standard', 'step-brisk']) {
    assert.ok(radios.some((r) => r.includes(`id="${id}"`)), `${id} radio present`);
    assert.match(html, new RegExp(`for="${id}"`), `${id} has its step-key label`);
  }
});

test('T-refine-1: app.js freezes the detents in exactly the composer-freeze states', () => {
  // The frozen set is the five committed states (composer parity).
  const frozenBlock = app.slice(app.indexOf('const FROZEN_STATES'), app.indexOf(']);', app.indexOf('const FROZEN_STATES')));
  for (const s of ['READY', 'BROADCASTING', 'BROADCASTING_ON_SCREEN', 'PAUSED', 'PAUSED_ON_SCREEN']) {
    assert.ok(frozenBlock.includes(`STATES.${s}`), `FROZEN_STATES must contain ${s}`);
  }

  // The disable pass runs in render() over the full radio set.
  assert.match(
    app,
    /const speedRadios = Array\.from\(document\.querySelectorAll\('input\[name="speed"\]'\)\)/,
    'speedRadios must be the full radio set (one query, no stragglers)'
  );
  assert.match(app, /messageInput\.disabled = FROZEN_STATES\.has\(state\);/, 'composer freeze present');
  assert.match(
    app,
    /const runCommitted = FROZEN_STATES\.has\(state\);\s*\n\s*for \(const radio of speedRadios\) radio\.disabled = runCommitted;/,
    'render() must disable every speed radio under the same FROZEN_STATES as the composer'
  );
});

test('T-refine-1: the change handler guards committed runs before stepId can mutate', () => {
  const start = app.indexOf("radio.addEventListener('change'");
  const end = app.indexOf('function selectStep', start);
  assert.ok(start !== -1 && end !== -1, 'change handler located');
  const handler = app.slice(start, end);

  const guard = handler.indexOf('FROZEN_STATES.has(machine.state())');
  const mutation = handler.indexOf('stepId = radio.value');
  assert.ok(guard !== -1, 'handler guards on FROZEN_STATES');
  assert.ok(mutation !== -1, 'handler still applies user speed changes when not committed');
  assert.ok(guard < mutation, 'the guard must run BEFORE stepId can mutate (belt and suspenders)');
  assert.match(handler, /selectStep\(stepId\)/, 'a refused change restores the armed step\'s checked state');
  assert.ok(
    !handler.includes('renderProgressLine'),
    'a speed change must never rewrite the progress line — the line belongs to the run'
  );
});

test('T-refine-1: the freeze is visible (machine-key disabled grammar in css/main.css)', () => {
  assert.match(
    css,
    /\.step-radio:disabled \+ \.step-key \{\s*\n\s*opacity: 0\.45;\s*\n\s*cursor: not-allowed;\s*\n\s*pointer-events: none;\s*\n\s*\}/,
    'disabled detents get the .key:disabled dim and go inert to hover/press'
  );
});

test('T-refine-1 detector self-test: the guard-order check catches planted violations (non-vacuous)', () => {
  const isUnguarded = (src) => {
    const s = src.indexOf("radio.addEventListener('change'");
    const e = src.indexOf('function selectStep', s);
    if (s === -1 || e === -1) return true;
    const h = src.slice(s, e);
    const g = h.indexOf('FROZEN_STATES.has(machine.state())');
    return g === -1 || g > h.indexOf('stepId = radio.value');
  };
  // Pre-fix shape: mutation with no guard (plus the old progress-line rewrite).
  const planted = `
for (const radio of speedRadios) {
  radio.addEventListener('change', () => {
    if (radio.checked && SPEED_STEPS[radio.value]) {
      stepId = radio.value;
      requestHashWrite();
      renderProgressLine();
    }
  });
}

function selectStep(id) {}
`;
  assert.ok(isUnguarded(planted), 'detector must flag the unguarded pre-fix handler');
  assert.ok(!isUnguarded(app), 'the shipped handler must pass its own detector');
});
