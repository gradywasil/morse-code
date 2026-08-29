// js/states.js — App state machine: the permission×support matrix and the
// broadcast lifecycle as one explicit, pure transition table.
//
// Task F8 of docs/ultron/plan.md. DOM-free, timer-free, promise-free: the
// machine is driven ENTIRELY by dispatched events (the app/I2 translates
// user gestures; the conductor F6 translates channel outcomes) and it
// answers with state changes + emitted events. Every async thing lives in
// the channels (F3 torch / F4 screen / F5 audio); this module only decides
// what the app is ALLOWED to be doing right now, so `node --test` can pin
// every cell of the table headlessly.
//
// TWO DECISIONS LIVE HERE (the reason F8 exists):
//
// 1. THE PERMISSION×SUPPORT MATRIX (R1, docs/ultron/research/
//    r1-torch-support-matrix.md, committed into F8):
//
//      torch supported × granted      → torch-ready (the torch path —
//                                       iOS Safari 17.4+ and
//                                       Chromium-based Android, R1 §3.1)
//      torch supported × denied       → permission-denied WITH the screen
//                                       offer attached (never a dead end)
//      torch unsupported (any reason) → unsupported = screen mode with
//                                       POSITIVE framing ("this device
//                                       broadcasts by screen light")
//      desktop / no-camera / insecure → screen WITHOUT prompting
//
//    Desktop browsers and Firefox (all platforms) always resolve to screen
//    mode (R1 §3.1). Firefox gets there through the live detection order
//    (caps/probe — never UA sniffing, explicitly out per R1 §8); desktops
//    and camera-less/insecure contexts get there without a prompt at all.
//    The matrix is exported AS DATA (ARM_MATRIX + resolveArmMatrix) so U1
//    can write copy per cell and the suite can enumerate every cell.
//
// 2. THE BROADCAST LIFECYCLE the conductor (F6) drives:
//
//      ready → GO → broadcasting → (PAUSE ⇄ RESUME) → done → REPLAY
//
//    including the mid-broadcast torch-loss takeover F6 performs —
//    broadcasting → TORCH_LOST → broadcasting-on-screen (seamless,
//    position-preserving; the channel swap is F6's behavior, this machine
//    owns the transition + the takeover metadata I2 renders). The manual
//    "torch not flashing? switch to screen" control (R1 §5.6's mitigation
//    for the resolves-but-no-physical-flash class) rides the SAME
//    transition via SWITCH_CHANNEL, cause-tagged.
//
// STATES (15 — every one reachable, none a dead end; STATE_LIST order):
//
//   idle                  cold open; composing; nothing acquired
//   preflight             the pre-broadcast gate: photosafety notice on the
//                         FIRST entry (plan: "notice before first
//                         broadcast"), a re-arm beat on later entries
//   arming                torch acquisition in flight — R1's ARMING (gUM +
//                         capability check + both-direction probe, i.e. one
//                         F3 `acquire()` call)
//   awaiting-permission   the browser camera prompt is up — an OPTIONAL
//                         refinement of arming (see PERMISSION_PROMPTED
//                         below); correctness never depends on it
//   permission-denied     gUM denied; screen OFFERED (ACCEPT_SCREEN)
//   unsupported           torch unavailable: screen mode, POSITIVE framing
//   torch-ready           torch armed; standing by
//   screen-mode           screen armed; standing by (from the unsupported
//                         reframe, the denied offer, or a manual switch)
//   ready                 GO given — armed + committed; the standby→caution
//                         →GO choreography (I2) renders HERE
//   broadcasting          torch-channel broadcast in progress
//   broadcasting-on-screen  screen-channel broadcast (fresh screen start,
//                         torch-loss takeover, or manual switch)
//   paused / paused-on-screen  visibilitychange/user pause, per channel
//   done                  broadcast over (complete or stopped); REPLAY and
//                         SHARE offered; the torch session is already
//                         released by then (privacy scope: camera track
//                         released after broadcast)
//   error                 arm-phase internal error or broadcast failure;
//                         RETRY_ARM / REPLAY / RESET all recover
//
// R1's reference flow IDLE → ARMING (gUM + probe) → TORCH_READY |
// SCREEN_MODE → BROADCASTING is this table's spine; preflight wraps it in
// the notice gate, awaiting-permission refines the prompt window, and the
// screen side of the matrix lands in screen-mode (via unsupported) rather
// than a dead end.
//
// EVENTS (dispatched INTO the machine; STATE_EVENTS):
//
//   User intent (I2 dispatches, from gestures):
//     REQUEST_BROADCAST   idle → preflight (the Broadcast key)
//     ACK                 preflight acknowledged (hazard notice OK'd /
//                         re-arm beat cleared)
//     CANCEL              back out of preflight (→ idle) or of the GO
//                         commitment (ready → armed standby)
//     GO                  commit: torch-ready|screen-mode → ready (the
//                         choreography runs), ready → broadcasting
//     PAUSE / RESUME      mid-broadcast (F6 also dispatches PAUSE on
//                         visibilitychange → hidden, per R2)
//     STOP                end the broadcast early → done (stopped)
//     REPLAY              done|error → ready (channel still armed) or
//                         preflight (torch was released — re-arm)
//     ACCEPT_SCREEN       take the offered screen (permission-denied,
//                         unsupported) → screen-mode
//     SWITCH_CHANNEL      manual "torch not flashing? switch to screen"
//                         (torch-ready → screen-mode; broadcasting →
//                         broadcasting-on-screen; paused → paused-on-screen)
//     RETRY_ARM           re-attempt torch acquisition (re-prompts — the
//                         user may have granted since; F3 re-acquire)
//     RESET               put it away → idle (releases the torch)
//
//   Environment (I2 translates one F3 `acquire()` result via
//   eventFromTorchResult() — the mapping below is exact):
//     PERMISSION_PROMPTED arming → awaiting-permission, dispatched when the
//                         app calls acquire() AND a camera prompt is
//                         actually expected (secure context + camera +
//                         permission not yet decided). Best-effort by
//                         design: a remembered grant skips it (arming →
//                         torch-ready directly), a desktop skips it (no
//                         prompt class) — every TORCH_* outcome is legal
//                         from BOTH arming and awaiting-permission.
//     PERMISSION_GRANTED  prompt answered yes → back to arming (probe)
//     TORCH_ACQUIRED      acquire() → {outcome:'torch-ready'}
//     TORCH_PERMISSION_DENIED  acquire() → screen-fallback with reason
//                         'permission-denied' (NotAllowedError)
//     TORCH_UNSUPPORTED   acquire() → screen-fallback, any other reason
//                         (insecure-context, no-camera, no-torch-capability,
//                         probe-*, …)
//     TORCH_ERROR         acquire() → {outcome:'error'} (internal)
//     TORCH_LOST          F3's 'lost' event mid-broadcast ({code:
//                         'track-ended'|'apply-rejected'}) → screen takeover
//     BROADCAST_COMPLETE  F6 ran the schedule to the end → done
//     BROADCAST_FAILED    F6 could not continue → error
//
// EMITTED EVENTS (machine → listeners; addEventListener/removeEventListener,
//   DOM-style like F3 — listener errors are swallowed, one broken consumer
//   must not break the machine):
//     'change'   every accepted transition:
//                {from, to, via, payload, effects, snapshot} (frozen)
//     'invalid'  every rejected dispatch: {state, type, reason} — a KNOWN
//                event in the wrong state is a runtime race (a late channel
//                outcome after the user moved on), so it is REJECTED
//                SOFTLY: no state change, no context change, dispatch()
//                returns {accepted:false}. Only UNKNOWN event names throw
//                TypeError — those are wiring bugs/typos, the F3/F4/F5
//                discipline.
//     'notice-required'  effect: entering preflight with the hazard notice
//                not yet acknowledged (plan AC: notice before first
//                broadcast). Fires once per machine.
//     'release-torch'    effect: this transition abandons a HELD torch
//                session that F3 will NOT have self-released — entering
//                done/idle/error from a torch state, or switching to
//                screen. TORCH_LOST does NOT carry it (F3 already stopped
//                the track on loss). The host answers with torch.release()
//                — the synchronous hardware kill switch.
//
// CHANNEL SEMANTICS (context.channel, what I2 renders per state):
//   'torch' in torch-ready/ready/broadcasting/paused; 'screen' in
//   screen-mode/broadcasting-on-screen/paused-on-screen; ready takes
//   either; done keeps 'screen' (screen arming persists — F4 keeps
//   fullscreen so replay needs no new gesture) but drops 'torch' (the
//   camera is released after broadcast per the privacy scope, so replay
//   re-arms); null everywhere else. Phase-scoped fields never leak across
//   a lifecycle: `takeover` (set only by TORCH_LOST/SWITCH_CHANNEL rides
//   the on-screen states and persists into done/error for explanatory
//   copy), `doneReason` lives only in done, `error` only in error — each
//   is cleared by the exits of its own state (REPLAY/RESET/RETRY_ARM).
//   `fallbackReason`/`fallbackDetail` are deliberately the LAST arm
//   resolution (screen-mode copy wants "why screen"), cleared by the next
//   successful torch arm.
//
// Wiring sketch for I2 (the whole app in ten lines):
//
//   const m = createStateMachine();
//   m.addEventListener('change', (e) => render(e.snapshot));
//   m.addEventListener('release-torch', () => torch.release());
//   broadcastKey.onclick = () => m.dispatch(STATE_EVENTS.REQUEST_BROADCAST);
//   // preflight ACK → const r = await torch.acquire();
//   //   m.dispatch(...eventFromTorchResult(r))   (or PERMISSION_PROMPTED
//   //   first, when a prompt is expected)
//   // GO → conductor.start(...) at ready's GO; conductor reports
//   //   BROADCAST_COMPLETE / BROADCAST_FAILED / TORCH_LOST (via F3's
//   //   'lost' listener) / PAUSE on visibilitychange.

