// js/torch.js — Torch channel: the camera LED as the broadcast light.
//
// Task F3 of docs/ultron/plan.md. Plain ES module; in Node it imports
// cleanly with no media stack at all — every global is injectable
// ({ mediaDevices, doc, setTimeout, clearTimeout }), exactly what
// test/torch.test.mjs does.
//
// WHY A CAMERA STREAM EXISTS AT ALL (privacy scope): the torch constraint
// lives on a live video track, so holding a track is the ONLY way to hold
// the LED. The stream is never LOOKED at: this module has zero frame-access
// surface — no pixel reads, no bitmap grabs, no frame callbacks, nothing
// that moves a frame into script (the scope-banned set; enforced headlessly
// by a source-scan test, re-audited by Q2's greps). The one element the
// stream touches is a 1px invisible MUTED <video> SINK whose whole job is
// keep-alive: iOS Safari can park tracks that have no sink, and rendering
// to a hidden element never exposes a frame to script.
//
// DETECTION ORDER — R1's committed recommendation, implemented EXACTLY
// (docs/ultron/research/r1-torch-support-matrix.md §5):
//   0. Secure context: no navigator.mediaDevices → screen fallback, no
//      prompt attempted (insecure origins leave it undefined — R1 §3.6).
//   1. getUserMedia({video:{facingMode:{ideal:'environment'}}, audio:false})
//      from a USER GESTURE only. This module never self-acquires — there is
//      no page-load path at all; acquisition starts when the app calls
//      acquire() inside its arm-torch gesture handler. `ideal`, never
//      `exact`: one-camera devices must not OverconstrainedError (R1 §3.5).
//      Any rejection → screen fallback (NotAllowedError is surfaced as the
//      permission-denied reason so F8 can render its denied state).
//   2. Guarded capability check: read the track's capabilities with the
//      FUNCTION ITSELF guarded (Firefox shipped without getCapabilities —
//      R1 §3.4) and require a truthy torch entry (boolean true, or a
//      true-bearing sequence per the Image Capture spec shape; [false]
//      means "cannot"). Absent → stop the track → screen fallback. The
//      capability alone proves nothing (documented false positives, R1
//      §3.4 Moto-G class) — the probe decides.
//   3. Trial probe, BOTH directions, each wrapped in a ~1.5 s timeout:
//      applyConstraints({advanced:[{torch:true}]}) first — on rejection
//      retry ONCE with the top-level {torch:true} (WebKit's own tests use
//      the top-level form; Chromium accepts both) — then the same
//      advanced-with-top-level-fallback pair for torch:false. A direction
//      passes when one form RESOLVES within its timeout; rejection of both
//      forms fails the direction; a TIMEOUT fails it outright (no
//      second-form retry — R1: any rejection/timeout → screen mode).
//      ON must pass AND OFF must pass: on devices where only torch:false
//      is broken (Chromium 1246938 class) the LED would stick ON at the
//      first gap and every subsequent mark would be a dash — the OFF probe
//      exists to catch exactly that device class. Any failure →
//      track.stop() → screen-fallback-recommended.
//   4. torch-ready. The winning constraint form per direction is remembered
//      and is the only one used on the hot path (per-call fallback there
//      would double command latency; the probe already established what
//      this device honors).
//
// STATES (the F8-facing detection lifecycle; exported TORCH_STATES):
//   idle → probing → torch-ready | screen-fallback-recommended | error
//   - probing: the async acquire() phase above is in flight (set
//     synchronously at acquire() call time, so status() is honest before
//     the first await resolves).
//   - torch-ready: armed; stream held; on()/off() legal.
//   - screen-fallback-recommended: this device/user cannot torch (reason in
//     status()). A HEALTHY detection outcome, not an error — F8 renders its
//     unsupported(screen) state and the F4 screen channel takes the
//     broadcast. A fresh acquire() re-prompts (the user may have granted
//     permission since).
//   - error: armed-then-broken — torch LOST mid-broadcast, or an unexpected
//     internal failure. The 'lost' EVENT (not the state alone) is F6's
//     takeover signal: it carries {code:'track-ended'|'apply-rejected'}.
//   - idle again after release()/destroy(); re-acquire works.
//
// Channel shape (drop-in alongside F4 screen / F5 audio for F6):
//
//   const torch = createTorchChannel();
//   const result = await torch.acquire(); // INSIDE the arm-torch gesture
//   //   {outcome:'torch-ready', form:'advanced'|'toplevel'}
//   // | {outcome:'screen-fallback', reason, detail}
//   // | {outcome:'error', reason, detail}
//   torch.on();        // fire-and-forget; promise resolves when ACCEPTED
//   torch.off();
//   torch.release();   // KILL SWITCH — synchronous track.stop(); per spec
//                      // the torch lasts only "as long as track is active",
//                      // so stopping always extinguishes the LED (R1 §3.4)
//   await torch.destroy(); // release + drop all listeners
//   torch.status();
//   torch.addEventListener('lost', (e) => …);   // e = {code, detail}
//   torch.addEventListener('released', () => …);
//
// HONEST COMPLETION SIGNALING (R2, docs/ultron/research/
// r2-latency-wpm-sync.md §3.1a + §5.3): on()/off() resolve the moment the
// browser ACCEPTS the constraint — which is command-submission time, a
// strict LOWER BOUND on the physical LED transition (the apply promise
// settles when the camera request is submitted; the LED moves 1–3 preview
// frames later). Resolved ≠ lit, and the difference is UNMEASURABLE from
// script: physical confirmation would require reading frames, which the
// privacy scope bans outright (R2 rejected measure-then-calibrate for
// exactly this reason). So the conductor fires torch commands
// TORCH_LEAD_MS = 120 ms EARLY (F6's own named constant, range 0–200,
// tuned once via Q3) and never awaits these promises on the hot path —
// they are fire-and-forget with honest resolve/reject semantics for anyone
// who does wait. Rejection means the apply was REFUSED → torch-loss (see
// below). Both marks of honesty are deliberate so F6 can reason about them.
//
// LOSS DETECTION (for F6's seamless screen takeover): the track's 'ended'
// event (camera stolen, screen lock, OS teardown — R1 §3.4 documents
// screen-lock killing the torch) and any hot-path applyConstraints
// rejection fire 'lost', stop the track, detach the sink, and set state
// error. acquire() also resolves {outcome:'error'} for unexpected internal
// failures — it never REJECTS; device/user conditions are outcomes, not
// exceptions.
//
// UNDETECTABLE RESIDUAL (documented honestly): the resolves-but-no-flash
// false-positive class (R1 §3.4) cannot be observed from script — no web
// API reports the physical LED. The plan's manual "torch not flashing?
// switch to screen" control (U1 copy + I2 wiring) covers it; this module's
// job is to make that switch cheap. R1's optional P2 enumerateDevices
// retry (multi-lens hunt for another torch-bearing camera) is intentionally
// NOT implemented — flagged P2 by the research, out of F3's outcome.
//
// Wiring-bug discipline (F4/F5 convention): on()/off() before a
// torch-ready acquire(), after release(), or after loss throw
// SYNCHRONOUSLY; release()/destroy() during probing throw (await acquire()
// first — it always settles: gUM resolves with the prompt, the probe is
// timeout-bounded). Construction throws on malformed options.

