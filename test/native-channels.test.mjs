import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeTorchChannel, createNativeFrameSource, NATIVE_CONTRAST_GATE } from '../native/web/js/native-channel-core.js';
import { createWatcher } from '../js/watcher.js';
import { translate } from '../js/morse.js';
import { schedule, SPEED_STEP_ORDER } from '../js/schedule.js';
import { createReceiveSession, SILENCE_AUTO_COMPLETE_MS } from '../js/receive-session.js';

test('a stray opening dash separated by quiet does not contaminate HELLO', () => {
  const session = createReceiveSession();
  session.feedMark(720, 720);
  session.feedGap(2200, 2920);
  const { events, durationMs } = schedule(translate('HELLO').tokens, 'LEARNER');
  for (let i = 1; i < events.length; i++) {
    const ms = events[i].tMs - events[i - 1].tMs;
    if (events[i].on) session.feedGap(ms, 2920 + events[i].tMs);
    else session.feedMark(ms, 2920 + events[i].tMs);
  }
  session.noteFrame(2920 + durationMs + 1000);
  assert.equal(session.status().text, 'HELLO');
});

test('native receiver does not turn low-contrast desktop flicker into letters', async () => {
  let deliver;
  const watcher = createWatcher({ video: {}, contrastGate: NATIVE_CONTRAST_GATE, frameSource: {
    start: async callback => { deliver = callback; return { ok: true }; }, stop() {},
  } });
  const session = createReceiveSession();
  let previous;
  watcher.addEventListener('edge', edge => {
    if (previous) {
      if (edge.on) session.feedGap(edge.tMs - previous.tMs, edge.tMs);
      else session.feedMark(edge.tMs - previous.tMs, edge.tMs);
    }
    previous = edge;
  });
  watcher.addEventListener('stats', stats => session.noteFrame(stats.tMs, { lightOn: stats.lightOn }));
  await watcher.acquire();
  for (let frame = 0; frame < 300; frame++) {
    const tMs = frame * 1000 / 30;
    const flicker = tMs >= 1000 && tMs < 2920 && Math.floor((tMs - 1000) / 240) % 2 === 0;
    deliver({ tMs, presented: frame + 1, levels: Array(64).fill(flicker ? 130 : 100), clippingFraction: 0 });
  }
  assert.equal(session.status().text, '', 'ordinary low-contrast light must not produce a false H');
  watcher.stop();
});

function pluginRig() {
  const listeners = new Map();
  const calls = [];
  const plugin = { addListener: async (name, fn) => {
    listeners.set(name, fn);
    return { remove: () => listeners.delete(name) };
  } };
  for (const method of ['acquireFlashlight', 'setFlashlight', 'releaseFlashlight', 'scheduleFlashlight', 'startReceiver', 'stopReceiver', 'positionPreview']) {
    plugin[method] = async data => { calls.push({ method, ...data }); return { ok: true }; };
  }
  return { plugin, calls, emit: (name, event) => listeners.get(name)?.(event), listeners };
}

test('native flashlight sends a complete timeline and ignores stale hardware errors after release', async () => {
  const rig = pluginRig();
  const channel = createNativeTorchChannel(rig.plugin);
  let lost = 0;
  channel.addEventListener('lost', () => lost++);
  assert.equal((await channel.acquire()).outcome, 'torch-ready');
  const events = [{ tMs: 0, on: true }, { tMs: 200, on: false }];
  await channel.scheduleTimeline({ events, positionMs: 0, delayMs: 10 });
  const scheduled = rig.calls.find(call => call.method === 'scheduleFlashlight');
  assert.deepEqual(scheduled.events, events);
  await channel.on();
  assert.equal(channel.isLit(), true);
  channel.release();
  rig.emit('hardwareLost', { source: 'flashlight', session: scheduled.session });
  assert.equal(lost, 0);
  assert.equal(channel.isLit(), false);
  assert.equal(rig.calls.at(-1).method, 'releaseFlashlight');
  await channel.destroy();
});

