// test/conductor.test.mjs — F6 broadcast conductor, headless.
//
// Full broadcasts run deterministically against a manually-advanced fake
// clock: the conductor's setTimeout/clearTimeout pair, its master clock
// (options.now / the audio channel's now()), and all three channel
// objects are injected stubs that RECORD {channel, op, at-clock-ms} for
// every call. Timing is then asserted EXACTLY, not approximately:
//
//   - screen edges at exact tMs (the loop sleeps until the next due),
//   - audio tones at exact absolute seconds, scheduled exactly one
//     LOOKAHEAD_MS window ahead,
//   - torch commands at exact tMs − TORCH_LEAD_MS,
//   - takeover at arbitrary marks (dot / dash / gap / final mark / paused),
//   - pause/resume re-anchoring exactness (elapsed skipped, no double
//     fires, nothing re-scheduled into the past),
//   - replay resets cleanly (no leaked timers or live tones),
//   - cancel mid-mark never leaves the light commanded ON.
//
// Stubs are dependency-free plain objects (the F4/F5 shapes are SYNC
// functions returning promises, faithful to the real channels; the audio
// stub records every tone with its scheduling instant).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  createConductor,
  TORCH_LEAD_MS,
  TORCH_LEAD_MIN_MS,
  TORCH_LEAD_MAX_MS,
  START_PAD_MS,
  TORCH_SPACING_FLOOR_MS,
  TAKEOVER_CODES,
  CONDUCTOR_STATES,
  PAUSE_REASONS,
} from '../js/conductor.js';
import { TICK_MS, LOOKAHEAD_MS } from '../js/audio.js';
import { schedule } from '../js/schedule.js';
import { translate } from '../js/morse.js';

// ---------------------------------------------------------------------------
// Deterministic clock