/** Per-direction probe timeout in ms. R1 §5: "wrap both in a ~1.5 s
 *  timeout" — one timeout per applyConstraints attempt. */
export const PROBE_TIMEOUT_MS = 1500;

/** acquire() result outcomes. */
export const TORCH_OUTCOMES = Object.freeze({
  READY: 'torch-ready',
  SCREEN_FALLBACK: 'screen-fallback',
  ERROR: 'error',
});

/** Channel states — the detection lifecycle F8 drives and renders. */
export const TORCH_STATES = Object.freeze({
  IDLE: 'idle',
  PROBING: 'probing',
  READY: 'torch-ready',
  SCREEN_FALLBACK: 'screen-fallback-recommended',
  ERROR: 'error',
});

/** screen-fallback reasons (status().reason in SCREEN_FALLBACK state;
 *  acquire() results carry the same strings). */
export const TORCH_FALLBACK_REASONS = Object.freeze({
  INSECURE_CONTEXT: 'insecure-context',       // no navigator.mediaDevices (R1 §3.6)
  NO_CAMERA: 'no-camera',                     // NotFoundError
  PERMISSION_DENIED: 'permission-denied',     // NotAllowedError → F8's denied state
  CAMERA_UNAVAILABLE: 'camera-unavailable',   // NotReadableError/TrackStartError
  GUM_FAILED: 'gum-failed',                   // any other getUserMedia rejection
  NO_VIDEO_TRACK: 'no-video-track',           // stream without a video track
  NO_TORCH_CAPABILITY: 'no-torch-capability', // getCapabilities absent/lying silent
  PROBE_ON_FAILED: 'probe-on-failed',         // torch:true rejected in both forms
  PROBE_OFF_FAILED: 'probe-off-failed',       // torch:false rejected — Chromium 1246938 class
  PROBE_TIMEOUT: 'probe-timeout',             // an apply never settled in time
});

