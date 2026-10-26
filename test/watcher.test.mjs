// test/watcher.test.mjs — T-W1 acceptance (run-2 plan, research D1–D5).
//
// Dependency-free stub rig: fake clock + fake timers + canvas/ctx stub +
// rVFC-capable video stub + gUM/track stubs. Frames are delivered by
// calling the captured rVFC callback with painted luminance levels; the
// fake timers advance the capability-probe delay by hand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { translate } from '../js/morse.js';
import { schedule, SPEED_STEP_ORDER } from '../js/schedule.js';
import { createReceiveSession, SILENCE_AUTO_COMPLETE_MS } from '../js/receive-session.js';

import {
  SAMPLE_GRID, ROLLING_WINDOW_MS, CONTRAST_GATE, CAPS_DELAY_MS,
  MAX_EXPOSURE_TIME, WATCHER_STATES, createWatcher,
} from '../js/watcher.js';

const FRAME_MS = 1000 / 30;

// Flush the microtask queue so async posture chains settle before asserts.
const flush = () => new Promise((r) => setImmediate(r));

function makeRig({ withRVFC = true, caps = {}, settings = {}, gumError = null, secureContext = true } = {}) {
  let nowMs = 0;
  const timerQueue = [];
  const timers = {
    setTimeout: (fn, ms) => { timerQueue.push({ at: nowMs + ms, fn }); return timerQueue.length; },
    clearTimeout: (id) => { if (id >= 1 && id <= timerQueue.length) timerQueue[id - 1] = null; },
  };
  const advance = (ms) => {
    const target = nowMs + ms;
    for (;;) {
      const due = timerQueue
        .map((t, i) => ({ ...t, i }))
        .filter((t) => t && t.at !== undefined && t.at <= target && timerQueue[t.i])
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timerQueue[due.i] = null;
      due.fn();
    }
    nowMs = target;
  };

  // Paint model: flatLevel fills the grid; quadrant overrides one corner
  // tile block for the ROI probe.
  let paint = { flatLevel: 40 };
  const ctx = {
    drawImage: (v, x, y, w, h) => { ctx.lastDraw = { v, x, y, w, h }; },
    getImageData: (x, y, w, h) => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          let level = paint.flatLevel;
          if (paint.quadrant && px < 8 && py < 8) level = paint.quadrant;
          if (paint.signal !== undefined && px >= 24 && py >= 24) level = paint.signal;
          const i = (py * w + px) * 4;
          data[i] = level; data[i + 1] = level; data[i + 2] = level; data[i + 3] = 255;
        }
      }
      return { data };
    },
    clearRect: (...args) => { ctx.cleared = args; },
  };
  const canvas = {
    width: 0, height: 0,
    getContext: (type, opts) => { canvas.ctxOpts = { type, opts }; return ctx; },
  };

  const rvfcQueue = [];
  const video = {
    srcObject: null, muted: false, playsInline: false, currentTime: 0,
    playCalls: 0,
    play: async () => { video.playCalls += 1; },
  };
  if (withRVFC) {
    video.requestVideoFrameCallback = (cb) => { rvfcQueue.push(cb); };
  }

  const docListeners = {};
  const doc = {
    createElement: () => canvas,
    addEventListener: (n, fn) => { docListeners[n] = fn; },
    removeEventListener: (n) => { delete docListeners[n]; },
  };

  const applyCalls = [];
  const trackListeners = {};
  const track = {
    getCapabilities: async () => caps,
    applyConstraints: async (c) => { applyCalls.push(c); },
    getSettings: async () => settings,
    addEventListener: (n, fn) => { trackListeners[n] = fn; },
    stops: 0,
    stop: () => { track.stops += 1; },
    ended: false,
  };
  const stream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  };

  const gumCalls = [];
  const media = {
    getUserMedia: async (c) => { gumCalls.push(c); if (gumError) throw gumError; return stream; },
  };

  let presented = 0;
  const deliverFrame = (tMs, { presentedAdvance = 1 } = {}) => {
    presented += presentedAdvance;
    const cb = rvfcQueue.shift();
    assert.ok(cb, 'a rVFC callback must be pending');
    cb(tMs, { expectedDisplayTime: tMs, presentedFrames: presented, mediaTime: 0 });
  };

  const watcher = createWatcher({
    video, media, clock: { now: () => nowMs }, doc, timers, secureContext,
  });

  return {
    watcher, video, track, stream, ctx, canvas, timers, advance, doc,
    gumCalls, applyCalls, docListeners, trackListeners,
    setPaint: (p) => { paint = p; },
    deliverFrame,
    get nowMs() { return nowMs; },
  };
}

