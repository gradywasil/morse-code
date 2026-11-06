import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceivedLog, LOG_KEY, LOG_LIMIT, LOG_TEXT_LIMIT } from '../js/received-log.js';
import { createDeviceStore } from '../js/device-store.js';

const clock = () => { let t = 1_000; return () => (t += 1000); };

test('messages are filed newest first and read back as copies', () => {
  const log = createReceivedLog({ store: createDeviceStore(), now: clock() });
  log.add({ text: 'FIRST' });
  log.add({ text: 'SECOND', partial: true });
  const [a, b] = log.list();
  assert.equal(a.text, 'SECOND');
  assert.equal(a.partial, true);
  assert.equal(b.text, 'FIRST');
  a.text = 'tampered';
  assert.equal(log.list()[0].text, 'SECOND');
});

test('nothing heard is not a message', () => {
  const log = createReceivedLog({ store: createDeviceStore() });
  assert.equal(log.add({ text: '   ' }), null);
  assert.equal(log.count(), 0);
});

test('delete one, clear all, and subscribers hear each change', () => {
  const log = createReceivedLog({ store: createDeviceStore(), now: clock() });
  let changes = 0;
  const off = log.onChange(() => { changes += 1; });
  const keep = log.add({ text: 'KEEP' });
  const drop = log.add({ text: 'DROP' });
  assert.equal(log.remove(drop.id), true);
  assert.equal(log.remove('nope'), false);
  assert.deepEqual(log.list().map((e) => e.id), [keep.id]);
  log.clear();
  assert.equal(log.count(), 0);
  assert.equal(changes, 4);
  off();
  log.add({ text: 'AGAIN' });
  assert.equal(changes, 4);
});

test('the log is bounded: oldest messages fall off, long text is cut', () => {
  const log = createReceivedLog({ store: createDeviceStore(), now: clock() });
  for (let i = 0; i < LOG_LIMIT + 5; i++) log.add({ text: `M${i}` });
  assert.equal(log.count(), LOG_LIMIT);
  assert.equal(log.list()[0].text, `M${LOG_LIMIT + 4}`);
  assert.equal(log.add({ text: 'X'.repeat(LOG_TEXT_LIMIT + 50) }).text.length, LOG_TEXT_LIMIT);
});

test('a persistent store carries the log to the next launch', () => {
  const backing = new Map();
  const store = { persistent: true, get: (k) => backing.get(k) ?? null, set: (k, v) => backing.set(k, v) };
  createReceivedLog({ store, now: clock() }).add({ text: 'KEPT' });
  const next = createReceivedLog({ store });
  assert.equal(next.persistent, true);
  assert.equal(next.list()[0].text, 'KEPT');
  next.add({ text: 'NEWER' });
  assert.deepEqual(next.list().map((e) => e.text), ['NEWER', 'KEPT']);
});

test('the web store forgets: a fresh store starts empty', () => {
  const web = createDeviceStore();
  assert.equal(web.persistent, false);
  createReceivedLog({ store: web }).add({ text: 'GONE' });
  assert.equal(createReceivedLog({ store: createDeviceStore() }).count(), 0);
});

test('damaged or hostile stored data is ignored, not trusted', () => {
  for (const raw of ['not json', '{"a":1}', '[1,"x",null]', '[{"id":"a","at":"now","text":"x"}]', '[{"id":"a","at":1,"text":"  "}]']) {
    const store = { persistent: true, get: () => raw, set() {} };
    assert.equal(createReceivedLog({ store }).count(), 0, raw);
  }
  const store = { persistent: true, get: () => JSON.stringify([
    { id: 'a', at: 5, text: 'GOOD' }, { id: 'a', at: 6, text: 'DUPLICATE ID' },
    { id: 'b', at: 7, text: 'OK', partial: 'yes' },
  ]), set() {} };
  const entries = createReceivedLog({ store }).list();
  assert.deepEqual(entries.map((e) => [e.id, e.partial]), [['a', false], ['b', false]]);
});

test('a store that refuses to write does not break the in-memory log', () => {
  const store = { persistent: true, get: () => null, set() { throw new Error('quota'); } };
  const log = createReceivedLog({ store });
  assert.doesNotThrow(() => log.add({ text: 'STILL HERE' }));
  assert.equal(log.list()[0].text, 'STILL HERE');
  assert.equal(typeof LOG_KEY, 'string');
});
