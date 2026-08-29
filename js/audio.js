// js/audio.js — Audio channel: the side-tone and the master clock.
//
// Task F5 of docs/ultron/plan.md. One oscillator voice — a clear sine at
// 700 Hz (R2 left the frequency open within the 600–800 Hz side-tone band;
// 700 Hz is the per-task default) — beeping the Morse marks with
// click-free ~5 ms envelopes, scheduled by ABSOLUTE AudioContext time so
// the F6 conductor can drive light + sound from one master clock. Plain ES
// module; in Node it imports cleanly without any Web Audio present — pass a
// `{ AudioContext }` fake constructor or a `{ context }` stub (exactly what
// test/audio.test.mjs does).
//
// Channel shape (drop-in alongside F3 torch / F4 screen for F6):
//
//   const audio = createAudioChannel();
//   await audio.unlock();            // INSIDE a user gesture (Broadcast tap):
//                                    // creates the context lazily + resumes
//   audio.now();                     // master clock — AudioContext.currentTime
//                                    // (seconds), the R2-committed substrate
//   audio.scheduleTone(t0, t1);      // one mark, absolute context-time seconds
//   audio.stopAll();                 // STOP / visibilitychange pause: kill
//                                    // every pending voice, click-free
//   audio.setMuted(true);            // memory-only toggle, click-free fade
//   await audio.destroy();           // teardown: voices dropped, context closed
//
// MASTER CLOCK + LOOKAHEAD (R2, docs/ultron/research/r2-latency-wpm-sync.md
// §5.3 / §3.3 — Chris Wilson, "A Tale of Two Clocks"): schedule by absolute
// AudioContext time with ~100 ms lookahead, NEVER fire-per-call setTimeout
// (timer callbacks skew "by tens of milliseconds or more"; the audio thread
// fires sample-accurately even if the main thread stalls). F6 owns the
// lookahead loop; its committed constants live here as the single source of
// truth, exported for F6 to import:
//
//   - LOOKAHEAD_MS = 100  (schedule-ahead window)
//   - TICK_MS      = 25   (loop tick)
//
// F6 anchors once per broadcast — t0 = audio.now() inside the Broadcast
// gesture (after unlock), event absolute time = t0 + tMs/1000 — then calls
// scheduleTone() for each F2 ON/OFF pair ahead of the playhead.
// scheduleTone() is SYNCHRONOUS (returns a voice handle, never a promise,
// never a timer): all timing authority stays with the audio thread.
//
// SYNC CONTRACT (plan F5 AC): `SYNC_TOLERANCE_MS = 45` (ITU-R BT.1359-1
// detectability window, per R2 §3.4/§5.2). The envelope is shaped so BOTH
// mark edges land exactly on their scheduled times — the attack ramp
// STARTS at the scheduled ON time and the release ramp ENDS at the
// scheduled OFF edge:
//
//   gain: 0 ──setValue(0, tOn)──▶ ramp to peak (tOn + 5 ms)
//         ──hold──▶ setValue(peak, tOff − 5 ms) ──▶ ramp to 0 (tOff)
//
//   → edge displacement ≤ ENVELOPE_MS = 5 ms ≪ 45 ms, and the release
//     finishing AT tOff means the tone never spills into the following gap
//     (mark/gap ratios are preserved, not just edges). Construction
//     rejects an envelope ≥ SYNC_TOLERANCE_MS — that would spend the whole
//     sync budget before any real-world latency.
//
// Scheduling with a start already in the past (conductor ticked late):
// the start clamps to currentTime — the OFF edge is the boundary that
// defines the following gap, so it is the one kept exact; the onset can
// only be early, bounded by F6's tick. A mark entirely in the past returns
// null (missed, no node) instead of throwing: throttle-tail lateness is a
// runtime condition, not a wiring bug. Calling scheduleTone() before a
// successful unlock() DOES throw synchronously — that is a wiring bug (the
// autoplay-policy contract below), matching F4's pre-attach discipline.
//
// VOICE LIFECYCLE: one shared timbre (frequency/type fixed per channel) on
// one master bus; each mark gets its own short-lived oscillator + gain —
// the Wilson per-note pattern, which keeps stop/cancel per-voice and
// leaves no always-running node. Voices self-release on `ended`
// (disconnect + untrack); `stopAll()` cancels everything pending,
// click-free, INCLUDING the ≤ LOOKAHEAD_MS tail Web Audio otherwise still
// owns after F6 stops scheduling — that is exactly why pause-on-hidden
// (R2) pairs with stopAll(). `voice.cancel()` does the same for one voice.
//
// MUTE (plan F5): `setMuted()` fades the master bus (a ~ENVELOPE_MS ramp —
// toggling mid-tone must not click) and is PERSISTED IN MEMORY ONLY: no
// localStorage/sessionStorage/cookies anywhere (scope: no persistence —
// enforced headlessly by a throwing localStorage guard in the test).
// Muting never disturbs the timeline: marks keep scheduling (through the
// silent bus), so unmuting mid-broadcast lands inside the message. The
// STOP button is `stopAll()`; mute is not stop.
//
// UNLOCK STATE MACHINE (plan F5 AC: no sound before gesture):
//   none → (unlock() inside a gesture) → running
//   - The AudioContext is created LAZILY inside unlock() — before any
//     gesture there is no context at all, so zero nodes, zero audio, and
//     scheduleTone() throws (see above). Triple guarantee: no context +
//     suspended-until-resumed (autoplay policy) + sync throw.
//   - unlock() is idempotent: re-calling it in later gestures (replay,
//     resume-after-background) is a cheap state check; it resumes a
//     context that iOS re-suspended after backgrounding. A suspended
//     context that has been unlocked once also gets a fire-and-forget
//     resume() nudge from scheduleTone() (never awaited — no hot-path
//     promises).
//   - resume() refusal (denied autoplay) rejects unlock(); the channel
//     stays locked and soundless — callers treat audio as absent and run
//     light-only (multimodal per PRODUCT.md: light + sound + readout).
//   - No Web Audio at all: unlock() rejects descriptively.
//
// DESTROY: drops all voices and closes the context (frees the audio
// device); the channel object survives with its in-memory mute preference
// and unlock() afterwards builds a fresh context. Destroy also closes an
// INJECTED context — the channel owns whatever context it plays through.

