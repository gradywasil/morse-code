// js/app.js — The Register, wired (I2): the only DOM glue in the repo.
//
// Task I2 of docs/ultron/plan.md. This module connects the logic core
// (F1 translate / F2 schedule / F3 torch / F4 screen / F5 audio / F6
// conductor / F7 hash / F8 states / U1 copy) to the instrument body built
// in I1 (index.html + css/main.css). It owns NO logic of its own: every
// decision comes from the machine (js/states.js), every string from the
// copy pack (js/copy.js), every timing from the conductor (js/conductor.js).
//
// LAWS THIS WIRING HOLDS
//
//   Gesture laws (privacy + platform):
//   - The camera is touched ONLY inside the Broadcast gesture chain:
//     REQUEST_BROADCAST → preflight(ACK) → [why-camera → CONTINUE] →
//     torch.acquire() — one acquire() per arm, always inside a click.
//     No getUserMedia call exists outside that path (torch.js owns the
//     only one; nothing here calls media APIs directly).
//   - audio.unlock() fires inside the GO gesture (F5's autoplay contract);
//     the conductor's own unlock() at start() is then an idempotent check.
//   - No storage API anywhere: message, speed and mute are memory-only;
//     the shareable state lives in the URL hash (F7) written via
//     history.replaceState — no history entry, no hashchange listening.
//   - No console output in the shipped path.
//
//   The journey (machine-driven; render() only reflects):
//   idle →(BROADCAST)→ preflight (hazard plate on FIRST visit, re-arm beat
//   after — the notice-required effect) →(ACK)→ arming → [awaiting-permission:
//   why-camera plate → CONTINUE] → torch.acquire() → eventFromTorchResult →
//   torch-ready | permission-denied (screen offered) | unsupported (screen,
//   positive) | error. Screen mode arms via ACCEPT_SCREEN. →(BROADCAST=GO)→
//   ready — the standby→caution→GO choreography auto-plays here (CANCEL
//   escapes) →(GO)→ broadcasting[-on-screen] via conductor.start() →
//   progress events drive the read-head traverse → done → REPLAY / SHARE.
//   TORCH_LOST mid-broadcast = seamless screen takeover; SWITCH_CHANNEL
//   rides the same machine transition, cause-tagged manual, and drives the
//   SAME conductor takeover (conductor.switchToScreen()) so the screen
//   really carries the message from the exact position — never a dark run
//   on a released torch.
//
//   The tape: translate().letters renders one punch group per character
//   (unknowns as flagged void groups — never dropped). Geometry is the
//   I1 world exactly: dot 14 / dash 42 / symbol gap 10 / letter gap 26 /
//   word gap 58 px, 44 px lead and trail — the module reproduces I1's
//   static "HELLO DARK ROOM" markup byte-for-byte when the prefill stands.
//   Typing re-punches via requestAnimationFrame coalescing (the input
//   handler itself does no DOM work); the tape FREEZES once the machine
//   commits a run (ready…) so read-head indices always match the schedule
//   being spoken.

import { translate } from './morse.js';
import { schedule, SPEED_STEPS, DEFAULT_STEP_ID, dotMsOf } from './schedule.js';
import { createTorchChannel } from './torch.js';
import { createScreenChannel } from './screen.js';
import { createAudioChannel } from './audio.js';
import { createConductor } from './conductor.js';
import {
  createStateMachine,
  STATES,
  STATE_EVENTS,
  STATE_EFFECTS,
  eventFromTorchResult,
} from './states.js';
import { encode, readHash, applyHash, shareUrl } from './hash.js';
import { COPY, speedLine, progressLine } from './copy.js';

// ---------------------------------------------------------------------------
// Tape geometry — the I1 world's exact punch metrics (css/main.css:
// .tp-dot 14 / .tp-dash 42 / .tg-marks gap 10; letter/word gaps 26/58).
// ---------------------------------------------------------------------------

const PUNCH = Object.freeze({
  DOT_W: 14,
  DASH_W: 42,
  SYMBOL_GAP: 10,
  LETTER_GAP: 26,
  WORD_GAP: 58,
  LEAD: 44,
  TRAIL: 44,
  VOID_W: 30, // the unknown character's dashed void slot (css .tg-unknown)
});

