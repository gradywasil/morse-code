import test from 'node:test';
import assert from 'node:assert/strict';
import { FLASH_COLORS, MIN_FLASH_LUMA, DEFAULT_FLASH_COLOR_ID, lumaOfHex, flashColorById } from '../js/flash-color.js';
import { createScreenChannel } from '../js/screen.js';

test('white stays the default and ids are unique', () => {
  assert.equal(FLASH_COLORS[0].id, DEFAULT_FLASH_COLOR_ID);
  assert.equal(flashColorById('WHITE').hex, '#ffffff');
  assert.equal(new Set(FLASH_COLORS.map((c) => c.id)).size, FLASH_COLORS.length);
});

test('every colour stays bright enough for the receiver, which reads luma', () => {
  for (const { id, hex } of FLASH_COLORS) {
    assert.match(hex, /^#[0-9a-f]{6}$/);
    assert.ok(lumaOfHex(hex) >= MIN_FLASH_LUMA, `${id} luma ${lumaOfHex(hex).toFixed(0)} < ${MIN_FLASH_LUMA}`);
  }
});

test('no red-dominant colour is ever offered (saturated-red flashing is its own WCAG hazard)', () => {
  for (const { id, hex } of FLASH_COLORS) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    assert.ok(r / (r + g + b) < 0.5, `${id} is red-dominant`);
  }
  // Plain blue and red fail the luma floor too, so the receiver rule excludes them.
  assert.ok(lumaOfHex('#0000ff') < MIN_FLASH_LUMA);
  assert.ok(lumaOfHex('#ff0000') < MIN_FLASH_LUMA);
});

test('an unknown or tampered id falls back to white', () => {
  assert.equal(flashColorById('RED').id, 'WHITE');
  assert.equal(flashColorById(null).id, 'WHITE');
});

function fakeDoc() {
  const style = { props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; } };
  const el = { style, classList: { add() {}, remove() {}, contains: () => false }, setAttribute() {}, remove() {} };
  return { el, doc: {
    createElement: () => el, getElementById: () => null, documentElement: {},
    body: { appendChild() {} }, head: { appendChild() {} }, addEventListener() {},
  } };
}

test('the screen channel paints the chosen colour on the overlay, before or after attach', async () => {
  const { el, doc } = fakeDoc();
  const channel = createScreenChannel({ doc, raf: () => 1, caf() {}, fullscreen: false });
  channel.setColor('#ffc040');
  await channel.attach();
  assert.equal(el.style.props['--mcb-flash-color'], '#ffc040');
  channel.setColor(null);
  assert.equal(el.style.props['--mcb-flash-color'], undefined);
  assert.throws(() => channel.setColor('red'), TypeError);
  assert.throws(() => channel.setColor('#fff'), TypeError);
});