import { TORCH_FALLBACK_REASONS, TORCH_ERROR_CODES, TORCH_OUTCOMES } from './torch.js';

/** The fifteen app states (frozen map + STATE_LIST in lifecycle order). */
export const STATES = Object.freeze({
  IDLE: 'idle',
  PREFLIGHT: 'preflight',
  ARMING: 'arming',
  AWAITING_PERMISSION: 'awaiting-permission',
  PERMISSION_DENIED: 'permission-denied',
  UNSUPPORTED: 'unsupported',
  TORCH_READY: 'torch-ready',
  SCREEN_MODE: 'screen-mode',
  READY: 'ready',
  BROADCASTING: 'broadcasting',
  BROADCASTING_ON_SCREEN: 'broadcasting-on-screen',
  PAUSED: 'paused',
  PAUSED_ON_SCREEN: 'paused-on-screen',
  DONE: 'done',
  ERROR: 'error',
});

/** States in lifecycle order (I1's static snapshots can iterate this). */
export const STATE_LIST = Object.freeze([
  STATES.IDLE,
  STATES.PREFLIGHT,
  STATES.ARMING,
  STATES.AWAITING_PERMISSION,
  STATES.PERMISSION_DENIED,
  STATES.UNSUPPORTED,
  STATES.TORCH_READY,
  STATES.SCREEN_MODE,
  STATES.READY,
  STATES.BROADCASTING,
  STATES.BROADCASTING_ON_SCREEN,
  STATES.PAUSED,
  STATES.PAUSED_ON_SCREEN,
  STATES.DONE,
  STATES.ERROR,
]);