/** Positions of the punch groups for a message (pure; mirrors I1's statics). */
function tapeGeometry(text) {
  const { letters } = translate(text);
  const groups = [];
  let x = PUNCH.LEAD;
  for (let i = 0; i < letters.length; i++) {
    const letter = letters[i];
    if (i > 0) {
      const between = text.slice(letters[i - 1].charIdx + 1, letter.charIdx);
      x += /\s/.test(between) ? PUNCH.WORD_GAP : PUNCH.LETTER_GAP;
    }
    const width = letter.known
      ? letter.marks.reduce(
          (w, m) => w + (m === 'dot' ? PUNCH.DOT_W : PUNCH.DASH_W),
          0
        ) + (letter.marks.length - 1) * PUNCH.SYMBOL_GAP
      : PUNCH.VOID_W;
    groups.push({
      char: letter.char,
      charIdx: letter.charIdx,
      known: letter.known,
      marks: letter.marks,
      letterIdx: letter.letterIdx,
      left: x,
      width,
      center: x + width / 2,
    });
    x += width;
  }
  return { groups, stripWidth: x + PUNCH.TRAIL };
}

// ---------------------------------------------------------------------------
// DOM handles
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);

const body = document.body;
const messageInput = $('#message');
const unknownFlags = $('#unknown-flags');
const unknownChars = unknownFlags.querySelector('.flag-chars');
const emptyNote = $('#empty-note');
const flagNote = $('#flag-note');
const strip = $('.tape-strip');
const gateFirst = $('.gate-first');
const gateReturning = $('.gate-returning');
const takeoverNote = $('.takeover-note');
const sharedNote = $('.shared-loaded');
const shareCopied = $('.share-outcome[data-outcome="copied"]');
const shareFailed = $('.share-outcome[data-outcome="failed"]');
const broadcastKey = $('.key-broadcast');
const replayKeys = Array.from(document.querySelectorAll('.keys-done .key, .keys-error .key'));
const toneKeys = Array.from(document.querySelectorAll('[data-action="tone"]'));
const speedRadios = Array.from(document.querySelectorAll('input[name="speed"]'));

// ---------------------------------------------------------------------------
// Channels + machine (single instances for the page's life)
// ---------------------------------------------------------------------------

const torch = createTorchChannel();
const screenChannel = createScreenChannel();
const audio = createAudioChannel();
const machine = createStateMachine();

// The run being spoken.
let liveSchedule = null;      // {events, durationMs, markCount} (conductor's)
let marksTotal = 0;
let marksBeforeLetter = [];   // cumulative mark count before letters[i]
let lastMarksStarted = 0;

// Tape state.
let tape = null;              // {groups, stripWidth} (set at boot)
let lastRenderedText = null;
let tapeRenderPending = false;

// Choreography timers (the ready-state beats).
let beatTimer = null;
let beatRun = 0;

// Hash write throttle (typing must not spam replaceState).
let hashTimer = null;

// Share outcome auto-hide.
let shareTimer = null;

// Speed choice (memory-only; the hash carries it when sharing).
let stepId = DEFAULT_STEP_ID;

/** States where the run is committed: the composer and speed detents
 * freeze, the tape holds. */
const FROZEN_STATES = new Set([
  STATES.READY,
  STATES.BROADCASTING,
  STATES.BROADCASTING_ON_SCREEN,
  STATES.PAUSED,
  STATES.PAUSED_ON_SCREEN,
]);

/** States that render a live progress line. */
const PROGRESS_STATES = new Set([
  STATES.BROADCASTING,
  STATES.BROADCASTING_ON_SCREEN,
  STATES.PAUSED,
  STATES.PAUSED_ON_SCREEN,
  STATES.ERROR,
]);

// ---------------------------------------------------------------------------
// The tape
// ---------------------------------------------------------------------------

/**
 * Punch the tape. `markNew` (the typing path) presses genuinely new
 * groups under the die (.tg-new → css punch-press, ≤150 ms): a group's
 * identity is its character at its position, so re-punching after an
 * edit presses only what actually changed — never the whole strip. The
 * boot render seeds the identity set instead (the machine presents its
 * tape; it does not punch one).
 */