/** Audio↔light sync budget in ms (ITU-R BT.1359-1 detectability, per R2).
 *  Exported for F6; wired here to bound the envelope (see header). */
export const SYNC_TOLERANCE_MS = 45;

/** Side-tone frequency in Hz. R2 left the exact value open within the
 *  600–800 Hz band; 700 Hz sine is the F5 default (clear at low volume,
 *  the common practice-oscillator pitch). */
export const TONE_HZ = 700;

/** Oscillator waveform of the single voice. */
export const TONE_TYPE = 'sine';

/** Peak gain of a mark (linear). Comfortably audible on phone speakers
 *  without pinning the output bus. */
export const TONE_GAIN = 0.5;

/** Attack/release ramp in ms — click-free edges (R2 §5.3: "~5 ms tone
 *  envelopes"); must stay < SYNC_TOLERANCE_MS (asserted at construction). */
export const ENVELOPE_MS = 5;

/** Lookahead schedule-ahead window in ms (R2-committed). F6 owns the loop;
 *  this module only schedules by absolute time. */
export const LOOKAHEAD_MS = 100;

/** Lookahead loop tick in ms (R2-committed, Wilson's two clocks). */
export const TICK_MS = 25;

const OSC_TYPES = new Set(['sine', 'square', 'sawtooth', 'triangle']);
const noop = () => {};

