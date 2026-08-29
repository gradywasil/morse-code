// test/states.test.mjs — F8 validation (headless: the machine IS pure).
// Run: `node --test test/states.test.mjs`
//
// js/states.js has no DOM, no timers, no promises — dispatch is
// synchronous — so everything is checkable directly. Coverage:
//   - the permission×support matrix, EVERY cell (4×4 literal expected
//     table) + the runtime carriers that land in each target state
//   - the F3 glue: fallback-reason → support mapping and the exact
//     acquire()-result → event translation
//   - the full user journeys (cold open torch, cold open screen, no-torch
//     after grant, denied → offer/retry/reset, mid-broadcast takeover,
//     manual switch, pause/resume, stop, replay after done, error
//     recovery, cancel paths)
//   - the ENTIRE transition table: every (state-variant × event) cell —
//     defined cells accept and land, undefined cells reject softly
//   - no dead ends / recovery paths; channel-state invariants; a seeded
//     random event storm (fuzz) that never leaves the invariant set
//   - dispatch/emitter semantics (soft race rejection vs TypeError wiring
//     bugs, frozen results/snapshots, listener isolation) and a source
//     purity scan (no DOM/timer/storage tokens, one import: torch.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  STATES,
  STATE_LIST,
  STATE_EVENTS,
  STATE_EFFECTS,
  TRANSITIONS,
  ARM_SUPPORT,
  ARM_PERMISSION,
  ARM_MATRIX,
  ARM_MEDIUMS,
  ARM_FRAMINGS,
  resolveArmMatrix,
  SUPPORT_BY_FALLBACK_REASON,
  eventFromTorchResult,
  createStateMachine,
} from '../js/states.js';
import {
  TORCH_FALLBACK_REASONS,
  TORCH_ERROR_CODES,
  TORCH_OUTCOMES,
} from '../js/torch.js';

const E = STATE_EVENTS;

// ---------------------------------------------------------------------------
// Expected table (hand-written from the plan/brief, INDEPENDENT of the
// module's TRANSITIONS — the consistency test cross-checks the two).

/** Events defined per state (the machine's whole behavior, as documented). */
const EXPECTED_DEFINED = {
  idle: ['request-broadcast'],
  preflight: ['ack', 'cancel'],
  arming: ['permission-prompted', 'torch-acquired', 'torch-permission-denied', 'torch-unsupported', 'torch-error'],
  'awaiting-permission': ['permission-granted', 'torch-acquired', 'torch-permission-denied', 'torch-unsupported', 'torch-error'],
  'permission-denied': ['accept-screen', 'retry-arm', 'reset'],
  unsupported: ['accept-screen', 'retry-arm', 'reset'],
  'torch-ready': ['go', 'switch-channel', 'reset'],
  'screen-mode': ['go', 'reset'],
  ready: ['go', 'cancel'],
  broadcasting: ['pause', 'torch-lost', 'switch-channel', 'stop', 'broadcast-complete', 'broadcast-failed'],
  'broadcasting-on-screen': ['pause', 'stop', 'broadcast-complete', 'broadcast-failed'],
  paused: ['resume', 'torch-lost', 'switch-channel', 'stop', 'reset'],
  'paused-on-screen': ['resume', 'stop', 'reset'],
  done: ['replay', 'reset'],
  error: ['retry-arm', 'replay', 'reset'],
};

/** The permission×support matrix as an independent literal. */
const EXPECTED_MATRIX = {
  torch: {
    granted: { state: 'torch-ready', medium: 'torch', framing: 'torch', offerScreen: false, prompts: false },
    denied: { state: 'permission-denied', medium: null, framing: 'denied-offer-screen', offerScreen: true, prompts: true },
    'prompt-pending': { state: 'awaiting-permission', medium: null, framing: 'why-camera', offerScreen: false, prompts: true },
    'not-asked': { state: 'arming', medium: null, framing: 'arming', offerScreen: false, prompts: true },
  },
  'no-torch': {
    granted: { state: 'unsupported', medium: 'screen', framing: 'screen-positive', offerScreen: false, prompts: false },
    denied: { state: 'permission-denied', medium: null, framing: 'denied-offer-screen', offerScreen: true, prompts: true },
    'prompt-pending': { state: 'awaiting-permission', medium: null, framing: 'why-camera', offerScreen: false, prompts: true },
    'not-asked': { state: 'unsupported', medium: 'screen', framing: 'screen-positive', offerScreen: false, prompts: false },
  },
  'no-camera': {
    granted: { state: 'unsupported', medium: 'screen', framing: 'screen-positive', offerScreen: false, prompts: false },
    denied: { state: 'permission-denied', medium: null, framing: 'denied-offer-screen', offerScreen: true, prompts: true },
    'prompt-pending': { state: 'unsupported', medium: 'screen', framing: 'screen-positive', offerScreen: false, prompts: false },
    'not-asked': { state: 'unsupported', medium: 'screen', framing: 'screen-positive', offerScreen: false, prompts: false },
  },
  'insecure-context': {
    granted: { state: 'unsupported', medium: 'screen', framing: 'screen-positive', offerScreen: false, prompts: false },
    denied: { state: 'unsupported', medium: 'screen', framing: 'screen-positive', offerScreen: false, prompts: false },
    'prompt-pending': { state: 'unsupported', medium: 'screen', framing: 'screen-positive', offerScreen: false, prompts: false },
    'not-asked': { state: 'unsupported', medium: 'screen', framing: 'screen-positive', offerScreen: false, prompts: false },
  },
};

/** Which context.channel values are legal per state (the channel-flavor
 *  invariant the fuzz asserts after every dispatch). */
const ALLOWED_CHANNELS = {
  idle: [null],
  preflight: [null],
  arming: [null],
  'awaiting-permission': [null],
  'permission-denied': [null],
  unsupported: [null],
  'torch-ready': ['torch'],
  'screen-mode': ['screen'],
  ready: ['torch', 'screen'],
  broadcasting: ['torch'],
  'broadcasting-on-screen': ['screen'],
  paused: ['torch'],
  'paused-on-screen': ['screen'],
  done: [null, 'screen'],
  error: [null, 'screen'],
};

// ---------------------------------------------------------------------------
// Journey helpers

/** Record every emitted event (name + payload) for assertions. */
function instrument(mach) {
  const events = [];
  mach.addEventListener('change', (p) => events.push(['change', p]));
  mach.addEventListener('invalid', (p) => events.push(['invalid', p]));
  for (const name of Object.values(STATE_EFFECTS)) {
    mach.addEventListener(name, (p) => events.push([name, p]));
  }
  return {
    events,
    changes: () => events.filter((e) => e[0] === 'change').map((e) => e[1]),
    states: () => events.filter((e) => e[0] === 'change').map((e) => e[1].to),
    vias: () => events.filter((e) => e[0] === 'change').map((e) => e[1].via),
    effects: () => events.filter((e) => e[0] !== 'change' && e[0] !== 'invalid').map((e) => e[0]),
    invalids: () => events.filter((e) => e[0] === 'invalid').map((e) => e[1]),
  };
}

/** Canonical drive path per state VARIANT (context matters for the
 *  branching rows: ready / done / error). Each returns a fresh machine in
 *  that variant, instruments included. */