class FakeClock {
  constructor() {
    this.ms = 0;
    this.timers = new Map(); // id → {fn, at}
    this.nextId = 1;
    this.fired = 0;
  }
  setTimeout(fn, ms) {
    const id = this.nextId++;
    this.timers.set(id, { fn, at: this.ms + Math.max(0, ms) });
    return id;
  }
  clearTimeout(id) {
    this.timers.delete(id);
  }
  async advanceTo(target) {
    if (target < this.ms) return;
    for (;;) {
      let dueId = null;
      let dueAt = Infinity;
      for (const [id, t] of this.timers) {
        if (t.at <= target && t.at < dueAt) {
          dueId = id;
          dueAt = t.at;
        }
      }
      if (dueId === null) break;
      const timer = this.timers.get(dueId);
      this.timers.delete(dueId);
      this.ms = Math.max(this.ms, timer.at); // fire AT its exact time
      this.fired++;
      if (this.fired > 100000) throw new Error('FakeClock runaway (timer storm)');
      timer.fn();
      await flush();
    }
    this.ms = target;
  }
  async advance(by) {
    await this.advanceTo(this.ms + by);
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Drive the clock until the conductor's timer chain goes idle. */
async function driveToIdle(clock, limitMs = 120000) {
  while (clock.timers.size > 0 && clock.ms < limitMs) {
    await clock.advance(1000);
  }
  assert.strictEqual(clock.timers.size, 0, 'timer chain must go idle (no leaked ticks)');
}

// ---------------------------------------------------------------------------
// Channel stubs (sync functions returning promises, like the real F3/F4)

function makeScreen(clock, log, opts = {}) {
  let onCalls = 0;
  return {
    attachCount: 0,
    attach() {
      this.attachCount++;
      log.push({ ch: 'screen', op: 'attach', at: clock.ms });
      if (opts.failAttach) return Promise.reject(new Error('screen attach refused'));
      return Promise.resolve({ fullscreen: true });
    },
    on() {
      onCalls++;
      if (opts.throwOnCall === onCalls) throw new Error(`screen wiring bug (on call ${onCalls})`);
      log.push({ ch: 'screen', op: 'on', at: clock.ms });
      if (opts.rejectOnCall === onCalls) return Promise.reject(new Error('screen async refusal'));
      return Promise.resolve();
    },
    off() {
      log.push({ ch: 'screen', op: 'off', at: clock.ms });
      return Promise.resolve();
    },
    hide() {
      log.push({ ch: 'screen', op: 'hide', at: clock.ms });
      return Promise.resolve();
    },
  };
}

function makeAudio(clock, log, opts = {}) {
  const tones = [];
  const channel = {
    tones,
    unlockCount: 0,
    stopAllCount: 0,
    unlock() {
      channel.unlockCount++;
      log.push({ ch: 'audio', op: 'unlock', at: clock.ms });
      if (opts.failUnlock) return Promise.reject(new Error('autoplay denied'));
      return Promise.resolve('running');
    },
    now() {
      return clock.ms / 1000;
    },
    scheduleTone(startSec, endSec) {
      const tone = { start: startSec, end: endSec, at: clock.ms, cancelled: false };
      tones.push(tone);
      log.push({ ch: 'audio', op: 'tone', at: clock.ms, start: startSec, end: endSec });
      return { start: startSec, end: endSec, cancel: () => { tone.cancelled = true; } };
    },
    stopAll() {
      channel.stopAllCount++;
      for (const t of tones) t.cancelled = true;
      log.push({ ch: 'audio', op: 'stopAll', at: clock.ms });
    },
  };
  return channel;
}

function makeTorch(clock, log, opts = {}) {
  const listeners = new Map();
  const torch = {
    cmds: [],
    _lost: false,
    on() {
      torch.cmds.push({ op: 'on', at: clock.ms });
      log.push({ ch: 'torch', op: 'on', at: clock.ms });
      return Promise.resolve();
    },
    off() {
      torch.cmds.push({ op: 'off', at: clock.ms });
      log.push({ ch: 'torch', op: 'off', at: clock.ms });
      return Promise.resolve();
    },
    status() {
      return { state: torch._lost ? 'error' : (opts.state ?? 'torch-ready') };
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    _listenerCount() {
      return listeners.get('lost')?.size ?? 0;
    },
    _lose(code = 'track-ended') {
      torch._lost = true;
      for (const fn of listeners.get('lost') ?? []) fn({ code, detail: `stub ${code}` });
    },
  };
  return torch;
}

function makeVisibility() {
  const vis = {
    hidden: false,
    listener: null,
    addEventListener(type, fn) {
      vis.listener = fn;
    },
    removeEventListener() {
      vis.listener = null;
    },
    isHidden() {
      return vis.hidden;
    },
    async goHidden() {
      vis.hidden = true;
      if (vis.listener) vis.listener();
      await flush();
    },
    async goVisible() {
      vis.hidden = false;
      if (vis.listener) vis.listener();
      await flush();
    },
  };
  return vis;
}

/** One fully-wired conductor rig on a fresh fake clock. */
function rig(opts = {}) {
  const clock = new FakeClock();
  const log = [];
  const rec = { progress: [], takeover: [], complete: [], error: [], pause: [], resume: [] };
  const screenCh = makeScreen(clock, log, opts.screen ?? {});
  const audioCh = makeAudio(clock, log, opts.audio ?? {});
  // torch armed ONLY when a torch config is passed ({} = ready torch);
  // default rig = screen-only broadcast.
  const torchCh = opts.torch ? makeTorch(clock, log, opts.torch) : null;
  const vis = makeVisibility();
  const conductor = createConductor({
    screen: screenCh,
    audio: audioCh,
    torch: torchCh,
    setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
    clearTimeout: (id) => clock.clearTimeout(id),
    visibility: vis,
    ...(opts.conductor ?? {}),
    onProgress: (p) => rec.progress.push(p),
    onTakeover: (p) => rec.takeover.push(p),
    onComplete: (p) => rec.complete.push(p),
    onError: (p) => rec.error.push(p),
    onPause: (p) => rec.pause.push(p),
    onResume: (p) => rec.resume.push(p),
  });
  return { clock, log, rec, screenCh, audioCh, torchCh, vis, conductor };
}

const ops = (log, ch, names) =>
  log.filter((e) => e.ch === ch && names.includes(e.op)).map((e) => ({ op: e.op, at: e.at }));

// ---------------------------------------------------------------------------
// Real F1+F2 schedules as ground truth (F2 pinned the math already)

const SOS_LEARNER = schedule(translate('SOS').tokens, 'LEARNER'); // 9 marks, 6480 ms
const SOS_STANDARD = schedule(translate('SOS').tokens, 'STANDARD');
const SOS_BRISK = schedule(translate('SOS').tokens, 'BRISK');
const E_BRISK = schedule(translate('E').tokens, 'BRISK'); // one 100 ms dot
const EE_BRISK = schedule(translate('EE').tokens, 'BRISK'); // dot 100, letter gap 300,
  // dot 100 → edges on@0 off@100 on@400 off@500, durationMs 500. At BRISK the
  // 100 ms dot is SHORTER than TORCH_LEAD_MS (120), so the lead windows
  // [edgeT−120, edgeT) recur before every edge and cover effectively the
  // whole timeline (the T-F6 verifier's blast-radius finding).
const EMPTY = schedule(translate('   ').tokens, 'LEARNER'); // whitespace-only

test('native torch schedules once per start/resume and cancels on pause and stop', async () => {
  const r = rig({ torch: {} });
  const timelines = [];
  r.torchCh.scheduleTimeline = async timeline => { timelines.push(timeline); };
  await r.conductor.start(SOS_LEARNER);
  assert.equal(timelines.length, 1);
  assert.deepEqual(timelines[0].events, SOS_LEARNER.events);
  assert.equal(timelines[0].positionMs, 0);
  await r.clock.advance(1000);
  assert.equal(r.torchCh.cmds.filter(command => command.op === 'on').length, 0,
    'the JavaScript tick must not send individual native edges');
  r.conductor.pause();
  assert.equal(r.torchCh.cmds.at(-1).op, 'off');
  await r.conductor.resume();
  assert.equal(timelines.length, 2);
  assert.ok(timelines[1].positionMs > 0);
  r.conductor.cancel();
  assert.equal(r.torchCh.cmds.at(-1).op, 'off');
  assert.equal(r.clock.timers.size, 0);
});
// Defect-3 shapes: symbol gaps SHORTER than TORCH_LEAD_MS (120) — the
// next mark's lead ON due precedes the current mark's OFF due, so the
// post-resume catch-up stream is the only place commanded dark can
// collapse. "I" @ BRISK: dots [0,100) [200,300), gap 100 < 120 (full
// collision); "I" @ STANDARD: gap 150, commanded dark gap−lead = 30 ms
// < one 33 ms frame (sub-frame); "S" @ BRISK / "N" @ BRISK: the
// verifier's sweep-flagged dot-chains and dash+dot pairs.
const I_BRISK = schedule(translate('I').tokens, 'BRISK'); // on@0 off@100 on@200 off@300
const I_STANDARD = schedule(translate('I').tokens, 'STANDARD'); // on@0 off@150 on@300 off@450
const N_BRISK = schedule(translate('N').tokens, 'BRISK'); // on@0 off@300 on@400 off@500
const S_BRISK = schedule(translate('S').tokens, 'BRISK'); // on@0 off@100 … on@400 off@500

const A = START_PAD_MS; // wall-clock ms of tMs 0 (clock starts at 0)
const ANCHOR_SEC = START_PAD_MS / 1000;

const edgeOps = (sched, at = (t) => A + t) =>
  sched.events.map((ev) => ({ op: ev.on ? 'on' : 'off', at: at(ev.tMs) }));

const torchEdgeOps = (sched) =>
  sched.events.map((ev) => ({ op: ev.on ? 'on' : 'off', at: A + ev.tMs - TORCH_LEAD_MS }));

const expectedTones = (sched, anchorSec = ANCHOR_SEC) => {
  const out = [];
  for (let i = 0; i < sched.events.length; i += 2) {
    out.push([
      anchorSec + sched.events[i].tMs / 1000,
      anchorSec + sched.events[i + 1].tMs / 1000,
    ]);
  }
  return out;
};

const expectedProgress = (sched, channel) =>
  sched.events
    .filter((ev) => ev.on)
    .map((ev) => ({
      tMs: ev.tMs,
      mark: ev.mark,
      charIdx: ev.charIdx,
      letterIdx: ev.letterIdx,
      symbolIdx: ev.symbolIdx,
      channel,
    }));

// ---------------------------------------------------------------------------
// Constants + construction

describe('F6 constants + construction', () => {
  test('committed constants (R2): lead 120 in [0,200], pad = lead + tick, loop pair from F5', () => {
    assert.strictEqual(TORCH_LEAD_MS, 120);
    assert.strictEqual(TORCH_LEAD_MIN_MS, 0);
    assert.strictEqual(TORCH_LEAD_MAX_MS, 200);
    assert.strictEqual(TICK_MS, 25);
    assert.strictEqual(LOOKAHEAD_MS, 100);
    assert.strictEqual(START_PAD_MS, TORCH_LEAD_MS + TICK_MS);
    assert.deepStrictEqual(CONDUCTOR_STATES, {
      IDLE: 'idle', RUNNING: 'running', PAUSED: 'paused',
      DONE: 'done', STOPPED: 'stopped', FAILED: 'failed',
    });
    assert.deepStrictEqual(PAUSE_REASONS, { USER: 'user', VISIBILITY: 'visibility' });
  });

  test('cold status shape', () => {
    const r = rig();
    const s = r.conductor.status();
    assert.strictEqual(s.state, CONDUCTOR_STATES.IDLE);
    assert.strictEqual(s.channel, null);
    assert.strictEqual(s.positionMs, 0);
    assert.strictEqual(s.hasSchedule, false);
    assert.strictEqual(s.tickPending, false);
    assert.strictEqual(s.clockSource, 'none');
    assert.strictEqual(s.torchLeadMs, TORCH_LEAD_MS);
    assert.strictEqual(s.tickMs, TICK_MS);
    assert.strictEqual(s.lookaheadMs, LOOKAHEAD_MS);
  });

  test('construction wiring-bug TypeErrors', () => {
    const clock = new FakeClock();
    const base = {
      screen: makeScreen(clock, []),
      audio: makeAudio(clock, []),
      setTimeout: clock.setTimeout.bind(clock),
      clearTimeout: clock.clearTimeout.bind(clock),
    };
    assert.throws(() => createConductor({ ...base, screen: null }), TypeError);
    assert.throws(() => createConductor({ ...base, screen: { attach: () => {} } }), TypeError);
    assert.throws(() => createConductor({ ...base, audio: { unlock: 1 } }), TypeError);
    assert.throws(() => createConductor({ ...base, torch: { on: () => {} } }), TypeError);
    assert.throws(() => createConductor({ ...base, onProgress: 'nope' }), TypeError);
    assert.throws(() => createConductor({ ...base, now: 42 }), TypeError);
    assert.throws(
      () => createConductor({ ...base, visibility: { addEventListener: () => {} } }),
      TypeError
    );
    assert.throws(() => createConductor({ ...base, tickMs: 0 }), TypeError);
    assert.throws(() => createConductor({ ...base, startPadMs: -1 }), TypeError);
  });

  test('torchLeadMs range 0–200 enforced (R2: tuned once via Q3, never runtime)', () => {
    const clock = new FakeClock();
    const base = {
      screen: makeScreen(clock, []),
      audio: makeAudio(clock, []),
      setTimeout: clock.setTimeout.bind(clock),
      clearTimeout: clock.clearTimeout.bind(clock),
    };
    assert.throws(() => createConductor({ ...base, torchLeadMs: TORCH_LEAD_MIN_MS - 1 }), RangeError);
    assert.throws(() => createConductor({ ...base, torchLeadMs: TORCH_LEAD_MAX_MS + 1 }), RangeError);
    assert.throws(() => createConductor({ ...base, torchLeadMs: 'fast' }), TypeError);
    for (const ok of [TORCH_LEAD_MIN_MS, 60, TORCH_LEAD_MS, TORCH_LEAD_MAX_MS]) {
      const c = createConductor({ ...base, torchLeadMs: ok });
      assert.strictEqual(c.status().torchLeadMs, ok);
    }
  });
});

// ---------------------------------------------------------------------------
// Screen-mode timing — exact edges at every WPM step

describe('F6 screen-mode broadcast timing (exact tMs, every WPM step)', () => {
  for (const sched of [SOS_LEARNER, SOS_STANDARD, SOS_BRISK]) {
    test(`"SOS" @ ${sched.stepId} (${sched.wpm} WPM, ${sched.durationMs} ms)`, async () => {
      const r = rig();
      assert.strictEqual(r.conductor.status().channel, null);
      const started = await r.conductor.start(sched);
      assert.deepStrictEqual(started, { started: true });

      // torch never commanded (screen-only rig); screen attached in-gesture
      assert.strictEqual(ops(r.log, 'torch', ['on', 'off']).length, 0);
      assert.strictEqual(r.screenCh.attachCount, 1);

      await driveToIdle(r.clock);

      // Screen edges land on their EXACT tMs (only the torch ever leads).
      assert.deepStrictEqual(ops(r.log, 'screen', ['on', 'off']), edgeOps(sched));

      // Audio: exact absolute seconds, scheduled exactly one window ahead.
      assert.deepStrictEqual(
        r.audioCh.tones.map((t) => [t.start, t.end]),
        expectedTones(sched)
      );
      assert.deepStrictEqual(
        r.audioCh.tones.map((t) => t.at),
        sched.events.filter((e) => e.on).map((e) => A + e.tMs - LOOKAHEAD_MS)
      );

      // Per-mark progress for the tape read-head, at the mark's exact ON.
      assert.deepStrictEqual(r.rec.progress, expectedProgress(sched, 'screen'));

      // Terminal state: carrier dropped at the exact end, machine told once.
      assert.deepStrictEqual(ops(r.log, 'screen', ['hide']), [{ op: 'hide', at: A + sched.durationMs }]);
      assert.strictEqual(r.rec.complete.length, 1);
      assert.deepStrictEqual(r.rec.complete[0], {
        durationMs: sched.durationMs,
        channel: 'screen',
        markCount: sched.markCount,
        positionMs: sched.durationMs,
      });
      assert.strictEqual(r.rec.error.length, 0);
      const s = r.conductor.status();
      assert.strictEqual(s.state, CONDUCTOR_STATES.DONE);
      assert.strictEqual(s.channel, 'screen');
    assert.strictEqual(s.positionMs, sched.durationMs);
  });
  }

  test('master clock is the audio clock (AudioContext.currentTime)', async () => {
    const r = rig();
    await r.conductor.start(SOS_LEARNER);
    assert.strictEqual(r.conductor.status().clockSource, 'audio');
    assert.strictEqual(r.audioCh.unlockCount, 1); // anchored after unlock, per R2/F5
    await r.clock.advanceTo(A + 50);
    const s = r.conductor.status();
    assert.ok(Math.abs(s.anchorSec - ANCHOR_SEC) < 1e-9);
    await driveToIdle(r.clock);
    await r.conductor.cancel();
  });

  test('audio edges are the schedule edges — nothing bleeds into gaps', async () => {
    const r = rig();
    await r.conductor.start(SOS_LEARNER);
    await driveToIdle(r.clock);
    // Every tone's [start,end] equals a mark's exact [ON,OFF] — release
    // ends AT the OFF edge, so no tone ever sounds inside a gap.
    const edges = [];
    for (let i = 0; i < SOS_LEARNER.events.length; i += 2) {
      edges.push([SOS_LEARNER.events[i].tMs, SOS_LEARNER.events[i + 1].tMs]);
    }
    assert.deepStrictEqual(
      r.audioCh.tones.map((t) => [Math.round(t.start * 1000 - A), Math.round(t.end * 1000 - A)]),
      edges
    );
  });
});

// ---------------------------------------------------------------------------
// Torch-mode timing — commands at exact tMs − 120

describe('F6 torch-mode broadcast timing (exact tMs − TORCH_LEAD_MS)', () => {
  test('"SOS" @ LEARNER on torch: screen stays standby, only torch leads', async () => {
    const r = rig({ torch: {} });
    assert.strictEqual(r.conductor.status().channel, null);
    await r.conductor.start(SOS_LEARNER);
    assert.strictEqual(r.conductor.status().channel, 'torch');
    assert.strictEqual(r.torchCh._listenerCount(), 1); // 'lost' bound for takeover

    await driveToIdle(r.clock);

    // Torch commands at the EXACT early times (first one at A − 120).
    assert.deepStrictEqual(r.torchCh.cmds, torchEdgeOps(SOS_LEARNER));
    assert.strictEqual(r.torchCh.cmds[0].at, A - TORCH_LEAD_MS);

    // Screen never flashes in torch mode (standby; carrier drop at end).
    assert.deepStrictEqual(ops(r.log, 'screen', ['on', 'off']), []);
    assert.deepStrictEqual(ops(r.log, 'screen', ['hide']), [{ op: 'hide', at: A + SOS_LEARNER.durationMs }]);

    // Audio + progress unaffected by the channel choice.
    assert.deepStrictEqual(
      r.audioCh.tones.map((t) => [t.start, t.end]),
      expectedTones(SOS_LEARNER)
    );
    assert.deepStrictEqual(r.rec.progress, expectedProgress(SOS_LEARNER, 'torch'));
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);
    assert.strictEqual(r.torchCh._listenerCount(), 0); // unbound at completion
  });

  test('torch not armed (status not torch-ready) → screen channel, torch untouched', async () => {
    const r = rig({ torch: { state: 'screen-fallback-recommended' } });
    await r.conductor.start(E_BRISK);
    assert.strictEqual(r.conductor.status().channel, 'screen');
    assert.strictEqual(r.torchCh._listenerCount(), 0);
    await driveToIdle(r.clock);
    assert.strictEqual(r.torchCh.cmds.length, 0);
    assert.deepStrictEqual(ops(r.log, 'screen', ['on', 'off']), edgeOps(E_BRISK));
  });

  test('custom torchLeadMs shifts only the torch channel', async () => {
    // pad widened with the lead so the first early command still has runway
    const r = rig({ torch: {}, conductor: { torchLeadMs: 200, startPadMs: 225 } });
    await r.conductor.start(E_BRISK);
    const A2 = Math.round(r.conductor.status().anchorSec * 1000);
    await driveToIdle(r.clock);
    assert.deepStrictEqual(r.torchCh.cmds, [
      { op: 'on', at: A2 + 0 - 200 },
      { op: 'off', at: A2 + 100 - 200 },
    ]);
    assert.deepStrictEqual(ops(r.log, 'screen', ['on', 'off']), []);
    assert.deepStrictEqual(
      r.audioCh.tones.map((t) => [t.start, t.end]),
      expectedTones(E_BRISK, A2 / 1000)
    );
  });
});

// ---------------------------------------------------------------------------
// Takeover — torch 'lost' → seamless screen, without losing position

describe('F6 torch-loss takeover at arbitrary marks', () => {
  const takeoverAt = async (tMs, code = 'track-ended') => {
    const r = rig({ torch: {} });
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + tMs);
    r.torchCh._lose(code);
    await driveToIdle(r.clock);
    return r;
  };
  const firstIdxAtOrAfter = (tMs) =>
    SOS_LEARNER.events.findIndex((e) => e.tMs >= tMs);

  test('during a dot (t=100, inside mark 0–240): running mark completes on screen', async () => {
    const r = await takeoverAt(100);
    // torch: only the first ON had been commanded (due at −120)
    assert.deepStrictEqual(r.torchCh.cmds, [{ op: 'on', at: A - TORCH_LEAD_MS }]);
    // screen picks up mid-mark NOW, then every later edge at exact tMs
    const from = firstIdxAtOrAfter(240);
    assert.deepStrictEqual(
      ops(r.log, 'screen', ['on', 'off']),
      [{ op: 'on', at: A + 100 }, ...edgeOps(SOS_LEARNER).slice(from)]
    );
    assert.strictEqual(r.rec.takeover.length, 1);
    assert.deepStrictEqual(r.rec.takeover[0], {
      code: 'track-ended',
      detail: 'stub track-ended',
      positionMs: 100,
      from: 'torch',
      to: 'screen',
      midMark: true,
      mark: { mark: 'dot', charIdx: 0, letterIdx: 0, symbolIdx: 0 },
    });
    // audio untouched by the takeover: all 9 marks, exact times
    assert.deepStrictEqual(
      r.audioCh.tones.map((t) => [t.start, t.end]),
      expectedTones(SOS_LEARNER)
    );
    assert.strictEqual(r.rec.complete[0]?.channel, 'screen');
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);
  });

  test('during a dash (t=2200, inside O dash 1920–2640)', async () => {
    const r = await takeoverAt(2200, 'apply-rejected');
    // every torch command whose due (t−120) had passed, and nothing after
    const expectedCmds = SOS_LEARNER.events
      .filter((ev) => ev.tMs - TORCH_LEAD_MS <= 2200)
      .map((ev) => ({ op: ev.on ? 'on' : 'off', at: A + ev.tMs - TORCH_LEAD_MS }));
    assert.deepStrictEqual(r.torchCh.cmds, expectedCmds);
    const from = firstIdxAtOrAfter(2640);
    assert.deepStrictEqual(
      ops(r.log, 'screen', ['on', 'off']),
      [{ op: 'on', at: A + 2200 }, ...edgeOps(SOS_LEARNER).slice(from)]
    );
    assert.deepStrictEqual(r.rec.takeover[0], {
      code: 'apply-rejected',
      detail: 'stub apply-rejected',
      positionMs: 2200,
      from: 'torch',
      to: 'screen',
      midMark: true,
      mark: { mark: 'dash', charIdx: 1, letterIdx: 1, symbolIdx: 0 },
    });
  });

  test('during a gap (t=1500, letter gap 1200–1920): next mark starts on screen at its exact tMs', async () => {
    const r = await takeoverAt(1500);
    // no mid-mark restore: first screen op is the ON edge at exactly 1920
    assert.deepStrictEqual(
      ops(r.log, 'screen', ['on', 'off']),
      edgeOps(SOS_LEARNER).slice(firstIdxAtOrAfter(1920))
    );
    const tk = r.rec.takeover[0];
    assert.strictEqual(tk.midMark, false);
    assert.strictEqual(tk.positionMs, 1500);
    assert.deepStrictEqual(tk.mark, { mark: 'dash', charIdx: 1, letterIdx: 1, symbolIdx: 0 });
  });

  test('during the final mark (t=6300, inside last dot 6240–6480)', async () => {
    const r = await takeoverAt(6300);
    assert.deepStrictEqual(
      ops(r.log, 'screen', ['on', 'off']),
      [{ op: 'on', at: A + 6300 }, { op: 'off', at: A + 6480 }]
    );
    assert.strictEqual(r.rec.takeover[0].midMark, true);
    assert.strictEqual(r.rec.takeover[0].positionMs, 6300);
    assert.deepStrictEqual(r.rec.takeover[0].mark, {
      mark: 'dot', charIdx: 2, letterIdx: 2, symbolIdx: 2,
    });
    assert.strictEqual(r.rec.complete.length, 1);
    assert.deepStrictEqual(ops(r.log, 'screen', ['hide']), [{ op: 'hide', at: A + 6480 }]);
  });

  test('loss while PAUSED: channel switches, no light action, resume drives screen', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + 1000);
    assert.strictEqual(r.conductor.pause('user'), true);
    r.torchCh._lose('track-ended');
    assert.strictEqual(r.rec.takeover.length, 1);
    assert.strictEqual(r.rec.takeover[0].positionMs, 1000);
    assert.strictEqual(r.rec.takeover[0].midMark, true);
    // paused + torch mode: the screen was never raised — no light command
    assert.deepStrictEqual(ops(r.log, 'screen', ['on', 'off']), []);
    await r.clock.advance(777);
    await r.conductor.resume();
    const resumeWall = A + 1777;
    await driveToIdle(r.clock);
    // mid-mark completes on SCREEN now (channel already switched)
    const from = firstIdxAtOrAfter(1200);
    assert.deepStrictEqual(
      ops(r.log, 'screen', ['on', 'off']),
      [{ op: 'on', at: resumeWall }, ...edgeOps(SOS_LEARNER).slice(from).map((o) => ({
        op: o.op, at: resumeWall + o.at - A - 1000,
      }))]
    );
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);
  });

  test('second loss (or loss after takeover) is ignored; listener unbound at takeover', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + 100);
    r.torchCh._lose();
    assert.strictEqual(r.torchCh._listenerCount(), 0);
    r.torchCh._lose(); // would fire nothing anyway; must not throw
    await driveToIdle(r.clock);
    assert.strictEqual(r.rec.takeover.length, 1);
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);
  });
});

