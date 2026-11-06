import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { logoSvg, logoColors, logoDataUrl, LOGO_VARS } from '../js/logo.js';
import { ACCENTS, BASE_DARK, buildTokens, contrastRatio } from '../js/themes.js';

test('the default logo is exactly the shipped favicon, so the default look does not change', () => {
  const colors = logoColors('dark', BASE_DARK);
  assert.deepEqual(colors, { plate: '#171008', tape: '#e2d3a8', rim: '#2b2013', lamp: '#ffb454' });
  const svg = logoSvg(colors);
  const favicon = readFileSync(new URL('../favicon.svg', import.meta.url), 'utf8');
  for (const hex of Object.values(colors)) {
    assert.ok(favicon.toLowerCase().includes(hex), `favicon.svg uses ${hex}`);
    assert.ok(svg.includes(hex), `the drawn logo uses ${hex}`);
  }
  // Same geometry: six sprocket holes, two punched dashes, one lamp jewel.
  assert.equal(svg.match(/r="1.8"/g).length, 6);
  assert.equal(svg.match(/rx="3.5"/g).length, 2);
  assert.match(svg, /r="3.2"/);
});

test('the in-page mark is drawn from CSS variables, so it recolours with the theme', () => {
  const svg = logoSvg(LOGO_VARS, 'brand');
  for (const v of Object.values(LOGO_VARS)) assert.ok(svg.includes(v), v);
  assert.doesNotMatch(svg, /#[0-9a-f]{6}/i, 'no hard-coded colour in the live mark');
  assert.match(svg, /id="brand-plate"/);
  assert.match(svg, /url\(#brand-plate\)/);
});

test('every mode and accent gives a legible mark: tape against plate, lamp against plate', () => {
  const combos = [['dark', 'amber'], ['contrast', 'amber']];
  for (const mode of ['light', 'dark']) for (const accent of ACCENTS) combos.push([mode, accent.id]);
  for (const [mode, accentId] of combos) {
    const c = logoColors(mode, { ...BASE_DARK, ...buildTokens(mode, accentId) });
    assert.ok(contrastRatio(c.tape, c.plate) >= 3, `${mode}/${accentId} tape vs plate ${contrastRatio(c.tape, c.plate).toFixed(2)}`);
    assert.ok(contrastRatio(c.lamp, c.plate) >= 3, `${mode}/${accentId} lamp vs plate ${contrastRatio(c.lamp, c.plate).toFixed(2)}`);
  }
});

test('the accent reaches the logo: a blue theme gives a blue lamp jewel', () => {
  const amber = logoColors('dark', { ...BASE_DARK, ...buildTokens('dark', 'amber') });
  const blue = logoColors('dark', { ...BASE_DARK, ...buildTokens('dark', 'blue') });
  assert.notEqual(amber.lamp, blue.lamp);
  assert.notEqual(amber.plate, blue.plate);
});

test('the tab icon is a self-contained data URL', () => {
  const url = logoDataUrl(logoColors('light', { ...BASE_DARK, ...buildTokens('light', 'rose') }));
  assert.match(url, /^data:image\/svg\+xml,%3Csvg/);
  assert.doesNotMatch(decodeURIComponent(url), /var\(--/);
});