const groupKey = (g) => `${g.charIdx}:${g.char}:${g.known ? g.marks.join('') : '?'}`;
let punchedKeys = new Set();

function buildTape(text, { markNew = false } = {}) {
  tape = tapeGeometry(text);
  strip.replaceChildren();
  strip.style.width = `${tape.stripWidth}px`;
  const nextKeys = new Set();
  for (const g of tape.groups) {
    const key = groupKey(g);
    nextKeys.add(key);
    const li = document.createElement('li');
    li.className = g.known ? 'tg' : 'tg tg-unknown';
    if (markNew && !punchedKeys.has(key)) li.classList.add('tg-new');
    li.dataset.g = String(g.letterIdx + 1);
    li.style.left = `${g.left}px`;
    li.style.width = `${g.width}px`;

    const ch = document.createElement('span');
    ch.className = 'tg-char';
    ch.textContent = g.char; // textContent: a shared link can carry any text
    li.appendChild(ch);

    const marks = document.createElement('span');
    marks.className = 'tg-marks';
    if (g.known) {
      for (const m of g.marks) {
        const punch = document.createElement('span');
        punch.className = m === 'dot' ? 'tp tp-dot' : 'tp tp-dash';
        marks.appendChild(punch);
      }
    }
    li.appendChild(marks);
    g.el = li;
    strip.appendChild(li);
  }
  punchedKeys = nextKeys;
  lastRenderedText = text;
}

/**
 * Place the read-head: shift the strip so group `letterIdx` sits under the
 * bridge, mark the groups before `spokenThrough` spoken, and light the
 * current group when the run is live. letterIdx null = empty tape.
 */
function setHead(letterIdx, spokenThrough, live) {
  const g = letterIdx === null ? null : tape.groups[letterIdx] ?? null;
  body.style.setProperty('--strip-shift', `${g ? g.center : PUNCH.LEAD}px`);
  for (let i = 0; i < tape.groups.length; i++) {
    const el = tape.groups[i].el;
    if (!el) continue;
    el.classList.toggle('tg-spoken', i < spokenThrough);
    el.classList.toggle('tg-live', live && i === letterIdx);
  }
}

/** Head placement per machine phase (progress events own the live traverse). */
function applyHeadForState(state) {
  if (!tape.groups.length) {
    setHead(null, 0, false);
  } else if (state === STATES.DONE) {
    setHead(tape.groups.length - 1, tape.groups.length, false);
  } else if (PROGRESS_STATES.has(state)) {
    // broadcasting / paused / error: keep the head where the schedule put it
  } else {
    setHead(0, 0, false);
  }
}

/** Schedule a tape re-punch off the input path (never blocks typing). */
function requestTapeRender() {
  if (FROZEN_STATES.has(machine.state())) return; // committed run: frozen
  if (tapeRenderPending) return;
  tapeRenderPending = true;
  requestAnimationFrame(() => {
    tapeRenderPending = false;
    if (FROZEN_STATES.has(machine.state())) return;
    const text = messageInput.value;
    if (text !== lastRenderedText) {
      buildTape(text, { markNew: true }); // typing presses new groups
      applyHeadForState(machine.state());
    }
    renderComposerNotes();
    updateTransportAvailability();
  });
}

function currentMarkCount() {
  // Marks speakable from the composer right now (unknowns contribute none).
  let n = 0;
  for (const g of tape.groups) n += g.known ? g.marks.length : 0;
  return n;
}

function renderComposerNotes() {
  const { unknown } = translate(messageInput.value);
  const hasUnknown = unknown.length > 0;
  unknownChars.textContent = unknown.map((u) => u.char).join(' ');
  unknownFlags.hidden = !hasUnknown;
  flagNote.hidden = !hasUnknown;
  emptyNote.hidden = currentMarkCount() > 0;
}

// ---------------------------------------------------------------------------
// Rendering: machine state → body
// ---------------------------------------------------------------------------

function progressElement(state) {
  return document.querySelector(`.status-progress[data-state-progress="${state}"]`);
}