// ---------------------------------------------------------------------------
// Manual switch — the operator's SWITCH TO SCREEN key rides the SAME
// takeover mechanics (T-refine-4: the host dispatches the machine's
// SWITCH_CHANNEL, which releases the torch, then calls switchToScreen();
// a bare release() emits 'released', which no conductor listens for).

describe('F6 manual switch to screen (operator takeover)', () => {
  test('mid-dot switch: screen completes from the exact position; the torch is never commanded again', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + 100); // inside mark 0–240 (a dot)
    const torchCmdsAtSwitch = r.torchCh.cmds.length;
    assert.strictEqual(r.conductor.switchToScreen(), true);
    await driveToIdle(r.clock);
    assert.strictEqual(r.torchCh.cmds.length, torchCmdsAtSwitch); // released torch: untouched
    // screen picks up mid-mark NOW, then every later edge at exact tMs —
    // the identical stream a torch loss produces at the same instant
    const from = SOS_LEARNER.events.findIndex((e) => e.tMs >= 240);
    assert.deepStrictEqual(
      ops(r.log, 'screen', ['on', 'off']),
      [{ op: 'on', at: A + 100 }, ...edgeOps(SOS_LEARNER).slice(from)]
    );
    assert.strictEqual(r.rec.takeover.length, 1);
    assert.deepStrictEqual(r.rec.takeover[0], {
      code: TAKEOVER_CODES.MANUAL_SWITCH,
      detail: 'operator switch to screen (machine SWITCH_CHANNEL)',
      positionMs: 100,
      from: 'torch',
      to: 'screen',
      midMark: true,
      mark: { mark: 'dot', charIdx: 0, letterIdx: 0, symbolIdx: 0 },
    });
    // audio/progress/completion: identical to an uninterrupted run — the
    // read-head stream never notices the swap except the channel tag (the
    // first mark reported on 'torch' before the switch, every later one on
    // 'screen' at its exact tMs)
    assert.deepStrictEqual(
      r.audioCh.tones.map((t) => [t.start, t.end]),
      expectedTones(SOS_LEARNER)
    );
    const onEdges = SOS_LEARNER.events.filter((e) => e.on);
    assert.deepStrictEqual(
      r.rec.progress.map((p) => p.tMs),
      onEdges.map((e) => e.tMs)
    );
    assert.deepStrictEqual(
      r.rec.progress.map((p) => p.channel),
      ['torch', ...Array(onEdges.length - 1).fill('screen')]
    );
    assert.strictEqual(r.rec.complete[0]?.channel, 'screen');
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);
  });

  test('switch while PAUSED: channel swaps with no light action; resume completes on screen', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + 1000);
    assert.strictEqual(r.conductor.pause('user'), true);
    assert.strictEqual(r.conductor.switchToScreen(), true);
    assert.strictEqual(r.rec.takeover.length, 1);
    assert.strictEqual(r.rec.takeover[0].code, TAKEOVER_CODES.MANUAL_SWITCH);
    assert.strictEqual(r.rec.takeover[0].positionMs, 1000);
    assert.strictEqual(r.rec.takeover[0].midMark, true);
    // paused: lights stay down — the screen raises only at resume
    assert.deepStrictEqual(ops(r.log, 'screen', ['on', 'off']), []);
    await r.clock.advance(777);
    await r.conductor.resume();
    const resumeWall = A + 1777;
    await driveToIdle(r.clock);
    const from = SOS_LEARNER.events.findIndex((e) => e.tMs >= 1200);
    assert.deepStrictEqual(
      ops(r.log, 'screen', ['on', 'off']),
      [{ op: 'on', at: resumeWall }, ...edgeOps(SOS_LEARNER).slice(from).map((o) => ({
        op: o.op, at: resumeWall + o.at - A - 1000,
      }))]
    );
    assert.strictEqual(r.rec.complete[0]?.channel, 'screen');
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);
  });

  test('no-op unless a torch-channel run is live: idle, done, second call', async () => {
    const r = rig({ torch: {} });
    assert.strictEqual(r.conductor.switchToScreen(), false); // idle, never started
    await r.conductor.start(SOS_LEARNER);
    await driveToIdle(r.clock);
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);
    assert.strictEqual(r.conductor.switchToScreen(), false); // after completion
    assert.strictEqual(r.rec.takeover.length, 0);
  });

  test('idempotent after a takeover (manual or loss): exactly one report, dead torch silent', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + 100);
    assert.strictEqual(r.conductor.switchToScreen(), true);
    assert.strictEqual(r.conductor.switchToScreen(), false); // channel already screen
    assert.strictEqual(r.torchCh._listenerCount(), 0); // 'lost' unbound at takeover
    r.torchCh._lose('track-ended'); // late loss: would fire nothing; must not throw
    await driveToIdle(r.clock);
    assert.strictEqual(r.rec.takeover.length, 1); // no double emits
    assert.strictEqual(r.rec.complete[0]?.channel, 'screen');
  });

  test('screen-only broadcast (no torch channel): switchToScreen is a no-op', async () => {
    const r = rig(); // default rig = screen-only
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + 100);
    assert.strictEqual(r.conductor.switchToScreen(), false);
    assert.strictEqual(r.rec.takeover.length, 0);
    await driveToIdle(r.clock);
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);
  });
});