/** Events dispatched into the machine (see the header for who dispatches
 *  what, and when). */
export const STATE_EVENTS = Object.freeze({
  // user intent
  REQUEST_BROADCAST: 'request-broadcast',
  ACK: 'ack',
  CANCEL: 'cancel',
  GO: 'go',
  PAUSE: 'pause',
  RESUME: 'resume',
  STOP: 'stop',
  REPLAY: 'replay',
  ACCEPT_SCREEN: 'accept-screen',
  SWITCH_CHANNEL: 'switch-channel',
  RETRY_ARM: 'retry-arm',
  RESET: 'reset',
  // environment (torch channel / permission prompt)
  PERMISSION_PROMPTED: 'permission-prompted',
  PERMISSION_GRANTED: 'permission-granted',
  TORCH_ACQUIRED: 'torch-acquired',
  TORCH_PERMISSION_DENIED: 'torch-permission-denied',
  TORCH_UNSUPPORTED: 'torch-unsupported',
  TORCH_ERROR: 'torch-error',
  TORCH_LOST: 'torch-lost',
  // conductor reports
  BROADCAST_COMPLETE: 'broadcast-complete',
  BROADCAST_FAILED: 'broadcast-failed',
});

/** Effects the machine asks the host to perform (emitted as events, in
 *  addition to 'change', after the state has already moved). */
export const STATE_EFFECTS = Object.freeze({
  NOTICE_REQUIRED: 'notice-required',
  RELEASE_TORCH: 'release-torch',
});

/** Broadcast medium a matrix cell resolves to (null = not yet decided —
 *  a screen OFFER is pending, the user has not accepted). */
export const ARM_MEDIUMS = Object.freeze({
  TORCH: 'torch',
  SCREEN: 'screen',
});

/** How I2/U1 frame the resolution (copy tone per cell). */
export const ARM_FRAMINGS = Object.freeze({
  TORCH: 'torch',
  SCREEN_POSITIVE: 'screen-positive',     // "this device broadcasts by screen light"
  DENIED_OFFER_SCREEN: 'denied-offer-screen',
  WHY_CAMERA: 'why-camera',               // pre-permission explainer (U1)
  ARMING: 'arming',
});

/** Support dimension of the matrix. */
export const ARM_SUPPORT = Object.freeze({
  /** Torch candidate: a camera exists and the torch path is worth probing
   *  (mobile Chromium, iOS 17.4+ Safari — R1 §3.1). */
  TORCH: 'torch',
  /** Camera present/permission given, but torch unusable at runtime:
   *  capability absent, probe failed, camera unavailable, gUM failed.
   *  Desktop-with-camera and all-Firefox land here AFTER the live check
   *  (never by UA sniffing — R1 §8 explicitly out). */
  NO_TORCH: 'no-torch',
  /** No camera to ask (NotFoundError / stream without a video track). */
  NO_CAMERA: 'no-camera',
  /** No navigator.mediaDevices — insecure context or no media stack
   *  (R1 §3.6): nothing can be prompted, screen directly. */
  INSECURE: 'insecure-context',
});

/** Permission dimension of the matrix. */
export const ARM_PERMISSION = Object.freeze({
  GRANTED: 'granted',
  DENIED: 'denied',
  /** The browser prompt is on screen right now. */
  PENDING: 'prompt-pending',
  /** No prompt has been (or will be) shown on this path. */
  NOT_ASKED: 'not-asked',
});

/**
 * THE permission×support matrix — every cell, as data. Row = support,
 * column = permission. Cell fields:
 *   state       where the app lands
 *   medium      the broadcast medium this cell implies ('torch' | 'screen'
 *               | null — null while a screen offer is pending)
 *   framing     the copy tone U1 writes for the cell
 *   offerScreen true only where an explicit screen CHOICE is offered
 *               (the denied cell — a decision the user must make)
 *   prompts     true when the camera prompt is part of this path (the
 *               "desktop/no-camera → screen WITHOUT prompting" cells are
 *               exactly the false ones)
 * Cells marked defensive below are unreachable through F3's live
 * detection order but defined so the matrix is TOTAL (tests enumerate
 * every cell).
 */
