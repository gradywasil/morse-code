// js/copy.js — The copy pack: EVERY user-facing string of the instrument in
// one reviewable, frozen, data-only module.
//
// Task U1 of docs/ultron/plan.md. Voice: THE REGISTER — a precision
// instrument's machine-plate register (stenciled legends, printed-state
// lines), never steampunk and never marketing. The three voice laws held by
// every string here (and enforced by test/copy.test.mjs):
//
//   1. TELEGRAPHIC AND PRECISE — plate legends and printed-state lines are
//      uppercase fragments; longer explanatory lines are sentence-case
//      statements of fact. No exclamation marks anywhere (test-enforced).
//   2. NO APOLOGY — screen mode is a first-class light source ("hold your
//      screen up"), never a consolation prize; denials offer the next move.
//   3. HONEST NUMBERS — every rate, cap, and step value is DERIVED from the
//      modules that own it (js/schedule.js's SPEED_STEPS / flashGuard /
//      thresholds), never retyped here, so research-committed values (R2:
//      LEARNER 5 / STANDARD 8 / BRISK 12, cap 12, 3 Hz threshold) cannot
//      drift between code and copy.
//
// Structure (stable keys, deep-frozen; I1/I2 render from these):
//
//   instrument   name plate (title, subtitle, foot legend)
//   input        message composer labels + empty/unknown handling
//   transport    the control keys (broadcast/stop/pause/resume/replay/…)
//   speed        speed-step control legend + ceiling note
//   steps        per-step {label, description, caution} keyed by step id;
//                BRISK alone carries the rapid-flash caution (R2)
//   notice       preflight gate: FIRST visit (hazard plate) vs returning
//                re-arm beat — states.js distinguishes via hazardAcknowledged
//   hazard       the photosensitivity plate: pictogram alt, ONE imperative
//                line, advisory, the step list + flash rates, acknowledge
//   whyCamera    the pre-permission explainer (shown BEFORE the browser
//                camera prompt; the two privacy facts are load-bearing and
//                test-pinned: torch-only-through-camera-stream, and no
//                video recorded or sent)
//   states       per-state {legend, line} for ALL 15 F8 states (keyed by
//                STATES values — completeness is test-enforced against
//                STATE_LIST, so a new state cannot ship copyless)
//   denied       the permission-denied block incl. the screen OFFER
//   screenMode   the positive screen framing
//   framings     one line per ARM_MATRIX framing (test-enforced total)
//   fallback     one machine line per F3 TORCH_FALLBACK_REASONS value
//                (test-enforced total) + a generic for unknown reasons
//   choreography the standby → caution → GO pre-broadcast beats
//   broadcast    channel status lines + takeover notes (torch lost / manual
//                switch — position preserved)
//   done         broadcast-end lines by doneReason (complete/stopped)
//   error        fault lines by kind (arm/broadcast/internal) + recovery
//   share        copy-link labels + outcome lines + what a link carries
//   shared       shared-link auto-fill outcomes (loaded / unreadable)
//
// Parameterized lines are tiny pure helpers (exported below): speedLine,
// progressLine, unknownCharsLine, fallbackLine. Everything else is data.
//
// DOM-free: no imports of any browser global; imports are the three DOM-free
// logic modules (schedule/torch/states — vocabulary and numbers only), so
// the pack loads anywhere they do, browser or bare Node.

import {
  SPEED_STEPS,
  SPEED_STEP_ORDER,
  WPM_HARD_CAP,
  PHOTOSAFETY_THRESHOLD_HZ,
  flashGuard,
} from './schedule.js';
import { TORCH_FALLBACK_REASONS } from './torch.js';
import { STATES, ARM_FRAMINGS, RECEIVE_STATES } from './states.js';
import { METER, SILENCE_AUTO_COMPLETE_MS } from './receive-session.js';

/** Auto-complete silence in whole seconds, derived — never re-typed. */
const AUTO_COMPLETE_SECONDS = Math.round(SILENCE_AUTO_COMPLETE_MS / 1000);