// Baseline run of quiet frames so the rolling window stabilizes.
function warmUp(rig, { frames = 60, startAt = 0, level = 40 } = {}) {
  rig.setPaint({ flatLevel: level });
  for (let i = 0; i < frames; i++) {
    rig.deliverFrame(startAt + i * FRAME_MS);
  }
  return startAt + frames * FRAME_MS;
}

test('acquire: exact gUM constraints, preview sink attach, watching state', async () => {
  const rig = makeRig();
  const states = [];
  rig.watcher.addEventListener('state', (s) => states.push(s.state));
  const result = await rig.watcher.acquire();
  assert.equal(result.ok, true);
  assert.equal(result.usingRVFC, true);
  assert.equal(rig.gumCalls.length, 1);
  assert.deepEqual(rig.gumCalls[0], {
    video: { facingMode: { ideal: 'environment' }, frameRate: { ideal: 60, min: 24 } },
    audio: false,
  });
  assert.equal(rig.video.srcObject, rig.stream);
  assert.equal(rig.video.muted, true);
  assert.equal(rig.video.playsInline, true);
  assert.equal(rig.video.playCalls, 1);
  assert.equal(rig.watcher.status().state, WATCHER_STATES.WATCHING);
  assert.deepEqual(states, [WATCHER_STATES.ACQUIRING, WATCHER_STATES.WATCHING]);
});

test('acquire error matrix maps gUM rejections to honest outcomes', async () => {
  const named = (name) => Object.assign(new Error(name), { name });
  for (const [errName, outcome] of [
    ['NotAllowedError', 'permission-denied'],
    ['SecurityError', 'permission-denied'],
    ['NotFoundError', 'no-camera'],
    ['NotReadableError', 'busy'],
    ['AbortError', 'busy'],
    ['TypeError', 'failed'],
  ]) {
    const rig = makeRig({ gumError: named(errName) });
    const errors = [];
    rig.watcher.addEventListener('error', (e) => errors.push(e));
    const result = await rig.watcher.acquire();
    assert.equal(result.ok, false);
    assert.equal(result.outcome, outcome, errName);
    assert.equal(errors[0]?.outcome, outcome, errName);
    assert.equal(rig.watcher.status().state, WATCHER_STATES.ERROR);
  }
});

test('insecure context: rejected before any getUserMedia call', async () => {
  const rig = makeRig({ secureContext: false });
  const result = await rig.watcher.acquire();
  assert.deepEqual(result, { ok: false, outcome: 'insecure' });
  assert.equal(rig.gumCalls.length, 0);
  assert.equal(rig.watcher.status().state, WATCHER_STATES.ERROR);
});

test('light edges: midpoint stamp at the original transition (D3)', async () => {
  const rig = makeRig();
  await rig.watcher.acquire();
  const edges = [];
  rig.watcher.addEventListener('edge', (e) => edges.push(e));

  const lastDarkT = warmUp(rig, { frames: 60, startAt: 0, level: 40 }) - FRAME_MS;
  // Flash ON: the peak tracker lifts contrast on the FIRST lit frame.
  rig.setPaint({ flatLevel: 200 });
  const flashStart = lastDarkT + FRAME_MS;
  rig.deliverFrame(flashStart);
  rig.deliverFrame(flashStart + FRAME_MS);          // confirmation frame
  const onEdge = edges.find((e) => e.on);
  assert.ok(onEdge, 'an ON edge must commit');
  // Transition midpoint: between the last dark frame and the first lit
  // frame — NOT stretched to the confirming frame.
  const expected = (lastDarkT + flashStart) / 2;
  assert.ok(Math.abs(onEdge.tMs - expected) < 0.001,
    `midpoint ${expected}, got ${onEdge.tMs}`);
});

