// js/conductor.js — Broadcast conductor (F6): runs an F2 schedule against
// the armed channels. The heart of the app.
//
// Task F6 of docs/ultron/plan.md. One event stream (F2's edge list) drives
// three offset channels against ONE master clock:
//
//   ┌──────────┬──────────────────────────────┬───────────────────────────┐
//   │ channel  │ fired at                     │ why                       │
//   ├──────────┼──────────────────────────────┼───────────────────────────┤
//   │ audio    │ exact tMs (absolute time on   │ the audio thread fires    │
//   │ (F5)     │ AudioContext.currentTime)     │ sample-accurately         │
//   │ screen   │ exact tMs (this loop, ≈1      │ next-frame paint lands    │
//   │ (F4)     │ frame late, within tolerance) │ within SYNC_TOLERANCE_MS  │
//   │ torch    │ tMs − TORCH_LEAD_MS (120)     │ applyConstraints latency  │
//   │ (F3)     │ fire-and-forget, never awaited│ ≈40–130 ms typical (R2)   │
//   └──────────┴──────────────────────────────┴───────────────────────────┘
//
// ONLY the torch leads. Screen and audio always fire AT their exact tMs —
// an early fire on either would bleed light/sound into the following gap
// (R2 §4a: the lead rides the gap-INCLUSIVE window so the LED transition
// lands near the boundary; the audio/screen edges define the gaps and must
// never move). Mark ratios are carried entirely by the F2 edge times.
//
// MASTER CLOCK + LOOKAHEAD LOOP (R2 §5.3, Chris Wilson's "A Tale of Two
// Clocks", constants imported from js/audio.js as the single source of
// truth): AudioContext.currentTime anchors the broadcast once, inside the
// Broadcast gesture — `anchorSec = now() + START_PAD_MS/1000`; an event's
// absolute time is `anchorSec + tMs/1000`. The loop:
//
//   - TICK_MS = 25 is the MAXIMUM sleep (R2's cadence — the loop wakes at
//     least this often so a stalled clock or a late timer can never starve
//     the lookahead window). When the next channel due is SOONER, the loop
//     sleeps exactly until it, so screen edges land on their exact tMs
//     instead of quantized to the tick grid. (Wilson's shape is preserved:
//     audio is still dispatched ahead of time by LOOKAHEAD_MS = 100 from
//     one place; only the wakeup is due-aware.)
//   - Audio tones are scheduled a full LOOKAHEAD_MS ahead at ABSOLUTE
//     times (scheduleTone is synchronous, no promises on the hot path).
//   - Torch commands fire TORCH_LEAD_MS early, fire-and-forget — F3's
//     on()/off() resolve at constraint-ACCEPTANCE (submission time, a
//     lower bound on the physical LED), so awaiting them would block the
//     loop and prove nothing (R2 §3.1a). Rejections arrive as F3's 'lost'
//     event → takeover below.
//   - NO runtime self-calibration, ever: physical confirmation would need
//     camera frames, which the privacy scope bans outright (R2 §4b).
//     TORCH_LEAD_MS is a named constant (range 0–200) tuned once via Q3.
//
// START_PAD_MS (= TORCH_LEAD_MS + TICK_MS) is runway before the first
// edge: the first torch command (due at tMs 0 − 120) must be reachable
// before the broadcast begins, or it would fire late and clamp. An
// injected torchLeadMs widens the DEFAULT pad to the effective lead +
// one tick for the same reason.
//
// PAUSE / RESUME (R2: pause on visibilitychange → hidden): pause freezes
// the exact schedule position P and kills everything in flight (tick
// timer, audio via stopAll() — including the ≤ LOOKAHEAD_MS tail Web
// Audio still owns — and the active light). Resume re-anchors with
// js/schedule.js eventIndexAt: everything with tMs < P is elapsed and
// never re-fires (no double-fires); a mark that was MID-FLIGHT at P
// completes with its remainder — its light is restored immediately and
// its tone re-scheduled from the (past, F5-clamped) onset to the EXACT
// OFF edge, so the boundary that defines the following gap never moves.
//
// TORCH CATCH-UP ON RESUME — THE SPACING FLOOR: the torch cursor
// re-anchors DOWN to the same resume index as the light/tone cursors.
// pause()'s lights-out OFF countermands EVERY torch command already
// issued — and because torch commands fire TORCH_LEAD_MS early, the
// cursor at the freeze point can sit up to one lead AHEAD of the
// schedule: any pause landing inside an edge's lead window
// ([edgeT−120, edgeT) — recurring before EVERY edge, effectively the
// whole timeline at BRISK, where the 100 ms dot is shorter than the
// lead) leaves issued-but-countermanded commands, so the resumed
// stream must rebuild EVERY pending edge's command.
//
// THE INVARIANT (command space): after any pause/resume sequence,
// between a commanded torch OFF and the next commanded torch ON there
// is ALWAYS a dark gap of at least TORCH_SPACING_FLOOR_MS — the
// hardware/driver always sees OFF settle before ON, so adjacent marks
// can never merge into one flash while both tones play. An unpaused
// run holds it by construction (consecutive torch commands are spaced
// by a Morse element, ≥100 ms at every committed step); resume
// catch-up is the only path that can compress it (when the inter-mark
// gap is shorter than TORCH_LEAD_MS, the NEXT mark's lead ON due
// precedes the CURRENT mark's catch-up OFF due), so the whole
// post-resume torch schedule is DERIVED from the floor once, in
// shapeTorchDues() — not patched per branch:
//   - base dues: a countermanded ON whose lead due passed fires
//     IMMEDIATELY at the resume instant (a mark must never play dark
//     against its tone); a countermanded OFF fires at its EXACT edge
//     time (the gap boundary is re-commanded no later than offT, and
//     never at the resume instant itself, where it would zero-length
//     the mark just restored there); everything else keeps its normal
//     lead due (tMs − TORCH_LEAD_MS);
//   - dark floor, two-sided: a pending OFF is PULLED no later than
//     min(offT, nextOnDue − floor) — when that pulls it earlier than
//     offT the restored mark renders slightly short in command space,
//     which is the accepted trade (a dark gap always exists, marks
//     stay distinct, information is preserved); when the pull would
//     land at/before the resume instant (or invert the just-restored
//     mark), the OFF instead KEEPS its exact edge time and the
//     FOLLOWING ON is advanced to at least offT + floor — never past
//     the mark's own tMs, so no command ever runs past its true
//     boundary. Either way the commanded dark gap is ≥ the floor, and
//     every ordering (catch-up OFF vs catch-up ON, catch-up OFF vs
//     normal-due ON, exact-edge pauses, repeated pause/resume cycles)
//     resolves inside the same rule pair.
// Resuming on visibility-visible is deliberately NOT automatic: F8's
// RESUME is a user-intent event, and a conductor that self-resumed would
// desync from the machine — the host decides (see the event map below).
//
// TORCH LOSS → SEAMLESS SCREEN TAKEOVER: F3's 'lost' event ({code:
// 'track-ended'|'apply-rejected'}) switches the active light channel to
// the screen WITHOUT losing position. The screen overlay is attached (in
// standby, carrier down) at every start() — inside the Broadcast gesture,
// because fullscreen needs user activation — so the takeover costs one
// class toggle. When the loss lands mid-mark, screen.on() fires at the
// loss instant and the running mark completes on screen; its OFF edge and
// every later edge still fire at their exact tMs. The state machine is
// told via the onTakeover callback (it dispatches TORCH_LOST); F3 has
// already stopped the track, so the conductor never commands a dead torch
// (and never calls release() — that is the host's kill switch via the
// machine's release-torch effect).
//
// MANUAL SWITCH — THE SAME MECHANICS (R1 §5.6's "torch not flashing?"
// control): the operator's SWITCH TO SCREEN key takes the SAME takeover
// path via switchToScreen(). The host dispatches the machine's
// SWITCH_CHANNEL FIRST (its release-torch effect is the synchronous
// hardware kill), then calls switchToScreen() — the screen completes the
// message from the exact current position, mid-mark included, paused
// included. A manual release() emits 'released', which no conductor
// listens for ('lost' is F3's loss signal, not a host action), so without
// this call the machine would say broadcasting-on-screen while the run
// went dark on a dead torch. The takeover is reported like any other
// (onTakeover, code TAKEOVER_CODES.MANUAL_SWITCH); the machine has
// already moved, so the host's TORCH_LOST dispatch for that report lands
// in a state with no row — a soft no-op, never a double transition.
//
// STATE-MACHINE MAP (F6 emits, never drives — js/states.js owns GO/PAUSE/
// RESUME/STOP). Callback → F8 event to dispatch:
//   onPause({reason:'visibility'})  → PAUSE        (machine: broadcasting → paused)
//   onResume({positionMs})          → (host calls resume() on RESUME)
//   onComplete({durationMs, …})     → BROADCAST_COMPLETE (→ done)
//   onError({phase, error})         → BROADCAST_FAILED   (→ error)
//   onTakeover({code, …})           → TORCH_LOST   (broadcasting → broadcasting-on-screen;
//                              a manual switch's report arrives after SWITCH_CHANNEL
//                              already moved the machine — see switchToScreen)
// onProgress feeds the I2 tape read-head, not the machine.
//
// PROGRESS (per mark, at the mark's exact ON tMs — the head moves with
// the schedule, not with the LED): {tMs, mark, charIdx, letterIdx,
// symbolIdx, channel}. Also emitted once at resume (current head after
// re-anchor). Consumer exceptions are swallowed — a broken UI callback
// must not stop a broadcast (F3/F8 listener discipline).
//
// DOM-FREE + STATE-MACHINE-AGNOSTIC BY INJECTION: clock (options.now),
// tick scheduling (setTimeout/clearTimeout pair), and all three channel
// objects are injectable; the visibilitychange port is injectable too
// ({addEventListener, removeEventListener, isHidden}; default: the global
// document, bound lazily via typeof guards so the module imports cleanly
// under bare Node). The conductor never touches the DOM itself, never
// imports the machine, and owns no channel lifetimes beyond commands.
//
// Wiring-bug discipline (F3/F4/F5 convention): start() while running,
// replay() before any start, and malformed options/schedules throw
// (TypeError/RangeError). Environment failures (attach rejected, no
// master clock, a channel throwing mid-broadcast) fail the broadcast via
// onError + state FAILED instead of throwing through the caller. Every
// fire-and-forget promise is caught — no unhandledrejection paths.