function renderProgressLine() {
  const state = machine.state();
  const el = PROGRESS_STATES.has(state) ? progressElement(state) : null;
  if (el && marksTotal > 0) {
    el.textContent =
      `${progressLine(Math.max(1, lastMarksStarted), marksTotal)} · ${speedLine(stepId)}`;
  }
}

function render(snapshot) {
  const state = snapshot.state;

  body.dataset.state = state;
  if (state !== STATES.READY) clearBeat();
  // The fire pulse lives only inside a broadcast.
  if (state !== STATES.BROADCASTING && state !== STATES.BROADCASTING_ON_SCREEN) {
    clearFire();
  }

  // First visit vs returning hazard beat (the notice-required carrier).
  gateFirst.hidden = !snapshot.noticePending;
  gateReturning.hidden = !(state === STATES.PREFLIGHT && !snapshot.noticePending);

  // Takeover note wording (only the on-screen broadcast state shows it).
  if (snapshot.takeover) {
    const lead = snapshot.takeover.cause === 'manual-switch'
      ? COPY.broadcast.takeoverManualSwitch
      : COPY.broadcast.takeoverTorchLost;
    takeoverNote.textContent = `${lead} ${COPY.broadcast.takeoverPositionKept}`;
  }

  // The composer freezes once a run is committed.
  messageInput.disabled = FROZEN_STATES.has(state);

  // The speed detents freeze with it (T-refine-1): a committed run cannot
  // change pace — no mid-run tap may rewrite the progress line to a speed
  // that is not the one speaking, or arm a different step for replay unseen.
  // On done/error the control unfreezes showing the step actually armed.
  const runCommitted = FROZEN_STATES.has(state);
  for (const radio of speedRadios) radio.disabled = runCommitted;

  // Tape placement: commit exactly what is about to be spoken at ready.
  if (state === STATES.READY && messageInput.value !== lastRenderedText) {
    buildTape(messageInput.value);
  }
  applyHeadForState(state);

  // Seed the progress line on ENTRY to a progress-bearing state (the T-I2
  // verification finding): onProgress only writes while events flow, so
  // paused / paused-on-screen / error (and the first ~1 tick of an on-screen
  // takeover) would otherwise show the I1 static placeholder. The line
  // guards marksTotal > 0 itself; `broadcasting` is also seeded by
  // startBroadcast().
  if (PROGRESS_STATES.has(state)) renderProgressLine();

  updateTransportAvailability();
}

function updateTransportAvailability() {
  const state = machine.state();
  const canSend = currentMarkCount() > 0;
  const goStates =
    state === STATES.IDLE || state === STATES.TORCH_READY || state === STATES.SCREEN_MODE;
  broadcastKey.disabled = goStates && !canSend;
  for (const key of replayKeys) {
    if (key.dataset.action === 'replay') key.disabled = !canSend;
  }
}

function updateToneLabels() {
  // The label names the CURRENT state, not the click's action: tone on at
  // unmuted boot ("TONE"), "TONE OFF" only while actually muted.
  const label = audio.isMuted() ? COPY.transport.toneOff : COPY.transport.tone;
  for (const key of toneKeys) key.textContent = label;
}

// ---------------------------------------------------------------------------
// The hash (F7): message + speed live in the URL, never in storage
// ---------------------------------------------------------------------------

function writeHash() {
  const hash = encode(messageInput.value, stepId);
  if (location.hash !== hash) applyHash(hash); // replaceState only, no entry
}

function requestHashWrite() {
  if (hashTimer !== null) clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    hashTimer = null;
    writeHash();
  }, 250);
}

// ---------------------------------------------------------------------------
// Arming (the only path that touches the camera)
// ---------------------------------------------------------------------------

/**
 * Best-effort "will the browser actually prompt?" — T-F8's refinement
 * heuristic: nothing to ask (no media stack) or the permission already
 * decided → skip the why-camera plate; otherwise show it BEFORE the prompt.
 */