test('a single-frame luminance spike never emits an edge (PWM/beat defense)', async () => {
  const rig = makeRig();
  await rig.watcher.acquire();
  const edges = [];
  rig.watcher.addEventListener('edge', (e) => edges.push(e));
  let t = warmUp(rig, { frames: 60, startAt: 0, level: 40 });
  rig.setPaint({ flatLevel: 200 });
  rig.deliverFrame(t + FRAME_MS); // one spike frame
  rig.setPaint({ flatLevel: 40 });
  for (let i = 0; i < 10; i++) rig.deliverFrame(t + 2 * FRAME_MS + i * FRAME_MS);
  assert.equal(edges.length, 0);
});

test('contrast gate: flat scene reports not-hearing and emits nothing', async () => {
  const rig = makeRig();
  await rig.watcher.acquire();
  const edges = [];
  rig.watcher.addEventListener('edge', (e) => edges.push(e));
  warmUp(rig, { frames: 40, startAt: 0, level: 100 });
  const stats = rig.watcher.status();
  assert.equal(stats.hearing, false);
  assert.ok(stats.contrast < CONTRAST_GATE);
  assert.equal(edges.length, 0);
});

test('quiet ROI diagnostics show the brightest tile without inventing contrast', async () => {
  const rig = makeRig();
  await rig.watcher.acquire();
  rig.setPaint({ flatLevel: 40, quadrant: 210 });
  for (let i = 0; i < 20; i++) rig.deliverFrame(i * FRAME_MS);
  const stats = rig.watcher.status();
  assert.equal(stats.level, 210);
});

test('clipping: a blown-out frame reports saturation', async () => {
  const rig = makeRig();
  await rig.watcher.acquire();
  rig.setPaint({ flatLevel: 255 });
  for (let i = 0; i < 10; i++) rig.deliverFrame(i * FRAME_MS);
  const stats = rig.watcher.status();
  assert.equal(stats.saturated, true);
  assert.equal(stats.clippingFraction, 1);
});

test('ambient-light regression: exposure never increases an already short shutter and restores its original setting', async () => {
  const rig = makeRig({
    caps: { exposureMode: ['continuous', 'manual'], exposureTime: { min: 1, max: 1000000, step: 1 } },
    settings: { exposureMode: 'continuous', exposureTime: 40 },
  });
  await rig.watcher.acquire();
  rig.advance(CAPS_DELAY_MS + 1);
  await flush();
  const shutter = rig.applyCalls.find((c) => c.advanced[0].exposureTime !== undefined);
  assert.ok(shutter.advanced[0].exposureTime <= 40, 'do not turn a 4 ms shutter into seconds of exposure');
  rig.watcher.stop();
  assert.deepEqual(rig.applyCalls.at(-1), { advanced: [{ exposureMode: 'continuous', exposureTime: 40 }] });
});

test('ambient-light regression: a steady bright background cannot hide a flashing source', async () => {
  const rig = makeRig();
  await rig.watcher.acquire();
  const edges = [];
  rig.watcher.addEventListener('edge', (e) => edges.push(e));
  let t = 0;
  for (const signal of [40, 180, 40]) {
    rig.setPaint({ flatLevel: 40, quadrant: 255, signal });
    for (let i = 0; i < 30; i++) rig.deliverFrame(t++ * FRAME_MS);
  }
  assert.deepEqual(edges.map((e) => e.on), [true, false]);
});

test('ambient-light regression: a sustained light still emits OFF after the baseline window fills', async () => {
  const rig = makeRig();
  await rig.watcher.acquire();
  const edges = [];
  rig.watcher.addEventListener('edge', (e) => edges.push(e));
  let t = warmUp(rig);
  for (const level of [200, 40]) {
    rig.setPaint({ flatLevel: level });
    for (let i = 0; i < 90; i++) rig.deliverFrame(t + i * FRAME_MS);
    t += 90 * FRAME_MS;
  }
  assert.deepEqual(edges.map((e) => e.on), [true, false]);
  assert.equal(rig.watcher.status().lightOn, false);
});

