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
import { createBroadcastBack } from './broadcast-back.js';
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
import { createDeviceStore } from './device-store.js';
import { createReceivedLog } from './received-log.js';
import { createScreenAwake } from './screen-awake.js';
import { textToMorse, morseToText } from './translator.js';
import { FLASH_COLORS, flashColorById } from './flash-color.js';
import {
  MODES, ACCENTS, BASE_DARK, modeById, accentById, resolveModeId, buildTokens, tokensToCss, isLightMode,
} from './themes.js';
import { createDropdown } from './dropdown.js';
import { LOGO_VARS, logoSvg, logoColors, logoDataUrl } from './logo.js';

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
const optionsPanel = $('#options-panel');
const flowPanel = $('#flow-panel');
const FLOW_STATES = new Set(['preflight', 'awaiting-permission', 'permission-denied', 'receive-preflight', 'receive-denied']);

function syncFlowPanel(state) {
  if (FLOW_STATES.has(state) && !flowPanel.open) flowPanel.showModal();
  else if (!FLOW_STATES.has(state) && flowPanel.open) flowPanel.close();
}

$('#options-trigger').addEventListener('click', () => optionsPanel.showModal());
$('#options-close').addEventListener('click', () => optionsPanel.close());
optionsPanel.addEventListener('click', event => { if (event.target === optionsPanel) optionsPanel.close(); });

// ---------------------------------------------------------------------------
// Channels + machine (single instances for the page's life)
// ---------------------------------------------------------------------------

const torch = createTorchChannel();
// Keep the current app view: requesting fullscreen adds a browser notice even in a TWA.
// Keep the screen black past the receiver's five-second silence completion.
const screenChannel = createScreenChannel({ fullscreen: false, leadingQuietMs: 2200, trailingQuietMs: 5500 });
const audio = createAudioChannel();
const machine = createStateMachine();

// On-device extras. The web build's store forgets on close; the native build's
// persists (see js/device-store.js). The screen colour is the sender's choice.
const deviceStore = createDeviceStore();
const FLASH_COLOR_KEY = 'flash-color';
let flashColor = flashColorById(deviceStore.get(FLASH_COLOR_KEY));
screenChannel.setColor(flashColor.hex);

// Hold the phone awake while a run is committed or the camera is listening,
// so a short auto-lock cannot cut a message off mid-way.
const awake = createScreenAwake();
const translatorOpen = $('#translator-open');
const AWAKE_STATES = new Set([
  STATES.READY, STATES.BROADCASTING, STATES.BROADCASTING_ON_SCREEN,
  STATES.PAUSED, STATES.PAUSED_ON_SCREEN, 'receive-armed', 'receive-active',
]);
let keepAwake = deviceStore.get('keep-awake') !== 'off';
function syncAwake() {
  const busy = AWAKE_STATES.has(body.dataset.state);
  awake.set(busy && keepAwake);
  translatorOpen.disabled = busy; // no modal over a live flash or a listening session
}

// Themes: a MODE (light, dark, contrast, or AUTO = follow the phone) and an
// ACCENT, combined into colour tokens set on <html>. Dark + amber is the stylesheet.
let modeChoice = modeById(deviceStore.get('mode')).id;
let accentChoice = accentById(deviceStore.get('accent')).id;
let accentDropdown = null;
let appliedTokens = [];
// The mark follows the theme: live in the header, and as the browser-tab icon.
const brandMark = $('.brand-mark');
brandMark.innerHTML = logoSvg(LOGO_VARS, 'brand');
brandMark.dataset.live = '';
const tabIcon = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
const lightQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
function applyTheme() {
  const mode = resolveModeId(modeChoice, lightQuery?.matches === true);
  const tokens = buildTokens(mode, accentChoice);
  const root = document.documentElement;
  for (const name of appliedTokens) root.style.removeProperty(`--${name}`);
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(`--${name}`, value);
  appliedTokens = Object.keys(tokens);
  const scheme = mode === 'light' ? 'light' : 'dark';
  root.style.colorScheme = scheme;
  root.dataset.mode = mode;
  // Saved so a native launch can paint the right colours before any script runs.
  deviceStore.set('theme-css', [tokensToCss(tokens), `color-scheme:${scheme}`].filter(Boolean).join(';'));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = tokens.ground ?? BASE_DARK.ground;
  if (tabIcon) tabIcon.href = logoDataUrl(logoColors(mode, { ...BASE_DARK, ...tokens }));
  if (typeof window.morseNativeSystemBars === 'function') window.morseNativeSystemBars(isLightMode(mode));
  accentDropdown?.setDisabled(mode === 'contrast'); // high contrast has its own fixed colours
}
lightQuery?.addEventListener?.('change', () => { if (modeChoice === 'auto') applyTheme(); });
applyTheme();

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

/** States where marks are actually being spoken. */
const LIVE_STATES = new Set([STATES.BROADCASTING, STATES.BROADCASTING_ON_SCREEN]);

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

// While the operator types, the newest punch feeds under the head so every
// press is visible even on a phone; committing a run rewinds to the start.
let followTyping = false;
let rewindTimer = null;

function rewindTape() {
  if (!followTyping) return;
  followTyping = false;
  body.classList.add('tape-rewinding');
  if (rewindTimer !== null) clearTimeout(rewindTimer);
  rewindTimer = setTimeout(() => {
    rewindTimer = null;
    body.classList.remove('tape-rewinding');
  }, 520);
}