async function promptExpected() {
  let supported = false;
  try {
    supported = torch.status().supported;
  } catch {
    supported = false;
  }
  if (!supported) return false;
  try {
    const perms = navigator.permissions;
    if (perms && typeof perms.query === 'function') {
      const status = await perms.query({ name: 'camera' });
      if (status && (status.state === 'granted' || status.state === 'denied')) {
        return false; // remembered decision — no prompt is coming
      }
    }
  } catch {
    /* permissions API unavailable / unknown name — first-run guess: prompt */
  }
  return true;
}

async function beginArm() {
  if (await promptExpected()) {
    // Why-camera first (copy law), then the prompt rides CONTINUE's gesture.
    machine.dispatch(STATE_EVENTS.PERMISSION_PROMPTED);
    return; // the continue-prompt action picks up acquire()
  }
  acquire();
}

async function acquire() {
  const armingStates = [STATES.ARMING, STATES.AWAITING_PERMISSION];
  if (!armingStates.includes(machine.state())) return; // user moved on (race)
  const result = await torch.acquire(); // never rejects (F3 contract)
  const event = eventFromTorchResult(result);
  machine.dispatch(event.type, event.payload);
  if (result.outcome === 'torch-ready') fireTestDot();
}

/** One dot on the lamp so the user can verify the light before the message. */
function fireTestDot() {
  setTimeout(() => {
    if (machine.state() !== STATES.TORCH_READY) return; // user moved on
    try {
      torch.on();
    } catch {
      return; // released meanwhile — nothing to verify with
    }
    setTimeout(() => {
      try {
        torch.off();
      } catch {
        /* released mid-dot: release() already stopped the track (LED out) */
      }
    }, dotMsOf(SPEED_STEPS[stepId].wpm));
  }, 300); // let the probe's own blink settle first
}

// ---------------------------------------------------------------------------
// The choreography (ready): standby → caution → GO; CANCEL escapes
// ---------------------------------------------------------------------------

const BEAT_STANDBY_MS = 650;
const BEAT_CAUTION_MS = 650;

function clearBeat() {
  if (beatTimer !== null) {
    clearTimeout(beatTimer);
    beatTimer = null;
  }
  delete body.dataset.beat;
}

function runBeats() {
  clearBeat();
  beatRun++;
  const run = beatRun;
  body.dataset.beat = 'standby';
  beatTimer = setTimeout(() => {
    if (run !== beatRun) return;
    body.dataset.beat = 'caution';
    beatTimer = setTimeout(() => {
      if (run !== beatRun) return;
      beatTimer = null;
      const res = machine.dispatch(STATE_EVENTS.GO); // ready → broadcasting
      if (res.accepted) startBroadcast();
    }, BEAT_CAUTION_MS);
  }, BEAT_STANDBY_MS);
}

// ---------------------------------------------------------------------------
// The broadcast (conductor driven from the machine's transitions)
// ---------------------------------------------------------------------------

function onProgress(event) {
  const letterIdx = event.letterIdx;
  const started = (marksBeforeLetter[letterIdx] ?? 0) + (event.symbolIdx ?? 0) + 1;
  if (started > lastMarksStarted) lastMarksStarted = started;
  setHead(letterIdx, letterIdx, true);
  firePulse();
  renderProgressLine();
}

// The fire pulse (I3): one bounded lamp pulse per mark, only while
// broadcasting. Alternating two classes swaps the ANIMATION NAME on the
// lamp — the only reliable way to restart a keyframe per mark without
// reflow tricks. Leaving the broadcasting states clears both classes, so
// nothing pulses outside a broadcast. CSS flattens the whole layer under
// prefers-reduced-motion / html.cap-low (the pulse is echo, not signal —
// the numeric progress line carries the same information statically).
let fireTick = 0;
function firePulse() {
  fireTick++;
  body.classList.toggle('fire-a', fireTick % 2 === 1);
  body.classList.toggle('fire-b', fireTick % 2 === 0);
}
function clearFire() {
  body.classList.remove('fire-a', 'fire-b');
}