for (const fps of [24, 30, 60]) {
  for (const step of SPEED_STEP_ORDER) {
    test(`sampled camera frames decode exact text at ${fps} fps / ${step} behind a steady highlight`, async () => {
      const rig = makeRig();
      await rig.watcher.acquire();
      const message = 'HELLO DARK ROOM';
      const { events, durationMs } = schedule(translate(message).tokens, step);
      const session = createReceiveSession();
      let previous = null;
      const heard = [];
      rig.watcher.addEventListener('edge', (edge) => {
        heard.push(edge);
        if (previous !== null) {
          const ms = edge.tMs - previous.tMs;
          if (edge.on) session.feedGap(ms, edge.tMs);
          else session.feedMark(ms, edge.tMs);
        }
        previous = edge;
      });
      rig.watcher.addEventListener('stats', (stats) => session.noteFrame(stats.tMs));
      let index = 0;
      let light = false;
      const start = 2000;
      for (let frame = 0; frame * 1000 / fps < start + durationMs + SILENCE_AUTO_COMPLETE_MS + 500; frame++) {
        const t = frame * 1000 / fps;
        while (index < events.length && events[index].tMs <= t - start) {
          light = events[index++].on;
        }
        rig.setPaint({ flatLevel: 100, quadrant: 255, signal: light ? 230 : 100 });
        rig.deliverFrame(t);
      }
      assert.equal(heard.length, events.length, `missing transitions: ${JSON.stringify(heard.slice(-8))}`);
      for (let i = 0; i < events.length; i++) {
        assert.ok(Math.abs(heard[i].tMs - start - events[i].tMs) <= 1000 / fps,
          `edge ${i}: expected ${start + events[i].tMs}, heard ${heard[i].tMs}`);
      }
      assert.equal(session.status().text, message);
      assert.equal(session.status().completed, true);
    });
  }
}

test('dropped frames are counted and flag the next edge low-confidence', async () => {
  const rig = makeRig();
  await rig.watcher.acquire();
  const edges = [];
  rig.watcher.addEventListener('edge', (e) => edges.push(e));
  let t = warmUp(rig, { frames: 60, startAt: 0, level: 40 });
  rig.setPaint({ flatLevel: 200 });
  rig.deliverFrame(t + 3 * FRAME_MS, { presentedAdvance: 3 }); // 2 frames dropped
  rig.deliverFrame(t + 4 * FRAME_MS);
  const onEdge = edges.find((e) => e.on);
  assert.ok(onEdge);
  assert.equal(onEdge.dropped, true);
  assert.ok(rig.watcher.status().droppedFrames >= 2);
});

test('rAF fallback: dedupes on currentTime, samples with clock.now, decodes edges', async () => {
  const rafQueue = [];
  const raf = (cb) => { rafQueue.push(cb); };
  let videoTime = 0;
  let nowMs = 0;
  const base = makeRig({ withRVFC: false });
  Object.defineProperty(base.video, 'currentTime', {
    get: () => videoTime,
    configurable: true,
  });
  const watcher = createWatcher({
    video: base.video,
    media: { getUserMedia: async (c) => { base.gumCalls.push(c); return base.stream; } },
    clock: { now: () => nowMs },
    doc: base.doc,
    timers: base.timers,
    raf,
    secureContext: true,
  });
  const result = await watcher.acquire();
  assert.equal(result.ok, true);
  assert.equal(result.usingRVFC, false);

  const edges = [];
  watcher.addEventListener('edge', (e) => edges.push(e));
  const statsEvents = [];
  watcher.addEventListener('stats', (s) => statsEvents.push(s));

  // Dark baseline; two ticks share a currentTime → only one sample each.
  base.setPaint({ flatLevel: 40 });
  let frames = 0;
  for (let i = 0; i < 60; i++) {
    videoTime = i / 30;
    nowMs = i * FRAME_MS;
    rafQueue.shift()?.();
    rafQueue.shift()?.(); // duplicate tick, same video frame
    frames += 1;
  }
  const samplesAfterBaseline = statsEvents.length;
  assert.ok(samplesAfterBaseline >= 45, `one sample per frame, got ${samplesAfterBaseline}/60`);

  // A long lit stretch through the fallback path still commits an edge.
  base.setPaint({ flatLevel: 200 });
  videoTime = 60 / 30;
  nowMs = 60 * FRAME_MS;
  rafQueue.shift()?.();
  videoTime = 61 / 30;
  nowMs = 61 * FRAME_MS;
  rafQueue.shift()?.();
  assert.ok(edges.some((e) => e.on), 'fallback path emits ON edges');
  // Clock-stamped: the midpoint lies between the last two frame times.
  const onEdge = edges.find((e) => e.on);
  assert.ok(Math.abs(onEdge.tMs - (59.5 * FRAME_MS)) < 0.001, `fallback stamp, got ${onEdge.tMs}`);
});