/** Head placement per machine phase (progress events own the live traverse). */
function applyHeadForState(state) {
  if (!tape.groups.length) {
    setHead(null, 0, false);
  } else if (state === STATES.DONE) {
    setHead(tape.groups.length - 1, tape.groups.length, false);
  } else if (PROGRESS_STATES.has(state)) {
    // broadcasting / paused / error: keep the head where the schedule put it
  } else if (followTyping) {
    setHead(tape.groups.length - 1, 0, false);
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
      followTyping = true;
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
  const { unknown, tokens } = translate(messageInput.value);
  const seconds = Math.ceil(schedule(tokens, stepId).durationMs / 1000);
  const duration = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  $('#message-duration').textContent = seconds ? `${duration} TO SEND` : '';
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
  syncFlowPanel(state);
  syncAwake();
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
  if (state !== STATES.IDLE && state !== STATES.TORCH_READY && state !== STATES.SCREEN_MODE) {
    rewindTape(); // leaving the composer: the tape winds back to its first letter
  }
  applyHeadForState(state);
  renderStage(snapshot);
  renderReceipt(snapshot);
  if (!LIVE_STATES.has(state)) stopHaptics();

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
  for (const key of toneKeys) {
    key.textContent = audio.isMuted() ? COPY.toggles.off : COPY.toggles.on;
    key.setAttribute('aria-pressed', String(!audio.isMuted()));
  }
  for (const key of hapticKeys) {
    key.textContent = hapticsOn ? COPY.toggles.on : COPY.toggles.off;
    key.setAttribute('aria-pressed', String(hapticsOn));
  }
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

// Keep the camera request on the explicit Enable flashlight gesture.
function beginArm() {
  machine.dispatch(STATE_EVENTS.PERMISSION_PROMPTED);
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
  stageProgress(letterIdx, event.symbolIdx ?? 0, event.mark);
  buzzMark(event.mark);
}

// ---------------------------------------------------------------------------
// The screen stage: while the screen is the light, a dark strip above the
// flash keeps the message, the count, and STOP in view. CSS shows it only
// while the flash overlay is mounted; this keeps its contents current.
// ---------------------------------------------------------------------------

const stage = $('.screen-stage');
const stageLegend = stage.querySelector('.stage-legend');
const stageLine = stage.querySelector('.stage-line');
const stageProgressEl = stage.querySelector('.stage-progress');
const stageLetters = stage.querySelector('.stage-letters');
const stageMarks = stage.querySelector('.stage-marks');
let stageGroups = [];   // per letterIdx: {el, marks}
let stageLetterIdx = -1;
let stageSpoken = false;
let stageTailTimer = null;

function clearStageTail() {
  if (stageTailTimer !== null) clearTimeout(stageTailTimer);
  stageTailTimer = null;
}

function buildStage(text) {
  stageLetters.replaceChildren();
  stageMarks.replaceChildren();
  stageGroups = [];
  stageLetterIdx = -1;
  stageSpoken = false;
  stageProgressEl.textContent = '';
  stage.style.setProperty('--stage-progress', '0%');
  const byChar = new Map(translate(text).letters.map((l) => [l.charIdx, l]));
  for (let i = 0; i < text.length; i++) {
    const li = document.createElement('li');
    li.textContent = /\s/.test(text[i]) ? '\u00a0' : text[i];
    const letter = byChar.get(i);
    if (letter) stageGroups[letter.letterIdx] = { el: li, marks: letter.marks };
    else li.className = 'stage-gap';
    stageLetters.appendChild(li);
  }
  stageLetters.style.setProperty('--stage-shift', '0px');
}

function stageProgress(letterIdx, symbolIdx, mark) {
  const group = stageGroups[letterIdx];
  if (!group) return;
  if (letterIdx !== stageLetterIdx) {
    for (let i = 0; i < stageGroups.length; i++) {
      const el = stageGroups[i]?.el;
      if (!el) continue;
      el.classList.toggle('is-spoken', i < letterIdx);
      el.classList.toggle('is-live', i === letterIdx);
    }
    stageLetters.style.setProperty(
      '--stage-shift', `${group.el.offsetLeft + group.el.offsetWidth / 2}px`);
    stageMarks.replaceChildren(...group.marks.map((m) => {
      const pill = document.createElement('span');
      pill.className = `stage-pill stage-${m}`;
      return pill;
    }));
    stageLetterIdx = letterIdx;
  }
  Array.from(stageMarks.children).forEach((pill, i) => {
    pill.classList.toggle('is-spoken', i < symbolIdx);
    pill.classList.toggle('is-live', i === symbolIdx);
  });
  stage.dataset.phase = 'live';
  stageLegend.textContent = COPY.screenStage.live;
  if (marksTotal > 0) {
    stageProgressEl.textContent = progressLine(Math.max(1, lastMarksStarted), marksTotal);
    stage.style.setProperty('--stage-progress', `${(lastMarksStarted / marksTotal) * 100}%`);
    stageSpoken = lastMarksStarted >= marksTotal;
  }
  clearStageTail();
  if (stageSpoken) {
    // The last mark: once its light ends, the screen holds dark so the
    // receiver can finish — say so instead of leaving a silent black screen.
    const units = mark === 'dash' ? 3 : 1;
    stageTailTimer = setTimeout(() => {
      stageTailTimer = null;
      if (LIVE_STATES.has(machine.state())) renderStage({ state: STATES.DONE });
    }, units * dotMsOf(SPEED_STEPS[stepId].wpm) + 60);
  }
}

function renderStage(snapshot) {
  const state = snapshot.state;
  if (state !== STATES.DONE && !LIVE_STATES.has(state)) clearStageTail();
  if (state === STATES.READY) buildStage(messageInput.value);
  let phase = stage.dataset.phase;
  if (state === STATES.READY) phase = 'lead';
  else if (state === STATES.PAUSED || state === STATES.PAUSED_ON_SCREEN) phase = 'held';
  else if (LIVE_STATES.has(state)) phase = stageLetterIdx < 0 ? 'lead' : 'live';
  else if (state === STATES.DONE) phase = 'tail';
  stage.dataset.phase = phase;
  stageLegend.textContent = COPY.screenStage[phase] ?? COPY.screenStage.lead;
  stageLine.textContent = phase === 'tail' ? COPY.screenStage.tailLine : COPY.screenStage.leadLine;
  if (phase === 'tail') {
    for (const g of stageGroups) g?.el.classList.remove('is-live');
    for (const pill of stageMarks.children) pill.classList.remove('is-live');
    if (stageSpoken) for (const g of stageGroups) g?.el.classList.add('is-spoken');
  }
}

// ---------------------------------------------------------------------------
// Vibration: the phone in the hand keys each mark. Memory-only preference;
// offered only where the platform exposes the Vibration API.
// ---------------------------------------------------------------------------

const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
const hapticKeys = Array.from(document.querySelectorAll('[data-action="haptics"]'));
let hapticsOn = canVibrate;
let buzzing = false;
if (canVibrate) for (const row of document.querySelectorAll('.haptic-option')) row.hidden = false;

function buzzMark(mark) {
  if (!hapticsOn) return;
  const dotMs = dotMsOf(SPEED_STEPS[stepId].wpm);
  // Slightly shorter than the light so consecutive marks stay distinct.
  buzzing = true;
  try { navigator.vibrate(Math.round(mark === 'dash' ? dotMs * 2.6 : dotMs * 0.7)); } catch { /* ignored */ }
}

function stopHaptics() {
  if (!buzzing) return;
  buzzing = false;
  try { navigator.vibrate(0); } catch { /* ignored */ }
}

// ---------------------------------------------------------------------------
// The finish: a printed receipt and the share key.
// ---------------------------------------------------------------------------

const receiptLegend = $('.receipt-legend');
const receiptDetail = $('.receipt-detail');
const shareKey = $('[data-action="share"]');
let shareKeyTimer = null;

function renderReceipt(snapshot) {
  if (snapshot.state !== STATES.DONE || !liveSchedule) return;
  const stopped = snapshot.doneReason === 'stopped';
  const letters = tape.groups.filter((g) => g.known).length;
  const seconds = Math.max(1, Math.round(liveSchedule.durationMs / 1000));
  receiptLegend.textContent = stopped ? COPY.done.stoppedLegend : COPY.done.sentLegend;
  receiptDetail.textContent = stopped
    ? progressLine(Math.max(1, lastMarksStarted), marksTotal)
    : `${letters} ${letters === 1 ? 'LETTER' : 'LETTERS'} · ${seconds}S`;
}

function flashShareKey(label) {
  shareKey.textContent = label;
  if (shareKeyTimer !== null) clearTimeout(shareKeyTimer);
  shareKeyTimer = setTimeout(() => {
    shareKeyTimer = null;
    shareKey.textContent = COPY.transport.share;
  }, 2400);
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

const broadcastBack = createBroadcastBack({
  history,
  target: window,
  onBack: () => {
    clearBeat();
    conductor.cancel();
    if (machine.can(STATE_EVENTS.STOP)) machine.dispatch(STATE_EVENTS.STOP);
    machine.dispatch(STATE_EVENTS.CANCEL);
    machine.dispatch(STATE_EVENTS.RESET);
    messageInput.focus({ preventScroll: true });
  },
});

machine.addEventListener('change', (e) => {
  render(e.snapshot);
  broadcastBack.setActive([
    STATES.READY, STATES.BROADCASTING, STATES.BROADCASTING_ON_SCREEN,
    STATES.PAUSED, STATES.PAUSED_ON_SCREEN,
  ].includes(e.snapshot.state));
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
    if (machine.dispatch(STATE_EVENTS.RETRY_ARM).accepted) acquire();
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
  share: () => {
    writeHash();
    const url = shareUrl(encode(messageInput.value, stepId));
    if (typeof navigator.share === 'function') {
      navigator.share({ title: COPY.done.shareTitle, text: COPY.done.shareText, url }).catch(() => {});
      return;
    }
    copyText(url).then(
      () => flashShareKey(COPY.done.shareCopied),
      () => flashShareKey(COPY.done.shareRefused)
    );
  },
  haptics: () => {
    hapticsOn = !hapticsOn;
    if (!hapticsOn) stopHaptics();
    updateToneLabels();
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
  button.addEventListener('click', (event) => {
    const run = ACTIONS[button.dataset.action];
    if (run) run(event);
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
      $('#options-speed').textContent = `${SPEED_STEPS[stepId].wpm} WPM`;
      renderComposerNotes();
      requestHashWrite();
    }
  });
}

function selectStep(id) {
  stepId = SPEED_STEPS[id] ? id : DEFAULT_STEP_ID;
  $('#options-speed').textContent = `${SPEED_STEPS[stepId].wpm} WPM`;
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

// ---------------------------------------------------------------------------
// RUN 2 — THE REGISTER LISTENS (I2 + S2, docs/ultron/run2-receiver/plan.md)
//
// The receive half: mode lever, watcher→session→tape pipeline, honest
// meters, COPY, and the camera discipline (opened in a gesture, closed on
// stop/mode-switch/background). The broadcast journey above is untouched
// except where explicitly guarded by mode checks.
// ---------------------------------------------------------------------------

import { createWatcher } from './watcher.js';
import {
  RECEIVE_STATES, RECEIVE_EVENTS, RECEIVE_EFFECTS, createReceiveMachine,
} from './states.js';
import { createReceiveSession, METER } from './receive-session.js';
import { meterLine } from './copy.js';

const RX = COPY.receive;

// -- receive DOM -------------------------------------------------------------
const previewVideo = $('#preview');
const aperture = $('.aperture');
const modeRadios = Array.from(document.querySelectorAll('input[name="mode"]'));
const meterSaturationNote = $('.meter-saturated');
const meterPartialNote = $('.meter-partial');
const receiveDoneNote = $('[data-receive-done-note]');
const rxStrip = $('.tape-rx');
const rxAnnounce = $('.meter .sr-live'); // markup-scoped live-region config
const receivedText = $('#received-text');
const transcriptLatest = $('#transcript-latest');
const receiveCopyKey = $('[data-action="copy-message"]');
let transcriptPending = false;
let transcriptDisplayed = '';
let followTranscript = true;

function requestTranscript() {
  if (transcriptPending) return;
  transcriptPending = true;
  // Session events finish updating canonical text before this reads it.
  queueMicrotask(() => {
    transcriptPending = false;
    const text = sessionTextNow();
    if (text === transcriptDisplayed) return;
    if (transcriptDisplayed && text.startsWith(transcriptDisplayed)) {
      receivedText.firstChild.appendData(text.slice(transcriptDisplayed.length));
    } else receivedText.textContent = text || 'Decoded letters appear here.';
    transcriptDisplayed = text;
    receivedText.dataset.empty = String(!text);
    receiveCopyKey.disabled = !text;
    if (followTranscript) receivedText.scrollTop = receivedText.scrollHeight;
  });
}

receivedText.addEventListener('scroll', () => {
  followTranscript = receivedText.scrollHeight - receivedText.clientHeight - receivedText.scrollTop < 24;
  transcriptLatest.hidden = followTranscript;
});
transcriptLatest.addEventListener('click', () => {
  followTranscript = true;
  receivedText.scrollTop = receivedText.scrollHeight;
  transcriptLatest.hidden = true;
});

// -- receive state -----------------------------------------------------------
let mode = 'broadcast';
const rxMachine = createReceiveMachine();
let watcher = null;
let rxSession = null;
let rxCompletedText = '';
let rxLastWord = '';

// Receive states where the mode lever freezes (a committed listen).
const RX_FROZEN_STATES = new Set([
  RECEIVE_STATES.ARMING, RECEIVE_STATES.ARMED, RECEIVE_STATES.ACTIVE,
]);

// -- receive tape rendering (I1's static strip becomes live) ------------------

const RX_PUNCH = Object.freeze({ dot: 14, dash: 42, gap: 10, letter: 26, word: 58, start: 44 });

let rxLiveEl = null;      // the growing group's <li>
let rxLiveMarks = 0;
let rxLiveWidth = 0;
let rxCursor = RX_PUNCH.start; // next group's left, in strip px

function rxResetTapeDom() {
  rxStrip.innerHTML = '';
  rxStrip.style.removeProperty('--strip-shift');
  rxLiveEl = null;
  rxLiveMarks = 0;
  rxLiveWidth = 0;
  rxCursor = RX_PUNCH.start;
}

function rxUpdateShift() {
  // Keep the growing record's edge under the read-head bridge (the
  // broadcast traverse, receive way). Information parity: the shift is a
  // transform — it still applies, instantly, under the capability layers.
  const edge = rxCursor + (rxLiveEl === null ? 0 : rxLiveWidth);
  rxStrip.style.setProperty('--strip-shift', `${Math.max(RX_PUNCH.start, edge - 60)}px`);
}

function rxEnsureLiveGroup() {
  if (rxLiveEl !== null) return rxLiveEl;
  const li = document.createElement('li');
  li.className = 'tg tg-new tg-live';
  li.style.left = `${rxCursor}px`;
  li.style.width = `${RX_PUNCH.dot}px`;
  const ch = document.createElement('span');
  ch.className = 'tg-char';
  const marks = document.createElement('span');
  marks.className = 'tg-marks';
  li.append(ch, marks);
  rxStrip.appendChild(li);
  rxLiveMarks = 0;
  rxLiveWidth = 0;
  return (rxLiveEl = li);
}

function rxAppendMark(mark) {
  const el = rxEnsureLiveGroup();
  if (rxLiveMarks > 0) rxLiveWidth += RX_PUNCH.gap;
  rxLiveWidth += mark === 'dash' ? RX_PUNCH.dash : RX_PUNCH.dot;
  el.style.width = `${rxLiveWidth}px`;
  const punch = document.createElement('span');
  punch.className = `tp tp-${mark} tp-new`; // the die press (I3)
  el.querySelector('.tg-marks').appendChild(punch);
  rxLiveMarks += 1;
  rxUpdateShift();
}

function rxCompleteLetter(event) {
  if (rxLiveEl === null) {
    // Sequence-independent rendering: replayed letters (the lock-time
    // recovery and the forced bootstrap) arrive with their marks in the
    // event, not in a live group — punch a completed group directly.
    rxRenderCompletedGroup(event);
    rxUpdateShift();
    return;
  }
  const el = rxLiveEl;
  if (event.known === false) {
    el.className = 'tg tg-void'; // the honest void group
    el.querySelector('.tg-char').textContent = '';
  } else {
    el.className = 'tg tg-spoken';
    el.querySelector('.tg-char').textContent = event.char;
  }
  rxCursor += rxLiveWidth + RX_PUNCH.letter;
  rxLiveEl = null;
  rxUpdateShift();
}

function rxRenderCompletedGroup(event) {
  const marks = Array.isArray(event.marks) ? event.marks : [];
  let width = 0;
  for (let i = 0; i < marks.length; i++) {
    width += marks[i] === 'dash' ? RX_PUNCH.dash : RX_PUNCH.dot;
    if (i < marks.length - 1) width += RX_PUNCH.gap;
  }
  if (width === 0) width = RX_PUNCH.dot; // a void keeps a minimal group
  const li = document.createElement('li');
  li.className = event.known === false ? 'tg tg-void' : 'tg tg-spoken';
  li.style.left = `${rxCursor}px`;
  li.style.width = `${width}px`;
  const ch = document.createElement('span');
  ch.className = 'tg-char';
  ch.textContent = event.known === true ? event.char : '';
  const markRow = document.createElement('span');
  markRow.className = 'tg-marks';
  for (const m of marks) {
    const punch = document.createElement('span');
    punch.className = `tp tp-${m}`;
    markRow.appendChild(punch);
  }
  li.append(ch, markRow);
  rxStrip.appendChild(li);
  rxCursor += width + RX_PUNCH.letter;
}

function rxAppendWord() {
  // A word gap is spacing, not an element (the tape's word grammar).
  rxCursor += RX_PUNCH.word - RX_PUNCH.letter;
  rxUpdateShift();
}

// -- announcements (per-word polite; letters settle silently) ------------------

function announceRxBurst(text) {
  // Letters accumulate silently; a completed WORD announces once (the
  // refinement-#2 law: no per-letter chatter). Timers are wrong here —
  // at LEARNER a letter every ~2 s would flush each letter alone.
  rxLastWord += text;
}

function announceRxWord() {
  const word = rxLastWord.trim();
  rxLastWord = '';
  if (word) {
    rxAnnounce.textContent = '';
    rxAnnounce.textContent = `${word}`;
  }
}

// -- watcher → session plumbing ------------------------------------------------

function beginListen() {
  // Inside the user's gesture (the click that dispatched ACK).
  if (watcher === null) {
    watcher = createWatcher({ video: previewVideo });
    watcher.addEventListener('edge', onWatcherEdge);
    watcher.addEventListener('stats', onWatcherStats);
    watcher.addEventListener('lost', () => {
      logReceived({ partial: true }); // the text heard so far is kept, in the log too
      rxMachine.dispatch(RECEIVE_EVENTS.CAMERA_LOST, { reason: 'ended' });
    });
  }
  watcher.acquire().then((result) => {
    if (result.ok) {
      rxMachine.dispatch(RECEIVE_EVENTS.WATCHER_GRANTED);
      // rxSession is created lazily at the FIRST edge, where the D8
      // mid-join truth is actually observable: a first OFF edge means
      // the light was already on when listening began.
    } else if (result.outcome === 'permission-denied') {
      rxMachine.dispatch(RECEIVE_EVENTS.WATCHER_DENIED, { outcome: result.outcome });
    } else {
      rxMachine.dispatch(RECEIVE_EVENTS.WATCHER_FAILED, { outcome: result.outcome });
    }
  });
}

let rxLightOnTMs = null;  // timestamp of the last ON edge (open mark)
let rxLightOffTMs = null; // timestamp of the last OFF edge (open gap)

function onWatcherEdge(edge) {
  if (rxSession === null) {
    // D8 at the only place it is observable: a first OFF edge means the
    // light was already on when listening began (mid-mark join).
    rxSession = createReceiveSession({
      lightOnAtBegin: !edge.on,
      onEvent: onSessionEvent,
    });
  }
  if (edge.on) {
    if (rxLightOffTMs !== null) {
      rxSession.feedGap(edge.tMs - rxLightOffTMs, edge.tMs);
    }
    rxLightOnTMs = edge.tMs;
  } else {
    if (rxLightOnTMs !== null) {
      rxSession.feedMark(edge.tMs - rxLightOnTMs, edge.tMs);
    }
    rxLightOffTMs = edge.tMs;
  }
}

function onWatcherStats(stats) {
  if (rxSession !== null) rxSession.noteFrame(stats.tMs, { lightOn: stats.lightOn });
  if (meterSaturationNote !== null) {
    meterSaturationNote.hidden = !stats.saturated;
  }
}

function onSessionEvent(event) {
  switch (event.type) {
    case 'replay-start':
      rxResetTapeDom();
      rxLastWord = '';
      break;
    case 'mark':
      if (rxMachine.state === RECEIVE_STATES.ARMED) {
        rxMachine.dispatch(RECEIVE_EVENTS.HEARING); // light speaks → active
      }
      firePulse(); // the read-head lamp fires per heard flash (I3)
      rxAppendMark(event.mark);
      break;
    case 'letter':
      rxCompleteLetter(event);
      requestTranscript();
      announceRxBurst(event.known ? event.char : '');
      break;
    case 'word':
      rxAppendWord();
      announceRxWord();
      break;
    case 'meter':
      renderRx();
      break;
    case 'partial':
      if (meterPartialNote !== null) meterPartialNote.hidden = false;
      break;
    case 'complete':
      rxCompletedText = event.text;
      logReceived({ partial: Boolean(event.partial) });
      requestTranscript();
      if (event.source === 'silence') {
        rxMachine.dispatch(RECEIVE_EVENTS.AUTO_COMPLETE, { partial: event.partial });
      } else {
        rxMachine.dispatch(RECEIVE_EVENTS.STOP);
      }
      announceRxWord(); // the trailing word, if the sender never paused
      rxAnnounce.textContent = '';
      rxAnnounce.textContent = event.text
        ? `${event.text}.`
        : RX.quietClosed;
      break;
    default:
      break;
  }
}

// -- receive render -------------------------------------------------------------

function renderRx() {
  const state = rxMachine.state;
  body.dataset.state = state;
  syncFlowPanel(state);
  syncAwake();
  if (state !== RECEIVE_STATES.ARMED && state !== RECEIVE_STATES.ACTIVE) {
    clearFire(); // the lamp fires only while light speaks
  }
  const sessionStatus = rxSession !== null ? rxSession.status() : null;
  const meter = sessionStatus !== null && sessionStatus.locked
    ? METER.DECODING
    : (sessionStatus !== null ? sessionStatus.meter : METER.SILENCE);
  body.dataset.meter = meter;
  const cameraOn = state === RECEIVE_STATES.ARMED || state === RECEIVE_STATES.ACTIVE;
  if (aperture !== null) aperture.dataset.rxCamera = cameraOn ? 'on' : 'off';
  if (state === RECEIVE_STATES.DONE) {
    const snap = rxMachine.snapshot();
    receiveDoneNote.textContent = snap.donePartial
      ? RX.donePartial
      : (snap.doneSource === 'silence' ? RX.quietClosed : RX.states[RECEIVE_STATES.DONE].line);
    if (rxLogged) receiveDoneNote.textContent += ` ${COPY.log.saved}`;
  }
  freezeModeLever();
}

// -- the mode lever (S2) ---------------------------------------------------------

function freezeModeLever() {
  // Frozen through any committed run of EITHER mode (v1 speed-freeze
  // grammar: disable pass + belt-and-suspenders restore in the handler).
  const txCommitted = mode === 'broadcast'
    && FROZEN_STATES.has(machine.state());
  const rxCommitted = mode === 'receive' && RX_FROZEN_STATES.has(rxMachine.state);
  for (const radio of modeRadios) radio.disabled = txCommitted || rxCommitted;
}

for (const radio of modeRadios) {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    const nextMode = radio.value.toLowerCase(); // radio values are uppercase
    if (nextMode === mode) return;
    // Guard: a committed run refuses the switch and restores the lever.
    if ((mode === 'broadcast' && FROZEN_STATES.has(machine.state()))
        || (mode === 'receive' && RX_FROZEN_STATES.has(rxMachine.state))) {
      for (const r of modeRadios) r.checked = r.value.toLowerCase() === mode;
      return;
    }
    if (mode === 'receive') {
      // Leaving receive: finalize + release the camera. No auto-restart.
      if (rxMachine.state === RECEIVE_STATES.ARMED || rxMachine.state === RECEIVE_STATES.ACTIVE) {
        if (rxSession !== null) rxSession.stop(); // emits complete → STOP row
        rxMachine.dispatch(RECEIVE_EVENTS.STOP);
      } else {
        rxMachine.dispatch(RECEIVE_EVENTS.RESET);
      }
      stopWatcher();
    }
    mode = nextMode;
    body.dataset.mode = mode;
    if (mode === 'receive') {
      // Entering receive never touches the broadcast machine or the hash.
      rxMachine.dispatch(RECEIVE_EVENTS.RESET);
      resetRxSurface();
      // The lever turn IS the listening request: the why-camera plate
      // greets the mode (the entry gesture).
      rxMachine.dispatch(RECEIVE_EVENTS.REQUEST_RECEIVE);
      renderRx();
    } else {
      render(machine.snapshot()); // the broadcast surface re-renders
    }
  });
}

function resetRxSurface() {
  rxLogged = false;
  rxCompletedText = '';
  rxLastWord = '';
  rxSession = null;
  followTranscript = true;
  transcriptLatest.hidden = true;
  receiveDoneNote.textContent = 'Letters appear as the light is decoded.';
  requestTranscript();
  rxResetTapeDom();
  rxLightOnTMs = null;
  rxLightOffTMs = null;
  if (meterPartialNote !== null) meterPartialNote.hidden = true;
  if (meterSaturationNote !== null) meterSaturationNote.hidden = true;
  rxAnnounce.textContent = '';
}

function stopWatcher() {
  if (watcher !== null) watcher.stop(); // release-torch's receive twin
  rxLightOnTMs = null;
  rxLightOffTMs = null;
}

// Machine effects: the host performs what the table asks.
rxMachine.addEventListener('change', renderRx);
rxMachine.addEventListener(RECEIVE_EFFECTS.RELEASE_CAMERA, () => {
  stopWatcher();
});

// Backgrounding while listening finalizes what was heard and closes the eye
// (the receive twin of the conductor's visibilitychange pause).
document.addEventListener('visibilitychange', () => {
  if (document.hidden && mode === 'receive') {
    const state = rxMachine.state;
    if (state === RECEIVE_STATES.ARMED || state === RECEIVE_STATES.ACTIVE) {
      if (rxSession !== null) rxSession.stop();
      rxMachine.dispatch(RECEIVE_EVENTS.STOP);
    }
  }
});

// -- receive gestures ------------------------------------------------------------

ACTIONS['begin-listening'] = () => {
  if (rxMachine.dispatch(RECEIVE_EVENTS.ACK).accepted) beginListen(); // in-gesture
};
ACTIONS['retry-receive'] = () => {
  if (rxMachine.dispatch(RECEIVE_EVENTS.RETRY_ARM).accepted) beginListen();
};
ACTIONS['stop-listening'] = () => {
  if (rxSession !== null) rxSession.stop();
  rxMachine.dispatch(RECEIVE_EVENTS.STOP);
};
ACTIONS['listen-again'] = () => {
  rxMachine.dispatch(RECEIVE_EVENTS.RESET);
  resetRxSurface();
  rxMachine.dispatch(RECEIVE_EVENTS.REQUEST_RECEIVE);
  renderRx();
};
ACTIONS['copy-message'] = () => {
  const text = rxCompletedText || sessionTextNow();
  copyText(text).then(
    () => { receiveDoneNote.textContent = RX.copied; },
    () => { receiveDoneNote.textContent = RX.copyFailed; }
  );
};

// These shared controls follow the active mode, including Escape from a gate.
const cancelBroadcast = ACTIONS.cancel;
ACTIONS.cancel = () => body.dataset.mode === 'receive'
  ? rxMachine.dispatch(RECEIVE_EVENTS.CANCEL) : cancelBroadcast();
const resetBroadcast = ACTIONS.reset;
ACTIONS.reset = () => body.dataset.mode === 'receive'
  ? rxMachine.dispatch(RECEIVE_EVENTS.RESET) : resetBroadcast();
flowPanel.addEventListener('cancel', event => {
  event.preventDefault();
  ACTIONS.cancel();
  if (flowPanel.open) ACTIONS.reset();
});

function sessionTextNow() {
  return rxSession !== null ? rxSession.status().text : '';
}

// -- the received log -------------------------------------------------------------
// Every finished message is filed here so it can be read back later. The web
// build keeps it for the open page; the native build keeps it on the device.

const receivedLog = createReceivedLog({ store: deviceStore });
const logPanel = $('#log-panel');
const logList = $('[data-log-list]');
const logEmpty = $('[data-log-empty]');
const logNote = $('[data-log-note]');
const logClear = $('[data-log-clear]');
const logOpen = $('#log-open');
const logCount = $('[data-log-count]');
let rxLogged = false;
let clearArmedTimer = null;

function logReceived({ partial }) {
  if (rxLogged) return;
  const text = (rxCompletedText || sessionTextNow()).trim();
  if (!text) return;
  rxLogged = true;
  receivedLog.add({ text, partial });
}

function formatWhen(at) {
  try {
    return new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
}

function logKey(label, action) {
  const key = document.createElement('button');
  key.className = 'key';
  key.type = 'button';
  key.dataset.logAction = action;
  key.textContent = label;
  return key;
}

function renderLog() {
  const entries = receivedLog.list();
  logList.replaceChildren(...entries.map((entry) => {
    const item = document.createElement('li');
    item.className = 'log-entry';
    item.dataset.id = entry.id;
    const meta = document.createElement('div');
    meta.className = 'log-meta';
    const time = document.createElement('time');
    time.dateTime = new Date(entry.at).toISOString();
    time.textContent = formatWhen(entry.at);
    meta.append(time);
    if (entry.partial) {
      const flag = document.createElement('span');
      flag.className = 'log-partial';
      flag.textContent = COPY.log.partial;
      meta.append(flag);
    }
    const text = document.createElement('p');
    text.className = 'log-text';
    text.textContent = entry.text; // textContent: received text is untrusted
    const keys = document.createElement('div');
    keys.className = 'log-keys';
    keys.append(logKey(COPY.log.copy, 'copy'), logKey(COPY.log.morse, 'morse'), logKey(COPY.log.delete, 'delete'));
    item.append(meta, text, keys);
    return item;
  }));
  logEmpty.hidden = entries.length > 0;
  logClear.disabled = entries.length === 0;
  logNote.textContent = receivedLog.persistent ? COPY.log.savedOnDevice : COPY.log.pageOnly;
  logCount.textContent = entries.length ? String(entries.length) : '';
}

receivedLog.onChange(renderLog);
renderLog();

logOpen.addEventListener('click', () => logPanel.showModal());
$('#log-close').addEventListener('click', () => logPanel.close());
logPanel.addEventListener('click', (event) => { if (event.target === logPanel) logPanel.close(); });
logPanel.addEventListener('close', () => {
  if (clearArmedTimer !== null) clearTimeout(clearArmedTimer);
  clearArmedTimer = null;
  logClear.textContent = COPY.log.clear;
});

logList.addEventListener('click', (event) => {
  const key = event.target.closest('[data-log-action]');
  const item = key?.closest('.log-entry');
  if (!key || !item) return;
  const entry = receivedLog.list().find((e) => e.id === item.dataset.id);
  if (!entry) return;
  if (key.dataset.logAction === 'delete') {
    receivedLog.remove(entry.id);
  } else if (key.dataset.logAction === 'morse') {
    logPanel.close();
    openTranslator(entry.text);
  } else {
    copyText(entry.text).then(
      () => flashKey(key, COPY.log.copied),
      () => flashKey(key, COPY.log.copyFailed)
    );
  }
});

// Two taps to clear: the first arms the key, the second empties the log.
logClear.addEventListener('click', () => {
  if (clearArmedTimer === null) {
    logClear.textContent = COPY.log.clearConfirm;
    clearArmedTimer = setTimeout(() => {
      clearArmedTimer = null;
      logClear.textContent = COPY.log.clear;
    }, 3000);
    return;
  }
  clearTimeout(clearArmedTimer);
  clearArmedTimer = null;
  logClear.textContent = COPY.log.clear;
  receivedLog.clear();
});

/** Show a short outcome on a key, then restore its label. */
function flashKey(key, label) {
  const original = key.dataset.label ?? key.textContent;
  key.dataset.label = original;
  key.textContent = label;
  clearTimeout(Number(key.dataset.flashTimer));
  key.dataset.flashTimer = String(setTimeout(() => { key.textContent = original; }, 1600));
}

// -- the translator ----------------------------------------------------------------
// Text and written Morse, side by side: edit either and the other follows, with
// the letter-by-letter signs underneath so the pairing is visible.

const trPanel = $('#translator-panel');
const trText = $('#tr-text');
const trMorse = $('#tr-morse');
const trNote = $('[data-tr-note]');
const trChips = $('[data-tr-chips]');
const TR_CHIP_LIMIT = 300;

function renderChips(items) {
  const shown = items.slice(0, TR_CHIP_LIMIT);
  const nodes = shown.map((item) => {
    const chip = document.createElement('li');
    if (item.gap) {
      chip.className = 'tr-chip tr-word';
      return chip;
    }
    chip.className = item.known ? 'tr-chip' : 'tr-chip is-unknown';
    const spoken = [...item.code].map((c) => (c === '.' ? 'dot' : c === '-' ? 'dash' : 'unknown')).join(' ');
    chip.setAttribute('aria-label', `${item.char}: ${spoken}`);
    const letter = document.createElement('span');
    letter.className = 'tr-char';
    letter.setAttribute('aria-hidden', 'true');
    letter.textContent = item.char;
    const marks = document.createElement('span');
    marks.className = 'tr-marks';
    marks.setAttribute('aria-hidden', 'true');
    for (const c of item.code) {
      const mark = document.createElement('i');
      mark.className = c === '.' ? 'm-dot' : c === '-' ? 'm-dash' : 'm-odd';
      marks.append(mark);
    }
    chip.append(letter, marks);
    return chip;
  });
  if (items.length > shown.length) {
    const more = document.createElement('li');
    more.className = 'tr-more';
    more.textContent = '…';
    nodes.push(more);
  }
  trChips.replaceChildren(...nodes);
}

function translateFromText() {
  const result = textToMorse(trText.value);
  trMorse.value = result.morse;
  trNote.textContent = result.unknown.length
    ? `${COPY.translator.noSign} ${[...new Set(result.unknown)].join(' ')}`
    : '';
  renderChips(result.items);
}

function translateFromMorse() {
  const result = morseToText(trMorse.value);
  trText.value = result.text;
  const n = result.unknown.length;
  trNote.textContent = n ? `${n} ${n === 1 ? COPY.translator.unreadOne : COPY.translator.unreadMany}` : '';
  renderChips(result.items);
}

trText.addEventListener('input', translateFromText);
trMorse.addEventListener('input', translateFromMorse);

function openTranslator(text) {
  if (typeof text === 'string') {
    trText.value = text;
    translateFromText();
  }
  trPanel.showModal();
}
translatorOpen.addEventListener('click', () => openTranslator());
$('#translator-close').addEventListener('click', () => trPanel.close());
trPanel.addEventListener('click', (event) => { if (event.target === trPanel) trPanel.close(); });

ACTIONS['copy-tr-text'] = (event) => copyFrom(trText.value, event);
ACTIONS['copy-tr-morse'] = (event) => copyFrom(trMorse.value, event);
function copyFrom(value, event) {
  const key = event?.currentTarget ?? null;
  if (!value.trim()) return;
  copyText(value).then(
    () => key && flashKey(key, COPY.translator.copied),
    () => key && flashKey(key, COPY.translator.copyFailed)
  );
}

// Copying the message just sent, as Morse a friend can paste into the translator.
ACTIONS['copy-morse'] = (event) => {
  const key = event?.currentTarget ?? null;
  const { morse } = textToMorse(messageInput.value);
  if (!morse) return;
  copyText(morse).then(
    () => key && flashKey(key, COPY.done.morseCopied),
    () => key && flashKey(key, COPY.done.shareRefused)
  );
};

// -- the screen light colour (accessibility) ---------------------------------------

createDropdown({
  host: $('[data-dropdown="flash-color"]'),
  options: FLASH_COLORS.map((c) => ({ id: c.id, label: c.label, swatch: c.hex })),
  value: flashColor.id,
  onChange: (id) => {
    flashColor = flashColorById(id);
    screenChannel.setColor(flashColor.hex);
    deviceStore.set(FLASH_COLOR_KEY, flashColor.id);
  },
});

// -- the appearance controls -------------------------------------------------------

const modeHost = $('[data-segmented="mode"]');
for (const mode of MODES) {
  const id = `mode-${mode.id}`;
  const radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = 'theme-mode';
  radio.id = id;
  radio.value = mode.id;
  radio.className = 'seg-radio';
  radio.checked = mode.id === modeChoice;
  const label = document.createElement('label');
  label.className = 'key seg-key';
  label.htmlFor = id;
  label.textContent = mode.label;
  modeHost.append(radio, label);
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    modeChoice = mode.id;
    deviceStore.set('mode', mode.id);
    applyTheme();
  });
}
accentDropdown = createDropdown({
  host: $('[data-dropdown="accent"]'),
  options: ACCENTS.map((a) => ({ id: a.id, label: a.label, swatch: a.swatch })),
  value: accentChoice,
  onChange: (id) => {
    accentChoice = id;
    deviceStore.set('accent', id);
    applyTheme();
  },
});
applyTheme(); // now that the accent control exists, settle its disabled state

// The app menu (top right of the header).
const menuPanel = $('#menu-panel');
$('#menu-open').addEventListener('click', () => menuPanel.showModal());
$('#menu-close').addEventListener('click', () => menuPanel.close());
menuPanel.addEventListener('click', (event) => { if (event.target === menuPanel) menuPanel.close(); });

// -- keep the screen on (a preference; on by default) -----------------------------

const awakeKey = $('[data-action="keep-awake"]');
function renderAwakeKey() {
  awakeKey.textContent = keepAwake ? COPY.toggles.on : COPY.toggles.off;
  awakeKey.setAttribute('aria-pressed', String(keepAwake));
}
ACTIONS['keep-awake'] = () => {
  keepAwake = !keepAwake;
  deviceStore.set('keep-awake', keepAwake ? 'on' : 'off');
  renderAwakeKey();
  syncAwake();
};
renderAwakeKey();

// Boot: the receive machine parks at its own idle; the lever turns it on.
body.dataset.mode = mode;
freezeModeLever();