// ---------------------------------------------------------------------------
// Derived values (single source of truth: js/schedule.js). R2-committed:
// LEARNER 5 (≈2.1 Hz sustained dots), STANDARD 8 (≈3.3 Hz), BRISK 12
// (≈5.0 Hz) — threshold 3 Hz, hard cap 12 WPM.

/** "LEARNER 5, STANDARD 8, BRISK 12" — for the hazard plate's step list. */
const STEP_LIST = SPEED_STEP_ORDER.map((id) => `${id} ${SPEED_STEPS[id].wpm}`).join(', ');

/** "2.1, 3.3, and 5.0" — sustained-dot flash rates per step, from flashGuard. */
const RATE_LIST =
  SPEED_STEP_ORDER.map((id) => `${flashGuard(SPEED_STEPS[id].wpm).sustainedDotHz.toFixed(1)}`)
    .join(', ')
    .replace(/, ([^,]*)$/, ' and $1');

// ---------------------------------------------------------------------------

/**
 * The copy pack. Deep-frozen data — render it, never mutate it.
 * Plate lines are short by law: no string here exceeds 120 characters
 * (test-enforced over every string in the tree).
 */
export const COPY = deepFreeze({
  // The name plate -----------------------------------------------------------
  instrument: {
    title: 'MORSE',
    subtitle: '',
    foot: 'ITU INTERNATIONAL MORSE. LAMP, SCREEN, AND TONE.',
  },

  // The composer -------------------------------------------------------------
  input: {
    label: 'YOUR MESSAGE',
    placeholder: 'A FEW WORDS…',
    empty: 'EMPTY TAPE. TYPE A MESSAGE TO BROADCAST.',
    unknownLead: 'NO MORSE SIGN FOR:',
    unknownNote: 'Characters without a Morse sign stay on the tape, unspoken.',
  },

  // The transport keys -------------------------------------------------------
  transport: {
    broadcast: 'BROADCAST',
    stop: 'STOP',
    pause: 'PAUSE',
    resume: 'RESUME',
    replay: 'REPLAY',
    share: 'SHARE',
    copyLink: 'COPY LINK',
    reset: 'RESET',
    cancel: 'CANCEL',
    tone: 'TONE',
    toneOff: 'TONE OFF',
    switchScreen: 'SWITCH TO SCREEN',
    switchHint: 'LAMP NOT FLASHING? THE SCREEN CAN TAKE OVER MID-MESSAGE.',
  },

  // The speed control --------------------------------------------------------
  speed: {
    legend: 'SPEED',
    cap: `CEILING ${WPM_HARD_CAP} WPM. NO FASTER STEP EXISTS.`,
  },

  // Per-step copy (keys are F2's stable step ids) -----------------------------
  steps: {
    LEARNER: {
      label: 'LEARNER',
      description:
        `${SPEED_STEPS.LEARNER.wpm} WPM. Slow, even punch. ` +
        `Flashes stay under ${PHOTOSAFETY_THRESHOLD_HZ} per second. The default.`,
      caution: null,
    },
    STANDARD: {
      label: 'STANDARD',
      description:
        `${SPEED_STEPS.STANDARD.wpm} WPM. Trained pace. Repeated dots reach ` +
        `${flashGuard(SPEED_STEPS.STANDARD.wpm).sustainedDotHz.toFixed(1)} per second.`,
      caution: null,
    },
    BRISK: {
      label: 'BRISK',
      description: `${SPEED_STEPS.BRISK.wpm} WPM. Fast punch for practiced eyes.`,
      caution:
        'RAPID FLASH: REPEATED DOTS REACH ' +
        `${flashGuard(SPEED_STEPS.BRISK.wpm).sustainedDotHz.toFixed(1)} PER SECOND — ` +
        `ABOVE THE ${PHOTOSAFETY_THRESHOLD_HZ}-HERTZ SAFETY LINE.`,
    },
  },

  // The preflight gate: first visit vs returning (states.js: hazardAcknowledged)
  notice: {
    firstVisit: 'FIRST RUN. READ THE CAUTION PLATE BEFORE THE LIGHT SPEAKS.',
    returning: 'CAUTION PLATE ON FILE. RE-ARM WHEN READY.',
  },

  // The photosensitivity hazard plate ----------------------------------------
  hazard: {
    title: 'CAUTION — FLASHING LIGHT',
    pictogramAlt: 'Warning pictogram: a lamp emitting rapid flashes.',
    imperative: 'DO NOT WATCH IF FLASHING LIGHT HAS EVER TRIGGERED A SEIZURE.',
    advisory:
      'This instrument speaks by flashing light. Anyone photosensitive should ' +
      'not watch the lamp or the screen.',
    steps: `Speed steps: ${STEP_LIST} words per minute.`,
    rates: `Repeated dots flash ${RATE_LIST} times per second across those steps.`,
    threshold: `The safety line is ${PHOTOSAFETY_THRESHOLD_HZ} flashes per second.`,
    default: 'The default LEARNER step stays below the line.',
    acknowledge: 'ACKNOWLEDGE — PROCEED',
    decline: 'NOT NOW',
  },

  // The why-camera explainer (shown BEFORE the browser camera prompt) ---------
  whyCamera: {
    title: 'WHY THE CAMERA PROMPT',
    lines: [
      'Browsers expose the torch only through a live camera stream.',
      'The prompt is the only door to the lamp.',
      'No video is recorded. No video is sent anywhere.',
      'The camera closes the moment the broadcast ends.',
    ],
    proceed: 'CONTINUE TO THE PROMPT',
  },

  // Per-state plate copy — ALL 15 F8 states (keys are STATES values) ----------
  states: {
    [STATES.IDLE]: {
      legend: 'IDLE',
      line: 'TYPE A MESSAGE. THE TAPE PUNCHES AS YOU GO.',
    },
    [STATES.PREFLIGHT]: {
      legend: 'PREFLIGHT',
      line: 'THE GATE BEFORE THE FIRST BROADCAST.',
    },
    [STATES.ARMING]: {
      legend: 'ARMING',
      line: 'TESTING THE LAMP. IT MAY BLINK ONCE.',
    },
    [STATES.AWAITING_PERMISSION]: {
      legend: 'AWAITING PERMISSION',
      line: 'THE BROWSER HAS THE CAMERA QUESTION. ANSWER IT.',
    },
    [STATES.PERMISSION_DENIED]: {
      legend: 'PERMISSION DENIED',
      line: 'CAMERA REFUSED. THE TORCH CANNOT LIGHT WITHOUT IT.',
    },
    [STATES.UNSUPPORTED]: {
      legend: 'NO TORCH',
      line: 'NO LAMP TO DRIVE. THE SCREEN CARRIES THE SIGNAL.',
    },
    [STATES.TORCH_READY]: {
      legend: 'TORCH READY',
      line: 'LAMP ARMED. STANDING BY FOR THE WORD.',
    },
    [STATES.SCREEN_MODE]: {
      legend: 'SCREEN READY',
      line: 'SCREEN ARMED. HOLD IT UP — IT IS THE LAMP.',
    },
    [STATES.READY]: {
      legend: 'READY',
      line: 'COMMITTED. STANDBY, CAUTION, THEN GO.',
    },
    [STATES.BROADCASTING]: {
      legend: 'SENDING',
      line: 'TORCH LIGHT SPEAKS THE TAPE.',
    },
    [STATES.BROADCASTING_ON_SCREEN]: {
      legend: 'SENDING',
      line: 'SCREEN LIGHT SPEAKS THE TAPE.',
    },
    [STATES.PAUSED]: {
      legend: 'PAUSED',
      line: 'HELD AT POSITION. THE TAPE WAITS.',
    },
    [STATES.PAUSED_ON_SCREEN]: {
      legend: 'PAUSED',
      line: 'HELD AT POSITION. SCREEN HOLDS THE LIGHT.',
    },
    [STATES.DONE]: {
      legend: 'DONE',
      line: 'THE RUN IS OVER. THE TAPE KEEPS THE MESSAGE.',
    },
    [STATES.ERROR]: {
      legend: 'FAULT',
      line: 'A FAULT STOPPED THE RUN. THE MESSAGE SURVIVES.',
    },
  },

  // The permission-denied block (screen OFFERED — never a dead end) -----------
  denied: {
    offer: 'BROADCAST BY SCREEN LIGHT',
    offerLine: 'THE SCREEN NEEDS NO PERMISSION AND SPEAKS THE SAME MORSE.',
    retry: 'RETRY THE TORCH',
    hint: 'Refused by choice? Regrant camera access in the browser site settings, then retry.',
  },

  // The positive screen framing ------------------------------------------------
  screenMode: {
    line: 'THE SCREEN IS THE LAMP. HOLD IT UP FACING THE ROOM.',
  },

  // One line per ARM_MATRIX framing (F8 exports the vocabulary) ----------------
  framings: {
    [ARM_FRAMINGS.TORCH]: 'TORCH PATH OPEN. THE LAMP ANSWERS.',
    [ARM_FRAMINGS.SCREEN_POSITIVE]: 'THIS DEVICE BROADCASTS BY SCREEN LIGHT.',
    [ARM_FRAMINGS.DENIED_OFFER_SCREEN]: 'CAMERA REFUSED. THE SCREEN IS OFFERED.',
    [ARM_FRAMINGS.WHY_CAMERA]: 'THE CAMERA QUESTION EXPLAINED BEFORE THE PROMPT.',
    [ARM_FRAMINGS.ARMING]: 'ARMING. THE LAMP IS UNDER TEST.',
  },

  // One machine line per F3 fallback reason (+ generic for the unknown) --------
  fallback: {
    [TORCH_FALLBACK_REASONS.INSECURE_CONTEXT]: 'NOT A SECURE CONNECTION. THE BROWSER WITHHOLDS THE CAMERA.',
    [TORCH_FALLBACK_REASONS.NO_CAMERA]: 'NO CAMERA FOUND ON THIS DEVICE.',
    [TORCH_FALLBACK_REASONS.PERMISSION_DENIED]: 'CAMERA PERMISSION DENIED.',
    [TORCH_FALLBACK_REASONS.CAMERA_UNAVAILABLE]: 'CAMERA IN USE OR UNREACHABLE RIGHT NOW.',
    [TORCH_FALLBACK_REASONS.GUM_FAILED]: 'THE CAMERA REQUEST FAILED IN THE BROWSER.',
    [TORCH_FALLBACK_REASONS.NO_VIDEO_TRACK]: 'THE CAMERA RETURNED NO VIDEO PATH.',
    [TORCH_FALLBACK_REASONS.NO_TORCH_CAPABILITY]: 'THE CAMERA REPORTS NO TORCH CONTROL.',
    [TORCH_FALLBACK_REASONS.PROBE_ON_FAILED]: 'THE LAMP REFUSED ITS TEST LIGHTING.',
    [TORCH_FALLBACK_REASONS.PROBE_OFF_FAILED]: 'THE LAMP WOULD NOT EXTINGUISH ON COMMAND.',
    [TORCH_FALLBACK_REASONS.PROBE_TIMEOUT]: 'THE LAMP NEVER ANSWERED ITS TEST IN TIME.',
    generic: 'THE TORCH PATH DID NOT ANSWER.',
  },

  // The pre-broadcast choreography (renders in `ready`) ------------------------
  choreography: {
    standby: { legend: 'STANDBY', line: 'INSTRUMENT ARMED. MESSAGE SET.' },
    caution: { legend: 'CAUTION', line: 'THE LIGHT IS ABOUT TO SPEAK.' },
    go: { legend: 'GO', line: 'SENDING NOW.' },
  },

  // Broadcast status + takeover notes ------------------------------------------
  broadcast: {
    torch: 'SENDING BY TORCH LIGHT.',
    screen: 'SENDING BY SCREEN LIGHT.',
    takeoverTorchLost: 'LIGHT SOURCE LOST — CONTINUING ON SCREEN.',
    takeoverManualSwitch: 'TORCH SET ASIDE — CONTINUING ON SCREEN.',
    takeoverPositionKept: 'POSITION KEPT. THE MESSAGE LOSES NOTHING.',
  },

  // Broadcast end (by doneReason) ------------------------------------------------
  done: {
    complete: 'BROADCAST COMPLETE. THE TAPE KEEPS THE MESSAGE.',
    stopped: 'STOPPED EARLY. THE TAPE KEEPS THE MESSAGE.',
    offer: 'REPLAY IT, OR SHARE THE LINK.',
  },

  // Faults -------------------------------------------------------------------------
  error: {
    arm: 'ARM FAULT. THE TORCH PATH FAILED.',
    broadcast: 'BROADCAST FAULT. THE RUN STOPPED EARLY.',
    internal: 'INTERNAL FAULT.',
    recover: 'THE MESSAGE SURVIVES. REPLAY, RETRY, OR RESET.',
  },

  // Share / copy-link -----------------------------------------------------------------
  share: {
    copied: 'LINK COPIED TO THE CLIPBOARD',
    copyFailed: 'COPY REFUSED. COPY THE ADDRESS BAR BY HAND.',
    carries: 'The link holds the message and its speed. No server, no record.',
  },

  // Shared-link auto-fill outcomes -------------------------------------------------------
  shared: {
    loaded: 'MESSAGE AND SPEED LOADED FROM THE LINK.',
    unreadable: 'THE LINK WAS UNREADABLE. EMPTY TAPE, SAFE SPEED.',
  },

  // Run 2 — the receiver (The Register Listens) --------------------------------------------
  receive: {
    // The mode lever.
    mode: {
      broadcast: 'BROADCAST',
      receive: 'RECEIVE',
      hint: 'One register, two directions. Speak, or listen.',
    },

    // The receive why-camera plate (BEFORE the prompt — the plate grammar
    // mirrors the broadcast explainer).
    whyCamera: {
      title: 'WHY THE CAMERA PROMPT',
      lines: [
        'The register listens through the camera.',
        'It watches light levels in a live view.',
        'Nothing is recorded. Nothing is sent anywhere.',
        'The eye closes the moment you stop.',
      ],
      proceed: 'BEGIN LISTENING',
    },

    // Per-state plate copy — ALL receive states (keys are RECEIVE_STATES).
    states: {
      [RECEIVE_STATES.IDLE]: {
        legend: 'AT REST',
        line: 'READY TO LISTEN.',
      },
      [RECEIVE_STATES.PREFLIGHT]: {
        legend: 'PREFLIGHT',
        line: 'THE GATE BEFORE THE EYE OPENS.',
      },
      [RECEIVE_STATES.ARMING]: {
        legend: 'OPENING THE EYE',
        line: 'THE CAMERA QUESTION IS WITH THE BROWSER.',
      },
      [RECEIVE_STATES.DENIED]: {
        legend: 'PERMISSION DENIED',
        line: 'CAMERA REFUSED. MORSE NEEDS IT TO LISTEN.',
      },
      [RECEIVE_STATES.UNSUPPORTED]: {
        legend: 'NO EYE',
        line: 'THIS CONTEXT OFFERS NO CAMERA. THE BROADCAST HALF STILL SPEAKS.',
      },
      [RECEIVE_STATES.ARMED]: {
        legend: 'LISTENING',
        line: 'THE EYE IS OPEN. AIM AT THE LIGHT.',
      },
      [RECEIVE_STATES.ACTIVE]: {
        legend: 'RECEIVING',
        line: 'LIGHT SPEAKS. THE TAPE PUNCHES WHAT IT HEARS.',
      },
      [RECEIVE_STATES.DONE]: {
        legend: 'HEARD',
        line: 'THE MESSAGE STANDS ON THE TAPE.',
      },
      [RECEIVE_STATES.ERROR]: {
        legend: 'FAULT',
        line: 'THE EYE FAILED. THE RECORD STANDS.',
      },
    },

    // The hearing meter (F3 METER values are the keys).
    meter: {
      [METER.SILENCE]: 'HEARING NOTHING',
      [METER.NOISE]: 'LIGHT, BUT NOT MORSE',
      [METER.DECODING]: 'HEARING LIGHT',
    },
    meterHints: {
      [METER.SILENCE]: 'Aim at the sender. Get closer. Dim the room.',
      [METER.NOISE]: 'Step back from the light, or block the stray glare.',
    },
    saturated: 'THE PICTURE IS BLOWN OUT. MOVE BACK FROM THE LIGHT.',
    partialNote: 'PARTIAL — LISTENING BEGAN MID-MESSAGE.',
    donePartial: 'THE RECORD IS PARTIAL. LISTENING BEGAN MID-MESSAGE.',
    quietClosed: `QUIET FOR ${AUTO_COMPLETE_SECONDS} SECONDS. THE MESSAGE CLOSED ITSELF.`,

    // Transport.
    stop: 'STOP LISTENING',
    copyMessage: 'COPY MESSAGE',
    copied: 'MESSAGE COPIED TO THE CLIPBOARD',
    copyFailed: 'COPY REFUSED. READ THE TAPE BY HAND.',
  },
});

