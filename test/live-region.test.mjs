// test/live-region.test.mjs — T-refine-2 aria-live cadence pin.
//
// The critique finding (2026-08-29 snapshot, P3): the status station is a
// single role="status" container (implicit aria-live=polite AND
// aria-atomic=true), and its progress line rewrites textContent on every
// progress event — runtime-verified at ~2.1 Hz sustained dots (LEARNER) to
// ~5.0 Hz (BRISK), and 38 candidates on the default 38-mark run. Every one
// of those mutations is a polite, ATOMIC announcement candidate reading the
// full station (~2–3 s of speech) that arrives faster than any screen
// reader can drain the queue: VoiceOver buries the DONE status under a
// stale mark ledger; NVDA interrupts per mutation into fragments.
//
// The fix is markup-scoped (index.html): the five churning progress lines
// carry aria-live="off" — in Chromium (ax_object.cc), an explicit aria-live
// value, including "off", makes the element its own live region root, so
// the per-mark mutations resolve to an OFF root and never reach the polite
// station; worst case on any engine is exactly the previous behavior. The
// state lines carry NO aria-live of their own: they keep inheriting the
// container's polite channel, so state changes still announce. app.js is
// untouched — the visible line still rewrites every mark.
//
// Pinned contract (source invariants, the speed-freeze precedent):
//   1. the station is the page's ONLY live region (role=status, polite).
//   2. every .status-progress line ships aria-live="off" (all five states).
//   3. no .status-line ships its own aria-live (state changes keep riding
//      the container's polite announcements).
//   4. app.js still renders the progress line per progress event — the
//      fix throttles announcements, never the visible per-mark line.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');

test('T-refine-2 + run 2: two scoped live regions — the station (states) and the receive word announcer', () => {
  const liveRegions = [...html.matchAll(/aria-live="[^"]*"/g)].map((m) => m[0]);
  // Run 2 adds exactly one announcing region beyond the v1 station: the
  // sr-live word announcer (receive mode, per-word polite cadence).
  assert.equal(liveRegions.filter((a) => a !== 'aria-live="off"').length, 2,
    'exactly two announcing live regions (station + word announcer)');
  assert.equal((html.match(/aria-live="polite"/g) || []).length, 2,
    'both announcing regions are polite');
  assert.match(html, /class="station-status" role="status" aria-live="polite"/,
    'the station keeps role="status" + polite (DESIGN.md: aria-live polite)');
  assert.match(html, /class="sr-live" aria-live="polite"><\/p>/,
    'the word announcer is the empty markup-scoped sr-live paragraph');
  assert.equal((html.match(/role="status"/g) || []).length, 1,
    'no other role="status" exists');
  assert.equal((html.match(/role="alert"/g) || []).length, 0,
    'no assertive channels exist');
});

test('T-refine-2: every progress line is scoped out of the announcements', () => {
  const lines = [...html.matchAll(/<p class="status-progress"[^>]*>/g)].map((m) => m[0]);
  assert.equal(lines.length, 5, 'exactly five progress lines (the progress-bearing states)');
  const states = ['broadcasting', 'broadcasting-on-screen', 'paused', 'paused-on-screen', 'error'];
  for (const s of states) {
    const line = lines.find((l) => l.includes(`data-state-progress="${s}"`));
    assert.ok(line, `progress line for ${s} present`);
    assert.match(line, /aria-live="off"/,
      `the ${s} line churns per mark — it must not ride the polite region`);
  }
});

test('T-refine-2: state lines carry no aria-live of their own', () => {
  const lines = [...html.matchAll(/<p class="status-line"[^>]*>/g)].map((m) => m[0]);
  // 15 broadcast lines + 9 receive lines (run 2) — all inherit the
  // station's polite channel; none may override it.
  assert.equal(lines.length, 24, 'the machine-state lines (15 broadcast + 9 receive)');
  for (const line of lines) {
    assert.ok(!line.includes('aria-live'),
      'a state line must inherit the container\'s polite channel, not override it');
  }
});

test('T-refine-2: app.js still writes the progress line on every mark', () => {
  // The fix throttles the ANNOUNCED stream only. The visible per-mark line
  // (I2 behavior) must keep rewriting from onProgress, untouched.
  const onProgressAt = app.indexOf('function onProgress(event)');
  const end = app.indexOf('\n}', onProgressAt);
  const body = app.slice(onProgressAt, end);
  assert.ok(onProgressAt !== -1, 'onProgress located');
  assert.match(body, /renderProgressLine\(\);/,
    'onProgress must render the progress line per mark');
  assert.match(app, /el\.textContent =\s*\n\s*`\$\{progressLine\(Math\.max\(1, lastMarksStarted\), marksTotal\)\} · \$\{speedLine\(stepId\)\}`/,
    'the progress text still writes per mark');
  // No announcement throttling logic leaked into app.js: the fix is markup-only.
  assert.ok(!app.includes('aria-live'), 'app.js must not manipulate live-region attributes');
});

test('T-refine-2 detector self-test: the checks catch planted violations (non-vacuous)', () => {
  const scopeCheck = (src) => {
    const lines = [...src.matchAll(/<p class="status-progress"[^>]*>/g)].map((m) => m[0]);
    return lines.length === 5 && lines.every((l) => l.includes('aria-live="off"'));
  };
  // Pre-fix shape: the churning lines ride the polite region.
  const plantedPreFix = `
<p class="status-progress" data-state-progress="broadcasting">MARK 7 OF 38</p>
<p class="status-progress" data-state-progress="broadcasting-on-screen">MARK 9 OF 38</p>
<p class="status-progress" data-state-progress="paused">MARK 8 OF 38</p>
<p class="status-progress" data-state-progress="paused-on-screen">MARK 8 OF 38</p>
<p class="status-progress" data-state-progress="error">MARK 6 OF 38</p>
`;
  assert.ok(!scopeCheck(plantedPreFix), 'detector must flag the pre-fix per-mark chatter shape');
  // Partial fix (one line missed) must also fail.
  const plantedPartial = plantedPreFix.replace('data-state-progress="error">MARK 6', 'data-state-progress="error" aria-live="off">MARK 6');
  assert.ok(!scopeCheck(plantedPartial), 'detector must flag any unscoped progress line');
  assert.ok(scopeCheck(html), 'the shipped index.html passes its own detector');
});