test('stop(): camera released, aperture dark, canvas wiped, exposure reset', async () => {
  const rig = makeRig({
    caps: {
      exposureMode: ['continuous', 'manual'],
      exposureTime: { min: 100, max: 10000, step: 100 },
    },
  });
  await rig.watcher.acquire();
  rig.advance(CAPS_DELAY_MS + 1); // capability probe fires
  await flush();
  assert.ok(rig.applyCalls.length >= 2, 'posture applied');

  const released = [];
  rig.watcher.addEventListener('released', () => released.push(1));
  rig.watcher.stop();
  assert.equal(rig.track.stops, 1);
  assert.equal(rig.video.srcObject, null);
  assert.ok(rig.ctx.cleared, 'the sampling canvas is wiped');
  assert.equal(rig.watcher.status().state, WATCHER_STATES.RELEASED);
  assert.equal(released.length, 1);
  // Exposure reset is the LAST applyConstraints recipe.
  const last = rig.applyCalls[rig.applyCalls.length - 1];
  assert.deepEqual(last, { advanced: [{ exposureMode: 'continuous' }] });
});

test('manual shutter is capped in real time units and respects the device minimum', async () => {
  const rig = makeRig({
    caps: {
      exposureMode: ['continuous', 'manual'],
      exposureTime: { min: 100, max: 10000, step: 100 },
    },
  });
  await rig.watcher.acquire();
  rig.advance(CAPS_DELAY_MS + 1);
  await flush();
  assert.deepEqual(rig.applyCalls[0], { advanced: [{ exposureMode: 'manual' }] });
  const target = Math.max(100, MAX_EXPOSURE_TIME);
  assert.deepEqual(rig.applyCalls[1], { advanced: [{ exposureTime: target }] });
});

test('exposure posture D5: EV nudge when only compensation is advertised', async () => {
  const rig = makeRig({
    caps: { exposureCompensation: { min: -2, max: 2, step: 0.5 } },
  });
  await rig.watcher.acquire();
  rig.advance(CAPS_DELAY_MS + 1);
  await flush();
  assert.deepEqual(rig.applyCalls[0], { advanced: [{ exposureCompensation: -0.5 }] });
});

test('no exposure caps anywhere (Safari/Firefox): zero constraint calls', async () => {
  const rig = makeRig({ caps: {} });
  await rig.watcher.acquire();
  rig.advance(CAPS_DELAY_MS + 1);
  for (let i = 0; i < 30; i++) rig.deliverFrame(i * FRAME_MS);
  assert.equal(rig.applyCalls.length, 0);
});

test('failed shutter write restores the mode even when the mode write succeeded', async () => {
  const rig = makeRig({
    caps: { exposureMode: ['continuous', 'manual'], exposureTime: { min: 1, max: 10000 } },
  });
  const apply = rig.track.applyConstraints;
  rig.track.applyConstraints = async (c) => {
    await apply(c);
    if (c.advanced[0].exposureTime !== undefined) throw new Error('shutter rejected');
  };
  await rig.watcher.acquire();
  rig.advance(CAPS_DELAY_MS + 1);
  await flush();
  assert.deepEqual(rig.applyCalls.at(-1), { advanced: [{ exposureMode: 'continuous' }] });
  assert.equal(rig.watcher.status().state, WATCHER_STATES.WATCHING);
});

