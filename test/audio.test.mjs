// test/audio.test.mjs — F5 validation (headless: minimal AudioContext stub).
// Run: `node --test test/audio.test.mjs`
//
// F5 is a Web Audio module, so its logic is tested against a dependency-
// free stub: just enough AudioContext (currentTime / state / resume /
// close / createOscillator / createGain / destination) with RECORDING
// AudioParams, so the envelope shape, edge times, and stop/cancel
// sequences are asserted as EVENT SEQUENCES — the real Web Audio contract.
// Everything headlessly checkable is checked: the unlock state machine
// (no sound before gesture), absolute-time scheduling math with exact
// edges, the click-free envelope vs SYNC_TOLERANCE_MS, lookahead
// semantics for F6, mute behavior, and cleanup/release. Real audible
// behavior (clicks, actual device latency) is Q3's scripted check via
// harness.html.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAudioChannel,
  SYNC_TOLERANCE_MS,
  TONE_HZ,
  TONE_TYPE,
  TONE_GAIN,
  ENVELOPE_MS,
  LOOKAHEAD_MS,
  TICK_MS,
} from '../js/audio.js';

// STANCE GUARD (installed for the whole file): the mute toggle is
// memory-only per plan F5 — no persistence APIs. If any code under test
// touches storage, these getters explode (the F4 suite guards its
// matchMedia stance the same way).
for (const name of ['localStorage', 'sessionStorage']) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      throw new Error(`audio.js must not touch ${name} — mute is memory-only`);
    },
  });
}

// ---------------------------------------------------------------------------
// Stubs (tiny, dependency-free)

/** AudioParam stub. `.value` updates immediately on every event (an
 *  approximation of the computed value; the assertions below target the
 *  EVENT SEQUENCE, which is the real automation contract). */
function createParamStub(initial = 1) {
  const param = {
    value: initial,
    events: [],
    setValueAtTime(value, startTime) {
      param.events.push(['setValueAtTime', value, startTime]);
      param.value = value;
      return param;
    },
    linearRampToValueAtTime(value, endTime) {
      param.events.push(['linearRampToValueAtTime', value, endTime]);
      param.value = value;
      return param;
    },
    cancelScheduledValues(cancelTime) {
      param.events.push(['cancelScheduledValues', cancelTime]);
      return param;
    },
  };
  return param;
}

/** GainNode stub: a recording `gain` param + connection bookkeeping. */
function createGainNodeStub(initial = 1) {
  const node = {
    _connections: [],
    _disconnected: false,
    gain: createParamStub(initial),
    connect(dest) {
      node._connections.push(dest);
      return dest;
    },
    disconnect() {
      node._disconnected = true;
    },
  };
  return node;
}

/** OscillatorNode stub: records start/stop times (the edge contract),
 *  manual `_end()` to fire onended, faithful InvalidStateError on
 *  stop-before-start. */
function createOscillatorStub() {
  const osc = {
    type: undefined,
    frequency: { value: 0 },
    _started: null,
    _stopped: null,
    _ended: false,
    _connections: [],
    _disconnected: false,
    onended: null,
    connect(dest) {
      osc._connections.push(dest);
      return dest;
    },
    disconnect() {
      osc._disconnected = true;
    },
    start(when = 0) {
      if (osc._started !== null) throw new Error('InvalidStateError: already started');
      osc._started = when;
    },
    stop(when = 0) {
      if (osc._started === null) throw new Error('InvalidStateError: stop before start');
      osc._stopped = when; // real spec: calling stop again re-schedules (last wins)
    },
    _end() {
      osc._ended = true;
      if (typeof osc.onended === 'function') osc.onended();
    },
  };
  return osc;
}

/** AudioContext stub: manually-advanced currentTime, state machine good
 *  enough for the unlock flow, node registries for leak checks. */
