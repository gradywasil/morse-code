// test/receive-states.test.mjs — T-S1 acceptance (run-2 plan).
//
// The receive machine's journeys, dead-end recovery, exhaustive
// event×state probes, and the additive-only guarantee for the broadcast
// machine (its tables are pinned by the v1 states suite, which must stay
// green — the last test re-runs that guarantee structurally).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RECEIVE_STATES, RECEIVE_STATE_LIST, RECEIVE_EVENTS, RECEIVE_EFFECTS,
  RECEIVE_TRANSITIONS, createReceiveMachine, STATES, STATE_LIST, createStateMachine,
} from '../js/states.js';

function drive(machine, events) {
  const changes = [];
  machine.addEventListener('change', (c) => changes.push(c));
  for (const [type, payload] of events) machine.dispatch(type, payload);
  return changes;
}

test('full happy journey: idle → preflight → arming → armed → active → done', () => {
  const m = createReceiveMachine();
  const changes = drive(m, [
    [RECEIVE_EVENTS.REQUEST_RECEIVE],
    [RECEIVE_EVENTS.ACK],
    [RECEIVE_EVENTS.WATCHER_GRANTED],
    [RECEIVE_EVENTS.HEARING],
    [RECEIVE_EVENTS.AUTO_COMPLETE, { partial: false }],
  ]);
  assert.deepEqual(changes.map((c) => c.to), [
    RECEIVE_STATES.PREFLIGHT, RECEIVE_STATES.ARMING, RECEIVE_STATES.ARMED,
    RECEIVE_STATES.ACTIVE, RECEIVE_STATES.DONE,
  ]);
  assert.deepEqual(changes[0].effects, [RECEIVE_EFFECTS.NOTICE_REQUIRED]);
  // The camera releases on EXIT rows (stop/auto-complete), never on entry.
  const stopRow = changes.find((c) => c.via === RECEIVE_EVENTS.AUTO_COMPLETE);
  assert.deepEqual(stopRow.effects, [RECEIVE_EFFECTS.RELEASE_CAMERA]);
  assert.deepEqual(changes.find((c) => c.via === RECEIVE_EVENTS.WATCHER_GRANTED).effects, []);
  const snap = m.snapshot();
  assert.equal(snap.doneSource, 'silence');
  assert.equal(snap.donePartial, false);
});

test('why-camera plate precedes the camera; cancel exits clean from preflight', () => {
  const m = createReceiveMachine();
  const changes = drive(m, [
    [RECEIVE_EVENTS.REQUEST_RECEIVE],
    [RECEIVE_EVENTS.CANCEL],
  ]);
  assert.deepEqual(changes.map((c) => c.to), [RECEIVE_STATES.PREFLIGHT, RECEIVE_STATES.IDLE]);
  assert.equal(m.state, RECEIVE_STATES.IDLE);
});

test('denied journey: honest outcome recorded, retry re-arms, reset returns', () => {
  const m = createReceiveMachine();
  drive(m, [
    [RECEIVE_EVENTS.REQUEST_RECEIVE],
    [RECEIVE_EVENTS.ACK],
    [RECEIVE_EVENTS.WATCHER_DENIED, { outcome: 'permission-denied' }],
  ]);
  assert.equal(m.state, RECEIVE_STATES.DENIED);
  assert.equal(m.snapshot().outcome, 'permission-denied');
  m.dispatch(RECEIVE_EVENTS.RETRY_ARM);
  assert.equal(m.state, RECEIVE_STATES.ARMING);
  m.dispatch(RECEIVE_EVENTS.WATCHER_GRANTED);
  m.dispatch(RECEIVE_EVENTS.RESET);
  assert.equal(m.state, RECEIVE_STATES.IDLE);
  assert.equal(m.snapshot().outcome, null, 'context reset on re-entry'); // re-arm from idle below
});

test('unsupported journey (insecure / no camera) with retry + reset', () => {
  const m = createReceiveMachine();
  drive(m, [
    [RECEIVE_EVENTS.REQUEST_RECEIVE],
    [RECEIVE_EVENTS.ACK],
    [RECEIVE_EVENTS.WATCHER_FAILED, { outcome: 'insecure' }],
  ]);
  assert.equal(m.state, RECEIVE_STATES.UNSUPPORTED);
  assert.equal(m.snapshot().outcome, 'insecure');
  m.dispatch(RECEIVE_EVENTS.RESET);
  assert.equal(m.state, RECEIVE_STATES.IDLE);
});

test('stop from armed (nothing heard) marks the honest partial record', () => {
  const m = createReceiveMachine();
  drive(m, [
    [RECEIVE_EVENTS.REQUEST_RECEIVE],
    [RECEIVE_EVENTS.ACK],
    [RECEIVE_EVENTS.WATCHER_GRANTED],
    [RECEIVE_EVENTS.STOP],
  ]);
  const snap = m.snapshot();
  assert.equal(snap.doneSource, 'stop');
  assert.equal(snap.donePartial, true);
  m.dispatch(RECEIVE_EVENTS.RESET);
  assert.equal(m.state, RECEIVE_STATES.IDLE);
});