// ---------------------------------------------------------------------------
// Pause / resume — exact re-anchoring

describe('F6 pause/resume re-anchoring exactness', () => {
  const firstIdxAt = (tMs) => SOS_LEARNER.events.findIndex((e) => e.tMs === tMs);

  test('mid-mark pause: remainder completes; elapsed marks skipped; no double fires', async () => {
    const r = rig();
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + 1000); // inside mark 960–1200
    assert.strictEqual(r.conductor.pause('user'), true);

    // frozen exactly, everything in flight killed, light out
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.PAUSED);
    assert.strictEqual(r.conductor.status().positionMs, 1000);
    assert.strictEqual(r.clock.timers.size, 0);
    assert.strictEqual(r.audioCh.stopAllCount, 1);
    assert.deepStrictEqual(r.rec.pause, [{ reason: 'user', positionMs: 1000 }]);
    assert.deepStrictEqual(ops(r.log, 'screen', ['on', 'off']).slice(0, 5), [
      { op: 'on', at: A + 0 },
      { op: 'off', at: A + 240 },
      { op: 'on', at: A + 480 },
      { op: 'off', at: A + 720 },
      { op: 'on', at: A + 960 },
    ]);
    assert.deepStrictEqual(ops(r.log, 'screen', ['off']).at(-1), { op: 'off', at: A + 1000 });

    await r.clock.advance(1234); // arbitrary hidden time — discarded
    const resumeWall = A + 2234;
    await r.conductor.resume();
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.RUNNING);
    assert.deepStrictEqual(r.rec.resume, [{ positionMs: 1000 }]);
    // head re-reported at the frozen position
    assert.deepStrictEqual(r.rec.progress.at(-1), {
      tMs: 1000, mark: 'dot', charIdx: 0, letterIdx: 0, symbolIdx: 2, channel: 'screen',
    });

    await driveToIdle(r.clock);

    // Exact continuation: restore NOW, then every remaining edge at
    // resumeWall + (tMs − 1000) — the OFF boundary at 1200 lands exactly.
    const from = firstIdxAt(1200);
    const tail = edgeOps(SOS_LEARNER).slice(from).map((o) => ({
      op: o.op, at: resumeWall + (o.at - A) - 1000,
    }));
    assert.deepStrictEqual(ops(r.log, 'screen', ['on', 'off']).slice(5), [
      { op: 'off', at: A + 1000 },
      { op: 'on', at: resumeWall },
      ...tail,
    ]);

    // No double EDGE fires: every ON edge fired exactly once (9 marks),
    // plus exactly one extra light-raise — the mid-mark resume restore
    // (the light was out during the pause; the mark continues, its OFF
    // edge still fires exactly once).
    assert.strictEqual(
      ops(r.log, 'screen', ['on']).length,
      SOS_LEARNER.markCount + 1
    );
    assert.strictEqual(
      ops(r.log, 'screen', ['off']).length,
      SOS_LEARNER.markCount + 1 // 9 edge-offs + the pause lights-out
    );

    // Audio: the 3 pre-pause tones were killed; post-resume the mid-flight
    // mark re-schedules as a partial (past onset, EXACT off) plus every
    // later mark — nothing entirely in the past, nothing re-scheduled past.
    const anchor2 = resumeWall / 1000 - 1.0;
    assert.deepStrictEqual(
      r.audioCh.tones.slice(3).map((t) => [t.start, t.end]),
      expectedTones(SOS_LEARNER, anchor2).slice(2)
    );
    for (const t of r.audioCh.tones) {
      assert.ok(t.end * 1000 >= t.at - 1e-6, 'no tone may end before it is scheduled');
    }
    assert.strictEqual(r.rec.complete.length, 1);
  });

  test('gap pause: no restore; next mark fires at its exact resumed time', async () => {
    const r = rig();
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + 1300); // inside letter gap 1200–1920
    r.conductor.pause('user');
    await r.clock.advance(500);
    await r.conductor.resume();
    const resumeWall = A + 1800;
    await driveToIdle(r.clock);
    const from = firstIdxAt(1920);
    const tail = edgeOps(SOS_LEARNER).slice(from).map((o) => ({
      op: o.op, at: resumeWall + (o.at - A) - 1300,
    }));
    assert.deepStrictEqual(ops(r.log, 'screen', ['on', 'off']).slice(6), [
      { op: 'off', at: A + 1300 }, // pause lights-out
      ...tail, // NO restore ON — first post-resume op is the 1920 ON edge
    ]);
    assert.strictEqual(ops(r.log, 'screen', ['on']).length, SOS_LEARNER.markCount);
  });

  test('double resume / pause-when-idle / resume-when-running are no-ops', async () => {
    const r = rig();
    assert.strictEqual(r.conductor.pause(), false);
    assert.strictEqual(await r.conductor.resume(), false);
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + 500);
    assert.strictEqual(await r.conductor.resume(), false); // running, not paused
    r.conductor.pause('user');
    assert.strictEqual(r.conductor.pause('user'), false); // already paused
    await r.conductor.cancel();
    assert.strictEqual(await r.conductor.resume(), false); // cancelled meanwhile
    assert.strictEqual(r.rec.pause.length, 1);
  });

  test('concurrent resume() calls re-anchor exactly once', async () => {
    const r = rig();
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + 1000);
    r.conductor.pause('user');
    const p1 = r.conductor.resume();
    const p2 = r.conductor.resume(); // racing tap / double dispatch
    assert.strictEqual(await p2, false);
    assert.strictEqual(await p1, true);
    await driveToIdle(r.clock);
    assert.strictEqual(r.rec.resume.length, 1);
    // one restore only: 9 mark ONs + 1 restore (mid-mark pause at 1000)
    assert.strictEqual(ops(r.log, 'screen', ['on']).length, SOS_LEARNER.markCount + 1);
  });

  test('pause exactly ON an edge time never double-fires that edge', async () => {
    const r = rig();
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + 240); // the tick at 240 fired off@240 already
    r.conductor.pause('user');
    assert.strictEqual(r.conductor.status().pausedAtMs, 240);
    await r.clock.advance(1000);
    await r.conductor.resume();
    await driveToIdle(r.clock);
    // off@240 appears at most twice at the SAME ms: once from the loop
    // (the edge) and once from pause()'s lights-out — never twice from the
    // loop, and never re-fired after resume.
    const atEdge = ops(r.log, 'screen', ['off']).filter((o) => o.at === A + 240);
    assert.ok(atEdge.length >= 1 && atEdge.length <= 2);
    assert.strictEqual(ops(r.log, 'screen', ['on']).length, SOS_LEARNER.markCount);
    // 9 edge-offs + exactly one pause lights-out
    assert.strictEqual(ops(r.log, 'screen', ['off']).length, SOS_LEARNER.markCount + 1);
  });

  test('clock-stall catch-up: one giant jump fires every due edge in order, then completes', async () => {
    const r = rig();
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advance(A + SOS_LEARNER.durationMs + 500); // stall past the end
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);
    assert.deepStrictEqual(ops(r.log, 'screen', ['on', 'off']), edgeOps(SOS_LEARNER));
    assert.deepStrictEqual(
      r.audioCh.tones.map((t) => [t.start, t.end]),
      expectedTones(SOS_LEARNER)
    );
    assert.strictEqual(r.rec.complete.length, 1);
    assert.strictEqual(r.clock.timers.size, 0);
  });
});

// ---------------------------------------------------------------------------
// Torch-mode pause/resume INSIDE TORCH_LEAD windows — the T-F6 verifier's
// two defects. Every expected stream below is HAND-COMPUTED (wall-clock ms
// on the fake clock, A = START_PAD_MS = 145), then asserted as the FULL
// command sequence — never call counts.
//
// "EE" @ BRISK: edges on@0 off@100 on@400 off@500; torch dues (tMs−120):
// on@−120, off@−20, on@280, off@380 → fired at walls 25, 125, 425, 525.
// The rule under test (torchDueMs): after a resume re-anchor, a
// countermanded ON whose lead due passed re-fires IMMEDIATELY at the
// resume tick; a countermanded OFF whose lead due passed re-fires at its
// EXACT edge time (never later than offT — and never at the resume
// instant, where it would zero-length the mark just re-lit there).

