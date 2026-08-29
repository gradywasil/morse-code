// test/torch.test.mjs — F3 validation (headless: gUM/track/doc/clock stubs).
// Run: `node --test test/torch.test.mjs`
//
// F3 is a media module, so its logic is tested against dependency-free
// stubs: a MediaStreamTrack fake with configurable capability/apply
// behavior covering R1's whole support matrix (full support, iOS top-level
// form, torch:false-only-ON, capabilities-lying, no-capabilities, desktop
// no-camera, permission-denied, timeout paths), a getUserMedia facade that
// records the exact constraints, a document stub whose <video> fires
// loadedmetadata (or not, for the sink-timeout path), and a manually
// advanced fake clock that makes the ~1.5 s probe timeouts observable
// without waiting. Everything headlessly checkable is checked: the R1
// detection order verbatim, the OFF-probe catch, stream keep-alive,
// release/loss lifecycle, honest completion signaling, wiring-bug
// discipline, and the privacy invariant (a source scan proving zero
// frame-access surface). Real LED behavior is Q3's scripted device check
// via harness.html.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createTorchChannel,
  PROBE_TIMEOUT_MS,
  TORCH_OUTCOMES,
  TORCH_STATES,
  TORCH_FALLBACK_REASONS,
  TORCH_ERROR_CODES,
  TORCH_FORMS,
  TORCH_EVENTS,
} from '../js/torch.js';

// ---------------------------------------------------------------------------
// Stubs (tiny, dependency-free)

/** Manually advanced clock: probe timeouts become synchronous, observable
 *  events, and `_pending()` proves no timer leaks. */
function createFakeClock() {
  const timers = new Map();
  let nextId = 0;
  let now = 0;
  return {
    setTimeout(fn, ms) {
      const id = ++nextId;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= now)
        .sort((a, b) => a[1].at - b[1].at);
      for (const [id, t] of due) {
        timers.delete(id);
        t.fn();
      }
    },
    _pending: () => timers.size,
  };
}

/** MediaStreamTrack fake. `apply(constraints, callNumber)` returns
 *  'fulfill' | 'reject' | 'hang' | an Error instance. Passing
 *  `capabilities: undefined` EXPLICITLY means no getCapabilities function
 *  at all (old-Firefox shape) — hence the hasOwnProperty dance. */
function createTrackStub(opts = {}) {
  const hasCaps = Object.prototype.hasOwnProperty.call(opts, 'capabilities');
  const capabilities = hasCaps ? opts.capabilities : { torch: true };
  const apply = opts.apply ?? (() => 'fulfill');
  const log = { applyCalls: [], stopCount: 0 };
  const listeners = new Map();
  const track = {
    kind: 'video',
    label: 'stub rear camera',
    readyState: 'live',
    getCapabilities: hasCaps && capabilities === undefined ? undefined : () => capabilities,
    getSettings: () => ({}),
    applyConstraints(constraints) {
      log.applyCalls.push(constraints);
      const behavior = apply(constraints, log.applyCalls.length);
      if (behavior === 'hang') return new Promise(() => {});
      if (behavior === 'reject' || behavior instanceof Error) {
        return Promise.reject(
          behavior instanceof Error ? behavior : new Error('constraints could not be satisfied (stub)')
        );
      }
      return Promise.resolve();
    },
    stop() {
      log.stopCount += 1;
      track.readyState = 'ended';
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    _dispatch(type) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
    _log: log,
  };
  return track;
}

function createStreamStub(track) {
  return {
    id: 'stub-stream',
    active: true,
    getTracks: () => [track],
    getVideoTracks: () => [track],
  };
}

/** getUserMedia facade: records the exact constraints per call; `gum(n)`
 *  returns a track (fresh session) or an Error to reject with. */
function createMediaDevicesStub(gum) {
  const calls = [];
  const streams = [];
  return {
    calls,
    streams,
    async getUserMedia(constraints) {
      calls.push(constraints);
      const track = gum(calls.length);
      if (track instanceof Error) throw track;
      const stream = createStreamStub(track);
      streams.push(stream);
      return stream;
    },
  };
}

/** Document stub whose <video> elements fire loadedmetadata on play()
 *  (unless metadataOnPlay:false — the sink-timeout path). */
function createDocStub({ metadataOnPlay = true } = {}) {
  const created = [];
  const body = {
    children: [],
    appendChild(el) {
      el.parentNode = body;
      body.children.push(el);
      return el;
    },
  };
  const doc = {
    _created: created,
    _metadataOnPlay: metadataOnPlay,
    body,
    createElement(tag) {
      const listeners = new Map();
      const el = {
        tagName: tag,
        attributes: {},
        style: {},
        parentNode: null,
        srcObject: null,
        readyState: 0,
        muted: false,
        played: 0,
        setAttribute(key, value) {
          el.attributes[key] = String(value);
          if (key === 'muted') el.muted = true;
        },
        getAttribute(key) {
          return key in el.attributes ? el.attributes[key] : null;
        },
        addEventListener(type, fn) {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type).add(fn);
        },
        removeEventListener(type, fn) {
          listeners.get(type)?.delete(fn);
        },
        _dispatch(type) {
          for (const fn of [...(listeners.get(type) ?? [])]) fn();
        },
        play() {
          el.played += 1;
          if (doc._metadataOnPlay) {
            queueMicrotask(() => {
              el.readyState = 1;
              el._dispatch('loadedmetadata');
            });
          }
          return Promise.resolve();
        },
        remove() {
          if (el.parentNode) {
            const i = el.parentNode.children.indexOf(el);
            if (i >= 0) el.parentNode.children.splice(i, 1);
            el.parentNode = null;
          }
        },
      };
      created.push(el);
      return el;
    },
  };
  return doc;
}