// ---------------------------------------------------------------------------
// Tiny pure helpers for parameterized lines. Data above; formatting here.

/**
 * Speed status line for a step id, e.g. `speedLine('LEARNER')` →
 * "LEARNER — 5 WPM". Numbers come from SPEED_STEPS (single source).
 * @param {string} stepId
 * @returns {string}
 * @throws {TypeError} unknown step id (wiring bug).
 */
export function speedLine(stepId) {
  const step = SPEED_STEPS[stepId];
  if (!step) {
    throw new TypeError(`copy: unknown speed step ${JSON.stringify(stepId)} — expected one of ${SPEED_STEP_ORDER.join(', ')}`);
  }
  return `${COPY.steps[stepId].label} — ${step.wpm} WPM`;
}

/**
 * Broadcast progress line: `progressLine(3, 29)` → "MARK 3 OF 29".
 * @param {number} sent marks completed (0 ≤ sent ≤ total)
 * @param {number} total total marks in the schedule
 * @returns {string}
 * @throws {TypeError} non-integer or out-of-range arguments (wiring bug).
 */
export function progressLine(sent, total) {
  if (!Number.isInteger(sent) || !Number.isInteger(total) || sent < 0 || total < 1 || sent > total) {
    throw new TypeError(`copy: progressLine expects 0 ≤ sent ≤ total integers, got ${sent} of ${total}`);
  }
  return `MARK ${sent} OF ${total}`;
}