import { eventIndexAt } from './schedule.js';
import { LOOKAHEAD_MS, TICK_MS } from './audio.js';
import { TORCH_EVENTS, TORCH_STATES } from './torch.js';

/**
 * Torch commands fire this many ms EARLY (R2 §5.3: the applyConstraints
 * pipeline costs ~40–130 ms typical; ON and OFF ride it symmetrically, so
 * the lead cancels the audio↔light OFFSET, not the mark ratios). Named
 * constant, range 0–200 (TORCH_LEAD_MIN_MS..TORCH_LEAD_MAX_MS), tuned
 * once via the Q3 real-device script — never self-calibrated at runtime.
 */
export const TORCH_LEAD_MS = 120;

/** Allowed range for torchLeadMs (R2 commits 0–200). */
export const TORCH_LEAD_MIN_MS = 0;
export const TORCH_LEAD_MAX_MS = 200;

/**
 * Runway before the first edge: the first torch command comes due at
 * `tMs 0 − TORCH_LEAD_MS`; the pad (lead + one tick of slack) guarantees
 * that due is still in the future at the first tick, so it fires at its
 * EXACT early time instead of clamping to the start.
 */
export const START_PAD_MS = TORCH_LEAD_MS + TICK_MS;

/**
 * Minimum commanded dark gap between a torch OFF and the next torch ON
 * (the spacing floor the post-resume catch-up schedule is derived from).
 * One camera-preview frame at 30 fps (⌈1000/30⌉): R2 §3.1c — the camera
 * pipeline applies torch requests per preview frame, so a commanded dark
 * period shorter than one frame can be skipped entirely by the HAL,
 * merging adjacent marks (the W3C #275 / html5-qrcode #634 rapid-toggle
 * class R2 §3.1b spaces commands to avoid). In an unpaused run the floor
 * holds by construction (consecutive torch commands are spaced by a
 * Morse element, ≥100 ms at every committed step — R2 §5.1); pause/resume
 * catch-up is the only path that can compress it, so the floor — not any
 * per-edge time — is what the catch-up scheduler enforces.
 */