/** Canonical wired environment. `capabilities: undefined` passes through
 *  as the explicit no-getCapabilities shape (see createTrackStub). */
function makeEnv(opts = {}) {
  const clock = createFakeClock();
  const trackOpts = {};
  if (Object.prototype.hasOwnProperty.call(opts, 'capabilities')) {
    trackOpts.capabilities = opts.capabilities;
  }
  if (opts.apply) trackOpts.apply = opts.apply;
  const track = createTrackStub(trackOpts);
  const mediaDevices = createMediaDevicesStub(opts.gum ?? (() => track));
  const doc = opts.withDoc === false ? undefined : createDocStub({ metadataOnPlay: opts.metadataOnPlay !== false });
  const channel = createTorchChannel({
    mediaDevices,
    ...(doc ? { doc } : {}),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  return { channel, clock, track, mediaDevices, doc };
}

const torchOf = (c) => (Array.isArray(c.advanced) ? c.advanced[0].torch : c.torch);
const namedError = (name, message) => {
  const err = new Error(message ?? name);
  err.name = name;
  return err;
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
async function settle(times = 4) {
  for (let i = 0; i < times; i += 1) await flush();
}

// ---------------------------------------------------------------------------
// Constants + module hygiene + the privacy invariant

describe('F3 constants', () => {
  test('PROBE_TIMEOUT_MS is ~1.5 s, per R1 §5 ("wrap both in a ~1.5 s timeout")', () => {
    assert.equal(PROBE_TIMEOUT_MS, 1500);
  });

  test('TORCH_STATES is the exact F8-facing lifecycle map, frozen', () => {
    assert.deepEqual(TORCH_STATES, {
      IDLE: 'idle',
      PROBING: 'probing',
      READY: 'torch-ready',
      SCREEN_FALLBACK: 'screen-fallback-recommended',
      ERROR: 'error',
    });
    assert.ok(Object.isFrozen(TORCH_STATES));
  });

  test('outcomes, fallback reasons, error codes, forms, events are frozen with unique values', () => {
    for (const map of [TORCH_OUTCOMES, TORCH_FALLBACK_REASONS, TORCH_ERROR_CODES, TORCH_FORMS, TORCH_EVENTS]) {
      assert.ok(Object.isFrozen(map));
      const values = Object.values(map);
      assert.equal(new Set(values).size, values.length);
    }
    assert.equal(TORCH_OUTCOMES.READY, 'torch-ready');
    assert.equal(TORCH_OUTCOMES.SCREEN_FALLBACK, 'screen-fallback');
    assert.equal(TORCH_FALLBACK_REASONS.PROBE_OFF_FAILED, 'probe-off-failed');
    assert.equal(TORCH_ERROR_CODES.APPLY_REJECTED, 'apply-rejected');
    assert.equal(TORCH_FORMS.ADVANCED, 'advanced');
    assert.equal(TORCH_FORMS.TOPLEVEL, 'toplevel');
    assert.equal(TORCH_EVENTS.LOST, 'lost');
    assert.equal(TORCH_EVENTS.RELEASED, 'released');
  });
});

describe('F3 hygiene + privacy', () => {
  test('constructs with no options under bare Node: idle, no media stack, nothing acquired', () => {
    const channel = createTorchChannel();
    const status = channel.status();
    assert.equal(status.state, TORCH_STATES.IDLE);
    assert.equal(status.acquired, false);
    assert.equal(status.sinkAttached, false);
    assert.equal(typeof status.supported, 'boolean');
  });

  test('construction never touches getUserMedia (never auto-acquire — gesture only)', () => {
    const { mediaDevices, channel } = makeEnv();
    assert.equal(mediaDevices.calls.length, 0);
    assert.equal(channel.status().state, TORCH_STATES.IDLE);
    for (let i = 0; i < 3; i += 1) createTorchChannel({ mediaDevices });
    assert.equal(mediaDevices.calls.length, 0);
  });

  test('PRIVACY: zero frame-access surface in js/torch.js (comment-stripped source scan)', () => {
    const source = readFileSync(new URL('../js/torch.js', import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const banned = [
      'drawImage',
      'ImageCapture',
      'getImageData',
      'getVideoFrame',
      'requestVideoFrameCallback',
      'createImageBitmap',
      'transferToImageBitmap',
      'toBlob',
      'toDataURL',
      'captureStream',
      'OffscreenCanvas',
      'HTMLCanvasElement',
      'getContext',
    ];
    for (const token of banned) {
      assert.ok(!code.includes(token), `frame API leaked into code: ${token}`);
    }
    assert.ok(!code.toLowerCase().includes('canvas'), 'canvas reference leaked into code');
    // The sanctioned exception, kept visible on purpose: the keep-alive sink.
    assert.ok(code.includes('srcObject'), 'the keep-alive sink should be the visible srcObject assignment');
  });
});

// ---------------------------------------------------------------------------
// Detection order, device class by device class (R1 §5 verbatim)

describe('F3 step 0 — insecure context', () => {
  test('no navigator.mediaDevices → screen-fallback/insecure-context, no prompt attempted', async () => {
    const channel = createTorchChannel(); // bare Node: mediaDevices undefined
    const result = await channel.acquire();
    assert.deepEqual(
      { outcome: result.outcome, reason: result.reason },
      { outcome: TORCH_OUTCOMES.SCREEN_FALLBACK, reason: TORCH_FALLBACK_REASONS.INSECURE_CONTEXT }
    );
    assert.match(result.detail, /mediaDevices/);
    assert.equal(channel.status().state, TORCH_STATES.SCREEN_FALLBACK);
    assert.equal(channel.status().supported, false);
  });
});

describe('F3 full support (Android-Chromium shape)', () => {
  test('torch-ready via advanced form; exact R1 sequence: gUM constraints, ON probe, OFF probe', async () => {
    const { channel, track, mediaDevices, clock, doc } = makeEnv();
    const result = await channel.acquire();
    assert.deepEqual(result, { outcome: TORCH_OUTCOMES.READY, form: TORCH_FORMS.ADVANCED });
    assert.equal(channel.status().state, TORCH_STATES.READY);
    // R1 §5.2 exactly: environment-IDEAL, audio:false
    assert.equal(mediaDevices.calls.length, 1);
    assert.deepEqual(mediaDevices.calls[0], {
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    // R1 §5.4 exactly: advanced ON, then advanced OFF (both must resolve)
    assert.deepEqual(track._log.applyCalls, [{ advanced: [{ torch: true }] }, { advanced: [{ torch: false }] }]);
    assert.equal(track._log.stopCount, 0); // stream KEPT ALIVE (torch dies with the track)
    assert.equal(channel.status().sinkAttached, true);
    assert.equal(doc.body.children.length, 1);
    assert.equal(clock._pending(), 0); // every probe timeout cleared
  });

  test('state reads "probing" synchronously at acquire() call time', async () => {
    const { channel } = makeEnv();
    const pending = channel.acquire();
    assert.equal(channel.status().state, TORCH_STATES.PROBING);
    await pending;
    assert.equal(channel.status().state, TORCH_STATES.READY);
  });

  test('on()/off() use the winning form; desired/applied track acceptance; stream still alive', async () => {
    const { channel, track } = makeEnv();
    await channel.acquire();
    await channel.on();
    assert.deepEqual(track._log.applyCalls[2], { advanced: [{ torch: true }] });
    assert.equal(channel.status().desired, true);
    assert.equal(channel.status().applied, true);
    assert.equal(channel.isLit(), true);
    await channel.off();
    assert.deepEqual(track._log.applyCalls[3], { advanced: [{ torch: false }] });
    assert.equal(channel.status().applied, false);
    assert.equal(channel.isLit(), false);
    assert.equal(track._log.stopCount, 0); // kept alive across the whole "broadcast"
  });

  test('acquire() while ready is cached — no second camera prompt', async () => {
    const { channel, mediaDevices } = makeEnv();
    await channel.acquire();
    const again = await channel.acquire();
    assert.deepEqual(again, { outcome: TORCH_OUTCOMES.READY, form: TORCH_FORMS.ADVANCED });
    assert.equal(mediaDevices.calls.length, 1);
  });

  test('concurrent acquire() calls share one in-flight probe', async () => {
    const { channel } = makeEnv();
    const p1 = channel.acquire();
    const p2 = channel.acquire();
    assert.strictEqual(p1, p2);
    await p1;
  });
});

describe('F3 iOS 17.4+ shape (advanced rejected, top-level accepted)', () => {
  test('falls back to the top-level form per direction; hot path uses top-level only', async () => {
    const apply = (c) => (Array.isArray(c.advanced) ? 'reject' : 'fulfill');
    const { channel, track } = makeEnv({ apply });
    const result = await channel.acquire();
    assert.deepEqual(result, { outcome: TORCH_OUTCOMES.READY, form: TORCH_FORMS.TOPLEVEL });
    // R1 §5.4: retry once with the top-level form, same shape for OFF
    assert.deepEqual(track._log.applyCalls, [
      { advanced: [{ torch: true }] },
      { torch: true },
      { advanced: [{ torch: false }] },
      { torch: false },
    ]);
    await channel.on();
    assert.deepEqual(track._log.applyCalls[4], { torch: true });
    assert.equal(track._log.stopCount, 0);
  });
});

describe('F3 device-class catches', () => {
  test('mixed forms (advanced wins ON, only top-level wins OFF): per-direction forms used on the hot path', async () => {
    const apply = (c) => (torchOf(c) === false && Array.isArray(c.advanced) ? 'reject' : 'fulfill');
    const { channel, track } = makeEnv({ apply });
    const result = await channel.acquire();
    assert.deepEqual(result, { outcome: TORCH_OUTCOMES.READY, form: TORCH_FORMS.ADVANCED });
    assert.deepEqual(channel.status().forms, { on: TORCH_FORMS.ADVANCED, off: TORCH_FORMS.TOPLEVEL });
    await channel.off(); // must ride the form that actually works for OFF
    assert.deepEqual(track._log.applyCalls.at(-1), { torch: false });
    await channel.on();
    assert.deepEqual(track._log.applyCalls.at(-1), { advanced: [{ torch: true }] });
    assert.equal(track._log.stopCount, 0);
  });

  test('torch:false-only-ON (Chromium 1246938 class) is caught by the OFF probe → screen fallback', async () => {
    const apply = (c) => (torchOf(c) === false ? 'reject' : 'fulfill');
    const { channel, track, doc } = makeEnv({ apply });
    const result = await channel.acquire();
    assert.equal(result.outcome, TORCH_OUTCOMES.SCREEN_FALLBACK);
    assert.equal(result.reason, TORCH_FALLBACK_REASONS.PROBE_OFF_FAILED);
    assert.match(result.detail, /torch:false/);
    assert.equal(channel.status().state, TORCH_STATES.SCREEN_FALLBACK);
    // ON succeeded (advanced), OFF rejected in BOTH forms
    assert.deepEqual(track._log.applyCalls, [
      { advanced: [{ torch: true }] },
      { advanced: [{ torch: false }] },
      { torch: false },
    ]);
    assert.equal(track._log.stopCount, 1); // killed — never hand a stuck-ON LED to the user
    assert.equal(doc.body.children.length, 0); // sink detached
    assert.equal(channel.status().sinkAttached, false);
  });

  test('capabilities-lying (torch exposed but applies refuse) → probe-on-failed, OFF never attempted', async () => {
    const { channel, track } = makeEnv({ apply: () => 'reject' });
    const result = await channel.acquire();
    assert.equal(result.reason, TORCH_FALLBACK_REASONS.PROBE_ON_FAILED);
    assert.match(result.detail, /BOTH constraint forms/);
    assert.deepEqual(track._log.applyCalls, [{ advanced: [{ torch: true }] }, { torch: true }]);
    assert.equal(track._log.stopCount, 1);
  });
});

describe('F3 capability gate (step 2)', () => {
  test('getCapabilities absent entirely (old-Firefox shape) → screen fallback, probe never attempted', async () => {
    const { channel, track } = makeEnv({ capabilities: undefined });
    const result = await channel.acquire();
    assert.equal(result.outcome, TORCH_OUTCOMES.SCREEN_FALLBACK);
    assert.equal(result.reason, TORCH_FALLBACK_REASONS.NO_TORCH_CAPABILITY);
    assert.match(result.detail, /getCapabilities unavailable/);
    assert.equal(track._log.applyCalls.length, 0); // cheap signal: no dead-end probing
    assert.equal(track._log.stopCount, 1);
  });

  test('empty capabilities object (desktop-Chrome webcam shape) → no-torch-capability', async () => {
    const { channel } = makeEnv({ capabilities: {} });
    const result = await channel.acquire();
    assert.equal(result.reason, TORCH_FALLBACK_REASONS.NO_TORCH_CAPABILITY);
    assert.equal(channel.status().state, TORCH_STATES.SCREEN_FALLBACK);
  });

  test('spec sequence shape: torch [false] means cannot → fallback; [true] proceeds to the probe', async () => {
    const no = makeEnv({ capabilities: { torch: [false] } });
    assert.equal((await no.channel.acquire()).reason, TORCH_FALLBACK_REASONS.NO_TORCH_CAPABILITY);

    const yes = makeEnv({ capabilities: { torch: [true] } });
    const result = await yes.channel.acquire();
    assert.equal(result.outcome, TORCH_OUTCOMES.READY);
  });
});

describe('F3 getUserMedia rejections (step 1)', () => {
  test('NotFoundError → no-camera', async () => {
    const { channel } = makeEnv({ gum: () => namedError('NotFoundError', 'no camera') });
    const result = await channel.acquire();
    assert.equal(result.outcome, TORCH_OUTCOMES.SCREEN_FALLBACK);
    assert.equal(result.reason, TORCH_FALLBACK_REASONS.NO_CAMERA);
    assert.match(result.detail, /NotFoundError/);
  });

  test('NotAllowedError → permission-denied (F8 renders its denied state from this)', async () => {
    const { channel } = makeEnv({ gum: () => namedError('NotAllowedError', 'Permission dismissed') });
    const result = await channel.acquire();
    assert.equal(result.reason, TORCH_FALLBACK_REASONS.PERMISSION_DENIED);
    assert.match(result.detail, /NotAllowedError/);
    assert.equal(channel.status().state, TORCH_STATES.SCREEN_FALLBACK);
  });

  test('NotReadableError → camera-unavailable; unnamed errors → gum-failed', async () => {
    const busy = makeEnv({ gum: () => namedError('NotReadableError', 'camera busy') });
    assert.equal((await busy.channel.acquire()).reason, TORCH_FALLBACK_REASONS.CAMERA_UNAVAILABLE);

    const weird = makeEnv({ gum: () => new Error('mystery') });
    assert.equal((await weird.channel.acquire()).reason, TORCH_FALLBACK_REASONS.GUM_FAILED);
  });
});

describe('F3 probe timeouts (step 3, ~1.5 s per direction)', () => {
  test('ON never settles → probe-timeout at 1500 ms; NO second-form retry after a timeout; track killed', async () => {
    const { channel, track, clock } = makeEnv({ apply: () => 'hang' });
    const pending = channel.acquire();
    await settle();
    assert.equal(channel.status().state, TORCH_STATES.PROBING);
    assert.equal(track._log.applyCalls.length, 1); // advanced form, hanging
    clock.advance(PROBE_TIMEOUT_MS);
    const result = await pending;
    assert.equal(result.outcome, TORCH_OUTCOMES.SCREEN_FALLBACK);
    assert.equal(result.reason, TORCH_FALLBACK_REASONS.PROBE_TIMEOUT);
    assert.match(result.detail, /torch:true/); // says WHICH direction
    assert.equal(track._log.applyCalls.length, 1); // R1: timeout is terminal, not retried
    assert.equal(track._log.stopCount, 1);
    assert.equal(clock._pending(), 0);
  });

  test('OFF never settles → probe-timeout naming torch:false (ON already passed)', async () => {
    const apply = (c) => (torchOf(c) === false ? 'hang' : 'fulfill');
    const { channel, clock } = makeEnv({ apply });
    const pending = channel.acquire();
    await settle();
    clock.advance(PROBE_TIMEOUT_MS);
    const result = await pending;
    assert.equal(result.reason, TORCH_FALLBACK_REASONS.PROBE_TIMEOUT);
    assert.match(result.detail, /torch:false/);
    assert.equal(channel.status().state, TORCH_STATES.SCREEN_FALLBACK);
  });
});

// ---------------------------------------------------------------------------
// Sink, release, loss

describe('F3 keep-alive sink', () => {
  test('1px invisible muted video holds the stream; srcObject set; metadata awaited', async () => {
    const { channel, mediaDevices, doc } = makeEnv();
    await channel.acquire();
    const video = doc._created[0];
    assert.equal(video.tagName, 'video');
    assert.strictEqual(doc.body.children[0], video);
    assert.deepEqual(video.attributes, {
      muted: '',
      playsinline: '',
      autoplay: '',
      'aria-hidden': 'true',
    });
    assert.equal(video.muted, true);
    assert.strictEqual(video.srcObject, mediaDevices.streams[0]);
    assert.equal(video.played, 1);
    assert.equal(video.style.position, 'fixed');
    assert.equal(video.style.pointerEvents, 'none');
    assert.equal(video.readyState, 1); // loadedmetadata observed before caps read
  });

  test('no document → no sink, session still proceeds (keep-alive is best-effort)', async () => {
    const { channel } = makeEnv({ withDoc: false });
    const result = await channel.acquire();
    assert.equal(result.outcome, TORCH_OUTCOMES.READY);
    assert.equal(channel.status().sinkAttached, false);
  });

  test('metadata never fires → bounded wait times out at 1500 ms and the probe still runs', async () => {
    const { channel, clock } = makeEnv({ metadataOnPlay: false });
    const pending = channel.acquire();
    await settle();
    assert.equal(channel.status().state, TORCH_STATES.PROBING); // still sink-waiting
    clock.advance(PROBE_TIMEOUT_MS);
    const result = await pending;
    assert.deepEqual(result, { outcome: TORCH_OUTCOMES.READY, form: TORCH_FORMS.ADVANCED });
    assert.equal(clock._pending(), 0);
  });
});

describe('F3 release — the guaranteed kill switch', () => {
  test('release(): synchronous track.stop(), sink detached, state idle, released event', async () => {
    const { channel, track, doc } = makeEnv();
    await channel.acquire();
    await channel.on();
    const events = [];
    channel.addEventListener(TORCH_EVENTS.RELEASED, () => events.push('released'));
    channel.release();
    assert.equal(track._log.stopCount, 1); // LED extinguished by hardware guarantee
    assert.equal(channel.status().state, TORCH_STATES.IDLE);
    assert.equal(channel.status().acquired, false);
    assert.equal(doc.body.children.length, 0);
    assert.equal(doc._created[0].srcObject, null);
    assert.deepEqual(events, ['released']);
    assert.throws(() => channel.on(), /torch-ready/);
  });

  test('release() is idempotent — no double stop, no second event', async () => {
    const { channel, track } = makeEnv();
    await channel.acquire();
    let fired = 0;
    channel.addEventListener(TORCH_EVENTS.RELEASED, () => { fired += 1; });
    channel.release();
    channel.release();
    assert.equal(track._log.stopCount, 1);
    assert.equal(fired, 1);
  });

  test('release() before any acquire: silent no-op, no event', () => {
    const { channel } = makeEnv();
    let fired = 0;
    channel.addEventListener(TORCH_EVENTS.RELEASED, () => { fired += 1; });
    channel.release();
    assert.equal(fired, 0);
    assert.equal(channel.status().state, TORCH_STATES.IDLE);
  });

  test('release() during probing throws synchronously (wiring bug: await acquire())', async () => {
    const { channel, clock } = makeEnv({ apply: () => 'hang' });
    const pending = channel.acquire();
    await settle();
    assert.throws(() => channel.release(), /during acquire\(\)/);
    // cleanup: let the probe time out so the acquisition settles cleanly
    clock.advance(PROBE_TIMEOUT_MS);
    const result = await pending;
    assert.equal(result.reason, TORCH_FALLBACK_REASONS.PROBE_TIMEOUT);
  });
});

describe('F3 torch loss mid-broadcast', () => {
  test("track 'ended' → lost{code:'track-ended'}, state error, channel dead", async () => {
    const { channel, track } = makeEnv();
    await channel.acquire();
    const losses = [];
    channel.addEventListener(TORCH_EVENTS.LOST, (e) => losses.push(e));
    track._dispatch('ended');
    assert.equal(losses.length, 1);
    assert.equal(losses[0].code, TORCH_ERROR_CODES.TRACK_ENDED);
    assert.match(losses[0].detail, /ended/);
    assert.equal(channel.status().state, TORCH_STATES.ERROR);
    assert.equal(channel.status().acquired, false);
    assert.equal(track._log.stopCount, 1); // kill switch ran even though the track died on its own
    assert.throws(() => channel.on(), /wiring bug/);
  });

  test("hot-path applyConstraints rejection → on() rejects, lost{code:'apply-rejected'}, state error", async () => {
    const mode = { behavior: 'fulfill' };
    const { channel, track } = makeEnv({ apply: (c) => (torchOf(c) === true ? mode.behavior : 'fulfill') });
    await channel.acquire();
    const losses = [];
    channel.addEventListener(TORCH_EVENTS.LOST, (e) => losses.push(e));
    mode.behavior = 'reject';
    await assert.rejects(() => channel.on(), /applyConstraints\(torch:true\).*rejected/);
    assert.equal(losses.length, 1);
    assert.equal(losses[0].code, TORCH_ERROR_CODES.APPLY_REJECTED);
    assert.equal(channel.status().state, TORCH_STATES.ERROR);
    assert.equal(channel.status().reason, TORCH_ERROR_CODES.APPLY_REJECTED);
    assert.equal(track._log.stopCount, 1);
  });

  test('fire-and-forget rejection: no unhandledRejection, loss still surfaced (F6 hot-path shape)', async () => {
    const mode = { behavior: 'fulfill' };
    const { channel } = makeEnv({ apply: (c) => (torchOf(c) === true ? mode.behavior : 'fulfill') });
    await channel.acquire();
    const losses = [];
    channel.addEventListener(TORCH_EVENTS.LOST, (e) => losses.push(e));
    const unhandled = [];
    const onUnhandled = (err) => unhandled.push(err);
    process.on('unhandledRejection', onUnhandled);
    try {
      mode.behavior = 'reject';
      channel.on(); // deliberately not awaited — the conductor never awaits
      await settle();
      assert.equal(losses.length, 1);
      assert.deepEqual(unhandled, []);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('F3 re-acquisition', () => {
  test('after permission-denied, a fresh acquire re-prompts and can arm', async () => {
    const trackA = createTrackStub();
    const trackB = createTrackStub();
    const denied = namedError('NotAllowedError', 'denied once');
    const { channel, mediaDevices } = makeEnv({ gum: (n) => (n === 1 ? denied : trackB) });
    void trackA;
    const first = await channel.acquire();
    assert.equal(first.reason, TORCH_FALLBACK_REASONS.PERMISSION_DENIED);
    const second = await channel.acquire();
    assert.equal(second.outcome, TORCH_OUTCOMES.READY);
    assert.equal(mediaDevices.calls.length, 2);
    assert.equal(trackB._log.stopCount, 0);
    assert.equal(trackB._log.applyCalls.length, 2);
  });

  test('after release() and after loss, acquire() re-arms from a fresh gesture', async () => {
    const env = makeEnv();
    await env.channel.acquire();
    env.channel.release();
    assert.equal((await env.channel.acquire()).outcome, TORCH_OUTCOMES.READY);
    assert.equal(env.mediaDevices.calls.length, 2);

    const lossEnv = makeEnv();
    await lossEnv.channel.acquire();
    lossEnv.track._dispatch('ended');
    assert.equal(lossEnv.channel.status().state, TORCH_STATES.ERROR);
    assert.equal((await lossEnv.channel.acquire()).outcome, TORCH_OUTCOMES.READY);
  });
});

// ---------------------------------------------------------------------------
// Wiring-bug discipline + events API + status shape

describe('F3 wiring bugs + construction validation', () => {
  test('on()/off() before any acquire, and after a screen-fallback outcome, throw synchronously', async () => {
    const fresh = makeEnv();
    assert.throws(() => fresh.channel.on(), /torch-ready/);
    assert.throws(() => fresh.channel.off(), /torch-ready/);

    const denied = makeEnv({ gum: () => namedError('NotAllowedError', 'no') });
    await denied.channel.acquire();
    assert.throws(() => denied.channel.on(), /screen-fallback-recommended/);
  });

  test('malformed options throw at construction', () => {
    assert.throws(() => createTorchChannel({ probeTimeoutMs: 'soon' }), TypeError);
    assert.throws(() => createTorchChannel({ probeTimeoutMs: 0 }), RangeError);
    assert.throws(() => createTorchChannel({ mediaDevices: {} }), TypeError);
    assert.throws(() => createTorchChannel({ setTimeout: () => 0 }), TypeError);
  });

  test('addEventListener requires a function', () => {
    const { channel } = makeEnv();
    assert.throws(() => channel.addEventListener(TORCH_EVENTS.LOST, 'nope'), TypeError);
  });
});

describe('F3 events API', () => {
  test('addEventListener returns an unsubscribe; removeEventListener works too', async () => {
    const { channel } = makeEnv();
    await channel.acquire();
    const seen = [];
    const listener = (e) => seen.push(e);
    const unsubscribe = channel.addEventListener(TORCH_EVENTS.RELEASED, listener);
    channel.addEventListener(TORCH_EVENTS.RELEASED, (e) => seen.push(['second', e]));
    channel.release();
    assert.equal(seen.length, 2);
    unsubscribe();
    channel.addEventListener(TORCH_EVENTS.RELEASED, listener);
    channel.removeEventListener(TORCH_EVENTS.RELEASED, listener);
    void channel; // re-added then removed again: neither fires below
    const before = seen.length;
    await channel.acquire();
    channel.release();
    assert.equal(seen.length, before + 1); // only the 'second' listener fired
  });

  test('a throwing listener is swallowed; other listeners still run', async () => {
    const { channel } = makeEnv();
    await channel.acquire();
    const seen = [];
    channel.addEventListener(TORCH_EVENTS.RELEASED, () => {
      throw new Error('broken consumer');
    });
    channel.addEventListener(TORCH_EVENTS.RELEASED, () => seen.push('ok'));
    channel.release();
    assert.deepEqual(seen, ['ok']);
  });
});

describe('F3 status shape', () => {
  test('idle: exact full shape', () => {
    const { channel } = makeEnv();
    assert.deepEqual(channel.status(), {
      state: TORCH_STATES.IDLE,
      supported: true,
      acquired: false,
      form: null,
      forms: null,
      desired: false,
      applied: false,
      reason: null,
      detail: null,
      sinkAttached: false,
      probeTimeoutMs: PROBE_TIMEOUT_MS,
    });
  });

  test('torch-ready: exact full shape (desired/applied false — the OFF probe left the LED dark)', async () => {
    const { channel } = makeEnv();
    await channel.acquire();
    assert.deepEqual(channel.status(), {
      state: TORCH_STATES.READY,
      supported: true,
      acquired: true,
      form: TORCH_FORMS.ADVANCED,
      forms: { on: TORCH_FORMS.ADVANCED, off: TORCH_FORMS.ADVANCED },
      desired: false,
      applied: false,
      reason: null,
      detail: null,
      sinkAttached: true,
      probeTimeoutMs: PROBE_TIMEOUT_MS,
    });
  });
});