function reach(variant) {
  const mach = createStateMachine();
  const rec = instrument(mach);
  const fire = (type, payload) => {
    const r = mach.dispatch(type, payload);
    assert.equal(r.accepted, true, `reach(${variant}): ${type} rejected — ${JSON.stringify(r)}`);
  };
  const armTorch = () => {
    fire(E.REQUEST_BROADCAST);
    fire(E.ACK);
    fire(E.TORCH_ACQUIRED, { form: 'advanced' });
  };
  const armScreen = () => {
    fire(E.REQUEST_BROADCAST);
    fire(E.ACK);
    fire(E.TORCH_UNSUPPORTED, { support: 'no-torch', reason: 'no-torch-capability' });
    fire(E.ACCEPT_SCREEN);
  };
  const broadcastTorch = () => {
    armTorch();
    fire(E.GO);
    fire(E.GO);
  };
  const broadcastScreen = () => {
    armScreen();
    fire(E.GO);
    fire(E.GO);
  };
  switch (variant) {
    case 'idle': break;
    case 'preflight': fire(E.REQUEST_BROADCAST); break;
    case 'arming': fire(E.REQUEST_BROADCAST); fire(E.ACK); break;
    case 'awaiting-permission': fire(E.REQUEST_BROADCAST); fire(E.ACK); fire(E.PERMISSION_PROMPTED); break;
    case 'permission-denied':
      fire(E.REQUEST_BROADCAST); fire(E.ACK); fire(E.PERMISSION_PROMPTED);
      fire(E.TORCH_PERMISSION_DENIED, { reason: 'permission-denied', detail: 'NotAllowedError' });
      break;
    case 'unsupported':
      fire(E.REQUEST_BROADCAST); fire(E.ACK);
      fire(E.TORCH_UNSUPPORTED, { support: 'insecure-context', reason: 'insecure-context' });
      break;
    case 'torch-ready': armTorch(); break;
    case 'screen-mode': armScreen(); break;
    case 'ready:torch': armTorch(); fire(E.GO); break;
    case 'ready:screen': armScreen(); fire(E.GO); break;
    case 'broadcasting': broadcastTorch(); break;
    case 'broadcasting-on-screen:fresh': broadcastScreen(); break;
    case 'broadcasting-on-screen:takeover': broadcastTorch(); fire(E.TORCH_LOST, { code: TORCH_ERROR_CODES.TRACK_ENDED }); break;
    case 'paused': broadcastTorch(); fire(E.PAUSE); break;
    case 'paused-on-screen': broadcastScreen(); fire(E.PAUSE); break;
    case 'done:torch': broadcastTorch(); fire(E.BROADCAST_COMPLETE); break;
    case 'done:screen': broadcastScreen(); fire(E.BROADCAST_COMPLETE); break;
    case 'done:stopped': broadcastTorch(); fire(E.PAUSE); fire(E.STOP); break;
    case 'error:arm': fire(E.REQUEST_BROADCAST); fire(E.ACK); fire(E.TORCH_ERROR, { reason: TORCH_ERROR_CODES.INTERNAL }); break;
    case 'error:broadcast:torch': broadcastTorch(); fire(E.BROADCAST_FAILED, { reason: 'conductor' }); break;
    case 'error:broadcast:screen': broadcastScreen(); fire(E.BROADCAST_FAILED, { reason: 'conductor' }); break;
    default: throw new Error(`unknown reach variant ${variant}`);
  }
  return { mach, rec };
}

/** Every state variant used by the exhaustive-cell tests. */
const ALL_VARIANTS = [
  'idle', 'preflight', 'arming', 'awaiting-permission', 'permission-denied', 'unsupported',
  'torch-ready', 'screen-mode', 'ready:torch', 'ready:screen', 'broadcasting',
  'broadcasting-on-screen:fresh', 'broadcasting-on-screen:takeover', 'paused', 'paused-on-screen',
  'done:torch', 'done:screen', 'done:stopped', 'error:arm', 'error:broadcast:torch', 'error:broadcast:screen',
];

const VARIANT_STATE = {
  'ready:torch': 'ready', 'ready:screen': 'ready',
  'broadcasting-on-screen:fresh': 'broadcasting-on-screen',
  'broadcasting-on-screen:takeover': 'broadcasting-on-screen',
  'done:torch': 'done', 'done:screen': 'done', 'done:stopped': 'done',
  'error:arm': 'error', 'error:broadcast:torch': 'error', 'error:broadcast:screen': 'error',
};

function variantState(variant) {
  return VARIANT_STATE[variant] ?? variant;
}

// ---------------------------------------------------------------------------
// 1. Shape, constants, table integrity

describe('constants and table shape', () => {
  test('the fifteen committed states, unique, frozen, in lifecycle order', () => {
    assert.deepEqual(STATE_LIST, [
      'idle', 'preflight', 'arming', 'awaiting-permission', 'permission-denied', 'unsupported',
      'torch-ready', 'screen-mode', 'ready', 'broadcasting', 'broadcasting-on-screen',
      'paused', 'paused-on-screen', 'done', 'error',
    ]);
    assert.equal(new Set(STATE_LIST).size, STATE_LIST.length, 'state names must be unique');
    assert.deepEqual([...STATE_LIST], Object.values(STATES));
    assert.equal(Object.isFrozen(STATES), true);
    assert.equal(Object.isFrozen(STATE_LIST), true);
    assert.equal(Object.isFrozen(STATE_EVENTS), true);
    assert.equal(Object.isFrozen(STATE_EFFECTS), true);
    assert.equal(Object.isFrozen(TRANSITIONS), true);
    for (const row of Object.values(TRANSITIONS)) {
      assert.equal(Object.isFrozen(row), true);
      for (const cell of Object.values(row)) assert.equal(Object.isFrozen(cell), true);
    }
  });

  test('event/effect vocabularies are unique and non-empty', () => {
    const events = Object.values(STATE_EVENTS);
    assert.equal(new Set(events).size, events.length);
    assert.equal(events.length, 21);
    assert.deepEqual(Object.values(STATE_EFFECTS), ['notice-required', 'release-torch']);
  });

  test('TRANSITIONS matches the hand-written EXPECTED_DEFINED table exactly', () => {
    assert.deepEqual(Object.keys(TRANSITIONS).sort(), Object.keys(EXPECTED_DEFINED).sort());
    for (const [state, events] of Object.entries(EXPECTED_DEFINED)) {
      assert.deepEqual(
        Object.keys(TRANSITIONS[state]).sort(),
        [...events].sort(),
        `state ${state}: defined events diverge from the documented table`
      );
    }
  });

  test('every table target is a real state; every effect is a real effect', () => {
    const stateNames = new Set(STATE_LIST);
    const effectNames = new Set(Object.values(STATE_EFFECTS));
    for (const [state, row] of Object.entries(TRANSITIONS)) {
      assert.equal(stateNames.has(state), true, `unknown source state ${state}`);
      for (const [type, cell] of Object.entries(row)) {
        const targets = typeof cell.to === 'function'
          ? [cell.to({ channel: null }), cell.to({ channel: 'screen' }), cell.to({ channel: 'torch' })]
          : [cell.to];
        for (const t of targets) {
          if (t === undefined) continue; // branch function may not care
          assert.equal(stateNames.has(t), true, `${state} --${type}--> unknown target ${t}`);
        }
        const effects = typeof cell.effects === 'function'
          ? [...cell.effects({ channel: 'torch', hazardAcknowledged: true }),
             ...cell.effects({ channel: null, hazardAcknowledged: false })]
          : (cell.effects ?? []);
        for (const fx of effects) {
          assert.equal(effectNames.has(fx), true, `${state} --${type}--> unknown effect ${fx}`);
        }
      }
    }
  });

  test('cold open is idle with a fresh, frozen snapshot', () => {
    const mach = createStateMachine();
    assert.equal(mach.state(), 'idle');
    assert.deepEqual(mach.snapshot(), {
      state: 'idle', channel: null, hazardAcknowledged: false, noticePending: false,
      fallbackReason: null, fallbackDetail: null, takeover: null, doneReason: null, error: null,
    });
    assert.equal(Object.isFrozen(mach.snapshot()), true);
    assert.throws(() => { mach.snapshot().state = 'nope'; }, TypeError);
  });
});