export const ARM_MATRIX = Object.freeze({
  [ARM_SUPPORT.TORCH]: Object.freeze({
    [ARM_PERMISSION.GRANTED]: Object.freeze({
      state: STATES.TORCH_READY,
      medium: ARM_MEDIUMS.TORCH,
      framing: ARM_FRAMINGS.TORCH,
      offerScreen: false,
      prompts: false,
    }),
    [ARM_PERMISSION.DENIED]: Object.freeze({
      state: STATES.PERMISSION_DENIED,
      medium: null,
      framing: ARM_FRAMINGS.DENIED_OFFER_SCREEN,
      offerScreen: true,
      prompts: true,
    }),
    [ARM_PERMISSION.PENDING]: Object.freeze({
      state: STATES.AWAITING_PERMISSION,
      medium: null,
      framing: ARM_FRAMINGS.WHY_CAMERA,
      offerScreen: false,
      prompts: true,
    }),
    [ARM_PERMISSION.NOT_ASKED]: Object.freeze({
      state: STATES.ARMING,
      medium: null,
      framing: ARM_FRAMINGS.ARMING,
      offerScreen: false,
      prompts: true, // about to ask
    }),
  }),
  [ARM_SUPPORT.NO_TORCH]: Object.freeze({
    // granted, then caps/probe said no — positive framing, screen IS the mode
    [ARM_PERMISSION.GRANTED]: Object.freeze({
      state: STATES.UNSUPPORTED,
      medium: ARM_MEDIUMS.SCREEN,
      framing: ARM_FRAMINGS.SCREEN_POSITIVE,
      offerScreen: false,
      prompts: false,
    }),
    [ARM_PERMISSION.DENIED]: Object.freeze({
      state: STATES.PERMISSION_DENIED,
      medium: null,
      framing: ARM_FRAMINGS.DENIED_OFFER_SCREEN,
      offerScreen: true,
      prompts: true,
    }),
    [ARM_PERMISSION.PENDING]: Object.freeze({
      state: STATES.AWAITING_PERMISSION,
      medium: null,
      framing: ARM_FRAMINGS.WHY_CAMERA,
      offerScreen: false,
      prompts: true,
    }),
    // host somehow knows torch is out before asking (defensive — the live
    // order cannot know this without a prompt)
    [ARM_PERMISSION.NOT_ASKED]: Object.freeze({
      state: STATES.UNSUPPORTED,
      medium: ARM_MEDIUMS.SCREEN,
      framing: ARM_FRAMINGS.SCREEN_POSITIVE,
      offerScreen: false,
      prompts: false,
    }),
  }),
  [ARM_SUPPORT.NO_CAMERA]: Object.freeze({
    // granted once, camera since gone (defensive)
    [ARM_PERMISSION.GRANTED]: Object.freeze({
      state: STATES.UNSUPPORTED,
      medium: ARM_MEDIUMS.SCREEN,
      framing: ARM_FRAMINGS.SCREEN_POSITIVE,
      offerScreen: false,
      prompts: false,
    }),
    // explicit refusal outranks device absence (defensive)
    [ARM_PERMISSION.DENIED]: Object.freeze({
      state: STATES.PERMISSION_DENIED,
      medium: null,
      framing: ARM_FRAMINGS.DENIED_OFFER_SCREEN,
      offerScreen: true,
      prompts: true,
    }),
    // the brief's cell: no-camera → screen WITHOUT prompting
    [ARM_PERMISSION.PENDING]: Object.freeze({
      state: STATES.UNSUPPORTED,
      medium: ARM_MEDIUMS.SCREEN,
      framing: ARM_FRAMINGS.SCREEN_POSITIVE,
      offerScreen: false,
      prompts: false,
    }),
    [ARM_PERMISSION.NOT_ASKED]: Object.freeze({
      state: STATES.UNSUPPORTED,
      medium: ARM_MEDIUMS.SCREEN,
      framing: ARM_FRAMINGS.SCREEN_POSITIVE,
      offerScreen: false,
      prompts: false,
    }),
  }),
  [ARM_SUPPORT.INSECURE]: Object.freeze({
    // no media stack — nothing can be prompted, screen directly (all four
    // cells identical; listed for totality)
    [ARM_PERMISSION.GRANTED]: Object.freeze({
      state: STATES.UNSUPPORTED,
      medium: ARM_MEDIUMS.SCREEN,
      framing: ARM_FRAMINGS.SCREEN_POSITIVE,
      offerScreen: false,
      prompts: false,
    }),
    [ARM_PERMISSION.DENIED]: Object.freeze({
      state: STATES.UNSUPPORTED,
      medium: ARM_MEDIUMS.SCREEN,
      framing: ARM_FRAMINGS.SCREEN_POSITIVE,
      offerScreen: false,
      prompts: false,
    }),
    [ARM_PERMISSION.PENDING]: Object.freeze({
      state: STATES.UNSUPPORTED,
      medium: ARM_MEDIUMS.SCREEN,
      framing: ARM_FRAMINGS.SCREEN_POSITIVE,
      offerScreen: false,
      prompts: false,
    }),
    [ARM_PERMISSION.NOT_ASKED]: Object.freeze({
      state: STATES.UNSUPPORTED,
      medium: ARM_MEDIUMS.SCREEN,
      framing: ARM_FRAMINGS.SCREEN_POSITIVE,
      offerScreen: false,
      prompts: false,
    }),
  }),
});

/**
 * Resolve one cell of the permission×support matrix (pure lookup).
 * @param {{support: string, permission: string}} cell
 * @returns {ReadonlyObject} the frozen matrix cell
 * @throws {TypeError} missing/unknown support or permission value.
 */
export function resolveArmMatrix({ support, permission } = {}) {
  const row = own(ARM_MATRIX, support);
  if (!row) {
    throw new TypeError(
      `states: unknown arm support ${inspect(support)} — expected one of ` +
        `${valuesOf(ARM_SUPPORT).join(', ')}`
    );
  }
  const cell = own(row, permission);
  if (!cell) {
    throw new TypeError(
      `states: unknown arm permission ${inspect(permission)} — expected one of ` +
        `${valuesOf(ARM_PERMISSION).join(', ')}`
    );
  }
  return cell;
}

/**
 * F3 fallback reason → matrix support value (the glue between the torch
 * channel's vocabulary and this machine's). Deliberately maps every
 * TORCH_FALLBACK_REASONS entry EXCEPT 'permission-denied' — that one is
 * the PERMISSION dimension, not support; eventFromTorchResult() routes it
 * to TORCH_PERMISSION_DENIED before any support lookup happens.
 */