export const TORCH_SPACING_FLOOR_MS = 33;

/**
 * Cause codes the conductor reports on onTakeover. Torch-loss codes arrive
 * from F3 (TORCH_ERROR_CODES: 'track-ended' | 'apply-rejected'); the manual
 * switch is an operator choice, not a torch error, so it owns its code here
 * (F8 tags the machine-side takeover cause with the same string).
 */
export const TAKEOVER_CODES = Object.freeze({
  MANUAL_SWITCH: 'manual-switch',
});

/** Conductor lifecycle states (status().state). */
export const CONDUCTOR_STATES = Object.freeze({
  IDLE: 'idle',         // never started (or destroyed)
  RUNNING: 'running',   // loop live, schedule playing
  PAUSED: 'paused',     // frozen at pausedAtMs (visibilitychange or user)
  DONE: 'done',         // ran to the end (onComplete fired)
  STOPPED: 'stopped',   // cancel()ed mid-broadcast
  FAILED: 'failed',     // onError fired (start or broadcast phase)
});

/** Why a pause happened (onPause payload `reason`). */
export const PAUSE_REASONS = Object.freeze({
  USER: 'user',                    // host called pause() (machine PAUSE)
  VISIBILITY: 'visibility',        // visibilitychange → hidden (R2)
});

const VISIBILITY_EVENT = 'visibilitychange';
const noop = () => {};

/**
 * Create a broadcast conductor. Everything time-related is injectable so
 * test/conductor.test.mjs runs full broadcasts deterministically on a mock
 * clock; defaults bind lazily (typeof guards) and the module imports
 * cleanly under bare Node.
 *
 * @param {{
 *   screen: Object,            // F4 channel: {attach, on, off, hide} (required)
 *   audio?: Object|null,       // F5 channel: {unlock, now, scheduleTone, stopAll}
 *   torch?: Object|null,       // F3 channel: {on, off, status,
 *                              //   addEventListener, removeEventListener}
 *   setTimeout?: Function, clearTimeout?: Function,  // tick pair
 *   now?: Function,            // master clock override — SECONDS (like
 *                              //   audio.now()); default: the audio clock,
 *                              //   falling back to performance.now()/1000
 *                              //   for light-only broadcasts
 *   visibility?: {addEventListener: Function, removeEventListener: Function,
 *                isHidden: Function},   // default: the global document
 *   torchLeadMs?: number, tickMs?: number, lookaheadMs?: number,
 *   torchSpacingFloorMs?: number, startPadMs?: number,
 *   onProgress?: Function, onTakeover?: Function, onComplete?: Function,
 *   onError?: Function, onPause?: Function, onResume?: Function,
 * }} [options]
 * @returns {{
 *   start: (sched?: {events: Array, durationMs: number}) => Promise<{started: boolean, completed?: boolean, error?: Error}>,
 *   pause: (reason?: string) => boolean,
 *   resume: () => Promise<boolean>,
 *   cancel: () => boolean,
 *   replay: () => Promise<{started: boolean}>,
 *   switchToScreen: () => boolean,
 *   status: () => Object,
 *   destroy: () => void,
 * }}
 * @throws {TypeError} malformed options (missing channels, bad callback or
 *   timer types).
 * @throws {RangeError} torchLeadMs outside [TORCH_LEAD_MIN_MS,
 *   TORCH_LEAD_MAX_MS], or non-positive tickMs/lookaheadMs.
 */
