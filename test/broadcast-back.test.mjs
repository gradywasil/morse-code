import test from 'node:test';
import assert from 'node:assert/strict';
import { createBroadcastBack } from '../js/broadcast-back.js';

function setup() {
  const target = new EventTarget();
  const calls = { push: 0, back: 0, exitBroadcast: 0 };
  const history = {
    state: { existing: true },
    pushState(state) { assert.deepEqual(state, this.state); calls.push++; },
    back() { calls.back++; },
  };
  const guard = createBroadcastBack({
    history, target, onBack: () => calls.exitBroadcast++,
  });
  return { guard, calls, pop: () => target.dispatchEvent(new Event('popstate')) };
}

test('one Back leaves the broadcast; another remains normal browser navigation', () => {
  const { guard, calls, pop } = setup();
  guard.setActive(true);
  guard.setActive(true); // pause/resume must not add entries
  pop();
  assert.deepEqual(calls, { push: 1, back: 0, exitBroadcast: 1 });
  guard.setActive(false);
  pop();
  assert.equal(calls.exitBroadcast, 1);
});

test('normal completion removes the temporary entry without invoking Back cleanup', () => {
  const { guard, calls, pop } = setup();
  for (let i = 0; i < 3; i++) {
    guard.setActive(true);
    guard.setActive(false);
    guard.setActive(false);
    pop();
  }
  assert.deepEqual(calls, { push: 3, back: 3, exitBroadcast: 0 });
});

test('a replay started before asynchronous history cleanup gets a fresh Back step', () => {
  const { guard, calls, pop } = setup();
  guard.setActive(true);
  guard.setActive(false);
  guard.setActive(true);
  assert.equal(calls.push, 1);
  pop();
  assert.equal(calls.push, 2);
  pop();
  assert.equal(calls.exitBroadcast, 1);
});