export const SUPPORT_BY_FALLBACK_REASON = Object.freeze({
  [TORCH_FALLBACK_REASONS.INSECURE_CONTEXT]: ARM_SUPPORT.INSECURE,
  [TORCH_FALLBACK_REASONS.NO_CAMERA]: ARM_SUPPORT.NO_CAMERA,
  [TORCH_FALLBACK_REASONS.NO_VIDEO_TRACK]: ARM_SUPPORT.NO_CAMERA,
  [TORCH_FALLBACK_REASONS.NO_TORCH_CAPABILITY]: ARM_SUPPORT.NO_TORCH,
  [TORCH_FALLBACK_REASONS.CAMERA_UNAVAILABLE]: ARM_SUPPORT.NO_TORCH,
  [TORCH_FALLBACK_REASONS.GUM_FAILED]: ARM_SUPPORT.NO_TORCH,
  [TORCH_FALLBACK_REASONS.PROBE_ON_FAILED]: ARM_SUPPORT.NO_TORCH,
  [TORCH_FALLBACK_REASONS.PROBE_OFF_FAILED]: ARM_SUPPORT.NO_TORCH,
  [TORCH_FALLBACK_REASONS.PROBE_TIMEOUT]: ARM_SUPPORT.NO_TORCH,
});

/**
 * Translate ONE F3 `acquire()` result into the event to dispatch — the
 * exact app-side wiring contract (I2 awaits `torch.acquire()` once and
 * dispatches what this returns; it never has to interpret F3 internals):
 *
 *   {outcome:'torch-ready'}                              → TORCH_ACQUIRED
 *   {outcome:'screen-fallback', reason:'permission-…'}   → TORCH_PERMISSION_DENIED
 *   {outcome:'screen-fallback', any other reason}        → TORCH_UNSUPPORTED
 *   {outcome:'error'}                                    → TORCH_ERROR
 *
 * @param {{outcome: string, form?: string, reason?: string, detail?: string}} result
 * @returns {Readonly<{type: string, payload: object}>} frozen
 * @throws {TypeError} malformed result.
 */
export function eventFromTorchResult(result) {
  if (!result || typeof result !== 'object' || typeof result.outcome !== 'string') {
    throw new TypeError(
      `states: eventFromTorchResult expects an acquire() result object, got ${inspect(result)}`
    );
  }
  switch (result.outcome) {
    case TORCH_OUTCOMES.READY:
      return frozenEvent(STATE_EVENTS.TORCH_ACQUIRED, { form: result.form ?? null });
    case TORCH_OUTCOMES.SCREEN_FALLBACK:
      return result.reason === TORCH_FALLBACK_REASONS.PERMISSION_DENIED
        ? frozenEvent(STATE_EVENTS.TORCH_PERMISSION_DENIED, {
            reason: result.reason,
            detail: result.detail ?? null,
          })
        : frozenEvent(STATE_EVENTS.TORCH_UNSUPPORTED, {
            support: SUPPORT_BY_FALLBACK_REASON[result.reason] ?? ARM_SUPPORT.NO_TORCH,
            reason: result.reason,
            detail: result.detail ?? null,
          });
    case TORCH_OUTCOMES.ERROR:
      return frozenEvent(STATE_EVENTS.TORCH_ERROR, {
        reason: result.reason ?? TORCH_ERROR_CODES.INTERNAL,
        detail: result.detail ?? null,
      });
    default:
      throw new TypeError(
        `states: unknown torch acquire() outcome ${inspect(result.outcome)} — expected one of ` +
          `${valuesOf(TORCH_OUTCOMES).join(', ')}`
      );
  }
}

// ---------------------------------------------------------------------------
// The transition table
//
// Row shape (all fields optional except `to`):
//   to       target state, or (ctx) => state for context-branching rows
//   effects  effect-name array, or (ctx) => array (evaluated against the
//            PRE-transition context)
//   apply    (ctx, payload, target) => void — context mutations, run AFTER
//            the target is resolved, BEFORE the state moves
// `to` may also be the literal null to spell an explicit dead guard, but
// no row uses that: this table has no dead ends by design.

const RELEASE = STATE_EFFECTS.RELEASE_TORCH;

/** READY/BROADCASTING/etc. branch on the armed channel (screen contexts
 *  carry the -on-screen states; torch contexts the plain ones). */
const onScreen = (ctx) => ctx.channel === ARM_MEDIUMS.SCREEN;

/** REPLAY from done/error: still armed → straight to the GO choreography;
 *  torch was released (privacy scope) → the preflight re-arm path. */
const replayTo = (ctx) => (ctx.channel ? STATES.READY : STATES.PREFLIGHT);