/**
 * Unknown-character flag line for the composer, e.g.
 * `unknownCharsLine(['#', '%'])` → "NO MORSE SIGN FOR: # %".
 * @param {string[]} chars characters F1 reported as unmappable
 * @returns {string}
 * @throws {TypeError} empty or non-string entries (wiring bug).
 */
export function unknownCharsLine(chars) {
  if (!Array.isArray(chars) || chars.length === 0 || chars.some((c) => typeof c !== 'string' || c.length === 0)) {
    throw new TypeError('copy: unknownCharsLine expects a non-empty array of non-empty strings');
  }
  return `${COPY.input.unknownLead} ${chars.join(' ')}`;
}

/**
 * Machine line for an F3 fallback reason; unknown reasons get the generic
 * line (a late or future reason must never render as undefined).
 * @param {string} reason a TORCH_FALLBACK_REASONS value (or anything)
 * @returns {string}
 */
export function fallbackLine(reason) {
  return COPY.fallback[reason] ?? COPY.fallback.generic;
}


/**
 * Meter line for a receive meter value; unknown meters get silence (a
 * future meter must never render as undefined).
 * @param {string} meter a METER value (or anything)
 * @returns {string}
 */
export function meterLine(meter) {
  return COPY.receive.meter[meter] ?? COPY.receive.meter[METER.SILENCE];
}

// Internal ------------------------------------------------------------------

/** Recursively freeze an object tree (arrays included). */
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}
