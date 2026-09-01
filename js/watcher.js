// js/watcher.js — the receiver's camera watcher (the instrument's eye).
//
// Task W1 of docs/ultron/run2-receiver/plan.md. The ONLY module in the
// repo permitted to touch video frames, under the re-scoped privacy law
// (town-hall run 2, user-approved 2026-09-01):
//
//   - frame access exists ONLY here, and ONLY in its sanctioned
//     downsampled forms — one 32×32 sampling canvas, drawImage(video)
//     scaled down, getImageData over that same 32×32 rect. Never full
//     resolution, never any export/encode/record surface, never stored,
//     never transmitted (memory-only, see research D2/D4).
//   - the preview <video> sink (passed by the host) is the stream's only
//     consumer besides the sampling canvas; the aperture goes dark on
//     release — srcObject detached, canvas wiped, never a frozen frame.
//   - the camera is hard-released on stop() and on pagehide; exposure
//     constraints (Chromium-only, D5) are always reset before release.
//
// Pipeline (research D1–D5, docs/ultron/run2-receiver/research/r1+r2):
//   rVFC primary (Baseline 2024) → per-frame luminance (Rec.601 integer
//   luma over the brightest 4×4-px tile of the 32×32 grid) → rolling
//   P25/P95 window → dual-threshold hysteresis → median-of-3 →
//   2-consecutive-frame confirmation → timestamped light edges with the
//   MIDPOINT between the last old-state frame and the first new-state
//   frame (±½ frame error bound; D3). rAF fallback dedupes on
//   video.currentTime. presentedFrames deltas count drops (D3).
//
// Consumers: app.js (I2) turns edges into decoder durations; F3 derives
// meter truth from edge traffic + the stats events emitted here.
//
// Cold-window property (honest limitation): the rolling OFF-level window
// needs ~0.5 s of presented frames before its estimates are trustworthy.
// A real camera always presents ambient frames from the moment the
// stream starts, so listening begins against a warmed window; a sender
// who starts flashing within the very first fraction of a second after
// the grant can lose that first mark (the session's D8/D9 gates keep
// the loss honest, never fabricated).

/** Sampling grid edge (32×32 = 1 kB luminance; research D2). */
export const SAMPLE_GRID = 32;

/** Rolling percentile window length in ms (D4: ~1–2 s). */
export const ROLLING_WINDOW_MS = 1500;

/** Minimum P95−P25 spread (8-bit) before edges may be emitted (D4). */
export const CONTRAST_GATE = 20;

/** Hysteresis fractions of the rolling range: ON above, OFF below (D4). */
export const HYSTERESIS_ON = 0.6;
export const HYSTERESIS_OFF = 0.35;

/**
 * Per-frame decay of the ON-level peak tracker (D4, implementation note:
 * a rolling P95 over the 1.5 s window needs ~4 lit frames before the
 * contrast gate opens — at BRISK a dot is only 3 frames, so dots would
 * measure near zero. The peak tracker lifts on the FIRST lit frame and
 * decays slowly (~50% per 23 frames) so ambient drift still adapts.)
 */
export const ON_LEVEL_DECAY = 0.97;

/** Pixels ≥ this luminance count as clipped (saturation warning, D5/R2). */
export const CLIP_LEVEL = 250;

/** Capability probe delay after stream start (Chrome populates caps late). */
export const CAPS_DELAY_MS = 500;

/** Manual exposureTime target as a fraction of the advertised range (D5). */
export const EXPOSURE_LOCK_FRACTION = 0.1;

export const WATCHER_STATES = Object.freeze({
  IDLE: 'idle',
  ACQUIRING: 'acquiring',
  WATCHING: 'watching',
  RELEASED: 'released',
  ERROR: 'error',
});

export const WATCHER_OUTCOMES = Object.freeze({
  OK: 'ok',
  PERMISSION_DENIED: 'permission-denied',
  NO_CAMERA: 'no-camera',
  BUSY: 'busy',
  INSECURE: 'insecure',
  FAILED: 'failed',
});