function createAudioContextStub({ resume } = {}) {
  const ctx = {
    currentTime: 0,
    state: 'suspended',
    destination: { _isDestination: true },
    _oscillators: [],
    _gains: [],
    _resumeCalls: 0,
    _closeCalls: 0,
    createOscillator() {
      const o = createOscillatorStub();
      ctx._oscillators.push(o);
      return o;
    },
    createGain() {
      const g = createGainNodeStub(1);
      ctx._gains.push(g);
      return g;
    },
    async resume() {
      ctx._resumeCalls += 1;
      ctx.state = 'running';
    },
    async close() {
      ctx._closeCalls += 1;
      ctx.state = 'closed';
    },
  };
  if (resume) ctx.resume = resume;
  return ctx;
}

/** Fake AudioContext constructor that logs its instances (the lazy-creation
 *  contract: "new" happens exactly once, inside unlock()). */
function fakeCtor(log) {
  return function FakeAudioContext() {
    const ctx = createAudioContextStub();
    log.push(ctx);
    return ctx; // object return wins over `this` — `new FakeAudioContext()` yields the stub
  };
}

/** A channel wired to a fresh fake ctor + the contexts it created. */
function makeChannel(options = {}) {
  const created = [];
  const channel = createAudioChannel({ AudioContext: fakeCtor(created), ...options });
  return { channel, created };
}

/** Unlocked channel parked at a given currentTime (the common rhythm). */
async function readyChannel(atTime = 0, options = {}) {
  const { channel, created } = makeChannel(options);
  await channel.unlock();
  created[0].currentTime = atTime;
  return { channel, ctx: created[0], created };
}

/** The tone-gain node of the n-th scheduled voice (gains[0] is the master bus). */
const toneGainOf = (ctx, n = 0) => ctx._gains[1 + n];

// ---------------------------------------------------------------------------

describe('F5 · module surface & constants', () => {
  test('committed constants: tolerance 45 (BT.1359), envelope 5 ms, 700 Hz sine, R2 lookahead', () => {
    assert.equal(SYNC_TOLERANCE_MS, 45);
    assert.equal(ENVELOPE_MS, 5);
    assert.equal(TONE_HZ, 700);
    assert.equal(TONE_TYPE, 'sine');
    assert.ok(TONE_GAIN > 0 && TONE_GAIN <= 1);
    assert.equal(LOOKAHEAD_MS, 100); // R2-committed schedule-ahead window
    assert.equal(TICK_MS, 25);       // R2-committed loop tick
  });

  test('envelope budget is wired to the sync tolerance: every edge displaced ≤ envelope < 45 ms', () => {
    // The attack STARTS at the ON edge and the release ENDS at the OFF edge
    // (asserted exactly in the scheduling tests below), so each edge's
    // displacement is bounded by ENVELOPE_MS — which must stay inside the
    // BT.1359-derived budget the module itself exports.
    assert.ok(ENVELOPE_MS < SYNC_TOLERANCE_MS);
    assert.ok(2 * ENVELOPE_MS < SYNC_TOLERANCE_MS);
  });

  test('construction validation: malformed voice options are rejected up front', () => {
    assert.throws(() => createAudioChannel({ frequency: 'loud' }), TypeError);
    assert.throws(() => createAudioChannel({ frequency: NaN }), TypeError);
    assert.throws(() => createAudioChannel({ frequency: 0 }), RangeError);
    assert.throws(() => createAudioChannel({ frequency: -700 }), RangeError);
    assert.throws(() => createAudioChannel({ type: 'noise' }), TypeError);
    assert.throws(() => createAudioChannel({ envelopeMs: 'fast' }), TypeError);
    assert.throws(() => createAudioChannel({ envelopeMs: -1 }), RangeError);
    // an envelope as wide as the tolerance would spend the whole sync budget
    assert.throws(() => createAudioChannel({ envelopeMs: SYNC_TOLERANCE_MS }), /sync tolerance/);
    assert.throws(() => createAudioChannel({ envelopeMs: 80 }), RangeError);
    assert.throws(() => createAudioChannel({ peakGain: 1.5 }), RangeError);
    assert.throws(() => createAudioChannel({ peakGain: -0.1 }), RangeError);
    // valid customizations pass and are reported
    const { channel } = makeChannel({ frequency: 620, type: 'triangle', envelopeMs: 10, peakGain: 0.3 });
    const s = channel.status();
    assert.equal(s.toneHz, 620);
    assert.equal(s.toneType, 'triangle');
    assert.equal(s.envelopeMs, 10);
    assert.equal(s.peakGain, 0.3);
  });

  test('mute is memory-only: the whole suite runs under a throwing storage guard', async () => {
    // localStorage/sessionStorage getters (installed at the top of this
    // file) throw on ANY access — every operation in this file, including
    // setMuted, has been proving the no-storage stance since line one.
    // A fresh channel starts unmuted; mute state never leaks across channels.
    const a = makeChannel().channel;
    const b = makeChannel().channel;
    a.setMuted(true);
    assert.equal(a.isMuted(), true);
    assert.equal(b.isMuted(), false, 'mute lives per channel, in memory only');
  });
});