export function createConductor(options = {}) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError(`conductor: options must be an object, got ${typeof options}`);
  }

  const screen = options.screen;
  if (!screen || typeof screen !== 'object') {
    throw new TypeError('conductor: options.screen (the F4 channel) is required');
  }
  for (const fn of ['attach', 'on', 'off', 'hide']) {
    if (typeof screen[fn] !== 'function') {
      throw new TypeError(`conductor: options.screen .${fn}() must be a function`);
    }
  }

  const audio = options.audio ?? null;
  if (audio !== null && typeof audio !== 'object') {
    throw new TypeError('conductor: options.audio must be the F5 channel object or null');
  }
  if (audio) {
    for (const fn of ['unlock', 'now', 'scheduleTone', 'stopAll']) {
      if (typeof audio[fn] !== 'function') {
        throw new TypeError(`conductor: options.audio .${fn}() must be a function`);
      }
    }
  }

  const torch = options.torch ?? null;
  if (torch !== null && typeof torch !== 'object') {
    throw new TypeError('conductor: options.torch must be the F3 channel object or null');
  }
  if (torch) {
    for (const fn of ['on', 'off', 'status', 'addEventListener', 'removeEventListener']) {
      if (typeof torch[fn] !== 'function') {
        throw new TypeError(`conductor: options.torch .${fn}() must be a function`);
      }
    }
  }

  const timerSet = options.setTimeout ?? (typeof setTimeout === 'function' ? setTimeout : null);
  const timerClear = options.clearTimeout ?? (typeof clearTimeout === 'function' ? clearTimeout : null);
  if (typeof timerSet !== 'function' || typeof timerClear !== 'function') {
    throw new TypeError(
      'conductor: setTimeout/clearTimeout unavailable — inject the pair for deterministic testing'
    );
  }

  const nowOverride = typeof options.now === 'function' ? options.now : null;
  if (options.now !== undefined && !nowOverride) {
    throw new TypeError('conductor: options.now must be a function returning seconds');
  }

  const leadMs = options.torchLeadMs ?? TORCH_LEAD_MS;
  if (typeof leadMs !== 'number' || !Number.isFinite(leadMs)) {
    throw new TypeError(`conductor: torchLeadMs must be a finite number, got ${leadMs}`);
  }
  if (leadMs < TORCH_LEAD_MIN_MS || leadMs > TORCH_LEAD_MAX_MS) {
    throw new RangeError(
      `conductor: torchLeadMs must be within [${TORCH_LEAD_MIN_MS}, ${TORCH_LEAD_MAX_MS}] ` +
        `(R2-committed range; tune once via Q3 — never at runtime). Got ${leadMs}`
    );
  }
  const tickMs = assertPositiveNumber(options.tickMs ?? TICK_MS, 'tickMs');
  const lookaheadMs = assertPositiveNumber(options.lookaheadMs ?? LOOKAHEAD_MS, 'lookaheadMs');
  // Spacing floor of the post-resume torch catch-up schedule (see
  // TORCH_SPACING_FLOOR_MS). Injectable so the shaping logic is testable
  // at exaggerated floors; the default is the committed one-frame value.
  const spacingFloorMs = assertPositiveNumber(
    options.torchSpacingFloorMs ?? TORCH_SPACING_FLOOR_MS,
    'torchSpacingFloorMs'
  );
  // Default pad tracks the EFFECTIVE lead (lead + one tick of slack): with
  // an injected torchLeadMs > default, a pad computed from the default lead
  // would under-pad the first early command.
  const startPadMs = assertNonNegativeNumber(
    options.startPadMs ?? (leadMs + TICK_MS),
    'startPadMs'
  );

  const cbs = {};
  for (const name of ['onProgress', 'onTakeover', 'onComplete', 'onError', 'onPause', 'onResume']) {
    const cb = options[name] ?? null;
    if (cb !== null && typeof cb !== 'function') {
      throw new TypeError(`conductor: options.${name} must be a function`);
    }
    cbs[name] = cb;
  }

  const visibility = resolveVisibility(options.visibility);

  // ----- runtime state ------------------------------------------------------

  let state = CONDUCTOR_STATES.IDLE;
  let scheduleRef = null;      // last started {events, durationMs} (replay source)
  let events = [];
  let durationMs = 0;
  let channel = null;          // 'torch' | 'screen' | null (before first start)
  let anchorSec = 0;
  let clockFn = null;
  let clockSource = 'none';    // 'injected' | 'audio' | 'performance' | 'none'
  let audioReady = false;
  let tickHandle = null;
  let starting = false;
  let resuming = false;

  let lightIdx = 0;            // next edge for screen commands + progress (exact tMs)
  let torchIdx = 0;            // next edge for torch commands (tMs − lead); ===
                               // events.length when the torch is not active
  let torchCatchUpT = -Infinity; // resume re-anchor: edges with tMs ≤ this had
                               // their lead-shifted torch due pass before the
                               // pause (countermanded by lights-out) and are
                               // caught up per shapeTorchDues(); −Infinity =
                               // normal (fresh run, no catch-up region)
  let torchDues = null;        // post-resume torch due per edge index (the
                               // shaped catch-up schedule from
                               // shapeTorchDues()); null = normal lead dues
  let toneIdx = 0;             // next ON edge still needing a tone (steps by 2)
  let pausedAtMs = 0;

  let lostHandler = null;
  let visBound = false;

  // Auto-pause per R2 the moment the page hides (only meaningful mid-run).
  function onVisibilityChange() {
    if (state === CONDUCTOR_STATES.RUNNING && visibility.isHidden()) {
      pause(PAUSE_REASONS.VISIBILITY);
    }
  }
  if (visibility) {
    visibility.addEventListener(VISIBILITY_EVENT, onVisibilityChange);
    visBound = true;
  }

  // ----- the loop ------------------------------------------------------------

  /** One wakeup: dispatch everything due, then sleep until the next due
   *  (never longer than TICK_MS — R2's cadence is the sleep CAP). */
  function tick() {
    tickHandle = null;
    if (state !== CONDUCTOR_STATES.RUNNING) return;
    try {
      const t = positionMs();
      dispatchDues(t);
      if (state !== CONDUCTOR_STATES.RUNNING) return; // completed/failed inside
      scheduleNextWake(t);
    } catch (err) {
      fail(err);
    }
  }

  /** Effective due (schedule ms) of the torch command for edge i: the
   *  shaped post-resume schedule when one exists (shapeTorchDues), the
   *  plain lead-shifted edge time otherwise (R2 §5.3). */
  function torchDueMs(i) {
    if (torchDues) return torchDues[i];
    return events[i].tMs - leadMs;
  }

  /** Derive the ENTIRE post-resume torch due schedule from the spacing
   *  floor (the defect-3 fix). Walked once per resume() over the pending
   *  edges [fromIdx, n); every ordering question — catch-up OFF vs
   *  catch-up ON, catch-up OFF vs normal-due ON, normal OFF vs catch-up
   *  ON — resolves inside the same rule pair, so there is no per-branch
   *  patching to get wrong:
   *
   *  base due   countermanded ON (lead due passed) → the resume instant
   *             (a mark must never play dark against its tone);
   *             countermanded OFF → its EXACT edge time (the gap boundary
   *             re-commanded no later than offT, never at the resume
   *             instant where it would zero-length the restored mark);
   *             everything else → the normal lead due (tMs − lead).
   *  dark floor a pending OFF is pulled to min(its due, nextOnDue −
   *             floor) when that stays strictly after the previous
   *             command (the restored mark renders slightly short — the
   *             accepted trade); otherwise the OFF keeps its due and the
   *             FOLLOWING ON is advanced to prevDue + floor, capped at
   *             the mark's own tMs (an ON is never commanded later than
   *             its true edge — and never after its own OFF's due).
   *  monotone   dues never decrease (dispatch order = edge order, and
   *             the wake target is always the earliest un-walked due).
   *
   *  The result is non-decreasing, ≥ the resume instant, and every
   *  commanded OFF→ON pair is ≥ spacingFloorMs apart at every committed
   *  step (Morse elements are ≥100 ms, so the ON push and the tMs cap
   *  can never collide there). */
  function shapeTorchDues(fromIdx, resumeMs) {
    const n = events.length;
    const dues = new Array(n);
    const base = (ev) =>
      ev.tMs <= torchCatchUpT ? (ev.on ? resumeMs : ev.tMs) : ev.tMs - leadMs;
    // The previous walked command — or, when the freeze point sat
    // mid-mark, the restore ON that resume() fires at the resume
    // instant (it is part of the post-resume command stream, so the
    // first walked OFF must not predate it).
    let prevDue = events[fromIdx] && events[fromIdx].on === false ? resumeMs : -Infinity;
    for (let i = fromIdx; i < n; i++) {
      const ev = events[i];
      let due = base(ev);
      if (!ev.on && i + 1 < n) {
        // Pull the OFF earlier so the next ON's due keeps a full floor
        // of commanded dark before it — but only when the pull stays
        // strictly after the previous command (else the OFF would
        // zero-length the just-lit mark; the ON push below restores the
        // floor instead).
        const pullTo = Math.min(due, base(events[i + 1]) - spacingFloorMs);
        if (pullTo > prevDue) due = pullTo;
      }
      if (due < prevDue) due = prevDue; // monotone: never before our own mark's ON
      if (ev.on) {
        if (due < prevDue + spacingFloorMs) due = prevDue + spacingFloorMs;
        if (due > ev.tMs) due = ev.tMs; // never command an ON past its exact edge
      }
      dues[i] = due;
      prevDue = due;
    }
    return dues;
  }

  function dispatchDues(t) {
    const n = events.length;

    // 1) Torch — lead-shifted, fire-and-forget (R2 §5.3: never awaited).
    while (channel === 'torch' && torchIdx < n && torchDueMs(torchIdx) <= t) {
      if (typeof torch?.scheduleTimeline !== 'function') torchCommand(events[torchIdx].on);
      torchIdx++;
    }

    // 2) Active screen channel + tape progress — exact tMs. Progress rides
    //    this pass in torch mode too: the read-head moves with the schedule.
    while (lightIdx < n && events[lightIdx].tMs <= t) {
      const ev = events[lightIdx];
      if (channel === 'screen') screenCommand(ev.on);
      if (ev.on) safeEmit(cbs.onProgress, progressOf(ev, ev.tMs));
      lightIdx++;
    }

    // 3) Audio — one LOOKAHEAD window ahead, absolute times (F5 contract).
    while (toneIdx < n && events[toneIdx].tMs <= t + lookaheadMs) {
      scheduleMark(events[toneIdx], events[toneIdx + 1]);
      toneIdx += 2;
    }

    // 4) Completion — every edge dispatched and the schedule exhausted.
    if (lightIdx >= n && t >= durationMs) finishComplete();
  }

  /** Sleep exactly until the soonest channel due, capped at one TICK_MS. */
  function scheduleNextWake(t) {
    let next = t + tickMs; // R2 cadence: never sleep longer than one tick
    if (channel === 'torch' && torchIdx < events.length) {
      next = Math.min(next, torchDueMs(torchIdx));
    }
    if (lightIdx < events.length) next = Math.min(next, events[lightIdx].tMs);
    if (toneIdx < events.length) next = Math.min(next, events[toneIdx].tMs - lookaheadMs);
    next = Math.min(next, durationMs);
    tickHandle = timerSet(tick, Math.max(next - t, 0));
  }

  // ----- channel commands (all fire-and-forget; sync throws propagate) -------

  function torchCommand(on) {
    if (!torch) return;
    try {
      const p = on ? torch.on() : torch.off();
      if (p && typeof p.catch === 'function') p.catch(noop);
    } catch {
      /* The channel left torch-ready synchronously (e.g. it was lost);
         F3's 'lost' event has already driven the takeover. Nothing to do. */
    }
  }

  function scheduleNativeTorch(position) {
    if (channel !== 'torch' || typeof torch?.scheduleTimeline !== 'function') return;
    const delayMs = Math.max(0, (anchorSec + position / 1000 - clockFn()) * 1000);
    torch.scheduleTimeline({ events, positionMs: position, delayMs }).catch(noop);
  }

  function screenCommand(on) {
    const p = on ? screen.on() : screen.off();
    if (p && typeof p.catch === 'function') p.catch(noop);
  }

  function scheduleMark(onEv, offEv) {
    if (!audio || !audioReady) return; // light-only broadcast
    // Absolute AudioContext seconds; F5 clamps a past onset (late tick,
    // resume remainder) while keeping the OFF edge — the boundary that
    // defines the following gap — exactly on schedule.
    audio.scheduleTone(anchorSec + onEv.tMs / 1000, anchorSec + offEv.tMs / 1000);
  }

  /** Best-effort all-lights-out. MUST never throw (it runs on stop paths
   *  where an exception would mask the real flow). The torch's guaranteed
   *  physical kill remains the host's torch.release() (machine effect);
   *  here we command OFF and drop the screen carrier. */
  function lightsDown(dropIt) {
    try {
      if (channel === 'torch') torchCommand(false);
      else screenCommand(false);
    } catch {
      /* best-effort */
    }
    if (dropIt) dropCarrier();
  }

  /** Carrier down (screen.hide): app visible again, fullscreen kept so a
   *  replay needs no new gesture (F4 contract). Best-effort. */
  function dropCarrier() {
    try {
      const p = screen.hide();
      if (p && typeof p.catch === 'function') p.catch(noop);
    } catch {
      /* best-effort */
    }
  }

  // ----- lifecycle ------------------------------------------------------------

  /**
   * Start a broadcast. Call from the GO gesture: screen.attach() and
   * audio.unlock() are BOTH initiated in this synchronous task (fullscreen
   * and context-resume need the user-activation window), then awaited.
   *
   * @param {{events: Array, durationMs: number}} [sched] — an F2 schedule;
   *   omitted on replay() (the remembered one is reused).
   */
  async function start(sched) {
    if (state === CONDUCTOR_STATES.RUNNING || state === CONDUCTOR_STATES.PAUSED || starting) {
      throw new Error(
        'conductor: start() while a broadcast is active — cancel() first, or use replay()'
      );
    }
    const s = sched ?? scheduleRef;
    const invalid = validateSchedule(s);
    if (invalid) throw invalid;

    starting = true;
    try {
      scheduleRef = s;
      events = s.events;
      durationMs = s.durationMs;
      lightIdx = 0;
      toneIdx = 0;
      torchIdx = 0;
      torchCatchUpT = -Infinity;
      torchDues = null;
      pausedAtMs = 0;
      audioReady = false;
      clockSource = 'none';
      channel = resolveChannel(); // torch preferred, screen fallback
      // A receiver needs a visible OFF interval before the bright app returns.
      if (channel === 'screen' && events.length) durationMs += screen.trailingQuietMs ?? 0;
      if (channel !== 'torch') torchIdx = events.length;

      // Both channel gestures open NOW (Broadcast tap), before any await.
      const attachP = beginCall(() => screen.attach());
      const unlockP = audio ? beginCall(() => audio.unlock()) : Promise.resolve();
      let attachErr = null;
      let unlockErr = null;
      await attachP.then(noop, (err) => { attachErr = err; });
      await unlockP.then(noop, (err) => { unlockErr = err; });
      if (attachErr) return failStart(attachErr);

      audioReady = !unlockErr;
      if (nowOverride) {
        clockFn = nowOverride;
        clockSource = 'injected';
      } else if (audio && audioReady) {
        clockFn = () => audio.now(); // AudioContext.currentTime — the master clock
        clockSource = 'audio';
      } else if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        // Light-only: no audio to sync against, so the monotonic UI clock
        // is sufficient (R2 §4 calls performance.now "required but not
        // sufficient" — exactly right when there is no audio).
        clockFn = () => performance.now() / 1000;
        clockSource = 'performance';
      } else {
        return failStart(
          new Error(
            `conductor: no master clock — audio unlock failed (${describe(unlockErr)}) ` +
              'and performance.now is unavailable'
          )
        );
      }

      if (channel === 'screen' && events.length && screen.leadingQuietMs > 0) await screen.prepare();
      anchorSec = clockFn() + (startPadMs + (channel === 'screen' ? screen.leadingQuietMs ?? 0 : 0)) / 1000;
      bindTorchLost();
      state = CONDUCTOR_STATES.RUNNING;

      if (events.length === 0) {
        // Whitespace-only message: nothing to send. Channels armed, carrier
        // down, machine told — an instantly-complete broadcast.
        finishComplete();
        return { started: true, completed: true };
      }
      scheduleNativeTorch(0);
      tick(); // immediate first pass: opens the first lookahead window
      return { started: true };
    } finally {
      starting = false;
    }
  }

  /** Freeze at the exact current position. Kills the tick timer, every
   *  scheduled tone (stopAll covers the ≤ LOOKAHEAD_MS audio tail), and
   *  the active light. Idempotent no-op unless running. */
  function pause(reason = PAUSE_REASONS.USER) {
    if (state !== CONDUCTOR_STATES.RUNNING) return false;
    pausedAtMs = clamped(positionMs(), 0, durationMs);
    stopTick();
    try {
      if (audio) audio.stopAll();
    } catch {
      /* best-effort */
    }
    lightsDown(false);
    state = CONDUCTOR_STATES.PAUSED;
    safeEmit(cbs.onPause, { reason, positionMs: pausedAtMs });
    return true;
  }

  /** Re-anchor at the frozen position and continue. Everything with
   *  tMs < pausedAtMs is elapsed (skipped, never re-fired); a mid-flight
   *  mark completes with its remainder (light restored now, tone from the
   *  F5-clamped onset to the exact OFF edge). The torch cursor re-anchors
   *  DOWN to the same index: pause's lights-out countermanded every torch
   *  command already issued (their dues lead the schedule by up to
   *  TORCH_LEAD_MS), so the resumed stream rebuilds from resumeIdx via
   *  shapeTorchDues() — the whole catch-up schedule derived from the
   *  spacing floor (immediate ONs, exact-edge OFFs, floor-preserved
   *  dark between consecutive marks). */
  async function resume() {
    if (state !== CONDUCTOR_STATES.PAUSED || resuming) return false;
    resuming = true;
    try {
      if (audio && clockSource === 'audio') {
        try {
          await audio.unlock(); // idempotent; resumes a context iOS suspended
        } catch {
          /* stays soundless — the clock itself keeps running */
        }
      }
      if (state !== CONDUCTOR_STATES.PAUSED) return false; // cancelled meanwhile

      anchorSec = clockFn() - pausedAtMs / 1000;

      // The committed re-anchor (R2/F2): eventIndexAt skips the elapsed
      // marks; the max() with our own cursor guarantees nothing already
      // dispatched can ever fire twice.
      const resumeIdx = Math.max(eventIndexAt(events, pausedAtMs), lightIdx);
      lightIdx = resumeIdx;
      // Torch: DOWN to resumeIdx, mirroring the light cursor (the fix for
      // the pause-inside-a-lead-window defects). The old clamp — max(
      // resumeIdx, torchIdx) — kept the cursor past edges whose lead-
      // shifted due had fired pre-pause and been countermanded by pause's
      // lights-out, so their commands were never re-issued. Re-firing a
      // countermanded command is safe (fire-and-forget, idempotent dark);
      // shapeTorchDues() below derives every catch-up command time from
      // the spacing floor.
      torchIdx = channel === 'torch' ? resumeIdx : events.length;
      torchCatchUpT = channel === 'torch' ? pausedAtMs + leadMs : -Infinity;
      // The whole post-resume torch schedule is derived here, once, from
      // the spacing floor (see shapeTorchDues) — the defect-3 fix. The old
      // per-edge shaping fired a catch-up OFF at its exact edge time while
      // the NEXT mark kept its normal lead due; whenever the inter-mark gap
      // < TORCH_LEAD_MS (every BRISK symbol gap, sub-frame at STANDARD)
      // both landed in the same dispatch tick and the commanded dark
      // collapsed to 0 — adjacent dots merged into one flash while both
      // tones played.
      torchDues = channel === 'torch' ? shapeTorchDues(resumeIdx, pausedAtMs) : null;
      toneIdx = onBaseEdge(resumeIdx);

      const ev = events[resumeIdx];
      if (ev && ev.on === false) {
        // Mid-mark at the freeze point: the running mark completes — light
        // back on NOW, remainder of its tone scheduled (onset clamps).
        try {
          if (channel === 'torch') torchCommand(true);
          else screenCommand(true);
        } catch (err) {
          // A channel throwing synchronously on the restore is a broadcast
          // failure (the tick-path discipline), not a rejected resume().
          fail(err);
          return false;
        }
        scheduleMark(events[resumeIdx - 1], ev);
        toneIdx = resumeIdx + 1; // partial scheduled here; skip past its OFF edge
      }

      state = CONDUCTOR_STATES.RUNNING;
      scheduleNativeTorch(pausedAtMs);
      safeEmit(cbs.onResume, { positionMs: pausedAtMs });
      if (ev) safeEmit(cbs.onProgress, progressOf(ev, pausedAtMs));
      tick();
      return true;
    } finally {
      resuming = false;
    }
  }

  /** Stop without completing: tick killed, tones killed, lights OUT (the
   *  LED is never left commanded-on), carrier dropped. No onComplete. */
  function cancel() {
    if (state !== CONDUCTOR_STATES.RUNNING && state !== CONDUCTOR_STATES.PAUSED) return false;
    stopTick();
    try {
      if (audio) audio.stopAll();
    } catch {
      /* best-effort */
    }
    lightsDown(true);
    unbindTorchLost();
    state = CONDUCTOR_STATES.STOPPED;
    return true;
  }

  /** Clean restart of the same schedule: fresh anchor, fresh cursors, no
   *  leaked timers or scheduled tones (a mid-broadcast replay cancels
   *  first). F4 keeps fullscreen across hide(), so replay needs no new
   *  gesture on the screen path. */
  async function replay() {
    if (!scheduleRef) {
      throw new Error('conductor: replay() before any start() — no schedule to replay');
    }
    if (state === CONDUCTOR_STATES.RUNNING || state === CONDUCTOR_STATES.PAUSED) cancel();
    return start();
  }

  /** Terminal success path. The schedule's own last edge is an OFF (F2
   *  invariant) that the loop has already dispatched at its exact time —
   *  so completion only drops the screen carrier (torch-mode overlays sit
   *  in standby; hide is a resolving no-op there). */
  function finishComplete() {
    stopTick();
    dropCarrier();
    unbindTorchLost();
    state = CONDUCTOR_STATES.DONE;
    safeEmit(cbs.onComplete, {
      durationMs,
      channel,
      markCount: events.length / 2,
      positionMs: durationMs,
    });
  }

  /** Terminal failure path (start-phase failures report without throwing). */
  function fail(error) {
    stopTick();
    try {
      if (audio) audio.stopAll();
    } catch {
      /* best-effort */
    }
    lightsDown(true);
    unbindTorchLost();
    state = CONDUCTOR_STATES.FAILED;
    safeEmit(cbs.onError, { phase: 'broadcast', error });
  }

  function failStart(error) {
    state = CONDUCTOR_STATES.FAILED;
    safeEmit(cbs.onError, { phase: 'start', error });
    return { started: false, error };
  }

  // ----- torch loss → seamless screen takeover --------------------------------

  function handleTorchLost(payload) {
    if (channel !== 'torch') return; // already taken over / never armed
    if (state !== CONDUCTOR_STATES.RUNNING && state !== CONDUCTOR_STATES.PAUSED) return;

    const lostAtMs = state === CONDUCTOR_STATES.RUNNING
      ? clamped(positionMs(), 0, durationMs)
      : pausedAtMs;
    const head = events[lightIdx] ?? null;
    const midMark = Boolean(head && head.on === false);

    channel = 'screen';
    durationMs = scheduleRef.durationMs + (screen.trailingQuietMs ?? 0);
    torchIdx = events.length; // retire the torch cursor
    torchDues = null;
    if (state === CONDUCTOR_STATES.RUNNING && midMark) {
      // The running mark completes on screen from this instant; its OFF
      // edge and every later edge stay on their exact times.
      screenCommand(true);
    }
    unbindTorchLost();
    safeEmit(cbs.onTakeover, {
      code: payload?.code ?? 'track-ended',
      detail: payload?.detail ?? null,
      positionMs: lostAtMs,
      from: 'torch',
      to: 'screen',
      midMark,
      mark: head ? identityOf(head) : null,
    });
  }

  function bindTorchLost() {
    if (!torch || channel !== 'torch' || lostHandler) return;
    lostHandler = (payload) => handleTorchLost(payload);
    try {
      torch.addEventListener(TORCH_EVENTS.LOST, lostHandler);
    } catch {
      lostHandler = null;
    }
  }

  /**
   * Operator's manual channel switch (the SWITCH TO SCREEN key): the SAME
   * takeover mechanics as torch loss — the screen completes the message
   * from the exact current position (a running mark lights on screen at
   * the switch instant; its OFF edge and every later edge stay on their
   * exact tMs) — but initiated by the host instead of F3's 'lost' event.
   * The host dispatches the machine's SWITCH_CHANNEL FIRST (its
   * release-torch effect is the synchronous hardware kill), then calls
   * this; the torch channel object is never touched again either way
   * (release() already stopped the track, and the cursor is retired here).
   * Reports onTakeover with code TAKEOVER_CODES.MANUAL_SWITCH — the
   * machine has already moved, so the host's TORCH_LOST dispatch for that
   * report is a soft no-op, never a second transition.
   *
   * @returns {boolean} true iff a live torch-channel takeover happened
   *   (false: never started/done, not on the torch channel, or already
   *   taken over — idempotent, never throws).
   */
  function switchToScreen() {
    if (channel !== 'torch') return false; // screen run / never armed / taken over
    if (state !== CONDUCTOR_STATES.RUNNING && state !== CONDUCTOR_STATES.PAUSED) return false;
    handleTorchLost({
      code: TAKEOVER_CODES.MANUAL_SWITCH,
      detail: 'operator switch to screen (machine SWITCH_CHANNEL)',
    });
    return true;
  }

  function unbindTorchLost() {
    const handler = lostHandler;
    lostHandler = null;
    if (!handler || !torch) return;
    try {
      torch.removeEventListener(TORCH_EVENTS.LOST, handler);
    } catch {
      /* already gone */
    }
  }

  // ----- introspection + teardown ---------------------------------------------

  function status() {
    return {
      state,
      channel,
      positionMs: livePosition(),
      durationMs,
      pausedAtMs,
      anchorSec: state === CONDUCTOR_STATES.IDLE ? 0 : anchorSec,
      clockSource,
      audioReady,
      torchLeadMs: leadMs,
      tickMs,
      lookaheadMs,
      torchSpacingFloorMs: spacingFloorMs,
      startPadMs,
      edges: events.length,
      edgesFired: lightIdx,
      tonesScheduled: toneIdx / 2,
      hasSchedule: Boolean(scheduleRef),
      tickPending: tickHandle !== null,
    };
  }

  /** Full teardown of the conductor itself (channels are owned by the
   *  host and are NOT destroyed — lights are commanded out first). */
  function destroy() {
    cancel();
    unbindTorchLost();
    if (visibility && visBound) {
      try {
        visibility.removeEventListener(VISIBILITY_EVENT, onVisibilityChange);
      } catch {
        /* already gone */
      }
      visBound = false;
    }
    scheduleRef = null;
    events = [];
    durationMs = 0;
    lightIdx = 0;
    torchIdx = 0;
    torchCatchUpT = -Infinity;
    torchDues = null;
    toneIdx = 0;
    pausedAtMs = 0;
    channel = null;
    clockFn = null;
    clockSource = 'none';
    state = CONDUCTOR_STATES.IDLE;
  }

  // ----- internals --------------------------------------------------------------
 
  function livePosition() {
    if (state === CONDUCTOR_STATES.RUNNING) return clamped(positionMs(), 0, durationMs);
    if (state === CONDUCTOR_STATES.PAUSED) return pausedAtMs;
    if (state === CONDUCTOR_STATES.DONE) return durationMs;
    return 0;
  }

  /** Schedule position in ms, quantized to the microsecond — F2 times are
   *  exact integers at every committed step, so this kills float noise in
   *  (now − anchor) arithmetic without moving any real edge. */
  function positionMs() {
    if (!clockFn) return 0;
    return Math.round((clockFn() - anchorSec) * 1e6) / 1e3;
  }

  function progressOf(ev, tMs) {
    return {
      tMs,
      mark: ev.mark,
      charIdx: ev.charIdx,
      letterIdx: ev.letterIdx,
      symbolIdx: ev.symbolIdx,
      channel,
    };
  }

  function identityOf(ev) {
    return {
      mark: ev.mark,
      charIdx: ev.charIdx,
      letterIdx: ev.letterIdx,
      symbolIdx: ev.symbolIdx,
    };
  }

  /** Index of the ON edge owning edge i (i itself when it is one) — the
   *  tone cursor re-anchor: a mid-flight mark re-schedules as a partial. */
  function onBaseEdge(i) {
    return events[i] && events[i].on === false ? i - 1 : i;
  }

  function stopTick() {
    if (tickHandle !== null) {
      timerClear(tickHandle);
      tickHandle = null;
    }
  }

  function resolveChannel() {
    if (!torch) return 'screen';
    try {
      const st = torch.status();
      return st && st.state === TORCH_STATES.READY ? 'torch' : 'screen';
    } catch {
      return 'screen';
    }
  }

  function safeEmit(cb, payload) {
    if (!cb) return;
    try {
      cb(payload);
    } catch {
      /* a broken consumer must not stop the broadcast */
    }
  }

  return { start, pause, resume, cancel, replay, switchToScreen, status, destroy };
}