/** error codes (status().reason in ERROR state; 'lost' event codes). */
export const TORCH_ERROR_CODES = Object.freeze({
  TRACK_ENDED: 'track-ended',
  APPLY_REJECTED: 'apply-rejected',
  INTERNAL: 'internal',
});

/** Constraint forms, in probe order: advanced first (Chromium's documented
 *  shape), top-level fallback (the form WebKit's own layout tests use). */
export const TORCH_FORMS = Object.freeze({
  ADVANCED: 'advanced',
  TOPLEVEL: 'toplevel',
});

/** Event names. The channel's own on()/off() are the LIGHT toggle, so the
 *  emitter uses DOM-style addEventListener — no name collision. */
export const TORCH_EVENTS = Object.freeze({
  LOST: 'lost',       // {code: TORCH_ERROR_CODES.TRACK_ENDED|APPLY_REJECTED, detail}
  RELEASED: 'released', // no payload
});

/** getUserMedia constraints — R1 §5.2 exactly: environment-IDEAL (never
 *  exact — one-camera devices must not OverconstrainedError), no audio. */
const GUM_CONSTRAINTS = Object.freeze({
  video: Object.freeze({ facingMode: Object.freeze({ ideal: 'environment' }) }),
  audio: false,
});

const noop = () => {};

/**
 * Create a torch channel. All media/DOM/timer globals are injectable for
 * the headless suite; defaults bind lazily (typeof guards) so the module
 * imports cleanly under bare Node (which also exercises the
 * insecure-context path).
 *
 * @param {{
 *   mediaDevices?: MediaDevices,
 *   doc?: Document,
 *   setTimeout?: (fn: () => void, ms: number) => number,
 *   clearTimeout?: (handle: number) => void,
 *   probeTimeoutMs?: number,
 * }} [options]
 *   - `mediaDevices`: the media device facade (default: the live global,
 *     read at call time). When injected it must carry getUserMedia.
 *   - `doc`: document for the keep-alive video sink (absent → no sink; the
 *     track from a resolved gUM is live without one on modern browsers).
 *   - `setTimeout`/`clearTimeout`: the probe-timeout pair (injected as a
 *     pair; default: the globals).
 *   - `probeTimeoutMs`: per-direction probe timeout (default 1500).
 * @returns {{
 *   acquire: () => Promise<{outcome: string, form?: string, reason?: string, detail?: string}>,
 *   on: () => Promise<void>,
 *   off: () => Promise<void>,
 *   release: () => void,
 *   destroy: () => Promise<void>,
 *   isLit: () => boolean,
 *   status: () => {state: string, supported: boolean, acquired: boolean,
 *     form: (string|null), forms: ({on: string, off: string}|null),
 *     desired: boolean, applied: boolean, reason: (string|null),
 *     detail: (string|null), sinkAttached: boolean, probeTimeoutMs: number},
 *   addEventListener: (type: string, listener: (payload?: object) => void) => () => void,
 *   removeEventListener: (type: string, listener: (payload?: object) => void) => void,
 * }}
 * @throws {TypeError} malformed option types.
 * @throws {RangeError} non-positive probeTimeoutMs.
 */