// ---------------------------------------------------------------------------
// 2. The permission×support matrix — every cell

describe('permission×support matrix', () => {
  test('all 16 cells deep-equal the expected table (via resolveArmMatrix)', () => {
    for (const [support, permissions] of Object.entries(EXPECTED_MATRIX)) {
      for (const [permission, expected] of Object.entries(permissions)) {
        const cell = resolveArmMatrix({ support, permission });
        assert.deepEqual(cell, expected, `cell ${support}×${permission}`);
        assert.equal(Object.isFrozen(cell), true);
      }
    }
  });

  test('ARM_MATRIX data equals resolveArmMatrix lookups (single source)', () => {
    for (const support of Object.values(ARM_SUPPORT)) {
      for (const permission of Object.values(ARM_PERMISSION)) {
        assert.deepEqual(resolveArmMatrix({ support, permission }), ARM_MATRIX[support][permission]);
      }
    }
  });

  test('desktop / no-camera / insecure resolve to screen WITHOUT prompting', () => {
    // The no-prompt paths for a camera-less device (the DENIED cell is the
    // defensive explicit-refusal cell — a user who answered a prompt; the
    // GRANTED cell never shows one on the way to screen either).
    for (const permission of [ARM_PERMISSION.GRANTED, ARM_PERMISSION.PENDING, ARM_PERMISSION.NOT_ASKED]) {
      const noCam = resolveArmMatrix({ support: ARM_SUPPORT.NO_CAMERA, permission });
      assert.equal(noCam.state, STATES.UNSUPPORTED);
      assert.equal(noCam.medium, ARM_MEDIUMS.SCREEN);
      assert.equal(noCam.prompts, false, `no-camera × ${permission} must not prompt`);
      assert.equal(noCam.framing, ARM_FRAMINGS.SCREEN_POSITIVE);
    }
    // Insecure context: no media stack at all — nothing can be prompted,
    // every permission column is the same screen cell.
    for (const permission of Object.values(ARM_PERMISSION)) {
      const insecure = resolveArmMatrix({ support: ARM_SUPPORT.INSECURE, permission });
      assert.equal(insecure.state, STATES.UNSUPPORTED);
      assert.equal(insecure.medium, ARM_MEDIUMS.SCREEN);
      assert.equal(insecure.prompts, false, `insecure × ${permission} must not prompt`);
      assert.equal(insecure.framing, ARM_FRAMINGS.SCREEN_POSITIVE);
    }
  });

  test('supported×denied OFFERS screen (offerScreen is true only there)', () => {
    for (const support of Object.values(ARM_SUPPORT)) {
      for (const permission of Object.values(ARM_PERMISSION)) {
        const cell = resolveArmMatrix({ support, permission });
        if (cell.state === STATES.PERMISSION_DENIED) {
          assert.equal(cell.offerScreen, true, `${support}×${permission} denied must offer screen`);
        } else {
          assert.equal(cell.offerScreen, false, `${support}×${permission} must not offer a choice`);
        }
      }
    }
    const denied = resolveArmMatrix({ support: ARM_SUPPORT.TORCH, permission: ARM_PERMISSION.DENIED });
    assert.equal(denied.state, STATES.PERMISSION_DENIED);
    assert.equal(denied.medium, null); // undecided until the user accepts
  });

  test('unsupported framing is positive everywhere it appears', () => {
    for (const support of Object.values(ARM_SUPPORT)) {
      for (const permission of Object.values(ARM_PERMISSION)) {
        const cell = resolveArmMatrix({ support, permission });
        if (cell.state === STATES.UNSUPPORTED) {
          assert.equal(cell.framing, ARM_FRAMINGS.SCREEN_POSITIVE, `${support}×${permission}`);
          assert.equal(cell.medium, ARM_MEDIUMS.SCREEN);
        }
      }
    }
  });

  test('every distinct matrix target state is reachable at runtime', () => {
    // torch-ready ← supported×granted
    let { mach } = reach('torch-ready');
    assert.equal(mach.state(), STATES.TORCH_READY);
    assert.equal(mach.snapshot().channel, 'torch');
    // awaiting-permission ← supported×prompt-pending
    ({ mach } = reach('awaiting-permission'));
    assert.equal(mach.state(), STATES.AWAITING_PERMISSION);
    // permission-denied ← (torch|no-torch)×denied
    ({ mach } = reach('permission-denied'));
    assert.equal(mach.state(), STATES.PERMISSION_DENIED);
    // arming ← supported×not-asked
    ({ mach } = reach('arming'));
    assert.equal(mach.state(), STATES.ARMING);
    // unsupported ← no-torch×granted, no-camera×not-asked, insecure×*
    ({ mach } = reach('unsupported'));
    assert.equal(mach.state(), STATES.UNSUPPORTED);
    assert.equal(mach.snapshot().fallbackReason, 'insecure-context');
  });

  test('matrix cells land through the runtime TORCH_* carriers (equivalence)', () => {
    const carriers = [
      // [matrix cell, runtime drive]
      [
        { support: ARM_SUPPORT.TORCH, permission: ARM_PERMISSION.GRANTED },
        ['torch-acquired'],
      ],
      [
        { support: ARM_SUPPORT.TORCH, permission: ARM_PERMISSION.DENIED },
        ['permission-prompted', 'torch-permission-denied'],
      ],
      [
        { support: ARM_SUPPORT.TORCH, permission: ARM_PERMISSION.PENDING },
        ['permission-prompted'],
      ],
      [
        { support: ARM_SUPPORT.NO_TORCH, permission: ARM_PERMISSION.GRANTED },
        ['permission-prompted', 'permission-granted', 'torch-unsupported'],
      ],
      [
        { support: ARM_SUPPORT.NO_TORCH, permission: ARM_PERMISSION.DENIED },
        ['permission-prompted', 'torch-permission-denied'],
      ],
      [
        { support: ARM_SUPPORT.NO_CAMERA, permission: ARM_PERMISSION.NOT_ASKED },
        ['torch-unsupported'],
      ],
      [
        { support: ARM_SUPPORT.INSECURE, permission: ARM_PERMISSION.NOT_ASKED },
        ['torch-unsupported'],
      ],
    ];
    for (const [cellInput, events] of carriers) {
      const mach = createStateMachine();
      mach.dispatch(E.REQUEST_BROADCAST);
      mach.dispatch(E.ACK);
      const payloads = {
        'torch-acquired': { form: 'advanced' },
        'permission-prompted': {},
        'permission-granted': {},
        'torch-permission-denied': { reason: 'permission-denied' },
        'torch-unsupported': { reason: cellInput.support === 'insecure-context' ? 'insecure-context' : 'no-camera' },
      };
      for (const ev of events) mach.dispatch(E[constantNameFor(ev)], payloads[ev]);
      assert.equal(
        mach.state(),
        resolveArmMatrix(cellInput).state,
        `${JSON.stringify(cellInput)} — runtime carrier ${events.join(',')} landed ${mach.state()}`
      );
    }
  });

  test('resolveArmMatrix rejects malformed axes (incl. prototype keys)', () => {
    assert.throws(() => resolveArmMatrix(), TypeError);
    assert.throws(() => resolveArmMatrix({}), TypeError);
    assert.throws(() => resolveArmMatrix({ support: 'toString', permission: 'granted' }), TypeError);
    assert.throws(() => resolveArmMatrix({ support: 'torch', permission: 'toString' }), TypeError);
    assert.throws(() => resolveArmMatrix({ support: 'android', permission: 'granted' }), TypeError);
    assert.throws(() => resolveArmMatrix({ support: 'torch', permission: 'maybe' }), TypeError);
  });
});

