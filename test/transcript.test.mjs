import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const transcriptCode = source.slice(source.indexOf('const receivedText ='), source.indexOf('// -- receive state'));
function makeTranscript() {
  let canonicalText = '';
  const handlers = {};
  const text = {
    dataset: {}, scrollTop: 0, scrollHeight: 400, clientHeight: 100,
    firstChild: { data: '', appendData(value) { this.data += value; } },
    set textContent(value) { this.firstChild = { data: value, appendData(extra) { this.data += extra; } }; },
    get textContent() { return this.firstChild.data; },
    addEventListener(type, handler) { handlers[type] = handler; },
  };
  const latest = { hidden: true, addEventListener(type, handler) { handlers.latest = handler; } };
  const copy = { disabled: true };
  const context = vm.createContext({
    $: selector => selector === '#received-text' ? text : selector === '#transcript-latest' ? latest : copy,
    queueMicrotask, sessionTextNow: () => canonicalText,
  });
  vm.runInContext(transcriptCode, context);
  return { text, latest, copy, handlers, update: async value => {
    canonicalText = value;
    context.requestTranscript();
    await Promise.resolve();
  } };
}

test('transcript reads canonical text, enables copying, and clears for a new listen', async () => {
  const rig = makeTranscript();
  await rig.update('HELLO ROOM');
  assert.equal(rig.text.textContent, 'HELLO ROOM');
  assert.equal(rig.text.dataset.empty, 'false');
  assert.equal(rig.copy.disabled, false);
  await rig.update('');
  assert.equal(rig.text.textContent, 'Decoded letters appear here.');
  assert.equal(rig.copy.disabled, true);
});

test('reading back preserves scroll and the selectable text node until Latest is pressed', async () => {
  const rig = makeTranscript();
  await rig.update('HELLO');
  assert.equal(rig.text.scrollTop, 400);
  const node = rig.text.firstChild;
  rig.text.scrollTop = 0;
  rig.handlers.scroll();
  await rig.update('HELLO ROOM');
  assert.equal(rig.text.scrollTop, 0);
  assert.strictEqual(rig.text.firstChild, node);
  assert.equal(rig.latest.hidden, false);
  rig.handlers.latest();
  assert.equal(rig.text.scrollTop, 400);
  assert.equal(rig.latest.hidden, true);
});