const GUM_VIDEO_CONSTRAINTS = Object.freeze({
  facingMode: { ideal: 'environment' },
  frameRate: { ideal: 60, min: 24 },
});

/**
 * Create a watcher. One instance per receive session.
 *
 * @param {{video: object, media?: object, clock?: object, doc?: object,
 *          timers?: object, raf?: Function, secureContext?: boolean}} options
 *   video — the host's preview <video> sink (the aperture). Required.
 *   media — {getUserMedia} (defaults to navigator.mediaDevices).
 *   clock — {now()} timestamp source (defaults to performance).
 *   doc — document used for the sampling canvas + pagehide safety
 *     (defaults to globalThis.document when present).
 *   timers — {setTimeout, clearTimeout} (capability probe).
 *   raf — requestAnimationFrame for the fallback loop.
 *   secureContext — isSecureContext gate (defaults to global flag).
 * @throws {TypeError} if video is missing or not an object.
 */
export function createWatcher(options = {}) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('createWatcher(options) expects an options object');
  }
  const video = options.video;
  if (video === null || typeof video !== 'object') {
    throw new TypeError('createWatcher({video}) requires the preview video element');
  }
  const media = options.media ?? null;
  const clock = options.clock ?? null;
  const doc = options.doc ?? (typeof globalThis.document !== 'undefined' ? globalThis.document : null);
  const timers = options.timers ?? {
    setTimeout: typeof globalThis.setTimeout === 'function'
      ? globalThis.setTimeout.bind(globalThis) : null,
    clearTimeout: typeof globalThis.clearTimeout === 'function'
      ? globalThis.clearTimeout.bind(globalThis) : null,
  };
  const raf = options.raf ?? (typeof globalThis.requestAnimationFrame === 'function'
    ? globalThis.requestAnimationFrame.bind(globalThis) : null);
  const secureContext = options.secureContext
    ?? (typeof globalThis.isSecureContext !== 'undefined' ? globalThis.isSecureContext : true);

  // ---- DOM-style event emitter (torch.js discipline) ----
  const listeners = new Map();
  const on = (name, fn) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
  };
  const off = (name, fn) => listeners.get(name)?.delete(fn);
  const dispatch = (name, detail) => {
    for (const fn of listeners.get(name) ?? []) fn(detail);
  };

  let state = WATCHER_STATES.IDLE;
  let stream = null;
  let track = null;
  let samplingCanvas = null;
  let samplingCtx = null;
  let loopHandle = null;      // rVFC has no cancel: a generation counter guards
  let generation = 0;
  let usingRVFC = false;
  let capsTimer = null;
  let exposureApplied = null; // reset recipe while a constraint was applied
  let pagehideBound = null;

  // Rolling luminance window (D4).
  const windowSamples = [];  // {tMs, level}
  const binaryHistory = [];  // last 3 hysteresized 0/1 decisions
  let lightOn = false;
  let pendingFlip = null;    // {to:boolean, frames:number, fromTMs:number}
  let lastFrameTMs = null;
  let lastVideoTime = -1;
  let lastPresented = null;
  let onLevel = null;        // decaying peak tracker (ON-level estimate)
  let droppedFrames = 0;     // cumulative (diagnostics)
  let droppedSinceEdge = 0;  // resets at each committed edge
  let lastStats = null;

  const now = () => (clock ? clock.now() : performance.now());

  function stopAll() {
    generation += 1; // cancels the sampling loop at its next guard
    if (capsTimer && timers?.clearTimeout) { timers.clearTimeout(capsTimer); capsTimer = null; }
    if (pagehideBound && doc) { doc.removeEventListener('pagehide', pagehideBound); pagehideBound = null; }
    void resetExposure(); // fire-and-forget before the track dies
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
    }
    if (video) video.srcObject = null; // the eye closes — never a frozen frame
    if (samplingCtx) {
      // Wipe the only place pixels ever lived (32×32, memory-only).
      samplingCtx.clearRect(0, 0, SAMPLE_GRID, SAMPLE_GRID);
    }
    samplingCanvas = null;
    samplingCtx = null;
    stream = null;
    track = null;
    windowSamples.length = 0;
    binaryHistory.length = 0;
    lightOn = false;
    pendingFlip = null;
    lastFrameTMs = null;
    lastVideoTime = -1;
    lastPresented = null;
    onLevel = null;
    droppedFrames = 0;
    droppedSinceEdge = 0;
    if (state !== WATCHER_STATES.ERROR) setState(WATCHER_STATES.RELEASED);
    dispatch('released', {});
  }

  function setState(next) {
    state = next;
    dispatch('state', { state: next });
  }

  // ---- Sampling pipeline (sanctioned forms only) ----

  function ensureCanvas() {
    if (samplingCtx) return;
    samplingCanvas = doc.createElement('canvas');
    samplingCanvas.width = SAMPLE_GRID;
    samplingCanvas.height = SAMPLE_GRID;
    samplingCtx = samplingCanvas.getContext('2d', { willReadFrequently: true });
  }

  function measureLevel() {
    // Downsample the frame to 32×32 — the ONLY frame read in the product.
    samplingCtx.drawImage(video, 0, 0, SAMPLE_GRID, SAMPLE_GRID);
    const { data } = samplingCtx.getImageData(0, 0, SAMPLE_GRID, SAMPLE_GRID);
    // Rec.601 integer luma per pixel; track the brightest 4×4-px tile.
    const TILE = 4, TILES = SAMPLE_GRID / TILE;
    let bestTile = -1, bestSum = -1;
    let clipped = 0;
    for (let ty = 0; ty < TILES; ty++) {
      for (let tx = 0; tx < TILES; tx++) {
        let sum = 0;
        for (let y = 0; y < TILE; y++) {
          const row = ((ty * TILE + y) * SAMPLE_GRID + tx * TILE) * 4;
          for (let x = 0; x < TILE; x++) {
            const i = row + x * 4;
            const luma = (77 * data[i] + 150 * data[i + 1] + 29 * data[i + 2]) >> 8;
            sum += luma;
            if (luma >= CLIP_LEVEL) clipped++;
          }
        }
        if (sum > bestSum) { bestSum = sum; bestTile = ty * TILES + tx; }
      }
    }
    return {
      level: bestSum / (TILE * TILE),
      clippingFraction: clipped / (SAMPLE_GRID * SAMPLE_GRID),
    };
  }

  function percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
    return sorted[idx];
  }

  function onFrame(frameTMs, presented) {
    if (state !== WATCHER_STATES.WATCHING) return;
    if (lastFrameTMs !== null && frameTMs < lastFrameTMs) return; // never time-travel
    if (lastPresented !== null && presented !== null && presented > lastPresented + 1) {
      droppedFrames += presented - lastPresented - 1;
      droppedSinceEdge += presented - lastPresented - 1;
    }
    lastPresented = presented;

    const { level, clippingFraction } = measureLevel();
    const tMs = frameTMs;

    windowSamples.push({ tMs, level });
    const cutoff = tMs - ROLLING_WINDOW_MS;
    while (windowSamples.length > 0 && windowSamples[0].tMs < cutoff) windowSamples.shift();
    const sorted = windowSamples.map((s) => s.level).sort((a, b) => a - b);
    const off = percentile(sorted, 25);
    // ON level: decaying peak tracker (immediate onset, slow ambient
    // adaptation — see ON_LEVEL_DECAY above).
    onLevel = Math.max(level, onLevel === null ? level : onLevel * ON_LEVEL_DECAY);
    const range = onLevel - off;

    let edge = null;
    if (range >= CONTRAST_GATE) {
      // Hysteresis classification for this frame (hold inside the band).
      const hi = off + HYSTERESIS_ON * range;
      const lo = off + HYSTERESIS_OFF * range;
      const raw = level > hi ? 1 : (level < lo ? 0 : (lightOn ? 1 : 0));

      binaryHistory.push(raw);
      if (binaryHistory.length > 3) binaryHistory.shift();
      // Median-of-3 over the hysteresized series (kills single-frame PWM
      // beat flicker — D4), then 2-consecutive-frame confirmation.
      const filtered = binaryHistory.length === 3
        ? binaryHistory.slice().sort((a, b) => a - b)[1]
        : raw;
      const target = filtered === 1;
      if (target !== lightOn) {
        if (pendingFlip && pendingFlip.to === target) {
          pendingFlip.frames += 1;
        } else {
          // The transition lies between the previous frame and this one —
          // the FIRST new-state frame. Stamp that midpoint now; the
          // confirming frame must not stretch the edge time (D3).
          pendingFlip = {
            to: target,
            frames: 1,
            edgeTMs: ((lastFrameTMs ?? tMs) + tMs) / 2,
          };
        }
        if (pendingFlip.frames >= 2) {
          edge = {
            tMs: pendingFlip.edgeTMs,
            on: target,
            dropped: droppedSinceEdge > 0,
          };
          droppedSinceEdge = 0;
          lightOn = target;
          pendingFlip = null;
        }
      } else {
        pendingFlip = null;
      }
    } else {
      // Below the contrast gate nothing is heard; state holds, edges stop.
      pendingFlip = null;
    }

    lastStats = {
      tMs: frameTMs, // frame time — the receive session's silence clock
      level: Math.round(level),
      off: Math.round(off),
      on: Math.round(onLevel),
      contrast: Math.round(range),
      hearing: range >= CONTRAST_GATE,
      saturated: clippingFraction > 0.5,
      clippingFraction,
      droppedFrames,
      lightOn,
      usingRVFC,
    };
    lastFrameTMs = tMs;
    dispatch('stats', lastStats);
    if (edge) dispatch('edge', edge);
  }

  function startLoop() {
    generation += 1;
    const gen = generation;
    if (typeof video.requestVideoFrameCallback === 'function') {
      usingRVFC = true;
      const tick = (nowMs, metadata) => {
        if (gen !== generation || state !== WATCHER_STATES.WATCHING) return;
        const frameTMs = metadata?.expectedDisplayTime ?? nowMs;
        onFrame(frameTMs, metadata?.presentedFrames ?? null);
        video.requestVideoFrameCallback(tick);
      };
      video.requestVideoFrameCallback(tick);
    } else {
      usingRVFC = false;
      if (typeof raf !== 'function') {
        throw new Error('watcher: no requestVideoFrameCallback and no requestAnimationFrame');
      }
      const tick = () => {
        if (gen !== generation || state !== WATCHER_STATES.WATCHING) return;
        if (video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          onFrame(now(), null);
        }
        raf(tick);
      };
      raf(tick);
    }
  }

  // ---- Exposure posture (D5: opportunistic, Chromium-only, silent) ----

  async function applyExposurePosture() {
    if (state !== WATCHER_STATES.WATCHING || typeof track.getCapabilities !== 'function') return;
    let caps;
    try {
      caps = await track.getCapabilities();
    } catch { return; }
    if (!caps || state !== WATCHER_STATES.WATCHING) return;
    try {
      if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('manual')
          && caps.exposureTime && typeof caps.exposureTime.max === 'number') {
        const { min = 0, max } = caps.exposureTime;
        const target = Math.max(min, Math.min(max, Math.round(max * EXPOSURE_LOCK_FRACTION)));
        await track.applyConstraints({ advanced: [{ exposureMode: 'manual' }] });
        await track.applyConstraints({ advanced: [{ exposureTime: target }] });
        exposureApplied = { exposureMode: 'continuous' }; // reset recipe
      } else if (caps.exposureCompensation && typeof caps.exposureCompensation.min === 'number') {
        const { min, step = 1 } = caps.exposureCompensation;
        const target = Math.max(min, -Math.abs(step));
        await track.applyConstraints({ advanced: [{ exposureCompensation: target }] });
        exposureApplied = { exposureCompensation: 0 };
      }
    } catch { /* best-effort by design (D5) */ }
  }

  async function resetExposure() {
    if (!exposureApplied || !track) return;
    const recipe = exposureApplied;
    exposureApplied = null;
    try {
      await track.applyConstraints({ advanced: [recipe] });
    } catch { /* the track may already be stopping */ }
  }

  // ---- Public surface ----

  return {
    addEventListener: on,
    removeEventListener: off,

    /** From the user's gesture: open the camera and start watching. */
    async acquire() {
      if (state === WATCHER_STATES.ACQUIRING || state === WATCHER_STATES.WATCHING) {
        throw new Error(`watcher.acquire() called in state ${state}`);
      }
      if (!secureContext) {
        setState(WATCHER_STATES.ERROR);
        return { ok: false, outcome: WATCHER_OUTCOMES.INSECURE };
      }
      const gum = media ?? (typeof navigator !== 'undefined' ? navigator.mediaDevices : null);
      if (!gum || typeof gum.getUserMedia !== 'function') {
        setState(WATCHER_STATES.ERROR);
        return { ok: false, outcome: WATCHER_OUTCOMES.FAILED };
      }
      setState(WATCHER_STATES.ACQUIRING);
      let liveStream;
      try {
        liveStream = await gum.getUserMedia({
          video: { ...GUM_VIDEO_CONSTRAINTS },
          audio: false,
        });
      } catch (err) {
        setState(WATCHER_STATES.ERROR);
        dispatch('error', { outcome: outcomeFromError(err), error: err });
        return { ok: false, outcome: outcomeFromError(err) };
      }
      stream = liveStream;
      track = liveStream.getVideoTracks()[0] ?? null;
      if (!track) {
        for (const t of liveStream.getTracks()) t.stop();
        setState(WATCHER_STATES.ERROR);
        return { ok: false, outcome: WATCHER_OUTCOMES.NO_CAMERA };
      }
      track.addEventListener('ended', () => {
        if (state === WATCHER_STATES.WATCHING) {
          dispatch('lost', {});
        }
      });
      ensureCanvas();
      video.srcObject = liveStream; // the aperture (sanctioned preview sink)
      video.muted = true;
      if ('playsInline' in video) video.playsInline = true;
      try {
        await video.play();
      } catch { /* some stubs/autoplay policies; frames may still flow */ }
      setState(WATCHER_STATES.WATCHING);
      dispatch('watching', { usingRVFC: typeof video.requestVideoFrameCallback === 'function' });
      startLoop();
      if (timers && typeof timers.setTimeout === 'function') {
        capsTimer = timers.setTimeout(() => {
          capsTimer = null;
          void applyExposurePosture();
        }, CAPS_DELAY_MS);
      }
      if (doc && !pagehideBound) {
        pagehideBound = () => stopAll();
        doc.addEventListener('pagehide', pagehideBound);
      }
      return { ok: true, outcome: WATCHER_OUTCOMES.OK, usingRVFC };
    },

    /** Kill switch: camera off, aperture dark, exposure reset. Synchronous. */
    stop: stopAll,

    /** Latest stats snapshot (meter truth input for F3/I2). */
    status() {
      return {
        state,
        usingRVFC,
        ...({ ...(lastStats ?? {}) }),
      };
    },
  };
}

function outcomeFromError(err) {
  const name = err?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return WATCHER_OUTCOMES.PERMISSION_DENIED;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return WATCHER_OUTCOMES.NO_CAMERA;
  if (name === 'NotReadableError' || name === 'AbortError') return WATCHER_OUTCOMES.BUSY;
  return WATCHER_OUTCOMES.FAILED;
}