/**
 * Create an audio channel. All Web Audio globals are injectable for the
 * headless suite; the constructor binds lazily (typeof guards) so the
 * module imports cleanly in Node with no Web Audio present.
 *
 * @param {{
 *   AudioContext?: Function,
 *   context?: AudioContext,
 *   frequency?: number,
 *   type?: 'sine'|'square'|'sawtooth'|'triangle',
 *   envelopeMs?: number,
 *   peakGain?: number,
 * }} [options]
 *   - `AudioContext`: constructor used for lazy creation inside unlock()
 *     (tests inject a fake; default: globalThis.AudioContext, falling back
 *     to the legacy webkitAudioContext).
 *   - `context`: an existing AudioContext to play through (trusted as
 *     gesture-unlocked iff it is already 'running').
 *   - `frequency`/`type`/`envelopeMs`/`peakGain`: voice overrides.
 * @returns {{
 *   unlock: () => Promise<string>,
 *   now: () => number,
 *   scheduleTone: (startSec: number, endSec: number) =>
 *     {start:number, end:number, cancel:() => void} | null,
 *   stopAll: () => void,
 *   setMuted: (muted: boolean) => void,
 *   toggleMuted: () => boolean,
 *   isMuted: () => boolean,
 *   status: () => {supported:boolean, created:boolean, unlocked:boolean,
 *     state:string, muted:boolean, activeVoices:number, toneHz:number,
 *     toneType:string, envelopeMs:number, peakGain:number, toleranceMs:number},
 *   destroy: () => Promise<void>,
 * }}
 * @throws {TypeError} malformed option types.
 * @throws {RangeError} frequency ≤ 0, peakGain outside [0,1], or
 *   envelopeMs outside [0, SYNC_TOLERANCE_MS).
 */