export const TRANSITIONS = Object.freeze({
  [STATES.IDLE]: Object.freeze({
    [STATE_EVENTS.REQUEST_BROADCAST]: Object.freeze({
      to: STATES.PREFLIGHT,
      effects: (ctx) => (ctx.hazardAcknowledged ? [] : [STATE_EFFECTS.NOTICE_REQUIRED]),
    }),
  }),

  [STATES.PREFLIGHT]: Object.freeze({
    // Entered unarmed, always (REPLAY only routes here once the torch was
    // released), so ACK always continues into acquisition.
    [STATE_EVENTS.ACK]: Object.freeze({
      to: STATES.ARMING,
      apply: (ctx) => {
        ctx.hazardAcknowledged = true;
      },
    }),
    [STATE_EVENTS.CANCEL]: Object.freeze({ to: STATES.IDLE }),
  }),

  [STATES.ARMING]: Object.freeze({
    [STATE_EVENTS.PERMISSION_PROMPTED]: Object.freeze({ to: STATES.AWAITING_PERMISSION }),
    [STATE_EVENTS.TORCH_ACQUIRED]: Object.freeze({
      to: STATES.TORCH_READY,
      apply: armTorch,
    }),
    [STATE_EVENTS.TORCH_PERMISSION_DENIED]: Object.freeze({
      to: STATES.PERMISSION_DENIED,
      apply: rememberFallback,
    }),
    [STATE_EVENTS.TORCH_UNSUPPORTED]: Object.freeze({
      to: STATES.UNSUPPORTED,
      apply: rememberFallback,
    }),
    [STATE_EVENTS.TORCH_ERROR]: Object.freeze({
      to: STATES.ERROR,
      apply: rememberArmError,
    }),
    // No CANCEL/RESET here on purpose: the OS prompt owns the screen while
    // acquire() is in flight, and acquire() ALWAYS settles (F3 contract),
    // so one of the four TORCH_* outcomes arrives moments later. The
    // machine has no way to get stuck.
  }),

  [STATES.AWAITING_PERMISSION]: Object.freeze({
    [STATE_EVENTS.PERMISSION_GRANTED]: Object.freeze({ to: STATES.ARMING }),
    [STATE_EVENTS.TORCH_ACQUIRED]: Object.freeze({
      to: STATES.TORCH_READY,
      apply: armTorch,
    }),
    [STATE_EVENTS.TORCH_PERMISSION_DENIED]: Object.freeze({
      to: STATES.PERMISSION_DENIED,
      apply: rememberFallback,
    }),
    [STATE_EVENTS.TORCH_UNSUPPORTED]: Object.freeze({
      to: STATES.UNSUPPORTED,
      apply: rememberFallback,
    }),
    [STATE_EVENTS.TORCH_ERROR]: Object.freeze({
      to: STATES.ERROR,
      apply: rememberArmError,
    }),
  }),

  [STATES.PERMISSION_DENIED]: Object.freeze({
    [STATE_EVENTS.ACCEPT_SCREEN]: Object.freeze({
      to: STATES.SCREEN_MODE,
      apply: (ctx) => {
        ctx.channel = ARM_MEDIUMS.SCREEN;
      },
    }),
    [STATE_EVENTS.RETRY_ARM]: Object.freeze({ to: STATES.ARMING }),
    [STATE_EVENTS.RESET]: Object.freeze({ to: STATES.IDLE }),
  }),

  [STATES.UNSUPPORTED]: Object.freeze({
    [STATE_EVENTS.ACCEPT_SCREEN]: Object.freeze({
      to: STATES.SCREEN_MODE,
      apply: (ctx) => {
        ctx.channel = ARM_MEDIUMS.SCREEN;
      },
    }),
    [STATE_EVENTS.RETRY_ARM]: Object.freeze({ to: STATES.ARMING }),
    [STATE_EVENTS.RESET]: Object.freeze({ to: STATES.IDLE }),
  }),

  [STATES.TORCH_READY]: Object.freeze({
    [STATE_EVENTS.GO]: Object.freeze({
      to: STATES.READY,
      apply: clearBroadcastContext,
    }),
    [STATE_EVENTS.SWITCH_CHANNEL]: Object.freeze({
      to: STATES.SCREEN_MODE,
      effects: [RELEASE],
      apply: (ctx) => {
        ctx.channel = ARM_MEDIUMS.SCREEN;
      },
    }),
    [STATE_EVENTS.RESET]: Object.freeze({
      to: STATES.IDLE,
      effects: [RELEASE],
      apply: retireBroadcastContext,
    }),
  }),

  [STATES.SCREEN_MODE]: Object.freeze({
    [STATE_EVENTS.GO]: Object.freeze({
      to: STATES.READY,
      apply: clearBroadcastContext,
    }),
    [STATE_EVENTS.RESET]: Object.freeze({
      to: STATES.IDLE,
      apply: retireBroadcastContext,
    }),
    // Switching BACK to torch is deliberately not a row: re-arming is a
    // fresh journey (RESET → REQUEST_BROADCAST → …), keeping the screen
    // switch one-way and the arming story single-entry.
  }),

  [STATES.READY]: Object.freeze({
    [STATE_EVENTS.GO]: Object.freeze({
      to: (ctx) => (onScreen(ctx) ? STATES.BROADCASTING_ON_SCREEN : STATES.BROADCASTING),
      apply: (ctx) => {
        ctx.doneReason = null;
        ctx.takeover = null;
      },
    }),
    [STATE_EVENTS.CANCEL]: Object.freeze({
      to: (ctx) => (onScreen(ctx) ? STATES.SCREEN_MODE : STATES.TORCH_READY),
    }),
  }),

  [STATES.BROADCASTING]: Object.freeze({
    [STATE_EVENTS.PAUSE]: Object.freeze({ to: STATES.PAUSED }),
    // F6's seamless takeover: F3 already stopped the track on loss, so no
    // release effect here — the host just keeps conducting on screen.
    [STATE_EVENTS.TORCH_LOST]: Object.freeze({
      to: STATES.BROADCASTING_ON_SCREEN,
      apply: (ctx, payload) => {
        ctx.channel = ARM_MEDIUMS.SCREEN;
        ctx.takeover = { cause: 'torch-lost', code: payload?.code ?? TORCH_ERROR_CODES.INTERNAL };
      },
    }),
    [STATE_EVENTS.SWITCH_CHANNEL]: Object.freeze({
      to: STATES.BROADCASTING_ON_SCREEN,
      effects: [RELEASE],
      apply: (ctx) => {
        ctx.channel = ARM_MEDIUMS.SCREEN;
        ctx.takeover = { cause: 'manual-switch', code: null };
      },
    }),
    [STATE_EVENTS.STOP]: Object.freeze({
      to: STATES.DONE,
      effects: [RELEASE],
      apply: (ctx) => {
        ctx.doneReason = 'stopped';
        ctx.channel = null; // camera released after broadcast (privacy scope)
      },
    }),
    [STATE_EVENTS.BROADCAST_COMPLETE]: Object.freeze({
      to: STATES.DONE,
      effects: [RELEASE],
      apply: (ctx) => {
        ctx.doneReason = 'complete';
        ctx.channel = null;
      },
    }),
    [STATE_EVENTS.BROADCAST_FAILED]: Object.freeze({
      to: STATES.ERROR,
      effects: [RELEASE],
      apply: (ctx, payload) => {
        ctx.error = {
          kind: 'broadcast',
          reason: payload?.reason ?? 'unknown',
          detail: payload?.detail ?? null,
        };
        ctx.channel = null;
      },
    }),
  }),

  [STATES.BROADCASTING_ON_SCREEN]: Object.freeze({
    [STATE_EVENTS.PAUSE]: Object.freeze({ to: STATES.PAUSED_ON_SCREEN }),
    // No TORCH_LOST row — there is no torch left to lose.
    [STATE_EVENTS.STOP]: Object.freeze({
      to: STATES.DONE,
      apply: (ctx) => {
        ctx.doneReason = 'stopped';
      },
    }),
    [STATE_EVENTS.BROADCAST_COMPLETE]: Object.freeze({
      to: STATES.DONE,
      apply: (ctx) => {
        ctx.doneReason = 'complete';
      },
    }),
    [STATE_EVENTS.BROADCAST_FAILED]: Object.freeze({
      to: STATES.ERROR,
      apply: (ctx, payload) => {
        ctx.error = {
          kind: 'broadcast',
          reason: payload?.reason ?? 'unknown',
          detail: payload?.detail ?? null,
        };
      },
    }),
  }),

  [STATES.PAUSED]: Object.freeze({
    [STATE_EVENTS.RESUME]: Object.freeze({ to: STATES.BROADCASTING }),
    [STATE_EVENTS.TORCH_LOST]: Object.freeze({
      to: STATES.PAUSED_ON_SCREEN,
      apply: (ctx, payload) => {
        ctx.channel = ARM_MEDIUMS.SCREEN;
        ctx.takeover = { cause: 'torch-lost', code: payload?.code ?? TORCH_ERROR_CODES.INTERNAL };
      },
    }),
    [STATE_EVENTS.SWITCH_CHANNEL]: Object.freeze({
      to: STATES.PAUSED_ON_SCREEN,
      effects: [RELEASE],
      apply: (ctx) => {
        ctx.channel = ARM_MEDIUMS.SCREEN;
        ctx.takeover = { cause: 'manual-switch', code: null };
      },
    }),
    [STATE_EVENTS.STOP]: Object.freeze({
      to: STATES.DONE,
      effects: [RELEASE],
      apply: (ctx) => {
        ctx.doneReason = 'stopped';
        ctx.channel = null;
      },
    }),
    [STATE_EVENTS.RESET]: Object.freeze({
      to: STATES.IDLE,
      effects: [RELEASE],
      apply: retireBroadcastContext,
    }),
  }),

  [STATES.PAUSED_ON_SCREEN]: Object.freeze({
    [STATE_EVENTS.RESUME]: Object.freeze({ to: STATES.BROADCASTING_ON_SCREEN }),
    [STATE_EVENTS.STOP]: Object.freeze({
      to: STATES.DONE,
      apply: (ctx) => {
        ctx.doneReason = 'stopped';
      },
    }),
    [STATE_EVENTS.RESET]: Object.freeze({
      to: STATES.IDLE,
      apply: retireBroadcastContext,
    }),
  }),

  [STATES.DONE]: Object.freeze({
    // Torch was released on entry (privacy scope) → channel is null → the
    // re-arm path; a held screen channel skips straight to the GO roll.
    [STATE_EVENTS.REPLAY]: Object.freeze({
      to: replayTo,
      apply: clearBroadcastContext,
    }),
    [STATE_EVENTS.RESET]: Object.freeze({
      to: STATES.IDLE,
      apply: retireBroadcastContext,
    }),
  }),

  [STATES.ERROR]: Object.freeze({
    // Re-arming means UNARMED until TORCH_ACQUIRED says otherwise — a
    // screen channel held through a screen-broadcast error must not leak
    // into the torch arm phase, and the failed broadcast's phase fields
    // (error/takeover/doneReason) retire with it.
    [STATE_EVENTS.RETRY_ARM]: Object.freeze({
      to: STATES.ARMING,
      apply: (ctx) => {
        ctx.error = null;
        ctx.channel = null;
        clearBroadcastContext(ctx);
      },
    }),
    [STATE_EVENTS.REPLAY]: Object.freeze({
      to: replayTo,
      apply: (ctx) => {
        ctx.error = null;
        clearBroadcastContext(ctx);
      },
    }),
    [STATE_EVENTS.RESET]: Object.freeze({
      to: STATES.IDLE,
      apply: retireBroadcastContext,
    }),
  }),
});