describe('F6 torch pause/resume inside TORCH_LEAD windows (verifier defects 1+2)', () => {
  const C = (op, at) => ({ op, at });

  test('defect 1: pause @60 (inside the running mark\'s final lead window) — pending OFF re-commanded, gap dark', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(EE_BRISK);
    await r.clock.advanceTo(A + 60);
    assert.strictEqual(r.conductor.pause('user'), true);
    assert.strictEqual(r.conductor.status().pausedAtMs, 60);
    assert.strictEqual(r.clock.timers.size, 0);
    // pre-pause: on@−120(w25), off@−20(w125) — both countermanded by the
    // pause lights-out off@60(w205).
    assert.deepStrictEqual(r.torchCh.cmds, [C('on', 25), C('off', 125), C('off', 205)]);

    await r.clock.advance(140); // hidden wall-time discarded
    await r.conductor.resume();
    await driveToIdle(r.clock);

    // FULL stream (hand-computed): restore on@60(w345); the countermanded
    // off@100 re-commanded at its EXACT edge time (w385) — the defect was
    // its total absence (LED commanded ON through the whole letter gap);
    // then on@280(w565) and off@380(w665) at their live lead dues.
    assert.deepStrictEqual(r.torchCh.cmds, [
      C('on', 25), C('off', 125), C('off', 205),
      C('on', 345), C('off', 385), C('on', 565), C('off', 665),
    ]);
    // gap [100,400) commanded DARK: an OFF sits between the restored mark
    // and the next mark's lead-ON.
    const post = r.torchCh.cmds.slice(3);
    assert.ok(post[0].op === 'on' && post[1].op === 'off' && post[1].at < post[2].at);

    // screen stays standby; carrier dropped at the exact end; one completion
    assert.deepStrictEqual(ops(r.log, 'screen', ['on', 'off']), []);
    assert.deepStrictEqual(ops(r.log, 'screen', ['hide']), [C('hide', 785)]);
    assert.deepStrictEqual(r.rec.complete, [{
      durationMs: 500, channel: 'torch', markCount: 2, positionMs: 500,
    }]);
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);

    // audio: partial remainder (past onset clamped by F5, EXACT off edge)
    // + the second mark — nothing scheduled to end in the past.
    const anchor1 = 345 / 1000 - 60 / 1000;
    assert.deepStrictEqual(
      r.audioCh.tones.slice(1).map((t) => [t.start, t.end]),
      [[anchor1, anchor1 + 0.1], [anchor1 + 0.4, anchor1 + 0.5]]
    );
    assert.deepStrictEqual(r.audioCh.tones.slice(1).map((t) => t.at), [345, 585]);
    for (const t of r.audioCh.tones) {
      assert.ok(t.end * 1000 >= t.at - 1e-6, 'no tone may end before it is scheduled');
    }
    // read-head: mark 0 (pre-pause + head re-report), then mark 1 at 400
    assert.deepStrictEqual(r.rec.progress.map((p) => [p.tMs, p.charIdx]), [[0, 0], [60, 0], [400, 1]]);
  });

  test('defect 2: pause @340 (inside the upcoming mark\'s lead window) — mark lit again on resume', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(EE_BRISK);
    await r.clock.advanceTo(A + 340);
    assert.strictEqual(r.conductor.pause('user'), true);
    // pre-pause: on@280(w425) was already issued — the defect was that its
    // countermand was never repaired: post-resume had `off@380` only and
    // mark [400,500) played DARK against its tone.
    assert.deepStrictEqual(r.torchCh.cmds, [C('on', 25), C('off', 125), C('on', 425), C('off', 485)]);

    await r.clock.advance(160);
    await r.conductor.resume();
    await driveToIdle(r.clock);

    // on@340(w645) IMMEDIATELY at the resume tick (its lead due 280 passed
    // pre-pause); off@380(w685) at its live lead due.
    assert.deepStrictEqual(r.torchCh.cmds, [
      C('on', 25), C('off', 125), C('on', 425), C('off', 485),
      C('on', 645), C('off', 685),
    ]);
    assert.deepStrictEqual(r.rec.progress.map((p) => [p.tMs, p.charIdx]), [[0, 0], [340, 1], [400, 1]]);
    // the mark's tone still plays exactly [400,500]
    const anchor2 = 645 / 1000 - 340 / 1000;
    assert.deepStrictEqual(
      r.audioCh.tones.slice(2).map((t) => [t.start, t.end]),
      [[anchor2 + 0.4, anchor2 + 0.5]]
    );
    assert.deepStrictEqual(ops(r.log, 'screen', ['hide']), [C('hide', 805)]);
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);
  });

  test('both upcoming dues already passed (pause @390): catch-up ON immediate, catch-up OFF at its exact edge — mark NOT zero-lengthened', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(EE_BRISK);
    await r.clock.advanceTo(A + 390);
    r.conductor.pause('user');
    // pre-pause the ENTIRE mark [400,500) was torch-commanded (on@280,
    // off@380) and then countermanded by the pause lights-out.
    assert.deepStrictEqual(r.torchCh.cmds, [
      C('on', 25), C('off', 125), C('on', 425), C('off', 525), C('off', 535),
    ]);
    await r.clock.advance(150);
    await r.conductor.resume();
    await driveToIdle(r.clock);
    // on IMMEDIATELY at the resume instant (w685 = schedule 390 — fires the
    // light before the mark starts, latest-possible catch-up for a passed
    // due); off at its EXACT edge 500 (w795) — a same-instant off would
    // drop the whole mark (the naive torchIdx=resumeIdx re-fire).
    assert.deepStrictEqual(r.torchCh.cmds.slice(5), [C('on', 685), C('off', 795)]);
    assert.deepStrictEqual(r.rec.progress.map((p) => [p.tMs, p.charIdx]), [[0, 0], [390, 1], [400, 1]]);
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);
  });

  test('pause exactly ON the mark\'s ON edge (t=400): full mark renders on resume', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(EE_BRISK);
    await r.clock.advanceTo(A + 400); // the tick at t=400 dispatched edge 2 first
    r.conductor.pause('user');
    assert.strictEqual(r.conductor.status().pausedAtMs, 400);
    assert.deepStrictEqual(r.torchCh.cmds, [
      C('on', 25), C('off', 125), C('on', 425), C('off', 525), C('off', 545),
    ]);
    await r.clock.advance(200);
    await r.conductor.resume();
    await driveToIdle(r.clock);
    // restore on@400(w745) + off at the EXACT 500(w845): the mark plays in
    // full — command-space identical to the screen channel's resume.
    assert.deepStrictEqual(r.torchCh.cmds.slice(5), [C('on', 745), C('off', 845)]);
    assert.deepStrictEqual(ops(r.log, 'screen', ['hide']), [C('hide', 845)]);
    assert.strictEqual(r.rec.complete.length, 1);
  });

  test('pause exactly ON the mark\'s OFF edge (t=100): edge never re-fired, run continues at lead dues', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(EE_BRISK);
    await r.clock.advanceTo(A + 100); // tick dispatched edge 1 at t=100 first
    r.conductor.pause('user');
    assert.strictEqual(r.conductor.status().pausedAtMs, 100);
    assert.deepStrictEqual(r.torchCh.cmds, [C('on', 25), C('off', 125), C('off', 245)]);
    await r.clock.advance(300);
    await r.conductor.resume();
    await driveToIdle(r.clock);
    // edge 1 (off@100) fired pre-pause (w125) and is NOT re-fired after the
    // resume (no double-fire); both remaining edges at their live lead dues.
    assert.deepStrictEqual(r.torchCh.cmds, [
      C('on', 25), C('off', 125), C('off', 245), C('on', 725), C('off', 825),
    ]);
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);
  });

  test('repeated pauses across lead windows (defect-1 window, then defect-2 window) — every cycle complete', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(EE_BRISK);
    await r.clock.advanceTo(A + 60);
    r.conductor.pause('user');
    await r.clock.advance(140);
    await r.conductor.resume();
    await r.clock.advanceTo(A + 480); // schedule t=340 again (wall = 345 + 280): second pause, defect-2 window
    r.conductor.pause('user');
    assert.strictEqual(r.conductor.status().pausedAtMs, 340);
    await r.clock.advance(100);
    await r.conductor.resume();
    await driveToIdle(r.clock);
    // cycle 1: on@60, off@100, on@280 …; pause2 lights-out off@340(w625);
    // cycle 2: on@340 IMMEDIATE (w725 — on@280 had been countermanded),
    // off@380(w765). Every future edge of BOTH cycles commanded exactly once.
    assert.deepStrictEqual(r.torchCh.cmds, [
      C('on', 25), C('off', 125), C('off', 205),
      C('on', 345), C('off', 385), C('on', 565),
      C('off', 625),
      C('on', 725), C('off', 765),
    ]);
    assert.deepStrictEqual(r.rec.progress.map((p) => [p.tMs, p.charIdx]), [
      [0, 0], [60, 0], [340, 1], [400, 1],
    ]);
    assert.deepStrictEqual(r.rec.complete, [{
      durationMs: 500, channel: 'torch', markCount: 2, positionMs: 500,
    }]);
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);
  });

  test('visibilitychange hidden inside the mark\'s lead window (the R2 auto-pause path) — same repaired stream', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(EE_BRISK);
    await r.clock.advanceTo(A + 60);
    await r.vis.goHidden();
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.PAUSED);
    assert.deepStrictEqual(r.rec.pause, [{ reason: 'visibility', positionMs: 60 }]);
    await r.clock.advance(140);
    await r.conductor.resume(); // visible does NOT auto-resume (host intent)
    await driveToIdle(r.clock);
    assert.deepStrictEqual(r.torchCh.cmds, [
      C('on', 25), C('off', 125), C('off', 205),
      C('on', 345), C('off', 385), C('on', 565), C('off', 665),
    ]);
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);
  });

  test('takeover after a lead-window resume: dead torch never re-commanded, screen finishes exactly', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(EE_BRISK);
    await r.clock.advanceTo(A + 60);
    r.conductor.pause('user');
    await r.clock.advance(140);
    await r.conductor.resume();
    await r.clock.advanceTo(A + 340); // schedule t=200 (wall = 345 + 140): inside the letter gap, post-resume
    const torchCmdsAtLoss = r.torchCh.cmds.length;
    r.torchCh._lose('track-ended');
    await driveToIdle(r.clock);
    // torch frozen at loss (its cursor retired); screen completes the rest
    // at exact tMs — off@100(w385) had already re-commanded the boundary.
    assert.strictEqual(r.torchCh.cmds.length, torchCmdsAtLoss);
    assert.deepStrictEqual(r.torchCh.cmds, [
      C('on', 25), C('off', 125), C('off', 205), C('on', 345), C('off', 385),
    ]);
    assert.deepStrictEqual(ops(r.log, 'screen', ['on', 'off']), [
      { op: 'on', at: 685 }, { op: 'off', at: 785 },
    ]);
    assert.deepStrictEqual(r.rec.takeover[0], {
      code: 'track-ended',
      detail: 'stub track-ended',
      positionMs: 200,
      from: 'torch',
      to: 'screen',
      midMark: false,
      mark: { mark: 'dot', charIdx: 1, letterIdx: 1, symbolIdx: 0 },
    });
    assert.strictEqual(r.rec.complete[0].channel, 'screen');
    assert.strictEqual(r.rec.progress.at(-1).channel, 'screen');
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);
  });

  test('torch lost while PAUSED inside the gap\'s lead window: resume drives screen at exact edges', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(EE_BRISK);
    await r.clock.advanceTo(A + 340);
    r.conductor.pause('user');
    r.torchCh._lose('apply-rejected');
    assert.strictEqual(r.rec.takeover[0].positionMs, 340);
    assert.strictEqual(r.rec.takeover[0].midMark, false);
    assert.deepStrictEqual(ops(r.log, 'screen', ['on', 'off']), []); // no light action while paused
    await r.clock.advance(100);
    await r.conductor.resume();
    await driveToIdle(r.clock);
    assert.strictEqual(r.torchCh.cmds.length, 4); // frozen: on@−120 off@−20 on@280 off@340(pause)
    assert.deepStrictEqual(ops(r.log, 'screen', ['on', 'off']), [
      { op: 'on', at: 645 }, // exact tMs 400
      { op: 'off', at: 745 }, // exact tMs 500
    ]);
    assert.strictEqual(r.rec.complete[0].channel, 'screen');
  });

  test('screen channel throwing synchronously on the resume restore fails the broadcast (not the resume() promise)', async () => {
    // 3 screen ONs fire before the pause (t=0/480/960 @LEARNER); the
    // mid-mark restore is the 4th on() — it throws.
    const r = rig({ screen: { throwOnCall: 4 } });
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + 1000);
    r.conductor.pause('user');
    assert.strictEqual(await r.conductor.resume(), false);
    assert.strictEqual(r.rec.error.length, 1);
    assert.strictEqual(r.rec.error[0].phase, 'broadcast');
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.FAILED);
    assert.deepStrictEqual(ops(r.log, 'screen', ['hide']), [{ op: 'hide', at: A + 1000 }]);
    assert.strictEqual(r.clock.timers.size, 0);
  });

  test('injected torchLeadMs widens the DEFAULT start pad (first command still at its exact early time)', async () => {
    const r = rig({ torch: {}, conductor: { torchLeadMs: 200 } });
    await r.conductor.start(E_BRISK);
    assert.strictEqual(Math.round(r.conductor.status().anchorSec * 1000), 225); // 200 + tick 25
    await driveToIdle(r.clock);
    assert.deepStrictEqual(r.torchCh.cmds, [
      { op: 'on', at: 25 },   // anchor 225 − lead 200
      { op: 'off', at: 125 }, // 225 + 100 − 200
    ]);
  });
});