describe('F5 · unlock state machine (no sound before gesture)', () => {
  test('before unlock: NO context is ever constructed; now() is 0; scheduleTone throws', async () => {
    const { channel, created } = makeChannel();
    assert.equal(created.length, 0, 'context creation is lazy — nothing before the gesture');
    assert.equal(channel.now(), 0);
    assert.deepEqual(
      { ...channel.status() },
      {
        supported: true, created: false, unlocked: false, state: 'none',
        muted: false, activeVoices: 0, toneHz: 700, toneType: 'sine',
        envelopeMs: 5, peakGain: 0.5, toleranceMs: 45,
      }
    );
    assert.throws(() => channel.scheduleTone(1, 2), /unlock\(\) must succeed from a user gesture/);
    // destroy is safe even here
    await channel.destroy();
    assert.equal(created.length, 0);
  });

  test('unsupported environment (no AudioContext anywhere): unlock() rejects descriptively', async () => {
    const channel = createAudioChannel({}); // Node: no globals either
    assert.equal(channel.status().supported, false);
    await assert.rejects(channel.unlock(), /Web Audio is unsupported/);
    assert.throws(() => channel.scheduleTone(1, 2), /unlock\(\) must succeed/);
  });

  test('unlock() inside the gesture: creates exactly one context, resumes it, wires the mute bus', async () => {
    const { channel, created } = makeChannel();
    const state = await channel.unlock();
    assert.equal(state, 'running');
    assert.equal(created.length, 1);
    const ctx = created[0];
    assert.equal(ctx._resumeCalls, 1);
    assert.equal(ctx.state, 'running');
    // master bus: gains[0] → destination, gain 1 (unmuted)
    assert.equal(ctx._gains.length, 1);
    assert.deepEqual(ctx._gains[0]._connections, [ctx.destination]);
    assert.equal(ctx._gains[0].gain.value, 1);
    const s = channel.status();
    assert.deepEqual(
      { supported: s.supported, created: s.created, unlocked: s.unlocked, state: s.state },
      { supported: true, created: true, unlocked: true, state: 'running' }
    );
  });

  test('unlock() is idempotent: later gestures re-unlock without a new context or resume', async () => {
    const { channel, created } = makeChannel();
    await channel.unlock();
    await channel.unlock(); // replay gesture
    assert.equal(created.length, 1);
    assert.equal(created[0]._resumeCalls, 1);
  });

  test('injected suspended context: unlock() resumes THAT context (no new one)', async () => {
    const ctx = createAudioContextStub();
    const channel = createAudioChannel({ context: ctx });
    assert.equal(channel.status().created, true);
    assert.equal(channel.status().unlocked, false); // suspended ≠ unlocked
    assert.throws(() => channel.scheduleTone(0.1, 0.2), /unlock\(\) must succeed/);
    await channel.unlock();
    assert.equal(ctx._resumeCalls, 1);
    assert.equal(ctx.state, 'running');
    assert.equal(channel.status().unlocked, true);
  });

  test('injected RUNNING context is trusted as already gesture-unlocked', async () => {
    const ctx = createAudioContextStub();
    ctx.state = 'running';
    const channel = createAudioChannel({ context: ctx });
    assert.equal(channel.status().unlocked, true);
    const voice = channel.scheduleTone(0.1, 0.24); // allowed without unlock()
    assert.equal(voice.start, 0.1);
    assert.equal(ctx._resumeCalls, 0); // running: nothing to resume
  });

  test('resume refusal (autoplay denied): unlock() rejects, channel stays locked, then recovers', async () => {
    const ctx = createAudioContextStub({
      resume: async () => {
        throw new Error('NotAllowedError: autoplay');
      },
    });
    const channel = createAudioChannel({ context: ctx });
    await assert.rejects(channel.unlock(), /resume was refused/);
    assert.equal(channel.status().unlocked, false);
    assert.throws(() => channel.scheduleTone(1, 2), /unlock\(\) must succeed/);
    // the next gesture succeeds — recovery is just another unlock()
    ctx.resume = async () => {
      ctx._resumeCalls += 1;
      ctx.state = 'running';
    };
    await channel.unlock();
    assert.equal(channel.status().unlocked, true);
  });
});