const conductor = createConductor({
  screen: screenChannel,
  audio,
  torch,
  onProgress,
  onPause: () => {
    machine.dispatch(STATE_EVENTS.PAUSE); // user tap or visibilitychange → hidden
  },
  onResume: () => {
    /* the host drives resume from the machine's RESUME event */
  },
  onComplete: () => {
    machine.dispatch(STATE_EVENTS.BROADCAST_COMPLETE);
  },
  onError: (payload) => {
    machine.dispatch(STATE_EVENTS.BROADCAST_FAILED, {
      reason: String(payload?.error?.message ?? 'unknown'),
      detail: null,
    });
  },
  onTakeover: (payload) => {
    // Genuine torch loss drives the machine. A manual switch's report
    // arrives AFTER SWITCH_CHANNEL already moved it (the on-screen states
    // carry no TORCH_LOST row), so there it is report-only — never a
    // second transition, never a rewritten takeover cause.
    if (machine.can(STATE_EVENTS.TORCH_LOST)) {
      machine.dispatch(STATE_EVENTS.TORCH_LOST, { code: payload?.code ?? null });
    }
  },
});

function startBroadcast() {
  const text = messageInput.value;
  const built = schedule(translate(text).tokens, stepId);
  if (built.markCount === 0) return; // wiring guard: GO is disabled on empty
  liveSchedule = built;
  marksTotal = built.markCount;
  lastMarksStarted = 0;

  marksBeforeLetter = [];
  let acc = 0;
  for (const letter of translate(text).letters) {
    marksBeforeLetter.push(acc);
    acc += letter.marks.length;
  }

  renderProgressLine();
  Promise.resolve(conductor.start(built)).catch(() => {
    /* conductor failures report through onError → BROADCAST_FAILED */
  });
}

// ---------------------------------------------------------------------------
// Machine reactions (effects + the choreography entry)
// ---------------------------------------------------------------------------

machine.addEventListener('change', (e) => {
  render(e.snapshot);
  if (e.snapshot.state === STATES.READY) runBeats();
});

machine.addEventListener(STATE_EFFECTS.RELEASE_TORCH, () => {
  torch.release(); // the synchronous hardware kill (privacy scope)
  // notice-required needs no host action: the hazard plate IS preflight.
});

// ---------------------------------------------------------------------------
// Gestures → machine events
// ---------------------------------------------------------------------------

function goFromArmed() {
  if (currentMarkCount() === 0) return; // the key is disabled; race guard
  audio.unlock().catch(() => {}); // inside the gesture (F5 autoplay law)
  machine.dispatch(STATE_EVENTS.GO); // → ready; the beats take it from here
}

const ACTIONS = {
  broadcast: () => {
    const state = machine.state();
    if (state === STATES.IDLE) machine.dispatch(STATE_EVENTS.REQUEST_BROADCAST);
    else if (state === STATES.UNSUPPORTED) machine.dispatch(STATE_EVENTS.ACCEPT_SCREEN);
    else if (state === STATES.TORCH_READY || state === STATES.SCREEN_MODE) goFromArmed();
  },
  tone: () => {
    audio.toggleMuted();
    updateToneLabels();
  },
  ack: () => {
    if (machine.dispatch(STATE_EVENTS.ACK).accepted) beginArm(); // → arming
  },
  decline: () => {
    machine.dispatch(STATE_EVENTS.CANCEL); // preflight → idle
  },
  'continue-prompt': () => {
    if (machine.state() === STATES.AWAITING_PERMISSION) acquire(); // in-gesture
  },
  'accept-screen': () => {
    machine.dispatch(STATE_EVENTS.ACCEPT_SCREEN);
  },
  'retry-arm': () => {
    if (machine.dispatch(STATE_EVENTS.RETRY_ARM).accepted) beginArm();
  },
  cancel: () => {
    clearBeat();
    machine.dispatch(STATE_EVENTS.CANCEL); // ready → armed standby
  },
  stop: () => {
    conductor.cancel();
    machine.dispatch(STATE_EVENTS.STOP);
  },
  pause: () => {
    if (!conductor.pause('user')) machine.dispatch(STATE_EVENTS.PAUSE);
  },
  resume: () => {
    if (machine.dispatch(STATE_EVENTS.RESUME).accepted) {
      Promise.resolve(conductor.resume()).catch(() => {});
    }
  },
  'switch-screen': () => {
    // The machine moves FIRST (its release-torch effect is the synchronous
    // hardware kill), THEN the conductor takes over with the exact
    // torch-loss mechanics: the screen completes the message from the
    // current position. The release alone left the run dark on a dead
    // torch (T-refine-4) — release() emits 'released', which the conductor
    // does not hear; only this call swaps its channel.
    if (machine.dispatch(STATE_EVENTS.SWITCH_CHANNEL).accepted) {
      conductor.switchToScreen();
    }
  },
  replay: () => {
    if (currentMarkCount() === 0) return;
    machine.dispatch(STATE_EVENTS.REPLAY); // → ready (screen) or preflight
  },
  reset: () => {
    conductor.cancel();
    Promise.resolve(screenChannel.destroy()).catch(() => {}); // exit fullscreen
    machine.dispatch(STATE_EVENTS.RESET);
  },
  'copy-link': () => {
    writeHash(); // the address bar already holds the shareable fragment
    copyText(shareUrl(encode(messageInput.value, stepId))).then(
      () => showShareOutcome(shareCopied),
      () => showShareOutcome(shareFailed)
    );
  },
};