/** Map an event value back to its STATE_EVENTS key name for the carrier test. */
function constantNameFor(value) {
  for (const [k, v] of Object.entries(STATE_EVENTS)) if (v === value) return k;
  throw new Error(`no constant for ${value}`);
}

// ---------------------------------------------------------------------------
// 3. F3 glue — acquire() results and fallback reasons

describe('F3 glue (torch vocabulary → machine events)', () => {
  test('SUPPORT_BY_FALLBACK_REASON covers every F3 fallback reason except the denial', () => {
    const reasons = Object.values(TORCH_FALLBACK_REASONS);
    const mapped = Object.keys(SUPPORT_BY_FALLBACK_REASON);
    for (const r of reasons) {
      if (r === TORCH_FALLBACK_REASONS.PERMISSION_DENIED) {
        assert.equal(SUPPORT_BY_FALLBACK_REASON[r], undefined, 'denial is the permission axis, not support');
      } else {
        assert.notEqual(SUPPORT_BY_FALLBACK_REASON[r], undefined, `reason ${r} must map to a support value`);
      }
    }
    assert.deepEqual(
      [...mapped].sort(),
      reasons.filter((r) => r !== TORCH_FALLBACK_REASONS.PERMISSION_DENIED).sort()
    );
    for (const support of Object.values(SUPPORT_BY_FALLBACK_REASON)) {
      assert.deepEqual(Object.values(ARM_SUPPORT).includes(support), true);
    }
    assert.equal(Object.isFrozen(SUPPORT_BY_FALLBACK_REASON), true);
  });

  test('eventFromTorchResult maps every outcome × reason class exactly', () => {
    const ready = eventFromTorchResult({ outcome: TORCH_OUTCOMES.READY, form: 'toplevel' });
    assert.deepEqual(ready, { type: E.TORCH_ACQUIRED, payload: { form: 'toplevel' } });
    assert.equal(Object.isFrozen(ready), true);

    const denied = eventFromTorchResult({
      outcome: TORCH_OUTCOMES.SCREEN_FALLBACK,
      reason: TORCH_FALLBACK_REASONS.PERMISSION_DENIED,
      detail: 'NotAllowedError: permission dismissed',
    });
    assert.deepEqual(denied, {
      type: E.TORCH_PERMISSION_DENIED,
      payload: { reason: 'permission-denied', detail: 'NotAllowedError: permission dismissed' },
    });

    for (const reason of [
      TORCH_FALLBACK_REASONS.INSECURE_CONTEXT,
      TORCH_FALLBACK_REASONS.NO_CAMERA,
      TORCH_FALLBACK_REASONS.NO_TORCH_CAPABILITY,
      TORCH_FALLBACK_REASONS.PROBE_ON_FAILED,
      TORCH_FALLBACK_REASONS.PROBE_OFF_FAILED,
      TORCH_FALLBACK_REASONS.PROBE_TIMEOUT,
      TORCH_FALLBACK_REASONS.CAMERA_UNAVAILABLE,
      TORCH_FALLBACK_REASONS.GUM_FAILED,
    ]) {
      const ev = eventFromTorchResult({ outcome: TORCH_OUTCOMES.SCREEN_FALLBACK, reason });
      assert.equal(ev.type, E.TORCH_UNSUPPORTED, reason);
      assert.equal(ev.payload.reason, reason);
      assert.notEqual(ev.payload.support, undefined);
    }

    const err = eventFromTorchResult({ outcome: TORCH_OUTCOMES.ERROR, reason: TORCH_ERROR_CODES.INTERNAL, detail: 'x' });
    assert.deepEqual(err, { type: E.TORCH_ERROR, payload: { reason: 'internal', detail: 'x' } });
    const errBare = eventFromTorchResult({ outcome: TORCH_OUTCOMES.ERROR });
    assert.deepEqual(errBare.payload, { reason: TORCH_ERROR_CODES.INTERNAL, detail: null });
  });

  test('unsupported events carry the matrix support value for their reason', () => {
    assert.equal(
      eventFromTorchResult({ outcome: TORCH_OUTCOMES.SCREEN_FALLBACK, reason: TORCH_FALLBACK_REASONS.NO_CAMERA })
        .payload.support,
      ARM_SUPPORT.NO_CAMERA
    );
    assert.equal(
      eventFromTorchResult({ outcome: TORCH_OUTCOMES.SCREEN_FALLBACK, reason: TORCH_FALLBACK_REASONS.INSECURE_CONTEXT })
        .payload.support,
      ARM_SUPPORT.INSECURE
    );
    assert.equal(
      eventFromTorchResult({ outcome: TORCH_OUTCOMES.SCREEN_FALLBACK, reason: TORCH_FALLBACK_REASONS.PROBE_TIMEOUT })
        .payload.support,
      ARM_SUPPORT.NO_TORCH
    );
  });

  test('eventFromTorchResult rejects malformed results', () => {
    assert.throws(() => eventFromTorchResult(null), TypeError);
    assert.throws(() => eventFromTorchResult(undefined), TypeError);
    assert.throws(() => eventFromTorchResult({}), TypeError);
    assert.throws(() => eventFromTorchResult({ outcome: 7 }), TypeError);
    assert.throws(() => eventFromTorchResult({ outcome: 'miracle' }), TypeError);
  });

  test('round trip: dispatch(eventFromTorchResult(acquire-result)) lands per the matrix', () => {
    const cases = [
      [{ outcome: 'torch-ready', form: 'advanced' }, STATES.TORCH_READY],
      [{ outcome: 'screen-fallback', reason: 'permission-denied' }, STATES.PERMISSION_DENIED],
      [{ outcome: 'screen-fallback', reason: 'no-torch-capability' }, STATES.UNSUPPORTED],
      [{ outcome: 'error', reason: 'internal' }, STATES.ERROR],
    ];
    for (const [result, expected] of cases) {
      const mach = createStateMachine();
      mach.dispatch(E.REQUEST_BROADCAST);
      mach.dispatch(E.ACK);
      const ev = eventFromTorchResult(result);
      const r = mach.dispatch(ev.type, ev.payload);
      assert.equal(r.accepted, true);
      assert.equal(mach.state(), expected, JSON.stringify(result));
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Full user journeys

describe('journeys', () => {
  test('cold open, torch path (iOS 17.4+ / Chromium Android): prompt → grant → probe → broadcast', () => {
    const { mach, rec } = reach('idle');
    const seq = [
      E.REQUEST_BROADCAST, E.ACK, E.PERMISSION_PROMPTED, E.PERMISSION_GRANTED, E.TORCH_ACQUIRED,
      E.GO, E.GO, E.BROADCAST_COMPLETE,
    ];
    for (const ev of seq) mach.dispatch(ev, ev === E.TORCH_ACQUIRED ? { form: 'advanced' } : undefined);
    assert.deepEqual(rec.states(), [
      'preflight', 'arming', 'awaiting-permission', 'arming', 'torch-ready', 'ready', 'broadcasting', 'done',
    ]);
    assert.deepEqual(rec.vias(), seq);
    const snap = mach.snapshot();
    assert.equal(snap.channel, null); // torch released after broadcast (privacy scope)
    assert.equal(snap.doneReason, 'complete');
    assert.equal(snap.hazardAcknowledged, true);
    assert.deepEqual(rec.effects(), ['notice-required', 'release-torch']);
  });

  test('remembered grant skips awaiting-permission (optional refinement is legal)', () => {
    const mach = createStateMachine();
    mach.dispatch(E.REQUEST_BROADCAST);
    mach.dispatch(E.ACK);
    mach.dispatch(E.TORCH_ACQUIRED, { form: 'advanced' });
    assert.equal(mach.state(), STATES.TORCH_READY);
  });

  test('cold open, screen path (desktop/insecure): no prompt, positive framing, replay without re-arm', () => {
    const { mach, rec } = reach('idle');
    mach.dispatch(E.REQUEST_BROADCAST);
    mach.dispatch(E.ACK);
    mach.dispatch(E.TORCH_UNSUPPORTED, { support: 'insecure-context', reason: 'insecure-context' });
    assert.equal(mach.state(), STATES.UNSUPPORTED);
    let snap = mach.snapshot();
    assert.equal(snap.fallbackReason, 'insecure-context');
    assert.equal(snap.channel, null);
    mach.dispatch(E.ACCEPT_SCREEN);
    assert.equal(mach.state(), STATES.SCREEN_MODE);
    assert.equal(mach.snapshot().channel, 'screen');
    mach.dispatch(E.GO);
    mach.dispatch(E.GO);
    assert.equal(mach.state(), STATES.BROADCASTING_ON_SCREEN);
    mach.dispatch(E.BROADCAST_COMPLETE);
    snap = mach.snapshot();
    assert.deepEqual(
      { state: snap.state, channel: snap.channel, doneReason: snap.doneReason },
      { state: 'done', channel: 'screen', doneReason: 'complete' },
      'screen arming persists through done — replay needs no re-arm'
    );
    const r = mach.dispatch(E.REPLAY);
    assert.equal(r.accepted, true);
    assert.equal(mach.state(), STATES.READY, 'replay on a held screen channel goes straight to the GO roll');
    mach.dispatch(E.GO);
    assert.equal(mach.state(), STATES.BROADCASTING_ON_SCREEN);
    assert.deepEqual(rec.effects(), ['notice-required'], 'the screen path never holds a torch — zero release effects');
  });

  test('no-torch after grant (Firefox / desktop-with-camera): positive screen, never a dead end', () => {
    const mach = createStateMachine();
    mach.dispatch(E.REQUEST_BROADCAST);
    mach.dispatch(E.ACK);
    mach.dispatch(E.PERMISSION_PROMPTED);
    assert.equal(mach.state(), STATES.AWAITING_PERMISSION);
    mach.dispatch(E.PERMISSION_GRANTED);
    assert.equal(mach.state(), STATES.ARMING);
    mach.dispatch(E.TORCH_UNSUPPORTED, { support: 'no-torch', reason: 'no-torch-capability' });
    assert.equal(mach.state(), STATES.UNSUPPORTED);
    assert.equal(mach.snapshot().fallbackReason, 'no-torch-capability');
  });

  test('denied path: offer screen → accept; retry → grant; reset → idle', () => {
    // accept the offer
    const a = reach('permission-denied').mach;
    assert.equal(a.snapshot().fallbackReason, 'permission-denied');
    a.dispatch(E.ACCEPT_SCREEN);
    assert.deepEqual(
      { state: a.state(), channel: a.snapshot().channel },
      { state: 'screen-mode', channel: 'screen' }
    );
    // retry: F3 re-acquire re-prompts, second time the user grants
    const b = reach('permission-denied').mach;
    b.dispatch(E.RETRY_ARM);
    assert.equal(b.state(), STATES.ARMING);
    b.dispatch(E.PERMISSION_PROMPTED);
    b.dispatch(E.PERMISSION_GRANTED);
    b.dispatch(E.TORCH_ACQUIRED, { form: 'advanced' });
    assert.equal(b.state(), STATES.TORCH_READY);
    assert.equal(b.snapshot().fallbackReason, null, 'stale denial context cleared on a fresh arm');
    // reset
    const c = reach('permission-denied').mach;
    c.dispatch(E.RESET);
    assert.equal(c.state(), STATES.IDLE);
  });

  test('mid-broadcast torch loss → screen takeover, position preserved, metadata for I2', () => {
    const { mach, rec } = reach('broadcasting');
    const r = mach.dispatch(E.TORCH_LOST, { code: TORCH_ERROR_CODES.TRACK_ENDED });
    assert.deepEqual(
      { accepted: r.accepted, to: r.to },
      { accepted: true, to: STATES.BROADCASTING_ON_SCREEN }
    );
    const snap = mach.snapshot();
    assert.equal(snap.channel, 'screen');
    assert.deepEqual(snap.takeover, { cause: 'torch-lost', code: 'track-ended' });
    // no release effect — F3 already stopped the track on loss
    assert.equal(rec.effects().includes('release-torch'), false);
    // the broadcast itself continues to completion
    mach.dispatch(E.BROADCAST_COMPLETE);
    assert.equal(mach.state(), STATES.DONE);
  });

  test('torch loss while PAUSED → paused-on-screen → resume on screen', () => {
    const mach = reach('paused').mach;
    mach.dispatch(E.TORCH_LOST, { code: TORCH_ERROR_CODES.APPLY_REJECTED });
    assert.equal(mach.state(), STATES.PAUSED_ON_SCREEN);
    assert.deepEqual(mach.snapshot().takeover, { cause: 'torch-lost', code: 'apply-rejected' });
    mach.dispatch(E.RESUME);
    assert.equal(mach.state(), STATES.BROADCASTING_ON_SCREEN);
  });

  test('manual "torch not flashing? switch to screen" — standby and mid-broadcast, with release', () => {
    const { mach, rec } = reach('torch-ready');
    mach.dispatch(E.SWITCH_CHANNEL);
    assert.deepEqual(
      { state: mach.state(), channel: mach.snapshot().channel },
      { state: 'screen-mode', channel: 'screen' }
    );
    assert.equal(rec.effects().at(-1), 'release-torch', 'switching away from torch releases the camera');

    const b = reach('broadcasting');
    b.mach.dispatch(E.SWITCH_CHANNEL);
    assert.equal(b.mach.state(), STATES.BROADCASTING_ON_SCREEN);
    assert.deepEqual(b.mach.snapshot().takeover, { cause: 'manual-switch', code: null });
    assert.equal(b.rec.effects().at(-1), 'release-torch');
  });

  test('pause/resume/stop on both channels', () => {
    // torch
    const a = reach('broadcasting').mach;
    a.dispatch(E.PAUSE);
    assert.equal(a.state(), STATES.PAUSED);
    a.dispatch(E.RESUME);
    assert.equal(a.state(), STATES.BROADCASTING);
    a.dispatch(E.PAUSE);
    a.dispatch(E.STOP);
    assert.deepEqual(
      { state: a.state(), doneReason: a.snapshot().doneReason, channel: a.snapshot().channel },
      { state: 'done', doneReason: 'stopped', channel: null }
    );
    // screen
    const b = reach('broadcasting-on-screen:fresh').mach;
    b.dispatch(E.PAUSE);
    assert.equal(b.state(), STATES.PAUSED_ON_SCREEN);
    b.dispatch(E.RESUME);
    assert.equal(b.state(), STATES.BROADCASTING_ON_SCREEN);
    b.dispatch(E.STOP);
    assert.deepEqual(
      { state: b.state(), doneReason: b.snapshot().doneReason, channel: b.snapshot().channel },
      { state: 'done', doneReason: 'stopped', channel: 'screen' }
    );
  });

  test('replay after a torch done re-arms through preflight (camera was released)', () => {
    const { mach, rec } = reach('done:torch');
    assert.equal(mach.snapshot().channel, null);
    mach.dispatch(E.REPLAY);
    assert.equal(mach.state(), STATES.PREFLIGHT);
    assert.equal(mach.snapshot().noticePending, false, 'hazard notice is once per session');
    assert.equal(rec.effects().filter((f) => f === 'notice-required').length, 1);
    mach.dispatch(E.ACK);
    assert.equal(mach.state(), STATES.ARMING);
    mach.dispatch(E.TORCH_ACQUIRED, { form: 'advanced' });
    mach.dispatch(E.GO);
    mach.dispatch(E.GO);
    assert.equal(mach.state(), STATES.BROADCASTING);
    assert.equal(mach.snapshot().takeover, null, 'takeover context cleared for the fresh broadcast');
  });

  test('error recovery: arm error retried; broadcast error reset into a full new journey', () => {
    const a = reach('error:arm').mach;
    assert.deepEqual(a.snapshot().error, { kind: 'arm', reason: 'internal', detail: null });
    a.dispatch(E.RETRY_ARM);
    a.dispatch(E.TORCH_ACQUIRED, { form: 'advanced' });
    assert.equal(a.state(), STATES.TORCH_READY);
    assert.equal(a.snapshot().error, null);

    const { mach, rec } = reach('error:broadcast:torch');
    assert.deepEqual(mach.snapshot().error, { kind: 'broadcast', reason: 'conductor', detail: null });
    assert.equal(mach.snapshot().channel, null);
    assert.equal(rec.effects().at(-1), 'release-torch');
    mach.dispatch(E.RESET);
    assert.equal(mach.state(), STATES.IDLE);
    // the full journey works again from scratch
    mach.dispatch(E.REQUEST_BROADCAST);
    mach.dispatch(E.ACK);
    mach.dispatch(E.TORCH_ACQUIRED, { form: 'advanced' });
    mach.dispatch(E.GO);
    mach.dispatch(E.GO);
    assert.equal(mach.state(), STATES.BROADCASTING);
  });

  test('error REPLAY branches by held channel (screen error replays directly)', () => {
    const a = reach('error:broadcast:screen').mach;
    assert.equal(a.snapshot().channel, 'screen');
    a.dispatch(E.REPLAY);
    assert.equal(a.state(), STATES.READY);
    const b = reach('error:broadcast:torch').mach;
    b.dispatch(E.REPLAY);
    assert.equal(b.state(), STATES.PREFLIGHT);
  });

  test('phase-scoped context retires on EVERY exit of its state (no stale leaks)', () => {
    // takeover → broadcast failure → re-arm: the new arm phase starts clean
    // (adversarial sequence found by hand-probing; the fuzz never drew it).
    const a = reach('broadcasting').mach;
    a.dispatch(E.TORCH_LOST, { code: 'track-ended' });
    a.dispatch(E.BROADCAST_FAILED, { reason: 'conductor' });
    assert.notEqual(a.snapshot().takeover, null, 'takeover legitimately survives INTO error');
    a.dispatch(E.RETRY_ARM);
    assert.deepEqual(
      { state: a.state(), channel: a.snapshot().channel, takeover: a.snapshot().takeover, error: a.snapshot().error },
      { state: 'arming', channel: null, takeover: null, error: null }
    );
    // error → RESET
    const b = reach('error:arm').mach;
    b.dispatch(E.RESET);
    assert.deepEqual(
      { state: b.state(), error: b.snapshot().error, channel: b.snapshot().channel },
      { state: 'idle', error: null, channel: null }
    );
    // done → RESET retires doneReason/takeover
    const c = reach('done:torch').mach;
    c.dispatch(E.RESET);
    assert.deepEqual(
      { state: c.state(), doneReason: c.snapshot().doneReason, takeover: c.snapshot().takeover },
      { state: 'idle', doneReason: null, takeover: null }
    );
    // paused-on-screen → RESET retires the takeover note
    const d = reach('broadcasting').mach;
    d.dispatch(E.TORCH_LOST, { code: 'track-ended' });
    d.dispatch(E.PAUSE);
    d.dispatch(E.RESET);
    assert.deepEqual(
      { state: d.state(), takeover: d.snapshot().takeover, channel: d.snapshot().channel },
      { state: 'idle', takeover: null, channel: null }
    );
  });

  test('cancel paths: preflight back to idle (notice re-arms), ready back to armed standby', () => {
    const { mach, rec } = reach('preflight');
    mach.dispatch(E.CANCEL);
    assert.equal(mach.state(), STATES.IDLE);
    assert.equal(mach.snapshot().hazardAcknowledged, false);
    mach.dispatch(E.REQUEST_BROADCAST);
    assert.deepEqual(rec.effects(), ['notice-required', 'notice-required'], 'unacknowledged → notice fires again');

    const rTorch = reach('ready:torch').mach;
    rTorch.dispatch(E.CANCEL);
    assert.deepEqual(
      { state: rTorch.state(), channel: rTorch.snapshot().channel },
      { state: 'torch-ready', channel: 'torch' }
    );
    const rScreen = reach('ready:screen').mach;
    rScreen.dispatch(E.CANCEL);
    assert.deepEqual(
      { state: rScreen.state(), channel: rScreen.snapshot().channel },
      { state: 'screen-mode', channel: 'screen' }
    );
  });

  test('notice fires exactly once per acknowledged session', () => {
    const { mach, rec } = reach('idle');
    for (let i = 0; i < 3; i++) {
      mach.dispatch(E.REQUEST_BROADCAST);
      mach.dispatch(E.ACK);
      mach.dispatch(E.TORCH_ACQUIRED, { form: 'advanced' });
      mach.dispatch(E.GO);
      mach.dispatch(E.GO);
      mach.dispatch(E.BROADCAST_COMPLETE);
      mach.dispatch(E.REPLAY); // → preflight (re-arm; channel released)
    }
    assert.equal(rec.effects().filter((f) => f === 'notice-required').length, 1);
    assert.equal(rec.effects().filter((f) => f === 'release-torch').length, 3);
  });
});

// ---------------------------------------------------------------------------
// 5. The ENTIRE table — every (variant × event) cell

describe('exhaustive transition-table cells', () => {
  test('every defined cell accepts; every undefined cell rejects softly', () => {
    const allEvents = Object.values(STATE_EVENTS);
    let accepted = 0;
    let rejected = 0;
    for (const variant of ALL_VARIANTS) {
      const state = variantState(variant);
      const defined = new Set(EXPECTED_DEFINED[state]);
      for (const ev of allEvents) {
        const { mach, rec } = reach(variant); // fresh machine per probe
        const before = mach.snapshot();
        const result = mach.dispatch(ev, { code: 'x', reason: 'y', detail: 'z', form: 'advanced' });
        if (defined.has(ev)) {
          accepted++;
          assert.deepEqual(
            { accepted: result.accepted, from: result.from },
            { accepted: true, from: state },
            `${variant} --${ev}--> must be accepted`
          );
          assert.notEqual(mach.state(), state, `${variant} --${ev}--> must move`);
          assert.equal(rec.invalids().length, 0);
        } else {
          rejected++;
          assert.deepEqual(
            result,
            { accepted: false, from: state, to: state, via: ev, reason: 'undefined-transition' },
            `${variant} --${ev}--> must reject with a frozen, descriptive result`
          );
          assert.equal(mach.state(), state, `${variant} --${ev}--> must not move`);
          assert.deepEqual(mach.snapshot(), before, `${variant} --${ev}--> must not touch context`);
          assert.deepEqual(rec.invalids(), [{ state, type: ev, reason: 'undefined-transition' }]);
        }
        assert.equal(Object.isFrozen(result), true);
      }
    }
    // 21 variants × 21 events = 441 probes; both classes non-empty.
    assert.equal(accepted + rejected, ALL_VARIANTS.length * allEvents.length);
    assert.ok(accepted > 40, `expected a real table, got ${accepted} defined cells`);
    assert.ok(rejected > 300, `expected the bulk to be rejections, got ${rejected}`);
  });

  test('branching rows land per channel: ready.GO / ready.CANCEL', () => {
    assert.equal(reach('ready:torch').mach.dispatch(E.GO).to, STATES.BROADCASTING);
    assert.equal(reach('ready:screen').mach.dispatch(E.GO).to, STATES.BROADCASTING_ON_SCREEN);
    assert.equal(reach('ready:torch').mach.dispatch(E.CANCEL).to, STATES.TORCH_READY);
    assert.equal(reach('ready:screen').mach.dispatch(E.CANCEL).to, STATES.SCREEN_MODE);
  });

  test('branching rows land per channel: done.REPLAY / error.REPLAY', () => {
    assert.equal(reach('done:torch').mach.dispatch(E.REPLAY).to, STATES.PREFLIGHT);
    assert.equal(reach('done:stopped').mach.dispatch(E.REPLAY).to, STATES.PREFLIGHT);
    assert.equal(reach('done:screen').mach.dispatch(E.REPLAY).to, STATES.READY);
    assert.equal(reach('error:arm').mach.dispatch(E.REPLAY).to, STATES.PREFLIGHT);
    assert.equal(reach('error:broadcast:torch').mach.dispatch(E.REPLAY).to, STATES.PREFLIGHT);
    assert.equal(reach('error:broadcast:screen').mach.dispatch(E.REPLAY).to, STATES.READY);
  });

  test('release-torch sits exactly on the torch-abandoning rows', () => {
    const cases = [
      // [variant, event, expects-release]
      ['torch-ready', 'reset', true],
      ['torch-ready', 'switch-channel', true],
      ['broadcasting', 'torch-lost', false], // F3 self-released on loss
      ['broadcasting', 'switch-channel', true],
      ['broadcasting', 'stop', true],
      ['broadcasting', 'broadcast-complete', true],
      ['broadcasting', 'broadcast-failed', true],
      ['paused', 'torch-lost', false],
      ['paused', 'switch-channel', true],
      ['paused', 'stop', true],
      ['paused', 'reset', true],
      ['broadcasting-on-screen:fresh', 'broadcast-complete', false],
      ['broadcasting-on-screen:fresh', 'stop', false],
      ['broadcasting-on-screen:fresh', 'broadcast-failed', false],
      ['paused-on-screen', 'stop', false],
      ['paused-on-screen', 'reset', false],
      ['screen-mode', 'reset', false],
      ['done:torch', 'replay', false], // already released at done
    ];
    for (const [variant, ev, expect] of cases) {
      const { mach, rec } = reach(variant);
      const releasesBefore = rec.effects().filter((f) => f === 'release-torch').length;
      mach.dispatch(ev, ev === 'torch-lost' ? { code: 'track-ended' } : {});
      const delta = rec.effects().filter((f) => f === 'release-torch').length - releasesBefore;
      assert.equal(delta, expect ? 1 : 0, `${variant} --${ev}--> release-torch expected ${expect}`);
    }
  });

  test('racy duplicate outcomes reject softly (no state corruption)', () => {
    const { mach, rec } = reach('torch-ready');
    const before = mach.snapshot();
    for (const ev of [E.TORCH_ACQUIRED, E.TORCH_UNSUPPORTED, E.TORCH_PERMISSION_DENIED, E.TORCH_ERROR, E.TORCH_LOST]) {
      const r = mach.dispatch(ev, { reason: 'late' });
      assert.equal(r.accepted, false, `${ev} after arm completed is a race`);
    }
    assert.equal(mach.state(), STATES.TORCH_READY);
    assert.deepEqual(mach.snapshot(), before);
    assert.equal(rec.invalids().length, 5);
  });
});

// ---------------------------------------------------------------------------
// 6. No dead ends

describe('no dead ends', () => {
  test('every state has at least one outgoing transition', () => {
    for (const state of STATE_LIST) {
      assert.ok(
        (EXPECTED_DEFINED[state]?.length ?? 0) > 0,
        `${state} is a sink — every state needs an exit`
      );
    }
  });

  test('terminal-ish states recover: retry / replay / idle within one or two hops', () => {
    // done
    for (const variant of ['done:torch', 'done:screen', 'done:stopped']) {
      const mach = reach(variant).mach;
      mach.dispatch(E.REPLAY);
      assert.ok([STATES.READY, STATES.PREFLIGHT].includes(mach.state()));
      const again = reach(variant).mach;
      again.dispatch(E.RESET);
      assert.equal(again.state(), STATES.IDLE);
    }
    // error
    for (const variant of ['error:arm', 'error:broadcast:torch', 'error:broadcast:screen']) {
      const mach = reach(variant).mach;
      mach.dispatch(E.RETRY_ARM);
      assert.equal(mach.state(), STATES.ARMING);
      const again = reach(variant).mach;
      again.dispatch(E.RESET);
      assert.equal(again.state(), STATES.IDLE);
    }
    // permission-denied and unsupported
    for (const variant of ['permission-denied', 'unsupported']) {
      const mach = reach(variant).mach;
      mach.dispatch(E.ACCEPT_SCREEN);
      assert.equal(mach.state(), STATES.SCREEN_MODE);
      const retry = reach(variant).mach;
      retry.dispatch(E.RETRY_ARM);
      assert.equal(retry.state(), STATES.ARMING);
      const reset = reach(variant).mach;
      reset.dispatch(E.RESET);
      assert.equal(reset.state(), STATES.IDLE);
    }
  });

  test('idle is reachable from every state within three hops', () => {
    const paths = {
      idle: [],
      preflight: ['cancel'],
      arming: ['torch-permission-denied', 'reset'],
      'awaiting-permission': ['permission-granted', 'torch-error', 'reset'],
      'permission-denied': ['reset'],
      unsupported: ['reset'],
      'torch-ready': ['reset'],
      'screen-mode': ['reset'],
      'ready:torch': ['cancel', 'reset'],
      'ready:screen': ['cancel', 'reset'],
      broadcasting: ['pause', 'reset'],
      'broadcasting-on-screen:fresh': ['pause', 'reset'],
      'broadcasting-on-screen:takeover': ['stop', 'reset'],
      paused: ['reset'],
      'paused-on-screen': ['reset'],
      'done:torch': ['reset'],
      'done:screen': ['reset'],
      'done:stopped': ['reset'],
      'error:arm': ['reset'],
      'error:broadcast:torch': ['reset'],
      'error:broadcast:screen': ['reset'],
    };
    for (const [variant, events] of Object.entries(paths)) {
      const mach = reach(variant).mach;
      for (const ev of events) mach.dispatch(E[constantNameFor(ev)]);
      assert.equal(mach.state(), STATES.IDLE, `${variant} must reach idle via ${events.join(' → ')}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Dispatch / emitter semantics

describe('dispatch and emitter semantics', () => {
  test('unknown event names throw TypeError (wiring bugs, not races)', () => {
    const mach = createStateMachine();
    assert.throws(() => mach.dispatch('transmogrify'), TypeError);
    assert.throws(() => mach.dispatch(''), TypeError);
    assert.throws(() => mach.dispatch(null), TypeError);
    assert.throws(() => mach.dispatch(42), TypeError);
    assert.throws(() => mach.can('transmogrify'), TypeError);
    assert.equal(mach.can(E.REQUEST_BROADCAST), true);
    assert.equal(mach.can(E.GO), false);
    assert.throws(() => mach.addEventListener('change', 'nope'), TypeError);
  });

  test('change payload carries the full transition; effects fire after change', () => {
    const { mach, rec } = reach('broadcasting');
    const order = [];
    mach.addEventListener('change', () => order.push('change'));
    mach.addEventListener(STATE_EFFECTS.RELEASE_TORCH, () => order.push('release-torch'));
    mach.dispatch(E.BROADCAST_COMPLETE);
    assert.deepEqual(order, ['change', 'release-torch']);
    const change = rec.changes().at(-1);
    assert.deepEqual(
      Object.keys(change).sort(),
      ['effects', 'from', 'payload', 'snapshot', 'to', 'via']
    );
    assert.equal(change.from, 'broadcasting');
    assert.equal(change.to, 'done');
    assert.equal(change.via, 'broadcast-complete');
    assert.deepEqual(change.effects, ['release-torch']);
    assert.equal(change.snapshot.state, 'done');
    assert.equal(Object.isFrozen(change), true);
    assert.equal(Object.isFrozen(change.effects), true);
  });

  test('payloads pass through untouched; results and snapshots are frozen', () => {
    const mach = createStateMachine();
    const payload = { reason: 'probe-timeout', detail: '…' };
    const r = mach.dispatch(E.REQUEST_BROADCAST, payload);
    assert.equal(r.accepted, true);
    assert.deepEqual(payload, { reason: 'probe-timeout', detail: '…' });
    assert.throws(() => { r.accepted = false; }, TypeError);
    const snap = mach.snapshot();
    assert.throws(() => { snap.state = 'hijack'; }, TypeError);
    assert.throws(() => { snap.takeover = {}; }, TypeError);
  });

  test('listener isolation: one throwing consumer cannot break signaling', () => {
    const mach = createStateMachine();
    const seen = [];
    mach.addEventListener('change', () => { throw new Error('broken consumer'); });
    mach.addEventListener('change', (p) => seen.push(p.to));
    mach.dispatch(E.REQUEST_BROADCAST);
    assert.deepEqual(seen, ['preflight']);
    mach.dispatch(E.ACK);
    assert.deepEqual(seen, ['preflight', 'arming']);
  });

  test('unsubscribe via returned function and via removeEventListener', () => {
    const mach = createStateMachine();
    const seen = [];
    const off = mach.addEventListener('change', (p) => seen.push(p.to));
    const other = (p) => seen.push('other:' + p.to);
    mach.addEventListener('change', other);
    mach.dispatch(E.REQUEST_BROADCAST);
    assert.deepEqual(seen, ['preflight', 'other:preflight'], 'both listeners attached');
    off();
    mach.removeEventListener('change', other);
    mach.dispatch(E.ACK);
    assert.deepEqual(seen, ['preflight', 'other:preflight'], 'both listeners detached');
    mach.removeEventListener('change', other); // double-remove is a no-op
  });

  test('distinct-render carriers: noticePending / takeover / doneReason / error scope to their states', () => {
    const notices = [];
    const mach = createStateMachine();
    mach.addEventListener('change', (p) => notices.push([p.to, p.snapshot.noticePending]));
    mach.dispatch(E.REQUEST_BROADCAST);
    mach.dispatch(E.ACK);
    assert.deepEqual(notices, [['preflight', true], ['arming', false]]);
    assert.equal(mach.snapshot().noticePending, false);

    const doneSnap = reach('done:torch').mach.snapshot();
    assert.equal(doneSnap.doneReason !== null, true);
    assert.equal(doneSnap.takeover, null);

    const takeoverSnap = reach('broadcasting-on-screen:takeover').mach.snapshot();
    assert.notEqual(takeoverSnap.takeover, null);
    assert.equal(takeoverSnap.doneReason, null);
    assert.equal(takeoverSnap.error, null);
  });
});

// ---------------------------------------------------------------------------
// 8. Purity + fuzz

describe('purity and robustness', () => {
  test('source is DOM/timer/storage-free and imports only torch.js', () => {
    const src = readFileSync(new URL('../js/states.js', import.meta.url), 'utf8');
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/([^:'"])\/\/.*$/gm, '$1'); // trailing // comments (no URLs in code strings)
    const banned = /\b(window|document|navigator|localStorage|sessionStorage|requestAnimationFrame|setTimeout|setInterval|HTMLElement|querySelector|getElementById|globalThis)\b/;
    const match = stripped.match(banned);
    assert.equal(match, null, `states.js must stay pure — found ${match && match[0]} outside comments`);
    const imports = [...src.matchAll(/import\s+[^;]*from\s+'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(imports, ['./torch.js'], 'the only dependency is the F3 vocabulary');
  });

  test('fuzz: 5 seeded storms × 3000 events never break an invariant', () => {
    const events = Object.values(STATE_EVENTS);
    let totalAccepted = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const rand = mulberry32(seed * 7919);
      const mach = createStateMachine();
      for (let i = 0; i < 3000; i++) {
        const ev = events[Math.floor(rand() * events.length)];
        const payload = rand() < 0.3 ? { code: 'track-ended', reason: 'probe-timeout', detail: 'fuzz' } : undefined;
        let r;
        assert.doesNotThrow(() => { r = mach.dispatch(ev, payload); }, `seed ${seed} i ${i} --${ev}--> threw`);
        assert.equal(typeof r.accepted, 'boolean');
        if (r.accepted) totalAccepted++;
        const snap = mach.snapshot();
        assert.ok(STATE_LIST.includes(snap.state), `seed ${seed} i ${i}: left the state set (${snap.state})`);
        assert.ok(
          ALLOWED_CHANNELS[snap.state].includes(snap.channel),
          `seed ${seed} i ${i}: channel ${snap.channel} illegal in ${snap.state}`
        );
        assert.ok(
          snap.takeover === null ||
            ['broadcasting-on-screen', 'paused-on-screen', 'done', 'error'].includes(snap.state),
          `seed ${seed} i ${i}: takeover set in ${snap.state}`
        );
        assert.ok(snap.doneReason === null || snap.state === 'done', `doneReason leaked into ${snap.state}`);
        assert.ok(snap.error === null || snap.state === 'error', `error leaked into ${snap.state}`);
        assert.ok(snap.noticePending === false || snap.state === 'preflight', `noticePending leaked into ${snap.state}`);
      }
    }
    // Uniform random events against per-state rows accept ~10% of the
    // time — the machine is deliberately strict; the sanity floor just
    // proves the storm actually exercised real transitions.
    assert.ok(totalAccepted > 1000, `the storm should move the machine often, accepted=${totalAccepted}`);
  });
});

/** Deterministic PRNG (mulberry32) so the fuzz never flakes. */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