export function createTorchChannel(options = {}) {
  const probeMs = options.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
  if (typeof probeMs !== 'number' || !Number.isFinite(probeMs)) {
    throw new TypeError(`torch channel: probeTimeoutMs must be a finite number, got ${probeMs}`);
  }
  if (probeMs <= 0) {
    throw new RangeError(`torch channel: probeTimeoutMs must be positive, got ${probeMs}`);
  }
  if (
    options.mediaDevices !== undefined &&
    (typeof options.mediaDevices !== 'object' ||
      options.mediaDevices === null ||
      typeof options.mediaDevices.getUserMedia !== 'function')
  ) {
    throw new TypeError(
      'torch channel: mediaDevices, when injected, must be an object carrying a getUserMedia function'
    );
  }
  if ((options.setTimeout === undefined) !== (options.clearTimeout === undefined)) {
    throw new TypeError('torch channel: inject setTimeout and clearTimeout as a pair');
  }
  const setTimeoutFn =
    options.setTimeout ??
    (typeof setTimeout === 'function' ? setTimeout.bind(globalThis) : undefined);
  const clearTimeoutFn =
    options.clearTimeout ??
    (typeof clearTimeout === 'function' ? clearTimeout.bind(globalThis) : undefined);
  const doc = options.doc ?? (typeof document === 'undefined' ? undefined : document);

  const listeners = new Map(); // type → Set<fn>
  const R = TORCH_FALLBACK_REASONS;
  const E = TORCH_ERROR_CODES;

  let state = TORCH_STATES.IDLE;
  let result = null;   // last acquire() resolution (source of status() fields)
  let reason = null;   // fallback reason | error code
  let detail = null;
  let forms = null;    // {on, off} winning constraint forms (hot path uses per-direction)
  let track = null;    // the held video track (torch lives on it)
  let stream = null;   // held so the track stays alive during broadcast
  let sinkEl = null;   // the keep-alive video element
  let desired = false; // last COMMANDED torch state
  let applied = false; // last ACCEPTED torch state (constraint application, not LED truth)
  let inFlight = null; // acquire() promise while probing

  // -------------------------------------------------------------------------
  // Acquisition — the R1 detection order, as one gesture-driven phase

  /**
   * Arm the torch channel. MUST be called from a user-gesture handler (the
   * camera prompt requires it on iOS and the permission UX demands it);
   * this module never self-invokes. Resolves — never rejects — with:
   *   {outcome:'torch-ready', form}                     state torch-ready
   *   {outcome:'screen-fallback', reason, detail}       state screen-fallback-recommended
   *   {outcome:'error', reason, detail}                 state error
   * Idempotent while ready (returns the cached result, no second prompt);
   * concurrent calls share the in-flight probe; a fresh call after
   * screen-fallback/error/idle re-runs the whole order (re-prompts).
   */
  function acquire() {
    if (state === TORCH_STATES.READY) return Promise.resolve({ ...result });
    if (state === TORCH_STATES.PROBING) return inFlight;
    inFlight = runAcquisition().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function runAcquisition() {
    state = TORCH_STATES.PROBING;
    reason = null;
    detail = null;
    try {
      if (typeof setTimeoutFn !== 'function' || typeof clearTimeoutFn !== 'function') {
        return finishError(
          E.INTERNAL,
          'timer APIs unavailable — R1 requires timeout-bounded probes, refusing to probe unbounded'
        );
      }
      const md = resolveMediaDevices();
      if (!md || typeof md.getUserMedia !== 'function') {
        return finishScreen(
          R.INSECURE_CONTEXT,
          'navigator.mediaDevices unavailable — insecure context or no media stack (R1 §3.6)'
        );
      }

      // (1) gesture-context acquisition, environment-ideal, audio:false
      let stream_;
      try {
        stream_ = await md.getUserMedia(GUM_CONSTRAINTS);
      } catch (err) {
        return finishScreen(gumReason(err), `getUserMedia rejected: ${describe(err)}`);
      }
      const track_ = pickVideoTrack(stream_);
      if (!track_) {
        stopStreamSafely(stream_);
        return finishScreen(R.NO_VIDEO_TRACK, 'stream carried no video track');
      }
      track = track_;
      stream = stream_;

      // Keep-alive before reading capabilities: caps can read empty before
      // the track is live (R1 §3.4, Chrome-59-era lesson — still wise).
      attachSink();
      await waitForSinkReady(); // bounded, never fatal

      // (2) guarded capability check
      const caps = readCapabilities(track_);
      if (!hasTorchCapability(caps)) {
        teardownSession();
        return finishScreen(
          R.NO_TORCH_CAPABILITY,
          'no torch capability' +
            (caps === undefined
              ? ' (getCapabilities unavailable — Firefox shape, R1 §3.4)'
              : ` (getCapabilities().torch = ${safeJson(caps && caps.torch)})`)
        );
      }

      // (3) trial probe — BOTH directions, advanced form with top-level
      // fallback, ~1.5 s timeout each; the OFF half catches the
      // torch:false-only-ON device class.
      const onProbe = await probeDirection(true);
      if (!onProbe.ok) {
        teardownSession();
        return finishScreen(onProbe.reason, onProbe.detail);
      }
      const offProbe = await probeDirection(false);
      if (!offProbe.ok) {
        teardownSession();
        return finishScreen(offProbe.reason, offProbe.detail);
      }

      // (4) armed — the OFF probe left the LED dark
      forms = { on: onProbe.form, off: offProbe.form };
      desired = false;
      applied = false;
      bindTrackEnded();
      state = TORCH_STATES.READY;
      result = Object.freeze({ outcome: TORCH_OUTCOMES.READY, form: forms.on });
      return result;
    } catch (err) {
      teardownSession();
      return finishError(E.INTERNAL, describe(err));
    }
  }

  /** Probe one direction; R1 §5.4 shape (advanced → top-level on rejection,
   *  timeout terminal). Resolves {ok:true, form} | {ok:false, reason, detail}. */
  async function probeDirection(torch) {
    let lastError = null;
    for (const form of [TORCH_FORMS.ADVANCED, TORCH_FORMS.TOPLEVEL]) {
      let attempt;
      try {
        attempt = track.applyConstraints(constraintsFor(form, torch));
      } catch (err) {
        lastError = err; // ancient engines may throw synchronously
        continue;
      }
      try {
        await withTimeout(Promise.resolve(attempt), probeMs, `torch:${torch} (${form})`);
        return { ok: true, form };
      } catch (err) {
        if (err && err.isProbeTimeout) {
          return {
            ok: false,
            reason: R.PROBE_TIMEOUT,
            detail:
              `applyConstraints(torch:${torch}) via the ${form} form did not settle ` +
              `within ${probeMs} ms — treating as unsupported (R1: timeout → screen mode)`,
          };
        }
        lastError = err; // rejection → retry the other form (R1 §5.4)
      }
    }
    return {
      ok: false,
      reason: torch ? R.PROBE_ON_FAILED : R.PROBE_OFF_FAILED,
      detail:
        `applyConstraints(torch:${torch}) rejected in BOTH constraint forms ` +
        `(advanced and top-level): ${describe(lastError)}`,
    };
  }

  /** One applyConstraints attempt, bounded in time. The underlying promise
   *  always receives handlers, so a late settlement after timeout cannot
   *  become an unhandled rejection. */
  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const handle = setTimeoutFn(() => {
        const err = new Error(`${label} timed out after ${ms} ms`);
        err.name = 'TimeoutError';
        err.isProbeTimeout = true;
        reject(err);
      }, ms);
      promise.then(
        (value) => {
          clearTimeoutFn(handle);
          resolve(value);
        },
        (err) => {
          clearTimeoutFn(handle);
          reject(err);
        }
      );
    });
  }

  // -------------------------------------------------------------------------
  // Hot path — on()/off() with honest completion signaling

  /** Command torch ON. Fire-and-forget on the hot path (R2 §5.3): the
   *  returned promise resolves when the constraint application is ACCEPTED
   *  (submission time — a lower bound on the LED, NOT physical
   *  confirmation) and rejects if the apply is refused (→ torch loss). */
  function on() {
    return command(true);
  }

  /** Command torch OFF. Same contract as on(). */
  function off() {
    return command(false);
  }

  function command(torch) {
    requireReady(torch ? 'on()' : 'off()');
    desired = torch;
    const form = forms[torch ? 'on' : 'off'];
    let attempt;
    try {
      attempt = track.applyConstraints(constraintsFor(form, torch));
    } catch (err) {
      attempt = Promise.reject(err);
    }
    const wrapped = Promise.resolve(attempt).then(
      () => {
        applied = torch; // accepted — honest as far as script can see
      },
      (err) => {
        const message = `torch channel: applyConstraints(torch:${torch}) via the ${form} form was rejected: ${describe(err)}`;
        loseTorch(E.APPLY_REJECTED, message);
        throw new Error(message, { cause: err });
      }
    );
    // Fire-and-forget safety: a caller who ignores the returned promise
    // must not trip unhandledrejection when a broadcast-ending rejection
    // arrives. Awaiting callers still see the rejection.
    wrapped.catch(noop);
    return wrapped;
  }

  // -------------------------------------------------------------------------
  // Lifecycle — release is the hardware-guaranteed kill switch

  /** Release the camera NOW: synchronous track.stop() (per spec the torch
   *  lasts only as long as the track is active, so this ALWAYS
   *  extinguishes the LED — the guaranteed kill switch), detach the sink,
   *  forget the session, state → idle. Emits 'released' when a session was
   *  held. Idempotent. Throws during probing (await acquire() first). */
  function release() {
    if (state === TORCH_STATES.PROBING) {
      throw new Error(
        'torch channel: release() during acquire() is a wiring bug — await acquire() first (it always settles)'
      );
    }
    const held = track !== null || sinkEl !== null;
    teardownSession();
    forms = null;
    desired = false;
    applied = false;
    reason = null;
    detail = null;
    result = null;
    state = TORCH_STATES.IDLE;
    if (held) emit(TORCH_EVENTS.RELEASED);
  }

  /** Teardown: release + drop every listener. The channel object stays
   *  usable — a later acquire() (fresh gesture) re-arms it (F4 convention:
   *  re-attach after destroy works). */
  async function destroy() {
    release();
    listeners.clear();
  }

  // -------------------------------------------------------------------------
  // Loss — the mid-broadcast fallback signal F6 converts to screen takeover

  function loseTorch(code, detailText) {
    if (state !== TORCH_STATES.READY) return false;
    teardownSession(); // stop() even though the apply already failed — kill switch
    forms = null;
    desired = false;
    applied = false;
    state = TORCH_STATES.ERROR;
    reason = code;
    detail = detailText;
    result = Object.freeze({ outcome: TORCH_OUTCOMES.ERROR, reason: code, detail: detailText });
    emit(TORCH_EVENTS.LOST, { code, detail: detailText }); // last: listeners may re-arm/release
    return true;
  }

  // -------------------------------------------------------------------------
  // Introspection + events

  /** True iff the last ACCEPTED command was ON. Honest limit: this is the
   *  constraint-application state, not physical LED truth — no frame
   *  verification exists by scope. */
  function isLit() {
    return applied;
  }

  /** The channel's whole observable state, for F6/F8/I2. */
  function status() {
    const md = resolveMediaDevices();
    return {
      state,
      supported: Boolean(md && typeof md.getUserMedia === 'function'),
      acquired: track !== null,
      form: forms ? forms.on : null,
      forms: forms ? { on: forms.on, off: forms.off } : null,
      desired,
      applied,
      reason,
      detail,
      sinkAttached: sinkEl !== null,
      probeTimeoutMs: probeMs,
    };
  }

  /** Subscribe ('lost' | 'released'). Returns an unsubscribe function.
   *  Listener errors are swallowed — one broken consumer must not break
   *  the channel's own signaling. */
  function addEventListener(type, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('torch channel: addEventListener(listener) requires a function');
    }
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(listener);
    return () => removeEventListener(type, listener);
  }

  function removeEventListener(type, listener) {
    listeners.get(type)?.delete(listener);
  }

  // -------------------------------------------------------------------------
  // Internals

  function requireReady(who) {
    if (state !== TORCH_STATES.READY) {
      throw new Error(
        `torch channel: ${who} requires a torch-ready acquire() — current state: ${state} (wiring bug)`
      );
    }
  }

  function resolveMediaDevices() {
    if (options.mediaDevices !== undefined) return options.mediaDevices;
    if (typeof navigator === 'undefined') return undefined;
    return navigator.mediaDevices;
  }

  function finishScreen(reasonCode, detailText) {
    state = TORCH_STATES.SCREEN_FALLBACK;
    reason = reasonCode;
    detail = detailText;
    forms = null;
    result = Object.freeze({
      outcome: TORCH_OUTCOMES.SCREEN_FALLBACK,
      reason: reasonCode,
      detail: detailText,
    });
    return result;
  }

  function finishError(code, detailText) {
    state = TORCH_STATES.ERROR;
    reason = code;
    detail = detailText;
    result = Object.freeze({ outcome: TORCH_OUTCOMES.ERROR, reason: code, detail: detailText });
    return result;
  }

  /** The exact constraint objects per R1 §5.4: advanced first, top-level
   *  fallback — both directions, probe and hot path alike. */
  function constraintsFor(form, torch) {
    return form === TORCH_FORMS.ADVANCED
      ? { advanced: [{ torch }] }
      : { torch };
  }

  function gumReason(err) {
    switch (err && err.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return R.PERMISSION_DENIED;
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return R.NO_CAMERA;
      case 'NotReadableError':
      case 'TrackStartError':
        return R.CAMERA_UNAVAILABLE;
      default:
        return R.GUM_FAILED;
    }
  }

  /** Guarded capability read — guard the FUNCTION itself (Firefox history,
   *  R1 §3.4). Never throws. */
  function readCapabilities(track_) {
    try {
      const fn = track_ && track_.getCapabilities;
      if (typeof fn !== 'function') return undefined;
      return fn.call(track_);
    } catch {
      return undefined;
    }
  }

  /** torch capability truthiness across the shapes seen in the wild:
   *  boolean true (Chromium/WebKit), a true-bearing sequence (the Image
   *  Capture spec's sequence<boolean>, where [false] means "cannot"), or
   *  absent (desktop-Chrome empty caps, no-LED devices). */
  function hasTorchCapability(caps) {
    if (caps === null || caps === undefined) return false;
    const torch = caps.torch;
    if (torch === null || torch === undefined) return false;
    if (Array.isArray(torch)) return torch.some(Boolean);
    return Boolean(torch);
  }

  function pickVideoTrack(stream_) {
    if (!stream_) return null;
    let tracks = [];
    if (typeof stream_.getVideoTracks === 'function') tracks = stream_.getVideoTracks();
    else if (typeof stream_.getTracks === 'function') {
      tracks = stream_.getTracks().filter((t) => t.kind !== 'audio');
    }
    return tracks[0] ?? null;
  }

  /** 1px invisible muted sink — keep-alive only (WebKit can park sink-less
   *  tracks). Invisible-but-RENDERED, not display:none (a fully hidden
   *  player can be parked too); out of flow and pointer-transparent so it
   *  can never disturb layout or eat a STOP tap. Best-effort: no doc → no
   *  sink, the session still proceeds. */
  function attachSink() {
    if (sinkEl || !doc || typeof doc.createElement !== 'function') return;
    try {
      const el = doc.createElement('video');
      el.setAttribute('muted', '');
      el.setAttribute('playsinline', '');
      el.setAttribute('autoplay', '');
      el.setAttribute('aria-hidden', 'true');
      if (el.style) {
        el.style.position = 'fixed';
        el.style.width = '1px';
        el.style.height = '1px';
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
      }
      el.srcObject = stream;
      try {
        el.muted = true;
      } catch {
        /* attribute already set — belt and braces */
      }
      const host = doc.body || doc.documentElement;
      if (host && typeof host.appendChild === 'function') host.appendChild(el);
      if (typeof el.play === 'function') {
        const playing = el.play();
        if (playing && typeof playing.catch === 'function') playing.catch(noop);
      }
      sinkEl = el;
    } catch {
      sinkEl = null; // keep-alive is best-effort, never fatal
    }
  }

  /** Wait (bounded by the probe timeout) for the sink's metadata so the
   *  capability read is not racing track liveness (R1 §3.4). Resolves
   *  true/false; never rejects; never blocks longer than probeMs. */
  function waitForSinkReady() {
    if (!sinkEl || typeof sinkEl.addEventListener !== 'function') return Promise.resolve(false);
    if (typeof sinkEl.readyState === 'number' && sinkEl.readyState >= 1) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      let done = false;
      const onMeta = () => finish(true);
      const handle = setTimeoutFn(() => finish(false), probeMs);
      function finish(ready) {
        if (done) return;
        done = true;
        clearTimeoutFn(handle);
        sinkEl.removeEventListener('loadedmetadata', onMeta);
        resolve(ready);
      }
      sinkEl.addEventListener('loadedmetadata', onMeta);
    });
  }

  function detachSink() {
    if (!sinkEl) return;
    try {
      sinkEl.srcObject = null;
    } catch {
      /* best-effort */
    }
    try {
      if (typeof sinkEl.remove === 'function') sinkEl.remove();
      else if (sinkEl.parentNode && typeof sinkEl.parentNode.removeChild === 'function') {
        sinkEl.parentNode.removeChild(sinkEl);
      }
    } catch {
      /* best-effort */
    }
    sinkEl = null;
  }

  function bindTrackEnded() {
    if (track && typeof track.addEventListener === 'function') {
      track.addEventListener('ended', onTrackEnded);
    }
  }

  function onTrackEnded() {
    loseTorch(
      E.TRACK_ENDED,
      'video track ended mid-session — camera released by the OS/app switch/screen lock (R1 §3.4)'
    );
  }

  /** Stop the track (the guaranteed LED extinguisher), detach the sink,
   *  unbind track events, forget the session refs. */
  function teardownSession() {
    if (track) {
      if (typeof track.removeEventListener === 'function') {
        track.removeEventListener('ended', onTrackEnded);
      }
      try {
        track.stop();
      } catch {
        /* an unstoppable track is already dead */
      }
    }
    detachSink();
    track = null;
    stream = null;
  }

  function stopStreamSafely(stream_) {
    if (!stream_) return;
    try {
      const tracks =
        typeof stream_.getTracks === 'function'
          ? stream_.getTracks()
          : typeof stream_.getVideoTracks === 'function'
            ? stream_.getVideoTracks()
            : [];
      for (const t of tracks) {
        if (t && typeof t.stop === 'function') t.stop();
      }
    } catch {
      /* best-effort */
    }
  }

  function emit(type, payload) {
    const set = listeners.get(type);
    if (!set || set.size === 0) return;
    for (const listener of [...set]) {
      try {
        listener(payload);
      } catch {
        /* one broken consumer must not break the channel's signaling */
      }
    }
  }

  function describe(err) {
    if (err && typeof err === 'object' && 'message' in err) {
      return err.name ? `${err.name}: ${err.message}` : String(err.message);
    }
    return String(err);
  }

  function safeJson(value) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return {
    acquire,
    on,
    off,
    release,
    destroy,
    isLit,
    status,
    addEventListener,
    removeEventListener,
  };
}
