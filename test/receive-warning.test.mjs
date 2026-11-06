import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COPY } from '../js/copy.js';

const plateOf = (html) => html.match(/<aside[^>]*id="why-camera-receive"[\s\S]*?<\/aside>/)[0];

test('the receiver sees the flashing-light caution on the camera plate, before the camera opens', () => {
  const plate = plateOf(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
  assert.ok(plate.includes(COPY.receive.hazard.title));
  assert.ok(plate.includes(COPY.receive.hazard.imperative));
  assert.ok(plate.includes(COPY.receive.hazard.advisory.replace("'", "'")));
  assert.match(plate, /role="img"/, 'the warning pictogram is present');
  assert.ok(plate.indexOf('DO NOT WATCH') < plate.indexOf('data-action="begin-listening"'), 'caution precedes the button');
  assert.match(COPY.receive.hazard.imperative, /^DO NOT WATCH.*SEIZURE/);
  assert.match(COPY.receive.hazard.advisory, /photosensitive/i);
  assert.match(COPY.receive.whyCamera.proceed, /ACKNOWLEDGE/);
});

// A minimal page for the native onboarding module.
function pageRig(initialState) {
  const clicks = [];
  const listeners = {};
  const buttons = {};
  const checkbox = { checked: false };
  const plate = { querySelector: (sel) => (sel === '.native-warning-choice input' ? checkbox : null) };
  const doc = {
    body: { dataset: { state: initialState } },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    querySelector: (sel) => {
      const match = sel.match(/data-action="([^"]+)"/);
      if (!match) return null;
      return buttons[match[1]] ??= { click: () => { clicks.push(match[1]); } };
    },
  };
  const click = (action) => listeners.click({ target: { closest: (sel) => (sel.includes(`"${action}"`) ? { closest: () => plate } : (sel === 'aside' ? plate : null)) } });
  return { doc, clicks, checkbox, click };
}

async function loadOnboarding() {
  let observed;
  globalThis.MutationObserver = class { constructor(fn) { observed = fn; } observe() {} };
  const { installNativeOnboarding } = await import('../native/web/js/native-onboarding.js');
  return { installNativeOnboarding, fire: () => observed() };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const hardware = { prepareCamera: () => Promise.resolve() };
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };

test('native: the receive plate waits for the receiver to read the caution', async () => {
  const { installNativeOnboarding, fire } = await loadOnboarding();
  const rig = pageRig('receive-preflight');
  installNativeOnboarding(hardware, rig.doc, memory());
  await tick(); fire(); await tick();
  assert.deepEqual(rig.clicks, [], 'the camera must not start itself before the warning is read');
});

test('native: reading the caution once covers both directions for the session', async () => {
  const { installNativeOnboarding, fire } = await loadOnboarding();
  const rig = pageRig('receive-preflight');
  installNativeOnboarding(hardware, rig.doc, memory());
  rig.click('begin-listening');
  rig.doc.body.dataset.state = 'preflight';
  fire(); await tick();
  assert.ok(rig.clicks.includes('ack'), 'the broadcast plate no longer re-asks in the same session');
});

test('native: "don’t show again" saves one preference that skips both plates next time', async () => {
  const { installNativeOnboarding, fire } = await loadOnboarding();
  const storage = memory();
  const first = pageRig('receive-preflight');
  installNativeOnboarding(hardware, first.doc, storage);
  first.checkbox.checked = true;
  first.click('begin-listening');
  assert.equal(storage.getItem('morse.hide-flash-warning.v1'), 'yes');

  const next = pageRig('receive-preflight');
  installNativeOnboarding(hardware, next.doc, storage);
  await tick(); fire(); await tick();
  assert.ok(next.clicks.includes('begin-listening'));
});

