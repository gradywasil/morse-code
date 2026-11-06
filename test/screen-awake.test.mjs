import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenAwake } from '../js/screen-awake.js';

function rig({ supported = true, refuse = false } = {}) {
  const handlers = {};
  const doc = { visibilityState: 'visible', addEventListener: (type, fn) => { handlers[type] = fn; } };
  const locks = [];
  const nav = supported ? { wakeLock: { request: async () => {
    if (refuse) throw new Error('refused');
    const listeners = [];
    const lock = {
      released: false,
      addEventListener: (_type, fn) => listeners.push(fn),
      async release() { lock.released = true; listeners.forEach((fn) => fn()); },
    };
    locks.push(lock);
    return lock;
  } } } : {};
  return { doc, nav, locks, handlers, awake: createScreenAwake({ nav, doc }) };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('holds the screen while wanted and lets go when the run ends', async () => {
  const { awake, locks } = rig();
  awake.set(true);
  await settle();
  assert.equal(awake.isHeld(), true);
  awake.set(true); // idempotent: no second lock
  await settle();
  assert.equal(locks.length, 1);
  awake.set(false);
  assert.equal(awake.isHeld(), false);
  assert.equal(locks[0].released, true);
});

test('the browser drops the lock when the page hides; it is re-taken on return while still wanted', async () => {
  const { awake, locks, doc, handlers } = rig();
  awake.set(true);
  await settle();
  await locks[0].release(); // the browser's own release on hide
  doc.visibilityState = 'hidden';
  handlers.visibilitychange();
  await settle();
  assert.equal(awake.isHeld(), false);
  doc.visibilityState = 'visible';
  handlers.visibilitychange();
  await settle();
  assert.equal(awake.isHeld(), true);
  assert.equal(locks.length, 2);
});

test('a run that ends while the request is in flight does not leave the screen held', async () => {
  const { awake, locks } = rig();
  awake.set(true);
  awake.set(false);
  await settle();
  assert.equal(awake.isHeld(), false);
  assert.ok(locks.every((lock) => lock.released));
});

test('no wake lock support, or a refusal, is silent: the app simply may sleep', async () => {
  for (const options of [{ supported: false }, { refuse: true }]) {
    const { awake } = rig(options);
    assert.doesNotThrow(() => awake.set(true));
    await settle();
    assert.equal(awake.isHeld(), false);
    assert.doesNotThrow(() => awake.set(false));
  }
});

test('nothing is requested for a hidden page', async () => {
  const { awake, doc, locks } = rig();
  doc.visibilityState = 'hidden';
  awake.set(true);
  await settle();
  assert.equal(locks.length, 0);
});