describe('F5 · scheduling math (the F6 master-clock contract)', () => {
  test('a mark lands EXACTLY on its scheduled edges: start/stop and envelope bounds', async () => {
    const { channel, ctx } = await readyChannel(0.5);
    const voice = channel.scheduleTone(1.0, 1.24); // 240 ms dot @ LEARNER
    assert.equal(voice.start, 1.0);
    assert.equal(voice.end, 1.24);
    const osc = ctx._oscillators[0];
    assert.equal(osc._started, 1.0, 'osc.start at the scheduled ON edge');
    assert.equal(osc._stopped, 1.24, 'osc.stop at the scheduled OFF edge');
    assert.equal(osc.type, 'sine');
    assert.equal(osc.frequency.value, 700);
  });

  test('click-free envelope: attack FROM the ON edge, release ENDING AT the OFF edge', async () => {
    const { channel, ctx } = await readyChannel(0.5);
    channel.scheduleTone(1.0, 1.24);
    const gain = toneGainOf(ctx);
    assert.deepEqual(gain.gain.events, [
      ['setValueAtTime', 0, 1.0],                 // silence until the ON edge
      ['linearRampToValueAtTime', 0.5, 1.005],    // 5 ms attack FROM tOn
      ['setValueAtTime', 0.5, 1.235],             // hold until 5 ms before tOff
      ['linearRampToValueAtTime', 0, 1.24],       // release ENDS at tOff — no gap spill
    ]);
    const first = gain.gain.events[0];
    const last = gain.gain.events.at(-1);
    assert.equal(first[2], 1.0, 'envelope begins at the scheduled start (0 ms displacement)');
    assert.equal(last[2], 1.24, 'envelope ends at the scheduled end (0 ms displacement)');
    assert.ok(ENVELOPE_MS < SYNC_TOLERANCE_MS); // the budget the shape must fit
  });

  test('routing: osc → tone gain → master bus → destination (master wired once, not per tone)', async () => {
    const { channel, ctx } = await readyChannel(0);
    channel.scheduleTone(1.0, 1.1);
    channel.scheduleTone(1.2, 1.5);
    const master = ctx._gains[0];
    assert.deepEqual(master._connections, [ctx.destination]); // ONE connection
    assert.equal(ctx._oscillators[0]._connections[0], toneGainOf(ctx, 0));
    assert.equal(ctx._oscillators[1]._connections[0], toneGainOf(ctx, 1));
    assert.equal(toneGainOf(ctx, 0)._connections[0], master);
    assert.equal(toneGainOf(ctx, 1)._connections[0], master);
  });

  test('late-scheduled onset clamps to now (OFF edge kept exact); fully-past mark → null, no node', async () => {
    const { channel, ctx } = await readyChannel(0.5);
    const late = channel.scheduleTone(0.4, 1.0); // start 100 ms in the past
    assert.equal(late.start, 0.5);
    assert.equal(late.end, 1.0);
    const osc = ctx._oscillators[0];
    assert.equal(osc._started, 0.5);
    assert.equal(osc._stopped, 1.0); // the boundary that defines the gap stays exact
    assert.equal(toneGainOf(ctx).gain.events[0][2], 0.5, 'envelope anchored at the clamped onset');

    const missed = channel.scheduleTone(0.2, 0.4); // entirely past
    assert.equal(missed, null);
    assert.equal(ctx._oscillators.length, 1, 'no node created for a missed mark');
    assert.equal(channel.status().activeVoices, 1);
  });

  test('argument validation: end ≤ start is RangeError; non-finite times are TypeError', async () => {
    const { channel } = await readyChannel(0);
    assert.throws(() => channel.scheduleTone(1, 1), RangeError);
    assert.throws(() => channel.scheduleTone(2, 1), RangeError);
    assert.throws(() => channel.scheduleTone(NaN, 1), TypeError);
    assert.throws(() => channel.scheduleTone(1, Infinity), TypeError);
    assert.throws(() => channel.scheduleTone('0', 1), TypeError);
  });

  test('degenerate sub-2×envelope mark: triangular envelope, edges still exact', async () => {
    // Impossible at ≤ 12 WPM (a dot is ≥ 100 ms; 2×envelope = 10 ms), but
    // scheduleTone is a public primitive — it must not emit a broken shape.
    const { channel, ctx } = await readyChannel(0);
    const voice = channel.scheduleTone(2.0, 2.006);
    assert.deepEqual(toneGainOf(ctx).gain.events, [
      ['setValueAtTime', 0, 2.0],
      ['linearRampToValueAtTime', 0.5, 2.003], // peak at the midpoint
      ['linearRampToValueAtTime', 0, 2.006],
    ]);
    assert.equal(ctx._oscillators[0]._started, 2.0);
    assert.equal(ctx._oscillators[0]._stopped, 2.006);
  });

  test('lookahead scheduling: absolute future times, synchronous handles, no timers or promises', async () => {
    const { channel, ctx } = await readyChannel(0);
    const marks = [[1.0, 1.1], [1.2, 1.5], [1.6, 1.7]]; // the F2 "SOS"-shaped edges
    const handles = marks.map(([a, b]) => channel.scheduleTone(a, b));
    assert.equal(handles.length, 3);
    for (const h of handles) {
      assert.ok(!(h instanceof Promise), 'fire-ahead contract: not a promise');
      assert.equal(typeof h.cancel, 'function');
    }
    assert.equal(channel.status().activeVoices, 3);
    handles.forEach((h, i) => {
      assert.equal(ctx._oscillators[i]._started, marks[i][0]);
      assert.equal(ctx._oscillators[i]._stopped, marks[i][1]);
    });
    // the module does not cap lookahead — F6's loop owns the window; a
    // whole broadcast scheduled at once is legal (harness.html does it)
    const far = channel.scheduleTone(5.0, 5.24);
    assert.equal(far.start, 5.0);
  });

  test('custom voice options flow through to the scheduled tone', async () => {
    const { channel, ctx } = await readyChannel(0, { frequency: 620, type: 'triangle', envelopeMs: 10, peakGain: 0.3 });
    channel.scheduleTone(1.0, 1.06);
    const osc = ctx._oscillators[0];
    assert.equal(osc.type, 'triangle');
    assert.equal(osc.frequency.value, 620);
    assert.deepEqual(toneGainOf(ctx).gain.events, [
      ['setValueAtTime', 0, 1.0],
      ['linearRampToValueAtTime', 0.3, 1.01], // 10 ms attack
      ['setValueAtTime', 0.3, 1.05],
      ['linearRampToValueAtTime', 0, 1.06],
    ]);
  });

  test('suspended-but-unlocked context: scheduleTone nudges resume WITHOUT awaiting it', async () => {
    const { channel, ctx } = await readyChannel(0);
    ctx.state = 'suspended'; // e.g. iOS re-suspended after backgrounding
    let nudges = 0;
    ctx.resume = () => {
      nudges += 1;
      return new Promise(() => {}); // never resolves — must not block
    };
    const voice = channel.scheduleTone(1.0, 1.24); // returns synchronously
    assert.equal(voice.start, 1.0);
    assert.equal(nudges, 1);
  });

  test('closed context: scheduleTone throws descriptively (unlock again to rebuild)', async () => {
    const { channel, ctx } = await readyChannel(0);
    ctx.state = 'closed'; // closed externally
    assert.throws(() => channel.scheduleTone(1, 2), /context is closed/);
  });

  test('now() is the master clock: tracks ctx.currentTime exactly, 0 before the context exists', async () => {
    const { channel, created } = makeChannel();
    assert.equal(channel.now(), 0);
    await channel.unlock();
    created[0].currentTime = 1.25;
    assert.equal(channel.now(), 1.25);
    created[0].currentTime = 2.5;
    assert.equal(channel.now(), 2.5);
  });
});