// ---------------------------------------------------------------------------
// Defect 3 (re-verification FAIL): the catch-up OFF and the following mark's
// ON collided in one dispatch tick whenever the inter-mark gap <
// TORCH_LEAD_MS — commanded dark collapsed to 0 (BRISK dots merged into one
// flash while both tones played) or below one 33 ms frame (STANDARD).
//
// THE INVARIANT now pinned everywhere below: in torch COMMAND space, after
// any pause/resume, between any commanded OFF and the next commanded ON
// there is always a dark gap ≥ TORCH_SPACING_FLOOR_MS (33 ms ≈ one 30 fps
// preview frame — R2 §3.1b/§3.1c), with every pending edge still commanded
// exactly once, in order, never before the resume instant. The sweep at the
// bottom would have caught all three verifier defects.

describe('F6 torch pause/resume spacing-floor invariant (verifier defect 3)', () => {
  const C = (op, at) => ({ op, at });

  /** Assert the commanded-stream invariant on the POST-RESUME command
   *  slice of one pause→resume cycle (the pre-pause prefix legitimately
   *  ends with the pause's countermand OFF next to an earlier OFF). */
  const assertPostResumeInvariant = (post, label) => {
    for (let i = 0; i < post.length; i++) {
      assert.strictEqual(post[i].op, i % 2 === 0 ? 'on' : 'off',
        `${label}: cmd#${i} must alternate starting ON — ${JSON.stringify(post)}`);
      if (i === 0) continue;
      assert.ok(post[i].at > post[i - 1].at,
        `${label}: cmd#${i} time must strictly increase — ${JSON.stringify(post)}`);
      if (post[i - 1].op === 'off') {
        const dark = post[i].at - post[i - 1].at;
        assert.ok(dark >= TORCH_SPACING_FLOOR_MS,
          `${label}: commanded dark ${dark} ms < floor ${TORCH_SPACING_FLOOR_MS} — ${JSON.stringify(post)}`);
      }
    }
    assert.strictEqual(post.at(-1).op, 'off', `${label}: stream must end OFF`);
    return post;
  };

  test('spacing floor: committed one-frame constant (R2 §3.1b/§3.1c), injectable + validated', () => {
    assert.strictEqual(TORCH_SPACING_FLOOR_MS, 33); // ⌈1000/30⌉ — one preview frame
    const clock = new FakeClock();
    const base = {
      screen: makeScreen(clock, []),
      audio: makeAudio(clock, []),
      setTimeout: clock.setTimeout.bind(clock),
      clearTimeout: clock.clearTimeout.bind(clock),
    };
    assert.throws(() => createConductor({ ...base, torchSpacingFloorMs: 0 }), TypeError);
    assert.throws(() => createConductor({ ...base, torchSpacingFloorMs: 'wide' }), TypeError);
    assert.strictEqual(createConductor(base).status().torchSpacingFloorMs, TORCH_SPACING_FLOOR_MS);
    assert.strictEqual(
      createConductor({ ...base, torchSpacingFloorMs: 60 }).status().torchSpacingFloorMs, 60
    );
  });

  test('repro A: "I" @ BRISK paused @50 (symbol gap 100 < lead 120) — dots stay distinct, dark ≥ floor', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(I_BRISK);
    await r.clock.advanceTo(A + 50);
    r.conductor.pause('user');
    // pre-pause: on@−120(w25), off@−20(w125) — both countermanded by the
    // pause lights-out off@50(w195).
    assert.deepStrictEqual(r.torchCh.cmds, [C('on', 25), C('off', 125), C('off', 195)]);

    await r.clock.advance(140); // hidden wall time discarded
    await r.conductor.resume();
    await driveToIdle(r.clock);

    // FULL hand-computed stream. The defect fired off@100 AND on@100 in the
    // same tick (next dot's normal due 80 blocked behind the catch-up OFF's
    // exact edge) — one continuous flash for two dots. Fix: the pull to
    // 80−33=47 would land before the restore ON at the resume instant, so
    // the OFF keeps its exact edge and the NEXT ON is advanced to
    // 100+33=133 (still ≤ its exact tMs 200): commanded dark [100,133]=33.
    assert.deepStrictEqual(r.torchCh.cmds, [
      C('on', 25), C('off', 125), C('off', 195),
      C('on', 335), C('off', 385), C('on', 418), C('off', 465),
    ]);
    const post = r.torchCh.cmds.slice(3);
    assert.ok(post[1].at - post[0].at === 50, 'dot 1 keeps its full 50 ms remainder');
    assert.strictEqual(post[2].at - post[1].at, TORCH_SPACING_FLOOR_MS);
    assertPostResumeInvariant(r.torchCh.cmds.slice(3), 'I@BRISK@50');

    // audio + progress + completion unaffected by the torch shaping
    const anchor1 = 335 / 1000 - 50 / 1000;
    assert.deepStrictEqual(
      r.audioCh.tones.slice(1).map((t) => [t.start, t.end]),
      [[anchor1, anchor1 + 0.1], [anchor1 + 0.2, anchor1 + 0.3]]
    );
    assert.deepStrictEqual(r.rec.progress.map((p) => [p.tMs, p.symbolIdx]), [[0, 0], [50, 0], [200, 1]]);
    assert.deepStrictEqual(r.rec.complete, [{
      durationMs: 300, channel: 'torch', markCount: 2, positionMs: 300,
    }]);
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);
  });

  test('repro B: "N" @ BRISK paused @250 (mid-dash, dot follows at gap 100) — dash and dot stay distinct', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(N_BRISK);
    await r.clock.advanceTo(A + 250);
    r.conductor.pause('user');
    assert.deepStrictEqual(r.torchCh.cmds, [C('on', 25), C('off', 325), C('off', 395)]);

    await r.clock.advance(140);
    await r.conductor.resume();
    await driveToIdle(r.clock);

    // Defect: on@250, off@300, on@300, off@380 — dash+dot merged. Fix: the
    // pull to 280−33=247 would precede the restore at 250, so off@300 keeps
    // its exact edge and the dot's ON is advanced to 333.
    assert.deepStrictEqual(r.torchCh.cmds, [
      C('on', 25), C('off', 325), C('off', 395),
      C('on', 535), C('off', 585), C('on', 618), C('off', 665),
    ]);
    assert.strictEqual(r.torchCh.cmds.at(-2).at - r.torchCh.cmds.at(-3).at, TORCH_SPACING_FLOOR_MS);
    assertPostResumeInvariant(r.torchCh.cmds.slice(3), 'N@BRISK@250');
    assert.deepStrictEqual(r.rec.complete, [{
      durationMs: 500, channel: 'torch', markCount: 2, positionMs: 500,
    }]);
  });

  test('repro C: "I" @ STANDARD paused @90 (gap 150: gap−lead = 30 ms sub-frame) — dark pulled to the floor', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(I_STANDARD);
    await r.clock.advanceTo(A + 90);
    r.conductor.pause('user');
    assert.deepStrictEqual(r.torchCh.cmds, [C('on', 25), C('off', 175), C('off', 235)]);

    await r.clock.advance(140);
    await r.conductor.resume();
    await driveToIdle(r.clock);

    // Defect: on@90, off@150 (catch-up exact edge), on@180 (normal due) —
    // 30 ms commanded dark, below one 33 ms preview frame (R2 §3.1b's
    // spacing argument broke post-resume). Fix: the pull to 180−33=147 is
    // FEASIBLE here (147 > 90), so the catch-up OFF fires early — dot 1
    // renders 3 ms short in command space, the accepted trade.
    assert.deepStrictEqual(r.torchCh.cmds, [
      C('on', 25), C('off', 175), C('off', 235),
      C('on', 375), C('off', 432), C('on', 465), C('off', 615),
    ]);
    assert.strictEqual(r.torchCh.cmds.at(-2).at - r.torchCh.cmds.at(-3).at, TORCH_SPACING_FLOOR_MS);
    assertPostResumeInvariant(r.torchCh.cmds.slice(3), 'I@STANDARD@90');
    assert.deepStrictEqual(r.rec.complete, [{
      durationMs: 450, channel: 'torch', markCount: 2, positionMs: 450,
    }]);
  });

  test('pull branch: "S" @ BRISK paused @45 — feasible pull renders dot 1 short, gap floor exact', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(S_BRISK);
    await r.clock.advanceTo(A + 45);
    r.conductor.pause('user');
    assert.deepStrictEqual(r.torchCh.cmds, [C('on', 25), C('off', 125), C('off', 190)]);

    await r.clock.advance(140);
    await r.conductor.resume();
    await driveToIdle(r.clock);

    // pull to 80−33=47 is feasible (47 > 45): off@47, on@80 (its normal
    // due — the pull reserved the floor ahead of it). Dots 1–2 no longer
    // merge (defect stream was on@45, off@100, on@100, off@180, …).
    assert.deepStrictEqual(r.torchCh.cmds, [
      C('on', 25), C('off', 125), C('off', 190),
      C('on', 330), C('off', 332), C('on', 365), C('off', 465), C('on', 565), C('off', 665),
    ]);
    assertPostResumeInvariant(r.torchCh.cmds.slice(3), 'S@BRISK@45');
  });

  test('max compression: "I" @ BRISK paused @99 (BOTH dues passed, next ON catch-up too) — rule pair still resolves', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(I_BRISK);
    await r.clock.advanceTo(A + 99);
    r.conductor.pause('user');
    // pre-pause the next dot's ON (due 80 → w225) had ALSO fired and was
    // countermanded by the pause lights-out off@244.
    assert.deepStrictEqual(r.torchCh.cmds, [
      C('on', 25), C('off', 125), C('on', 225), C('off', 244),
    ]);

    await r.clock.advance(140);
    await r.conductor.resume();
    await driveToIdle(r.clock);

    // The countermanded ON's base is the resume instant 99, i.e. BEFORE
    // the catch-up OFF's exact edge 100. The pull (to 99−33=66) is
    // infeasible, so the OFF keeps 100 and the ON is advanced to 133 —
    // dot 1 renders its full 1 ms remainder, dark 33.
    assert.deepStrictEqual(r.torchCh.cmds, [
      C('on', 25), C('off', 125), C('on', 225), C('off', 244),
      C('on', 384), C('off', 385), C('on', 418), C('off', 465),
    ]);
    assertPostResumeInvariant(r.torchCh.cmds.slice(4), 'I@BRISK@99');
  });

  test('visibilitychange path: "I" @ BRISK hidden @50 — identical repaired stream (R2 auto-pause)', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(I_BRISK);
    await r.clock.advanceTo(A + 50);
    await r.vis.goHidden();
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.PAUSED);
    assert.deepStrictEqual(r.rec.pause, [{ reason: 'visibility', positionMs: 50 }]);
    await r.clock.advance(140);
    await r.conductor.resume(); // visible does NOT auto-resume (host intent)
    await driveToIdle(r.clock);
    assert.deepStrictEqual(r.torchCh.cmds, [
      C('on', 25), C('off', 125), C('off', 195),
      C('on', 335), C('off', 385), C('on', 418), C('off', 465),
    ]);
    assertPostResumeInvariant(r.torchCh.cmds.slice(3), 'I@BRISK@50 (visibility)');
  });

  test('injected exaggerated floor (60) drives the same derivation — and a pull that would equal the restore never zero-lengthens the mark', async () => {
    const r = rig({ torch: {}, conductor: { torchSpacingFloorMs: 60 } });
    await r.conductor.start(I_BRISK);
    await r.clock.advanceTo(A + 20);
    r.conductor.pause('user');
    await r.clock.advance(140);
    await r.conductor.resume();
    await driveToIdle(r.clock);
    // pull target = 80−60 = 20 = the restore instant: the strict pull
    // condition REFUSES it (a zero-length dot), the OFF keeps its exact
    // edge 100, and the ON advances to 100+60 = 160 — dark exactly 60.
    assert.deepStrictEqual(r.torchCh.cmds, [
      C('on', 25), C('off', 125), C('off', 165),
      C('on', 305), C('off', 385), C('on', 445), C('off', 465),
    ]);
    assert.strictEqual(r.torchCh.cmds.at(-2).at - r.torchCh.cmds.at(-3).at, 60);
  });

  // -- the systematic sweep ------------------------------------------------
  //
  // Step through pause positions every 5 ms across a whole schedule and
  // assert the commanded-stream invariant at EVERY position: off→next-on
  // spacing ≥ floor, full coverage of future edges (exactly one command
  // per pending edge + the restore), no double-fires (alternation),
  // nothing before the resume instant, tones re-scheduled with EXACT OFF
  // edges, one completion, zero leaked timers. This oracle flags defect 1
  // (missing OFF), defect 2 (missing ON), and defect 3 (sub-floor dark)
  // at every pause position class: inside a mark's lead window, inside a
  // gap's lead window, both dues passed, exactly on an edge, repeated
  // cycles, mid-dash, symbol/letter/word gaps.

  const sweepPausePositions = async (msg, stepId, stepMs) => {
    const sched = schedule(translate(msg).tokens, stepId);
    const evs = sched.events;
    let positions = 0;
    for (let p = 0; p < sched.durationMs; p += stepMs) {
      const r = rig({ torch: {} });
      await r.conductor.start(sched);
      await r.clock.advanceTo(A + p); // exact-edge positions dispatch first (FakeClock)
      assert.strictEqual(r.conductor.pause('user'), true, `p=${p}: must be running`);
      const preCount = r.torchCh.cmds.length;
      assert.strictEqual(r.torchCh.cmds.at(-1).op, 'off', `p=${p}: pause lights-out is an OFF`);
      await r.clock.advance(217); // odd hidden wall time — discarded on resume
      await r.conductor.resume();
      const resumeWall = r.clock.ms; // captured before the run continues
      await driveToIdle(r.clock); // asserts zero leaked timers itself
      const post = r.torchCh.cmds.slice(preCount);

      // coverage: one command per pending edge (+1 restore mid-mark)
      const dispatched = evs.filter((e) => e.tMs <= p).length;
      const pending = evs.slice(dispatched);
      const restored = pending.length > 0 && pending[0].on === false;
      assert.strictEqual(
        post.length,
        pending.length + (restored ? 1 : 0),
        `p=${p}: one command per pending edge${restored ? ' + restore' : ''} — ${JSON.stringify(post)}`
      );
      // alternation from ON, strict times, floor between OFF→ON, ≥ resume
      for (let i = 0; i < post.length; i++) {
        assert.strictEqual(post[i].op, i % 2 === 0 ? 'on' : 'off',
          `p=${p}: cmd#${i} must alternate starting ON — ${JSON.stringify(post)}`);
        assert.ok(post[i].at >= resumeWall,
          `p=${p}: cmd#${i} before the resume instant — ${JSON.stringify(post)}`);
        if (i === 0) continue;
        assert.ok(post[i].at > post[i - 1].at,
          `p=${p}: cmd#${i} time must strictly increase — ${JSON.stringify(post)}`);
        if (post[i - 1].op === 'off') {
          const dark = post[i].at - post[i - 1].at;
          assert.ok(dark >= TORCH_SPACING_FLOOR_MS,
            `p=${p}: commanded dark ${dark} < floor ${TORCH_SPACING_FLOOR_MS} — ${JSON.stringify(post)}`);
        }
      }
      // tones: every pending mark re-scheduled post-resume, OFF edges EXACT
      // (audio never moved — only the torch catch-up needed re-derivation)
      const anchorSec = resumeWall / 1000 - p / 1000;
      const expected = [];
      for (let i = 0; i < evs.length; i += 2) {
        if (restored && i === dispatched - 1) {
          expected.push([anchorSec + evs[i].tMs / 1000, anchorSec + evs[i + 1].tMs / 1000]);
        } else if (i >= dispatched) {
          expected.push([anchorSec + evs[i].tMs / 1000, anchorSec + evs[i + 1].tMs / 1000]);
        }
      }
      assert.deepStrictEqual(
        r.audioCh.tones.filter((t) => t.at >= resumeWall).map((t) => [t.start, t.end]),
        expected,
        `p=${p}: pending marks re-scheduled with exact OFF edges`
      );

      assert.strictEqual(r.torchCh.cmds.length, preCount + post.length,
        `p=${p}: no torch command after completion`);
      assert.deepStrictEqual(r.rec.complete, [{
        durationMs: sched.durationMs, channel: 'torch',
        markCount: sched.markCount, positionMs: sched.durationMs,
      }], `p=${p}: exactly one completion`);
      assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE, `p=${p}`);
      positions++;
    }
    return positions;
  };

  test('sweep: "SOS N I" @ BRISK — pause every 5 ms, invariant at every position (would have caught all 3 defects)', async () => {
    const n = await sweepPausePositions('SOS N I', 'BRISK', 5);
    assert.ok(n >= 900, `covered ${n} positions`); // 4900 ms / 5 = 980
  });

  test('sweep: "SOS" @ STANDARD — pause every 5 ms (sub-frame gap−lead = 30 class)', async () => {
    const n = await sweepPausePositions('SOS', 'STANDARD', 5);
    assert.ok(n >= 700, `covered ${n} positions`); // 4050 ms / 5 = 810
  });

  test('sweep: "EE" @ LEARNER — pause every 5 ms (letter-gap-only class stays clean)', async () => {
    const n = await sweepPausePositions('EE', 'LEARNER', 5);
    assert.ok(n >= 90, `covered ${n} positions`); // 1440 ms? E+E: 1+3+1 units × 240 = 1200/5 = 240… asserted loosely
  });
});