// Row apply() helpers -------------------------------------------------------------

function armTorch(ctx) {
  ctx.channel = ARM_MEDIUMS.TORCH;
  ctx.fallbackReason = null;
  ctx.fallbackDetail = null;
}

function rememberFallback(ctx, payload) {
  ctx.fallbackReason = payload?.reason ?? null;
  ctx.fallbackDetail = payload?.detail ?? null;
}

function rememberArmError(ctx, payload) {
  ctx.error = {
    kind: 'arm',
    reason: payload?.reason ?? TORCH_ERROR_CODES.INTERNAL,
    detail: payload?.detail ?? null,
  };
}

function clearBroadcastContext(ctx) {
  ctx.doneReason = null;
  ctx.takeover = null;
}

/** Put-it-away: leaving the broadcast world entirely — drop the channel
 *  AND every phase-scoped field, so idle never renders stale done/error/
 *  takeover context from a previous life. */
function retireBroadcastContext(ctx) {
  ctx.channel = null;
  ctx.doneReason = null;
  ctx.takeover = null;
  ctx.error = null;
}

// ---------------------------------------------------------------------------------

const EVENT_NAMES = new Set(valuesOf(STATE_EVENTS));
const STATE_NAMES = new Set(valuesOf(STATES));

/**
 * Create the app state machine. Zero configuration — the cold open is
 * always idle (no persistence anywhere, per the no-build/no-storage scope).
 *
 * @returns {{
 *   dispatch: (type: string, payload?: object) => Readonly<{accepted: boolean, from: string, to: string, via: string, effects?: string[], reason?: string}>,
 *   state: () => string,
 *   can: (type: string) => boolean,
 *   snapshot: () => Readonly<object>,
 *   addEventListener: (type: string, listener: (payload?: object) => void) => () => void,
 *   removeEventListener: (type: string, listener: (payload?: object) => void) => void,
 * }}
 *
 * dispatch(): synchronous, pure with respect to the outside world (no DOM,
 * no timers, no promises). An ACCEPTED event moves the state, mutates the
 * internal context per the table, emits 'change' and then each row effect
 * as its own event. A KNOWN event with no row for the current state is a
 * soft rejection (race; state and context untouched, 'invalid' emitted,
 * {accepted:false} returned). An UNKNOWN event name throws TypeError —
 * that is a wiring bug, the F3/F4/F5 discipline.
 */