// -----------------------------------------------------------------------------
// Module internals

/** Run fn synchronously, normalizing sync throws into rejections (so a
 *  non-async stub channel still gets the settled-promise treatment). */
function beginCall(run) {
  try {
    return Promise.resolve(run());
  } catch (err) {
    return Promise.reject(err);
  }
}

function resolveVisibility(visibility) {
  if (visibility === undefined || visibility === null) {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
      return null; // no DOM (bare Node): the host pauses/resumes manually
    }
    return {
      addEventListener: (type, fn) => document.addEventListener(type, fn),
      removeEventListener: (type, fn) => document.removeEventListener(type, fn),
      isHidden: () => document.visibilityState === 'hidden',
    };
  }
  if (typeof visibility !== 'object') {
    throw new TypeError('conductor: options.visibility must be {addEventListener, removeEventListener, isHidden}');
  }
  for (const fn of ['addEventListener', 'removeEventListener', 'isHidden']) {
    if (typeof visibility[fn] !== 'function') {
      throw new TypeError(`conductor: options.visibility .${fn}() must be a function`);
    }
  }
  return visibility;
}

function validateSchedule(s) {
  if (!s || typeof s !== 'object') {
    return new TypeError('conductor: start(schedule) expects an F2 schedule {events, durationMs}');
  }
  if (!Array.isArray(s.events)) {
    return new TypeError('conductor: schedule.events must be an array (from js/schedule.js)');
  }
  if (typeof s.durationMs !== 'number' || !Number.isFinite(s.durationMs) || s.durationMs < 0) {
    return new TypeError(`conductor: schedule.durationMs must be a finite number ≥ 0, got ${s.durationMs}`);
  }
  let prevOn = null;
  let prevT = -Infinity;
  for (let i = 0; i < s.events.length; i++) {
    const ev = s.events[i];
    if (!ev || typeof ev !== 'object') {
      return new TypeError(`conductor: schedule.events[${i}] must be an object`);
    }
    if (typeof ev.tMs !== 'number' || !Number.isFinite(ev.tMs) || ev.tMs < 0) {
      return new TypeError(`conductor: schedule.events[${i}].tMs must be a finite number ≥ 0`);
    }
    if (typeof ev.on !== 'boolean') {
      return new TypeError(`conductor: schedule.events[${i}].on must be a boolean`);
    }
    if (i === 0 ? !ev.on : ev.on === prevOn) {
      return new TypeError(
        'conductor: schedule.events must strictly alternate on/off starting on:true (F2 invariant)'
      );
    }
    if (ev.tMs <= prevT) {
      return new TypeError(`conductor: schedule.events[${i}].tMs must strictly increase`);
    }
    prevOn = ev.on;
    prevT = ev.tMs;
  }
  if (s.events.length && s.durationMs < s.events[s.events.length - 1].tMs) {
    return new RangeError('conductor: schedule.durationMs ends before the last edge');
  }
  return null;
}

function assertPositiveNumber(v, name) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new TypeError(`conductor: ${name} must be a positive finite number, got ${v}`);
  }
  return v;
}

function assertNonNegativeNumber(v, name) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new TypeError(`conductor: ${name} must be a finite number ≥ 0, got ${v}`);
  }
  return v;
}

function clamped(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function describe(err) {
  return err?.message ?? String(err);
}