// ---------------------------------------------------------------------------
// visibilitychange (R2)

describe('F6 visibilitychange pause (hidden → paused; visible does NOT auto-resume)', () => {
  test('hidden mid-broadcast pauses exactly; visible leaves it to the host; resume re-anchors', async () => {
    const r = rig();
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + 500);
    await r.vis.goHidden();

    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.PAUSED);
    assert.deepStrictEqual(r.rec.pause, [{ reason: 'visibility', positionMs: 500 }]);
    assert.strictEqual(r.audioCh.stopAllCount, 1);
    assert.strictEqual(r.clock.timers.size, 0);
    assert.deepStrictEqual(ops(r.log, 'screen', ['off']).at(-1), { op: 'off', at: A + 500 });

    await r.clock.advance(321); // hidden wall-time is discarded
    await r.vis.goVisible();
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.PAUSED); // manual resume by design
    assert.strictEqual(r.rec.resume.length, 0);

    await r.conductor.resume(); // host dispatches machine RESUME → resume()
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.RUNNING);
    await driveToIdle(r.clock);
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);
    // 9 mark ONs + the mid-mark resume restore (t=500 froze inside mark 480–720)
    assert.strictEqual(ops(r.log, 'screen', ['on']).length, SOS_LEARNER.markCount + 1);
  });

  test('hidden while idle/paused is ignored; visibility port unbound on destroy', async () => {
    const r = rig();
    await r.vis.goHidden(); // idle: nothing to pause
    assert.strictEqual(r.rec.pause.length, 0);
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + 300);
    r.conductor.pause('user');
    await r.vis.goHidden(); // already paused: no second pause event
    assert.strictEqual(r.rec.pause.length, 1);
    await r.vis.goVisible();
    r.conductor.destroy();
    assert.strictEqual(r.vis.listener, null); // port unbound — no leak
  });
});

// ---------------------------------------------------------------------------
// Replay — clean restart of the same schedule

describe('F6 replay resets cleanly', () => {
  test('replay after completion: identical relative timing, no leaked timers or tones', async () => {
    const r = rig();
    await r.conductor.start(SOS_LEARNER);
    await driveToIdle(r.clock);
    const firstRunOps = ops(r.log, 'screen', ['on', 'off']).length;
    const firstRunTones = r.audioCh.tones.length;

    const started = await r.conductor.replay();
    assert.deepStrictEqual(started, { started: true });
    assert.strictEqual(r.screenCh.attachCount, 2); // idempotent re-attach per F4
    const A2 = Math.round(r.conductor.status().anchorSec * 1000); // fresh anchor
    await driveToIdle(r.clock);

    const first = edgeOps(SOS_LEARNER);
    const second = edgeOps(SOS_LEARNER, (t) => A2 + t);
    const allOps = ops(r.log, 'screen', ['on', 'off']);
    assert.strictEqual(allOps.length, firstRunOps + SOS_LEARNER.events.length);
    assert.deepStrictEqual(allOps, [...first, ...second]); // full repeat, exact
    assert.strictEqual(r.audioCh.tones.length, firstRunTones + SOS_LEARNER.markCount);
    assert.deepStrictEqual(
      r.audioCh.tones.slice(firstRunTones).map((t) => [t.start, t.end]),
      expectedTones(SOS_LEARNER, A2 / 1000)
    );
    assert.strictEqual(r.rec.complete.length, 2);
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);
    assert.strictEqual(r.clock.timers.size, 0);
  });

  test('replay MID-broadcast: cancels first (tones killed, lights out) then restarts', async () => {
    const r = rig();
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + 1000);
    await r.conductor.replay();
    // the interrupted run was cancelled: audio killed, carrier dropped
    assert.ok(r.audioCh.stopAllCount >= 1);
    assert.deepStrictEqual(ops(r.log, 'screen', ['hide']), [{ op: 'hide', at: A + 1000 }]);
    assert.deepStrictEqual(r.rec.complete, []); // first run never completed
    const A2 = Math.round(r.conductor.status().anchorSec * 1000); // fresh anchor
    await driveToIdle(r.clock);
    assert.strictEqual(ops(r.log, 'screen', ['on']).length, 3 + SOS_LEARNER.markCount);
    // first run: on0, off240, on480, off720, on960, off1000(cancel) — then the repeat
    const second = ops(r.log, 'screen', ['on', 'off']).slice(6);
    assert.deepStrictEqual(second, edgeOps(SOS_LEARNER, (t) => A2 + t));
    assert.strictEqual(r.rec.complete.length, 1);
    assert.strictEqual(r.clock.timers.size, 0);
  });

  test('replay before any start() is a wiring bug', async () => {
    const r = rig();
    await assert.rejects(() => r.conductor.replay(), /no schedule to replay/);
  });
});