test('an exposure probe settling after stop cannot write to a newly acquired session', async () => {
  const rig = makeRig();
  let finishCaps;
  rig.track.getCapabilities = () => new Promise((resolve) => { finishCaps = resolve; });
  await rig.watcher.acquire();
  rig.advance(CAPS_DELAY_MS + 1);
  rig.watcher.stop();
  await rig.watcher.acquire();
  finishCaps({ exposureMode: ['continuous', 'manual'], exposureTime: { min: 1, max: 10000 } });
  await flush();
  assert.equal(rig.applyCalls.length, 0);
});

test('track ended mid-watch emits lost', async () => {
  const rig = makeRig();
  await rig.watcher.acquire();
  const lost = [];
  rig.watcher.addEventListener('lost', () => lost.push(1));
  rig.trackListeners.ended();
  assert.equal(lost.length, 1);
});

test('pagehide stops the watcher (safety net)', async () => {
  const rig = makeRig();
  await rig.watcher.acquire();
  rig.docListeners.pagehide();
  assert.equal(rig.track.stops, 1);
  assert.equal(rig.watcher.status().state, WATCHER_STATES.RELEASED);
});

test('non-monotonic frame times are ignored without corrupting state', async () => {
  const rig = makeRig();
  await rig.watcher.acquire();
  let t = warmUp(rig, { frames: 20, startAt: 0 });
  rig.deliverFrame(t - 1000); // time travel — must be a no-op
  const stats = rig.watcher.status();
  assert.ok(Number.isFinite(stats.level));
});

test('TypeError discipline', () => {
  assert.throws(() => createWatcher({}), TypeError);
  assert.throws(() => createWatcher({ video: null }), TypeError);
  assert.throws(() => createWatcher(null), TypeError);
});

test('watcher frame access is confined to sanctioned downsampled forms', () => {
  const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'watcher.js'), 'utf8');
  // The sanctioned forms (research D2/D3) — exact shapes.
  assert.ok(source.includes(`samplingCtx.drawImage(video, 0, 0, SAMPLE_GRID, SAMPLE_GRID)`));
  assert.ok(source.includes(`samplingCtx.getImageData(0, 0, SAMPLE_GRID, SAMPLE_GRID)`));
  assert.ok(source.includes(`getContext('2d', { willReadFrequently: true })`));
  assert.ok(source.includes(`export const SAMPLE_GRID = 32`));
  // The banned-everywhere forms must not appear even here.
  for (const banned of ['toDataURL', 'toBlob', 'captureStream', 'MediaRecorder',
    'createImageBitmap', 'ImageCapture', 'takePhoto', 'grabFrame', 'OffscreenCanvas',
    'MediaStreamTrackProcessor', 'readPixels', 'texImage']) {
    assert.ok(!source.includes(banned), `watcher.js must not contain ${banned}`);
  }
  // Full-resolution reads are structurally impossible: the canvas IS 32×32.
  assert.ok(source.includes('samplingCanvas.width = SAMPLE_GRID'));
  assert.ok(source.includes('samplingCanvas.height = SAMPLE_GRID'));
});

test('stop wipes every pipeline buffer; a re-acquire starts clean', async () => {
  const rig = makeRig();
  await rig.watcher.acquire();
  warmUp(rig, { frames: 30, startAt: 0, level: 40 });
  rig.watcher.stop();
  const result = await rig.watcher.acquire(); // second session on one instance
  assert.equal(result.ok, true);
  const edges = [];
  rig.watcher.addEventListener('edge', (e) => edges.push(e));
  warmUp(rig, { frames: 30, startAt: 10000, level: 40 });
  assert.equal(edges.length, 0); // no stale luminance window → no phantom edges
});