describe('F5 · mute behavior', () => {
  test('setMuted(true): click-free fade of the master bus (never an instant cut)', async () => {
    const { channel, ctx } = await readyChannel(0.3);
    channel.setMuted(true);
    assert.equal(channel.isMuted(), true);
    const master = ctx._gains[0];
    assert.deepEqual(master.gain.events, [
      ['cancelScheduledValues', 0.3],
      ['setValueAtTime', 1, 0.3],              // anchor at the current value
      ['linearRampToValueAtTime', 0, 0.305],   // ~5 ms fade — no click
    ]);
    assert.equal(master._connections.length, 1); // routing untouched
  });

  test('unmute restores the bus with the same click-free fade', async () => {
    const { channel, ctx } = await readyChannel(0.3);
    channel.setMuted(true);
    ctx.currentTime = 1.0;
    channel.setMuted(false);
    const master = ctx._gains[0];
    assert.deepEqual(master.gain.events.slice(-2), [
      ['setValueAtTime', 0, 1.0],
      ['linearRampToValueAtTime', 1, 1.005],
    ]);
    assert.equal(channel.isMuted(), false);
  });

  test('toggleMuted() flips and returns the new state', async () => {
    const { channel } = await readyChannel(0);
    assert.equal(channel.toggleMuted(), true);
    assert.equal(channel.isMuted(), true);
    assert.equal(channel.toggleMuted(), false);
    assert.equal(channel.isMuted(), false);
  });

  test('muting before unlock: bus born silent; the TIMELINE continues (mute is not stop)', async () => {
    const { channel, created } = makeChannel();
    channel.setMuted(true); // no context yet — flag only
    await channel.unlock();
    const ctx = created[0];
    assert.equal(ctx._gains[0].gain.value, 0, 'bus starts at 0 — silent from birth');
    const voice = channel.scheduleTone(1.0, 1.24); // marks keep scheduling
    assert.equal(voice.start, 1.0);
    assert.equal(channel.status().activeVoices, 1);
    assert.equal(channel.status().muted, true);
    assert.equal(ctx._oscillators.length, 1, 'nodes exist — only the bus is silent');
    channel.setMuted(false); // unmuting mid-message lands inside it
    assert.deepEqual(ctx._gains[0].gain.events.at(-1), ['linearRampToValueAtTime', 1, 0.005]);
  });
});

