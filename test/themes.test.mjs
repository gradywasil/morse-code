import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MODES, ACCENTS, BASE_DARK, CONTRAST_PAIRS, MIN_CONTRAST, DEFAULT_MODE_ID, DEFAULT_ACCENT_ID,
  modeById, accentById, resolveModeId, buildTokens, contrastRatio, tokensToCss,
} from '../js/themes.js';

const css = readFileSync(new URL('../css/main.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function rootTokens() {
  const start = css.indexOf(':root {');
  const block = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  const tokens = {};
  for (const [, name, value] of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens[name] = value.trim();
  return tokens;
}
const root = rootTokens();

test('the default look in the stylesheet and the dark palette in code are the same thing', () => {
  for (const [name, value] of Object.entries(BASE_DARK)) {
    assert.equal(root[name], value, `--${name} differs between css/main.css and js/themes.js`);
  }
  assert.deepEqual(buildTokens('dark', 'amber'), {}, 'dark + amber adds nothing: it is the stylesheet');
});

test('modes and accents are a real choice, and unknown or tampered values fall back safely', () => {
  assert.deepEqual(MODES.map((m) => m.id), ['auto', 'light', 'dark', 'contrast']);
  assert.ok(ACCENTS.length >= 5, 'several accents, not one');
  assert.equal(new Set(ACCENTS.map((a) => a.id)).size, ACCENTS.length);
  assert.equal(modeById('nonsense').id, DEFAULT_MODE_ID);
  assert.equal(accentById('nonsense').id, DEFAULT_ACCENT_ID);
  assert.equal(resolveModeId('auto', true), 'light');
  assert.equal(resolveModeId('auto', false), 'dark');
  assert.equal(resolveModeId('contrast', true), 'contrast');
});

test('every light and dark accent sets every token, and tints the whole palette', () => {
  for (const mode of ['light', 'dark']) {
    for (const accent of ACCENTS) {
      const tokens = buildTokens(mode, accent.id);
      if (mode === 'dark' && accent.id === 'amber') continue;
      for (const name of Object.keys(BASE_DARK)) assert.ok(name in tokens, `${mode}/${accent.id} lacks --${name}`);
    }
  }
  // A non-amber accent really does turn the palette: the lamp and the ground move.
  const blue = buildTokens('dark', 'blue');
  assert.notEqual(blue.lamp, BASE_DARK.lamp);
  assert.notEqual(blue.ground, BASE_DARK.ground);
  assert.equal(blue['key-top'] === BASE_DARK['key-top'], false);
});

test('the lamp-rgb triplet always matches the lamp colour', () => {
  for (const mode of ['light', 'dark']) {
    for (const accent of ACCENTS) {
      const tokens = buildTokens(mode, accent.id);
      if (!tokens.lamp) continue;
      const n = parseInt(tokens.lamp.slice(1), 16);
      assert.equal(tokens['lamp-rgb'], [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(', '), `${mode}/${accent.id}`);
    }
  }
});

// WCAG AA for every pair of text and surface, in every combination.
const combos = [['dark', 'amber'], ['contrast', 'amber']];
for (const mode of ['light', 'dark']) for (const accent of ACCENTS) combos.push([mode, accent.id]);
for (const [mode, accentId] of combos) {
  test(`${mode} / ${accentId}: text is readable on every surface it sits on (WCAG AA ${MIN_CONTRAST}:1)`, () => {
    const tokens = { ...BASE_DARK, ...buildTokens(mode, accentId) };
    for (const [fg, bg] of CONTRAST_PAIRS) {
      const ratio = contrastRatio(tokens[fg], tokens[bg]);
      assert.ok(ratio >= MIN_CONTRAST, `${fg} ${tokens[fg]} on ${bg} ${tokens[bg]} = ${ratio.toFixed(2)}`);
    }
  });
}

test('tokens flatten to a style string a native launch can apply before any script runs', () => {
  const css = tokensToCss(buildTokens('light', 'blue'));
  assert.match(css, /--ground:#[0-9a-f]{6};/);
  assert.doesNotMatch(css, /undefined/);
  assert.equal(tokensToCss({}), '');
});

test('no rule outside :root hard-codes a colour (that would not follow the theme)', () => {
  const start = css.indexOf(':root {');
  const rest = (css.slice(0, start) + css.slice(css.indexOf('\n}', start) + 2)).replace(/\/\*[\s\S]*?\*\//g, '');
  const literals = [...rest.matchAll(/#[0-9a-f]{3,8}\b|rgba?\(\s*\d/gi)].map((m) => m[0]);
  // The fade masks use black as an alpha channel only; the colour never shows.
  assert.deepEqual(literals.filter((l) => l.toLowerCase() !== '#000'), []);
});

test('layout: app menu top right, Translate on both screens, Sending on Broadcast, Log on Receive', () => {
  const header = html.match(/<header[\s\S]*?<\/header>/)[0];
  assert.match(header, /id="menu-open"/);
  assert.ok(header.indexOf('id="mode"') < header.indexOf('id="menu-open"'), 'menu sits right of Broadcast / Receive');
  const dock = html.match(/<nav class="dock"[\s\S]*?<\/nav>/)[0];
  for (const id of ['translator-open', 'options-trigger', 'log-open']) assert.match(dock, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html.match(/<div class="transcript-actions">[\s\S]*?<\/div>/)[0], /log-open/, 'Log left the message card');
  const sending = html.match(/<dialog id="options-panel"[\s\S]*?<\/dialog>/)[0];
  for (const needle of ['id="speed"', 'data-dropdown="flash-color"']) assert.ok(sending.includes(needle), needle);
  assert.doesNotMatch(sending, /data-action="tone"/, 'sound is an app setting, not a sending one');
  const menu = html.match(/<dialog id="menu-panel"[\s\S]*?<\/dialog>/)[0];
  for (const needle of ['data-segmented="mode"', 'data-dropdown="accent"', 'data-action="tone"', 'data-action="haptics"',
    'data-action="keep-awake"', 'data-show-flash-warning', 'href="privacy"', 'discord.gg']) assert.ok(menu.includes(needle), needle);
  assert.doesNotMatch(menu, /received-log|RECEIVED LOG/i, 'the log is not buried in settings');
});