test('camera lost mid-listen → error, release effect fired, reset recovers', () => {
  for (const source of [RECEIVE_STATES.ARMED, RECEIVE_STATES.ACTIVE]) {
    const m = createReceiveMachine();
    const releases = [];
    m.addEventListener(RECEIVE_EFFECTS.RELEASE_CAMERA, () => releases.push(1));
    drive(m, [
      [RECEIVE_EVENTS.REQUEST_RECEIVE],
      [RECEIVE_EVENTS.ACK],
      [RECEIVE_EVENTS.WATCHER_GRANTED],
      ...(source === RECEIVE_STATES.ACTIVE ? [[RECEIVE_EVENTS.HEARING]] : []),
      [RECEIVE_EVENTS.CAMERA_LOST, { reason: 'ended' }],
    ]);
    assert.equal(m.state, RECEIVE_STATES.ERROR);
    assert.equal(m.snapshot().error.reason, 'ended');
    assert.equal(releases.length, 1);
    m.dispatch(RECEIVE_EVENTS.RESET);
    assert.equal(m.state, RECEIVE_STATES.IDLE);
  }
});

test('no dead ends: every state returns to idle within 3 hops (table BFS)', () => {
  const successors = (state) => Object.values(RECEIVE_TRANSITIONS[state] ?? {})
    .map((row) => row.to);
  for (const start of RECEIVE_STATE_LIST) {
    const seen = new Set([start]);
    let frontier = [start];
    for (let hop = 1; hop <= 3; hop++) {
      frontier = frontier.flatMap(successors).filter((s) => !seen.has(s) && seen.add(s));
    }
    assert.ok(seen.has(RECEIVE_STATES.IDLE), `${start} must reach idle within 3 hops`);
  }
  // And the table covers every listed state.
  for (const state of RECEIVE_STATE_LIST) {
    assert.ok(RECEIVE_TRANSITIONS[state] !== undefined, `${state} has a table section`);
  }
});

test('exhaustive event×state probes: known-wrong-state is a soft rejection', () => {
  const EVENTS = Object.values(RECEIVE_EVENTS);
  // Path to each state from the table (BFS predecessors).
  const pathTo = (target) => {
    const queue = [[RECEIVE_STATES.IDLE, []]];
    const seen = new Set([RECEIVE_STATES.IDLE]);
    while (queue.length) {
      const [state, path] = queue.shift();
      if (state === target) return path;
      for (const [ev, row] of Object.entries(RECEIVE_TRANSITIONS[state] ?? {})) {
        const to = row.to;
        if (!seen.has(to)) { seen.add(to); queue.push([to, [...path, ev]]); }
      }
    }
    return null;
  };
  for (const state of RECEIVE_STATE_LIST) {
    const path = pathTo(state);
    assert.ok(path !== null, `${state} reachable`);
    for (const ev of EVENTS) {
      const m = createReceiveMachine();
      for (const step of path) m.dispatch(step);
      assert.equal(m.state, state);
      const changes = [];
      const invalids = [];
      m.addEventListener('change', (c) => changes.push(c));
      m.addEventListener('invalid', (i) => invalids.push(i));
      const r = m.dispatch(ev);
      assert.equal(typeof r.accepted, 'boolean');
      if (!r.accepted) {
        assert.equal(invalids.length, 1);
        assert.equal(m.state, state, 'soft rejection changes nothing');
        assert.equal(changes.length, 0);
      }
    }
  }
});

test('unknown event names throw TypeError (wiring bug discipline)', () => {
  const m = createReceiveMachine();
  assert.throws(() => m.dispatch('nonsense'), TypeError);
  assert.throws(() => m.dispatch(42), TypeError);
});

test('additive-only: the broadcast machine is untouched and still works', () => {
  // The v1 suite pins TRANSITIONS exhaustively; here we structurally
  // confirm the broadcast surface is unchanged in shape and behavior.
  assert.equal(STATE_LIST.length, 15);
  assert.equal(Object.keys(STATES).length, 15);
  const m = createStateMachine();
  assert.equal(m.state(), STATES.IDLE);
  const r = m.dispatch('request-broadcast');
  assert.equal(r.accepted, true);
  assert.equal(m.state(), STATES.PREFLIGHT);
});

test('frozen tables and lists', () => {
  for (const frozen of [RECEIVE_STATES, RECEIVE_STATE_LIST, RECEIVE_EVENTS, RECEIVE_EFFECTS]) {
    assert.ok(Object.isFrozen(frozen));
  }
});