function copyText(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text);
  }
  // Legacy fallback for engines without the async clipboard.
  return new Promise((resolve, reject) => {
    const holder = document.createElement('textarea');
    holder.value = text;
    holder.setAttribute('readonly', '');
    holder.style.position = 'fixed';
    holder.style.opacity = '0';
    document.body.appendChild(holder);
    holder.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    holder.remove();
    if (ok) resolve();
    else reject(new Error('execCommand copy refused'));
  });
}

function showShareOutcome(el) {
  shareCopied.hidden = el !== shareCopied;
  shareFailed.hidden = el !== shareFailed;
  if (shareTimer !== null) clearTimeout(shareTimer);
  shareTimer = setTimeout(() => {
    shareTimer = null;
    shareCopied.hidden = true;
    shareFailed.hidden = true;
  }, 4000);
}

for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('click', () => {
    const run = ACTIONS[button.dataset.action];
    if (run) run();
  });
}

// ---------------------------------------------------------------------------
// Composer + speed inputs
// ---------------------------------------------------------------------------

messageInput.addEventListener('input', () => {
  requestTapeRender();
  requestHashWrite();
});

for (const radio of speedRadios) {
  radio.addEventListener('change', () => {
    // Belt and suspenders (T-refine-1): a disabled radio never fires, but a
    // stale or programmatic change while a run is committed must not reach
    // stepId — restore the armed step's checked state and leave. The
    // progress line is likewise never rewritten from here: it belongs to
    // the run (the error line is the failed run's record); render() and
    // startBroadcast() seed it with the step that actually speaks.
    if (FROZEN_STATES.has(machine.state())) {
      selectStep(stepId);
      return;
    }
    if (radio.checked && SPEED_STEPS[radio.value]) {
      stepId = radio.value;
      requestHashWrite();
    }
  });
}

function selectStep(id) {
  stepId = SPEED_STEPS[id] ? id : DEFAULT_STEP_ID;
  for (const radio of speedRadios) {
    radio.checked = radio.value === stepId;
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

// Capability layer: Save-Data reaches the server as a request header and
// is invisible to CSS — mirror it onto <html> as the .cap-low class hook
// so the stylesheet can flatten the same layers prefers-reduced-motion
// flattens (glows + motion, never information, never the flash itself).
const connection = typeof navigator !== 'undefined' && navigator.connection;
if (connection && connection.saveData) {
  document.documentElement.classList.add('cap-low');
}

const loaded = readHash();
if (loaded) {
  messageInput.value = loaded.message;
  selectStep(loaded.stepId);
  // Loaded vs unreadable (F7 keeps "no link" as null, which never lands
  // here): a link that carried nothing readable still names the safe speed.
  const carried = loaded.message.length > 0 || loaded.stepId !== DEFAULT_STEP_ID;
  sharedNote.hidden = false;
  sharedNote.textContent = carried ? COPY.shared.loaded : COPY.shared.unreadable;
}

buildTape(messageInput.value);
renderComposerNotes();
updateToneLabels();
render(machine.snapshot());