export function createAudioChannel(options = {}) {
  const toneHz = options.frequency ?? TONE_HZ;
  const toneType = options.type ?? TONE_TYPE;
  const envelopeMs = options.envelopeMs ?? ENVELOPE_MS;
  const peakGain = options.peakGain ?? TONE_GAIN;

  if (typeof toneHz !== 'number' || !Number.isFinite(toneHz)) {
    throw new TypeError(`audio channel: frequency must be a finite number, got ${toneHz}`);
  }
  if (toneHz <= 0) {
    throw new RangeError(`audio channel: frequency must be positive, got ${toneHz}`);
  }
  if (!OSC_TYPES.has(toneType)) {
    throw new TypeError(
      `audio channel: type must be one of ${[...OSC_TYPES].join('/')}, got ${String(toneType)}`
    );
  }
  if (typeof envelopeMs !== 'number' || !Number.isFinite(envelopeMs)) {
    throw new TypeError(`audio channel: envelopeMs must be a finite number, got ${envelopeMs}`);
  }
  if (envelopeMs < 0 || envelopeMs >= SYNC_TOLERANCE_MS) {
    throw new RangeError(
      `audio channel: envelopeMs must be in [0, ${SYNC_TOLERANCE_MS}) — a wider ramp ` +
        `would spend the whole sync tolerance before any real latency (got ${envelopeMs})`
    );
  }
  if (typeof peakGain !== 'number' || !Number.isFinite(peakGain)) {
    throw new TypeError(`audio channel: peakGain must be a finite number, got ${peakGain}`);
  }
  if (peakGain < 0 || peakGain > 1) {
    throw new RangeError(`audio channel: peakGain must be within [0,1], got ${peakGain}`);
  }

  const envSec = envelopeMs / 1000;

  let ctx = options.context ?? null;      // null = create lazily in unlock()
  let master = null;                      // mute bus: voices → master → destination
  let unlocked = false;                   // a resume() succeeded at least once
  let muted = false;                      // memory only — never storage
  const voices = new Set();               // scheduled-but-not-yet-ended marks

  // An injected running context is trusted as gesture-unlocked (it can only
  // be running if some gesture already started it); a suspended one is not.
  if (ctx && ctx.state === 'running') unlocked = true;
  if (ctx) wireMaster();

  /** Create the AudioContext (lazily, inside unlock()) and its mute bus. */
  async function unlock() {
    if (!ctx) {
      const Ctor = resolveCtor();
      if (typeof Ctor !== 'function') {
        throw new Error(
          'audio channel: Web Audio is unsupported here (no AudioContext) — ' +
            'run the broadcast light-only'
        );
      }
      ctx = new Ctor();
      wireMaster();
    }
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch (err) {
        throw new Error(
          `audio channel: context resume was refused (autoplay policy?) — ${err?.message ?? err}`
        );
      }
    }
    unlocked = true;
    return ctx.state;
  }

  /** Master clock — AudioContext.currentTime in SECONDS. 0 before the
   *  context exists: anchor against now() only once unlocked (broadcasts
   *  start from the gesture that unlocks, so F6 always can). */
  function now() {
    return ctx ? ctx.currentTime : 0;
  }

  /**
   * Schedule ONE mark as a tone between absolute context-time seconds.
   * Synchronous by design: no promises, no timers — the audio thread owns
   * the timing (lookahead contract, header). Returns the voice handle
   * `{start, end, cancel}` (start = effective, possibly clamped, onset) or
   * null when the whole mark lies in the past (missed, not an error).
   *
   * @param {number} startSec scheduled ON edge (absolute, seconds)
   * @param {number} endSec scheduled OFF edge (absolute, seconds; > startSec)
   * @throws {Error} before a successful unlock(), or on a closed context
   *   (wiring bugs — sound must never precede the gesture).
   * @throws {TypeError} non-finite times.
   * @throws {RangeError} endSec ≤ startSec.
   */
  function scheduleTone(startSec, endSec) {
    if (!ctx || !unlocked) {
      throw new Error(
        'audio channel: unlock() must succeed from a user gesture before scheduleTone() ' +
          '(no sound before the gesture — autoplay-policy contract)'
      );
    }
    if (ctx.state === 'closed') {
      throw new Error('audio channel: context is closed — unlock() again to build a fresh one');
    }
    if (!isFiniteSec(startSec) || !isFiniteSec(endSec)) {
      throw new TypeError(
        `scheduleTone(startSec, endSec) expects finite seconds, got ${startSec}..${endSec}`
      );
    }
    if (endSec <= startSec) {
      throw new RangeError(
        `scheduleTone(startSec, endSec): end (${endSec}s) must be after start (${startSec}s)`
      );
    }

    const nowT = ctx.currentTime;
    if (endSec <= nowT) return null; // fully past: missed (late-tick tail)
    const t0 = Math.max(startSec, nowT); // late onset clamps; OFF edge kept exact
    const t1 = endSec;

    // Self-heal an unlocked context that the platform re-suspended (e.g.
    // iOS after backgrounding): nudge resume, never await it — no promises
    // on the hot path (R2 §5.3 discipline).
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      try {
        ctx.resume().catch(noop);
      } catch {
        /* ancient engines may throw synchronously — the tone is silent, not fatal */
      }
    }

    const osc = ctx.createOscillator();
    osc.type = toneType;
    osc.frequency.value = toneHz;
    const gain = ctx.createGain();
    const g = gain.gain;
    g.value = 0; // silence before t0 (osc not started yet; belt and braces)

    if (t1 - t0 >= 2 * envSec) {
      // Full envelope: attack FROM the ON edge, release ENDING AT the OFF
      // edge — both edges exact; nothing spills into the following gap.
      g.setValueAtTime(0, t0);
      g.linearRampToValueAtTime(peakGain, t0 + envSec);
      g.setValueAtTime(peakGain, t1 - envSec);
      g.linearRampToValueAtTime(0, t1);
    } else {
      // Degenerate guard (impossible at ≤12 WPM — a dot is ≥100 ms — but
      // scheduleTone is a public primitive): too short for both ramps, so
      // peak at the midpoint; the edges still land exactly.
      const mid = t0 + (t1 - t0) / 2;
      g.setValueAtTime(0, t0);
      g.linearRampToValueAtTime(peakGain, mid);
      g.linearRampToValueAtTime(0, t1);
    }

    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t1);

    const voice = { start: t0, end: t1, cancel: null };
    // Internal (non-enumerable) node refs — the public handle shape stays
    // {start, end, cancel}.
    Object.defineProperty(voice, 'oscRef', { value: osc });
    Object.defineProperty(voice, 'gainRef', { value: gain });
    voice.cancel = () => cancelVoice(voice);
    voices.add(voice);
    osc.onended = () => {
      // Natural end (or a cancel's stop): release the graph, untrack.
      voices.delete(voice);
      disconnect(osc);
      disconnect(gain);
    };
    return voice;
  }

  /** Kill every pending voice, click-free (STOP button, pause-on-hidden).
   *  The channel stays usable — the next scheduleTone() just works. */
  function stopAll() {
    if (!ctx) return;
    for (const voice of [...voices]) cancelVoice(voice);
  }

  /** Memory-only mute: fades the master bus so mid-tone toggles cannot
   *  click and the timeline never changes (marks keep scheduling through
   *  the silent bus; unmuting lands inside the message). */
  function setMuted(next) {
    muted = Boolean(next);
    if (!ctx || !master) return; // no context yet: honored at wireMaster()
    const t = ctx.currentTime;
    const g = master.gain;
    const v = g.value; // read BEFORE cancel: the current (possibly mid-fade) value
    g.cancelScheduledValues(t);
    g.setValueAtTime(v, t);
    g.linearRampToValueAtTime(muted ? 0 : 1, t + envSec);
  }

  /** Flip mute; returns the new state. */
  function toggleMuted() {
    setMuted(!muted);
    return muted;
  }

  function isMuted() {
    return muted;
  }

  /** Introspection for F6/I2 — the channel's whole observable state. */
  function status() {
    return {
      supported: Boolean(ctx) || typeof resolveCtor() === 'function',
      created: Boolean(ctx),
      unlocked,
      state: ctx ? ctx.state : 'none',
      muted,
      activeVoices: voices.size,
      toneHz,
      toneType,
      envelopeMs,
      peakGain,
      toleranceMs: SYNC_TOLERANCE_MS,
    };
  }

  /** Teardown: drop every voice and CLOSE the context (releases the audio
   *  device). The in-memory mute preference survives; a later unlock()
   *  builds a fresh context. Idempotent; safe before any unlock. */
  async function destroy() {
    voices.clear();
    const closing = ctx;
    ctx = null;
    master = null;
    unlocked = false;
    if (
      closing &&
      typeof closing.close === 'function' &&
      closing.state !== 'closed'
    ) {
      try {
        await closing.close();
      } catch {
        /* already closing — nothing to do */
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internals

  function resolveCtor() {
    if (typeof options.AudioContext === 'function') return options.AudioContext;
    if (typeof globalThis.AudioContext === 'function') return globalThis.AudioContext;
    if (typeof globalThis.webkitAudioContext === 'function') return globalThis.webkitAudioContext;
    return null;
  }

  /** The mute bus: voices → master(1|0) → destination, wired the moment a
   *  context exists (injected at construction, lazy at unlock). */
  function wireMaster() {
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
  }

  /** Click-free kill of one pending voice: freeze the envelope at its
   *  current value, fade to 0 over ~ENVELOPE_MS, stop the oscillator just
   *  after; `onended` then disconnects the graph. */
  function cancelVoice(voice) {
    if (!voices.has(voice) || !ctx) return; // already ended or post-destroy
    voices.delete(voice);
    const t = ctx.currentTime;
    const g = voice.gainRef.gain;
    const v = g.value; // read before cancel (mid-attack truth, real API)
    try {
      g.cancelScheduledValues(t);
      g.setValueAtTime(v, t);
      g.linearRampToValueAtTime(0, t + envSec);
      voice.oscRef.stop(t + envSec); // last stop wins; start-in-future never sounds
    } catch {
      /* engines that throw on stop-after-stop: the envelope is 0 anyway */
    }
  }

  function disconnect(node) {
    if (node && typeof node.disconnect === 'function') {
      try {
        node.disconnect();
      } catch {
        /* already disconnected / context closing */
      }
    }
  }

  function isFiniteSec(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  return { unlock, now, scheduleTone, stopAll, setMuted, toggleMuted, isMuted, status, destroy };
}