export function createStateMachine() {
  const listeners = new Map(); // type → Set<fn>
  const ctx = {
    channel: null, // 'torch' | 'screen' | null — armed/active medium
    hazardAcknowledged: false,
    fallbackReason: null, // why unsupported/denied (F3 reason string)
    fallbackDetail: null,
    takeover: null, // {cause: 'torch-lost'|'manual-switch', code} — set on screen takeover
    doneReason: null, // 'complete' | 'stopped' — set entering done
    error: null, // {kind: 'arm'|'broadcast', reason, detail} — set entering error
  };
  let current = STATES.IDLE;

  function dispatch(type, payload) {
    if (typeof type !== 'string' || !EVENT_NAMES.has(type)) {
      throw new TypeError(
        `states: unknown event ${inspect(type)} — expected one of ${valuesOf(STATE_EVENTS).join(', ')}`
      );
    }
    const row = resolveRow(current, type, ctx);
    if (!row) {
      emit('invalid', Object.freeze({ state: current, type, reason: 'undefined-transition' }));
      return frozenResult({ accepted: false, from: current, to: current, via: type, reason: 'undefined-transition' });
    }
    const target = typeof row.to === 'function' ? row.to({ ...ctx }) : row.to;
    if (!STATE_NAMES.has(target)) {
      // Internal table typo — impossible to reach through the public API;
      // fail loudly rather than render a state that does not exist.
      throw new Error(`states: transition table typo — ${current} --${type}--> ${inspect(target)}`);
    }
    const effects = resolveEffects(row, ctx);
    if (typeof row.apply === 'function') row.apply(ctx, payload, target);
    const from = current;
    current = target;
    const safePayload = Object.freeze({ ...(payload ?? {}) });
    emit('change', Object.freeze({
      from,
      to: current,
      via: type,
      payload: safePayload,
      effects: Object.freeze([...effects]),
      snapshot: snapshot(),
    }));
    for (const effect of effects) {
      emit(effect, Object.freeze({ from, to: current, via: type }));
    }
    return frozenResult({ accepted: true, from, to: current, via: type, effects: Object.freeze([...effects]) });
  }

  function resolveRow(state, type, context) {
    const row = own(TRANSITIONS[state] ?? {}, type);
    return row ?? null;
  }

  function resolveEffects(row, context) {
    if (row.effects === undefined) return [];
    return typeof row.effects === 'function' ? row.effects({ ...context }) : [...row.effects];
  }

  function snapshot() {
    return Object.freeze({
      state: current,
      channel: ctx.channel,
      hazardAcknowledged: ctx.hazardAcknowledged,
      noticePending: current === STATES.PREFLIGHT && !ctx.hazardAcknowledged,
      fallbackReason: ctx.fallbackReason,
      fallbackDetail: ctx.fallbackDetail,
      takeover: ctx.takeover ? Object.freeze({ ...ctx.takeover }) : null,
      doneReason: ctx.doneReason,
      error: ctx.error ? Object.freeze({ ...ctx.error }) : null,
    });
  }

  function can(type) {
    if (typeof type !== 'string' || !EVENT_NAMES.has(type)) {
      throw new TypeError(
        `states: unknown event ${inspect(type)} — expected one of ${valuesOf(STATE_EVENTS).join(', ')}`
      );
    }
    return resolveRow(current, type, ctx) !== null;
  }

  function state() {
    return current;
  }

  function addEventListener(type, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('states: addEventListener(listener) requires a function');
    }
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(listener);
    return () => removeEventListener(type, listener);
  }

  function removeEventListener(type, listener) {
    listeners.get(type)?.delete(listener);
  }

  function emit(type, payload) {
    const set = listeners.get(type);
    if (!set || set.size === 0) return;
    for (const listener of [...set]) {
      try {
        listener(payload);
      } catch {
        /* one broken consumer must not break the machine's signaling */
      }
    }
  }

  return {
    dispatch,
    state,
    can,
    snapshot,
    addEventListener,
    removeEventListener,
  };
}

// ---------------------------------------------------------------------------------
// Small internal helpers (kept local so the public surface stays minimal)

/** Own-property lookup that ignores prototype pollution ('toString' etc.). */
function own(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

/** Values of a frozen constants map, as an array. */
function valuesOf(map) {
  return Object.values(map);
}

function frozenEvent(type, payload) {
  return Object.freeze({ type, payload: Object.freeze(payload) });
}

function frozenResult(result) {
  return Object.freeze(result);
}

function inspect(value) {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
