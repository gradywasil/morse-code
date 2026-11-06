// test/screen-stage.test.mjs — the screen stage stays reachable above the flash.
//
// While the screen itself is the light, js/screen.js mounts a full-viewport
// overlay at OVERLAY_Z_INDEX. The stage strip (STOP, the count, the ticker)
// must layer above it, appear only while that overlay is mounted, and carry
// the keys that end or hold a run.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OVERLAY_Z_INDEX, SCREEN_CLASSES } from '../js/screen.js';

const css = readFileSync(new URL('../css/main.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('the stage layers above the flash overlay', () => {
  const rule = css.match(/\.screen-stage \{[^}]*\}/);
  assert.ok(rule, 'a .screen-stage rule exists');
  const z = Number(rule[0].match(/z-index:\s*(\d+)/)?.[1]);
  assert.ok(z > OVERLAY_Z_INDEX, `stage z-index ${z} must exceed ${OVERLAY_Z_INDEX}`);
  assert.match(rule[0], /display:\s*none/, 'hidden unless the overlay is mounted');
});

test('the stage shows only while the overlay is lit or dark', () => {
  for (const cls of [SCREEN_CLASSES.dark, SCREEN_CLASSES.lit]) {
    assert.ok(
      css.includes(`body:has(.${SCREEN_CLASSES.overlay}.${cls}) .screen-stage`),
      `stage mounts with .${cls}`
    );
  }
});

test('the stage carries STOP, PAUSE, and RESUME keys', () => {
  const stage = html.match(/<div class="screen-stage"[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? '';
  for (const action of ['stop', 'pause', 'resume']) {
    assert.match(stage, new RegExp(`data-action="${action}"`), `${action} key in the stage`);
  }
});