// ---------------------------------------------------------------------------
// Cancel — the light is never left ON

describe('F6 cancel mid-broadcast', () => {
  test('cancel mid-mark (screen): off + hide now, audio killed, nothing after', async () => {
    const r = rig();
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + 1100); // inside mark 960–1200
    assert.strictEqual(r.conductor.cancel(), true);
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.STOPPED);
    assert.strictEqual(r.audioCh.stopAllCount, 1);
    assert.deepStrictEqual(ops(r.log, 'screen', ['off']).at(-1), { op: 'off', at: A + 1100 });
    assert.deepStrictEqual(ops(r.log, 'screen', ['hide']), [{ op: 'hide', at: A + 1100 }]);

    const opsBefore = r.log.length;
    await r.clock.advance(3000);
    assert.strictEqual(r.log.length, opsBefore); // dead quiet after cancel
    assert.strictEqual(r.clock.timers.size, 0);
    assert.deepStrictEqual(r.rec.complete, []); // cancel ≠ complete
    assert.strictEqual(r.rec.error.length, 0);
  });

  test('cancel mid-mark (torch): last torch command is OFF — LED never left ON', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + 1100);
    r.conductor.cancel();
    const cmds = r.torchCh.cmds;
    assert.deepStrictEqual(cmds.at(-1), { op: 'off', at: A + 1100 });
    await r.clock.advance(2000);
    assert.strictEqual(cmds.length, ops(r.log, 'torch', ['on', 'off']).length);
    assert.deepStrictEqual(cmds.at(-1), { op: 'off', at: A + 1100 }); // nothing after
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.STOPPED);
  });

  test('cancel after takeover commands only the live channel; idempotent', async () => {
    const r = rig({ torch: {} });
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + 100);
    r.torchCh._lose();
    await r.clock.advanceTo(A + 200);
    const torchCmds = r.torchCh.cmds.length;
    r.conductor.cancel();
    await r.clock.advance(1000);
    assert.strictEqual(r.torchCh.cmds.length, torchCmds); // dead torch untouched
    assert.deepStrictEqual(ops(r.log, 'screen', ['off']).at(-1), { op: 'off', at: A + 200 });
    assert.deepStrictEqual(ops(r.log, 'screen', ['hide']), [{ op: 'hide', at: A + 200 }]);
    assert.strictEqual(r.conductor.cancel(), false); // idempotent no-op
  });

  test('cancel while idle is a no-op; destroy resets to a clean conductor', async () => {
    const r = rig();
    assert.strictEqual(r.conductor.cancel(), false);
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + 400);
    r.conductor.destroy();
    const s = r.conductor.status();
    assert.strictEqual(s.state, CONDUCTOR_STATES.IDLE);
    assert.strictEqual(s.hasSchedule, false);
    assert.strictEqual(s.channel, null);
    assert.strictEqual(r.clock.timers.size, 0);
    assert.strictEqual(ops(r.log, 'torch', ['on', 'off']).length, 0);
    await assert.rejects(() => r.conductor.replay(), /no schedule to replay/);
  });
});

// ---------------------------------------------------------------------------
// Failure paths

describe('F6 failure paths', () => {
  test('screen attach refused → onError(start), state FAILED, no broadcast', async () => {
    const r = rig({ screen: { failAttach: true } });
    const started = await r.conductor.start(SOS_LEARNER);
    assert.strictEqual(started.started, false);
    assert.ok(started.error);
    assert.strictEqual(r.rec.error.length, 1);
    assert.strictEqual(r.rec.error[0].phase, 'start');
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.FAILED);
    assert.strictEqual(r.rec.complete.length, 0);
    assert.strictEqual(r.clock.timers.size, 0);
  });

  test('screen.on() wiring throw mid-broadcast → onError(broadcast), lights out, loop dead', async () => {
    const r = rig({ screen: { throwOnCall: 2 } });
    await r.conductor.start(SOS_LEARNER);
    await driveToIdle(r.clock);
    assert.strictEqual(r.rec.error.length, 1);
    assert.strictEqual(r.rec.error[0].phase, 'broadcast');
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.FAILED);
    assert.deepStrictEqual(r.rec.complete, []);
    assert.strictEqual(r.clock.timers.size, 0);
    // lights attempted out (best-effort off + carrier drop)
    assert.deepStrictEqual(ops(r.log, 'screen', ['hide']), [{ op: 'hide', at: A + 480 }]);
  });

  test('async channel rejections never surface as unhandled; broadcast continues', async () => {
    const unhandled = [];
    const onUnhandled = (err) => unhandled.push(err);
    process.on('unhandledRejection', onUnhandled);
    try {
      const r = rig({ screen: { rejectOnCall: 1 } });
      await r.conductor.start(SOS_LEARNER);
      await driveToIdle(r.clock);
      assert.strictEqual(r.rec.complete.length, 1);
      assert.strictEqual(unhandled.length, 0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  test('start() while active, and malformed schedules, are wiring bugs', async () => {
    const r = rig();
    await r.conductor.start(SOS_LEARNER);
    await assert.rejects(() => r.conductor.start(E_BRISK), /active/);
    await r.conductor.cancel();

    await assert.rejects(
      () => r.conductor.start({ durationMs: 10 }),
      TypeError
    );
    await assert.rejects(
      () => r.conductor.start({ events: 'x', durationMs: 10 }),
      TypeError
    );
    await assert.rejects(
      () => r.conductor.start({ events: [{ tMs: 0, on: false }], durationMs: 10 }),
      /alternate/
    );
    await assert.rejects(
      () => r.conductor.start({
        events: [{ tMs: 0, on: true }, { tMs: 100, on: false }],
        durationMs: 50,
      }),
      RangeError
    );
    // start() with no argument replays the remembered schedule; only a
    // conductor that has never started rejects the empty call.
    await r.conductor.cancel();
    const fresh = rig();
    await assert.rejects(() => fresh.conductor.start(), /expects an F2 schedule/);
  });

  test('broken progress consumer cannot stop the broadcast', async () => {
    const clock = new FakeClock();
    const log = [];
    let calls = 0;
    const conductor = createConductor({
      screen: makeScreen(clock, log),
      audio: makeAudio(clock, log),
      torch: null,
      setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
      clearTimeout: (id) => clock.clearTimeout(id),
      visibility: makeVisibility(),
      onProgress: () => {
        calls++;
        if (calls === 2) throw new Error('UI exploded');
      },
      onComplete: () => log.push({ ch: 'cb', op: 'complete', at: clock.ms }),
    });
    await conductor.start(SOS_LEARNER);
    await driveToIdle(clock);
    assert.ok(calls >= 2);
    assert.strictEqual(conductor.status().state, CONDUCTOR_STATES.DONE);
  });
});

// ---------------------------------------------------------------------------
// Clock sources + degenerate schedules

describe('F6 clock sources and degenerate schedules', () => {
  test('light-only: injected clock drives exact timing, zero tones', async () => {
    const clock = new FakeClock();
    const log = [];
    const rec = { complete: [] };
    const conductor = createConductor({
      screen: makeScreen(clock, log),
      audio: makeAudio(clock, log, { failUnlock: true }),
      torch: null,
      setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
      clearTimeout: (id) => clock.clearTimeout(id),
      visibility: makeVisibility(),
      now: () => clock.ms / 1000,
      onComplete: (p) => rec.complete.push(p),
    });
    await conductor.start(SOS_LEARNER);
    assert.strictEqual(conductor.status().clockSource, 'injected');
    await driveToIdle(clock);
    assert.strictEqual(rec.complete.length, 1);
    assert.deepStrictEqual(ops(log, 'screen', ['on', 'off']), edgeOps(SOS_LEARNER));
    assert.strictEqual(clock.timers.size, 0);
  });

  test('whitespace-only message: instantly-complete broadcast', async () => {
    const r = rig();
    assert.strictEqual(EMPTY.events.length, 0);
    const started = await r.conductor.start(EMPTY);
    assert.deepStrictEqual(started, { started: true, completed: true });
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);
    assert.deepStrictEqual(r.rec.complete, [{
      durationMs: 0, channel: 'screen', markCount: 0, positionMs: 0,
    }]);
    assert.strictEqual(r.screenCh.attachCount, 1); // channels still armed in-gesture
    assert.strictEqual(r.audioCh.unlockCount, 1);
    assert.deepStrictEqual(ops(r.log, 'screen', ['on', 'off']), []);
    assert.strictEqual(r.clock.timers.size, 0);
  });

  test('performance.now fallback (real clock, light-only smoke)', async () => {
    const t0 = performance.now();
    const wall = { get ms() { return Math.round(performance.now() - t0); } };
    const log = [];
    const rec = { complete: [] };
    const conductor = createConductor({
      screen: makeScreen(wall, log),
      audio: makeAudio(wall, log, { failUnlock: true }),
      torch: null,
      visibility: makeVisibility(),
      onComplete: (p) => rec.complete.push(p),
      // real setTimeout/clearTimeout + real performance.now — no injection
    });
    const started = await conductor.start(E_BRISK);
    assert.strictEqual(started.started, true);
    assert.strictEqual(conductor.status().clockSource, 'performance');
    await new Promise((resolve) => setTimeout(resolve, START_PAD_MS + E_BRISK.durationMs + 250));
    assert.strictEqual(conductor.status().state, CONDUCTOR_STATES.DONE);
    assert.strictEqual(rec.complete.length, 1);
    const on = ops(log, 'screen', ['on'])[0];
    const off = ops(log, 'screen', ['off'])[0];
    assert.ok(Math.abs(on.at - START_PAD_MS) < 80, `on at ${on.at}`);
    assert.ok(Math.abs(off.at - START_PAD_MS - 100) < 80, `off at ${off.at}`);
  });

  test('audio re-unlock on resume (idempotent, iOS re-suspension path)', async () => {
    const r = rig();
    await r.conductor.start(SOS_LEARNER);
    await r.clock.advanceTo(A + 500);
    r.conductor.pause('user');
    await r.conductor.resume();
    assert.strictEqual(r.audioCh.unlockCount, 2); // once at start, once at resume
    await driveToIdle(r.clock);
    assert.strictEqual(r.conductor.status().state, CONDUCTOR_STATES.DONE);
  });
});

// ---------------------------------------------------------------------------
// Hygiene

describe('F6 source hygiene', () => {
  test('module is DOM-free: lazy typeof-guarded globals only; no storage/frame tokens', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../js/conductor.js', import.meta.url), 'utf8'));
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const banned of ['localStorage', 'sessionStorage', 'navigator', 'window.', 'querySelector', 'createElement', 'innerHTML', 'drawImage', 'canvas', 'getVideoFrame', 'requestVideoFrameCallback']) {
      assert.ok(!stripped.includes(banned), `banned token in executable code: ${banned}`);
    }
    // The only document reference is the lazy visibility default.
    assert.ok(stripped.includes('typeof document'), 'visibility default binds lazily via typeof guard');
  });
});