test('release during native permission request cannot reactivate the flashlight', async () => {
  const rig = pluginRig();
  let resolve;
  rig.plugin.acquireFlashlight = () => new Promise(done => { resolve = done; });
  const channel = createNativeTorchChannel(rig.plugin);
  const pending = channel.acquire();
  channel.release();
  resolve({ ok: true });
  assert.equal((await pending).reason, 'cancelled');
  assert.equal(channel.status().acquired, false);
  await channel.destroy();
});

test('native receiver maps camera timestamps, tracks its preview, and drops frames after stop', async () => {
  const rig = pluginRig();
  const video = { style: {}, getBoundingClientRect: () => ({ left: 4, top: 8, width: 80, height: 60 }) };
  const env = { devicePixelRatio: 2, performance: { now: () => 100 },
    requestAnimationFrame: fn => fn(), addEventListener() {}, removeEventListener() {},
    ResizeObserver: class { observe() {} disconnect() {} } };
  const source = createNativeFrameSource(rig.plugin, video, env);
  const frames = [];
  await source.start(frame => frames.push(frame), () => {});
  const start = rig.calls.find(call => call.method === 'startReceiver');
  assert.equal(start.scale, 2);
  rig.emit('cameraFrame', { session: start.session, tMs: 5000 });
  rig.emit('cameraFrame', { session: start.session, tMs: 5033 });
  assert.deepEqual(frames.map(frame => frame.tMs), [100, 133]);
  await source.stop();
  rig.emit('cameraFrame', { session: start.session, tMs: 5066 });
  assert.equal(frames.length, 2);
  assert.equal(video.style.visibility, '');
  assert.equal(rig.listeners.size, 0);
});

for (const fps of [24, 30, 60]) for (const step of SPEED_STEP_ORDER) test(`native brightness tiles decode HELLO DARK ROOM at ${fps} fps / ${step}`, async () => {
  let deliver;
  let stops = 0;
  const watcher = createWatcher({ video: {}, contrastGate: NATIVE_CONTRAST_GATE, frameSource: {
    start: async callback => { deliver = callback; return { ok: true }; },
    stop: () => { stops++; },
  } });
  const session = createReceiveSession();
  let previous = null;
  watcher.addEventListener('edge', edge => {
    if (previous) {
      const ms = edge.tMs - previous.tMs;
      if (edge.on) session.feedGap(ms, edge.tMs);
      else session.feedMark(ms, edge.tMs);
    }
    previous = edge;
  });
  watcher.addEventListener('stats', stats => session.noteFrame(stats.tMs, { lightOn: stats.lightOn }));
  await watcher.acquire();
  const { events, durationMs, dotMs } = schedule(translate('HELLO DARK ROOM').tokens, step);
  let index = 0;
  let light = false;
  let settledText = null;
  for (let frame = 0; frame * 1000 / fps < 4200 + durationMs + SILENCE_AUTO_COMPLETE_MS + 1500; frame++) {
    const tMs = frame * 1000 / fps;
    while (index < events.length && events[index].tMs <= tMs - 4200) light = events[index++].on;
    const idleLevel = tMs >= 200 && tMs < 920 ? 230 : 100;
    const desktopReturned = tMs > 4200 + durationMs + 5500;
    const levels = Array(64).fill(idleLevel);
    levels[0] = 255;
    levels[63] = desktopReturned ? 200 : (light ? 230 : idleLevel);
    deliver({ tMs, presented: frame + 1, levels, clippingFraction: 1 / 64 });
    if (settledText === null && tMs >= 4200 + durationMs + 2.5 * dotMs) settledText = session.status().text;
  }
  assert.equal(settledText, 'HELLO DARK ROOM', 'final M settles before silence completion');
  assert.equal(session.status().text, 'HELLO DARK ROOM');
  watcher.stop();
  const before = session.status().text;
  deliver({ tMs: 999999, presented: 999999, levels: Array(64).fill(255), clippingFraction: 1 });
  assert.equal(session.status().text, before);
  assert.equal(stops, 1);
});