describe('F5 · cleanup & release', () => {
  test('natural end: voices self-release — untracked and disconnected, no leak', async () => {
    const { channel, ctx } = await readyChannel(0);
    channel.scheduleTone(1.0, 1.1);
    channel.scheduleTone(1.2, 1.5);
    channel.scheduleTone(1.6, 1.7);
    assert.equal(channel.status().activeVoices, 3);
    for (const osc of ctx._oscillators) osc._end(); // marks finish
    assert.equal(channel.status().activeVoices, 0);
    for (const osc of ctx._oscillators) assert.equal(osc._disconnected, true);
    for (const g of ctx._gains.slice(1)) assert.equal(g._disconnected, true);
    assert.equal(ctx._gains[0]._disconnected, false, 'master bus survives between voices');
  });

  test('voice.cancel(): click-free kill — freeze, fade to 0, stop just after', async () => {
    const { channel, ctx } = await readyChannel(0.6);
    const voice = channel.scheduleTone(1.0, 1.24);
    voice.cancel();
    const gain = toneGainOf(ctx);
    assert.deepEqual(gain.gain.events.slice(-3), [
      ['cancelScheduledValues', 0.6],
      ['setValueAtTime', 0, 0.6],               // freeze at the current value
      ['linearRampToValueAtTime', 0, 0.605],    // ~5 ms fade — no click
    ]);
    assert.equal(ctx._oscillators[0]._stopped, 0.605);
    assert.equal(channel.status().activeVoices, 0, 'untracked immediately');
    ctx._oscillators[0]._end(); // the stop lands → graph released
    assert.equal(ctx._oscillators[0]._disconnected, true);
  });

  test('stopAll(): every pending voice cancelled; bus + mute state untouched; channel reusable', async () => {
    const { channel, ctx } = await readyChannel(0.6);
    channel.setMuted(true); // mute state must survive a stop
    ctx._gains[0].gain.events.length = 0;
    channel.scheduleTone(1.0, 1.1);
    channel.scheduleTone(1.2, 1.5);
    channel.scheduleTone(1.6, 1.7);
    channel.stopAll();
    assert.equal(channel.status().activeVoices, 0);
    for (const osc of ctx._oscillators) assert.equal(osc._stopped, 0.605);
    for (const g of ctx._gains.slice(1)) {
      assert.ok(g.gain.events.some((e) => e[0] === 'cancelScheduledValues'));
    }
    assert.deepEqual(ctx._gains[0].gain.events, [], 'STOP never touches the mute bus');
    assert.equal(channel.status().muted, true);
    // reusable: the next broadcast just schedules
    const again = channel.scheduleTone(2.0, 2.24);
    assert.equal(again.start, 2.0);
  });

  test('stopAll() before unlock: clean no-op', () => {
    const { channel, created } = makeChannel();
    channel.stopAll();
    assert.equal(created.length, 0);
  });

  test('destroy(): voices dropped, context closed, status reset; unlock() builds a FRESH context', async () => {
    const { channel, created } = makeChannel();
    await channel.unlock();
    channel.scheduleTone(1.0, 1.24);
    channel.setMuted(true); // in-memory preference survives destroy
    await channel.destroy();
    const ctx = created[0];
    assert.equal(ctx._closeCalls, 1);
    assert.equal(ctx.state, 'closed');
    assert.deepEqual(
      { ...channel.status() },
      {
        supported: true, created: false, unlocked: false, state: 'none',
        muted: true, activeVoices: 0, toneHz: 700, toneType: 'sine',
        envelopeMs: 5, peakGain: 0.5, toleranceMs: 45,
      }
    );
    assert.throws(() => channel.scheduleTone(1, 2), /unlock\(\) must succeed/);
    assert.equal(channel.now(), 0);
    await channel.unlock(); // fresh context — replay after teardown
    assert.equal(created.length, 2);
    assert.equal(created[1].state, 'running');
    assert.equal(created[1]._gains[0].gain.value, 0, 'mute preference honored on the new bus');
  });

  test('destroy() is idempotent and safe before unlock; closes an injected context too', async () => {
    const never = makeChannel();
    await never.channel.destroy(); // no context — clean no-op
    assert.equal(never.created.length, 0);

    const ctx = createAudioContextStub();
    ctx.state = 'running';
    const channel = createAudioChannel({ context: ctx });
    await channel.destroy();
    assert.equal(ctx._closeCalls, 1, 'the channel owns whatever context it plays through');
    await channel.destroy();
    assert.equal(ctx._closeCalls, 1, 'second destroy: nothing left to close');
  });
});
