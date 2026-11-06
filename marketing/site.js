import { translate } from '../js/morse.js';
import { schedule } from '../js/schedule.js';
import { encode } from '../js/hash.js';

const $ = selector => document.querySelector(selector);
const input = $('#demo-message');
const playButton = $('#play-signal');
const speed = $('#demo-speed');
const soundButton = $('#sound-toggle');
const options = $('#demo-options');
const status = $('#demo-status');
const error = $('#demo-error');
const track = $('#tape-track');
const signal = $('#signal-path');
const receipt = $('#demo-receipt');
const receiptStatus = $('#receipt-status');
const receiptProgress = $('#receipt-progress');
const preview = $('#receiver-preview');
const replayButtons = [...document.querySelectorAll('[data-play]')];
const channelButtons = [...document.querySelectorAll('[data-channel].channel-choice')];
const channels = {
  flashlight: ['Let your flashlight talk.', "The Android app turns your camera's LED into a Morse lamp. This small light follows the same timing."],
  screen: ['The screen becomes the signal.', 'Morse can turn the screen into a light source. This small screen previews the rhythm without flashing the whole page.'],
  sound: ['Hear the dots and dashes.', 'A short tone is a dot. A longer one is a dash. Press Play to hear your message at the selected speed.'],
  vibration: ['Feel the rhythm.', 'The Android app can tap the message through vibration. This demo also vibrates on browsers that support it.'],
};

let translation;
let timing;
let soundEnabled = false;
let channel = 'flashlight';
let audioContext;
let run;
let frame;
let starting = false;
let generation = 0;

function labelButton(button, label, icon) {
  button.querySelector('span').textContent = label;
  button.querySelector('use').setAttribute('href', '#icon-' + icon);
}

function setControls(playing) {
  input.disabled = playing;
  $('#clear-message').disabled = playing || input.value.length === 0;
  speed.disabled = playing;
  soundButton.disabled = playing;
  channelButtons.forEach(button => { button.disabled = playing; });
  playButton.disabled = !playing && (!timing.markCount || translation.unknown.length > 0);
  replayButtons.forEach(button => { button.disabled = playButton.disabled; });
  labelButton(playButton, playing ? 'Stop the signal' : 'Send a signal', playing ? 'stop' : 'play');
  replayButtons.forEach(button => labelButton(button, playing ? 'Stop the signal' : 'Play the message', playing ? 'stop' : 'play'));
  document.body.dataset.playing = String(playing);
}

function moveTape(index) {
  const group = track.children[index];
  if (group) track.style.setProperty('--tape-shift', group.offsetLeft + group.offsetWidth / 2 + 'px');
}

function fitSignal() {
  if (innerWidth < 1200) {
    // Keep live marks on the optical plate's measured bright-contact axis.
    const beam = $('.beam-ambient');
    const dx = beam.offsetWidth * .8904;
    const dy = beam.offsetHeight * .8224;
    signal.style.left = beam.offsetLeft + beam.offsetWidth * .0487 + 'px';
    signal.style.top = beam.offsetTop + beam.offsetHeight * .1028 + 'px';
    signal.style.width = Math.hypot(dx, dy) + 'px';
    signal.style.transform = `rotate(${Math.atan2(dy, dx)}rad) translateY(-50%)`;
  } else {
    ['left', 'top', 'width', 'transform'].forEach(property => signal.style.removeProperty(property));
  }
  const units = translation.letters.reduce((sum, letter) => sum + letter.marks.reduce((total, mark) => total + (mark === 'dash' ? 3 : 1), 0) + Math.max(0, letter.marks.length - 1) * .5 + 1.5, 0);
  const unit = Math.min(innerWidth < 761 ? 4 : 10, signal.clientWidth / Math.max(1, units));
  signal.style.setProperty('--signal-unit', unit + 'px');
  signal.style.setProperty('--signal-gap', unit * .5 + 'px');
  signal.style.setProperty('--letter-gap', unit * 1.5 + 'px');
}

function renderMessage() {
  input.value = input.value.slice(0, 24);
  translation = translate(input.value);
  timing = schedule(translation.tokens, speed.value);
  track.replaceChildren();
  signal.replaceChildren();
  translation.letters.forEach(letter => {
    const group = document.createElement('span');
    group.className = 'tape-letter';
    const character = document.createElement('span');
    character.textContent = letter.char.toUpperCase();
    const punches = document.createElement('span');
    punches.className = 'tape-punches';
    const beamGroup = document.createElement('span');
    beamGroup.className = 'signal-letter';
    letter.marks.forEach(mark => {
      const punch = document.createElement('i');
      punch.className = 'punch ' + mark;
      punches.append(punch);
      const beamMark = document.createElement('i');
      beamMark.className = 'signal-mark ' + mark;
      beamGroup.append(beamMark);
    });
    group.append(character, punches);
    track.append(group);
    signal.append(beamGroup);
  });
  error.hidden = translation.unknown.length === 0;
  status.hidden = !error.hidden;
  error.textContent = error.hidden ? '' : 'That message has a character Morse cannot send. Try letters, numbers or punctuation.';
  $('#character-count').textContent = input.value.length + ' / 24';
  status.textContent = timing.markCount ? `${Math.ceil(timing.durationMs / 1000)}s at ${timing.wpm} WPM. ${soundEnabled ? 'Sound on.' : 'Sound off.'}` : 'Type a few words to punch the tape.';
  receipt.textContent = 'Your words land here.';
  receiptStatus.textContent = 'Type a message above and send the signal.';
  receiptProgress.textContent = 'READY TO LISTEN';
  preview.textContent = 'Read the light.';
  document.querySelectorAll('[data-open-app]').forEach(link => { link.href = 'https://morse.graydonwasil.com/' + encode(input.value, speed.value); });
  setControls(false);
  fitSignal();
  moveTape(0);
}

function setSound(enabled) {
  soundEnabled = enabled;
  soundButton.setAttribute('aria-pressed', String(enabled));
  soundButton.querySelector('span').textContent = enabled ? 'Sound on' : 'Sound off';
  renderMessage();
}

function closeOptions() {
  options.open = false;
  options.querySelector('summary').focus({ preventScroll: true });
}

function releaseAudio(audio) {
  if (!audio) return;
  audio.gain.gain.cancelScheduledValues(0);
  audio.gain.gain.setValueAtTime(0, audioContext.currentTime);
  audio.oscillator.stop();
  audio.oscillator.disconnect();
  audio.gain.disconnect();
  audioContext.suspend().catch(() => {});
}

function finish(completed, reason) {
  generation++;
  starting = false;
  cancelAnimationFrame(frame);
  const previous = run;
  run = undefined;
  document.body.dataset.signal = 'off';
  if (previous) releaseAudio(previous.audio);
  if (typeof navigator.vibrate === 'function' && channel === 'vibration') navigator.vibrate(0);
  signal.querySelectorAll('.is-live').forEach(mark => mark.classList.remove('is-live'));
  track.querySelectorAll('.is-live').forEach(letter => letter.classList.remove('is-live'));
  setControls(false);
  if (!previous) return;
  if (completed) {
    receipt.textContent = previous.text;
    preview.textContent = previous.text;
    status.textContent = `Message played in ${Math.ceil(previous.timing.durationMs / 1000)}s. Try your own words.`;
    receiptStatus.textContent = 'Your demo message has arrived. In the app, a camera reads the real light.';
    receiptProgress.textContent = previous.translation.letters.length + ' LETTERS RECEIVED';
    [...track.children].forEach(letter => letter.classList.add('is-sent'));
  } else {
    status.textContent = reason || 'Signal stopped. Press Send to start again.';
    receiptStatus.textContent = 'Signal stopped. Send again to replay the whole message.';
    receiptProgress.textContent = 'SIGNAL STOPPED';
  }
}

function tick(now) {
  if (!run) return;
  const elapsed = now - run.started;
  while (run.position < run.timing.events.length && run.timing.events[run.position].tMs <= elapsed) {
    const event = run.timing.events[run.position++];
    document.body.dataset.signal = event.on ? 'on' : 'off';
    const beam = signal.children[event.letterIdx]?.children[event.symbolIdx];
    if (beam) { beam.classList.toggle('is-live', event.on); beam.classList.toggle('is-sent', !event.on); }
    if (event.on && run.letter !== event.letterIdx) {
      if (run.letter !== undefined) {
        track.children[run.letter].classList.remove('is-live');
        track.children[run.letter].classList.add('is-sent');
      }
      run.letter = event.letterIdx;
      track.children[event.letterIdx].classList.add('is-live');
      moveTape(event.letterIdx);
    }
    if (event.on && channel === 'vibration' && typeof navigator.vibrate === 'function') {
      const next = run.timing.events[run.position];
      navigator.vibrate(Math.max(1, next.tMs - event.tMs - 15));
    }
    if (!event.on && run.timing.events[run.position]?.letterIdx !== event.letterIdx) {
      const heard = run.text.slice(0, event.charIdx + 1);
      receipt.textContent = heard;
      preview.textContent = heard;
      receiptProgress.textContent = `${event.letterIdx + 1} / ${run.translation.letters.length} LETTERS`;
    }
  }
  if (elapsed >= run.timing.durationMs) finish(true);
  else frame = requestAnimationFrame(tick);
}

async function play() {
  if (run || starting) { finish(false); return; }
  if (playButton.disabled) return;
  const token = ++generation;
  starting = true;
  setControls(true);
  options.open = false;
  const text = input.value.toUpperCase();
  const playback = { text, translation, timing, position: 0, audio: undefined };
  try {
    if (soundEnabled) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw new Error('Sound unavailable');
      audioContext ||= new Audio();
      await audioContext.resume();
      if (token !== generation || document.hidden) return;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.frequency.value = 700;
      gain.gain.value = 0;
      oscillator.connect(gain).connect(audioContext.destination);
      const start = audioContext.currentTime + .025;
      for (let index = 0; index < timing.events.length; index += 2) {
        const on = start + timing.events[index].tMs / 1000;
        const off = start + timing.events[index + 1].tMs / 1000;
        gain.gain.setValueAtTime(0, on);
        gain.gain.linearRampToValueAtTime(.055, on + .004);
        gain.gain.setValueAtTime(.055, off - .004);
        gain.gain.linearRampToValueAtTime(0, off);
      }
      oscillator.start(start);
      oscillator.stop(start + timing.durationMs / 1000 + .02);
      playback.audio = { oscillator, gain };
    }
  } catch {
    playback.soundUnavailable = true;
    if (channel === 'sound') $('#channel-description').textContent = 'Sound is unavailable in this browser. The visual pattern still plays, and you can hear it in the Android app.';
    soundEnabled = false;
    soundButton.setAttribute('aria-pressed', 'false');
    soundButton.querySelector('span').textContent = 'Sound off';
  }
  if (token !== generation || document.hidden) { releaseAudio(playback.audio); return; }
  starting = false;
  run = playback;
  run.started = performance.now() + 25;
  signal.querySelectorAll('.is-sent').forEach(mark => mark.classList.remove('is-sent'));
  [...track.children].forEach(letter => letter.classList.remove('is-sent', 'is-live'));
  moveTape(0);
  receipt.textContent = 'Listening…';
  receiptStatus.textContent = 'The dots and dashes are becoming words.';
  receiptProgress.textContent = 'RECEIVING THE DEMO';
  preview.textContent = 'Listening…';
  status.textContent = playback.soundUnavailable ? 'Sound is unavailable here. The visual signal is playing.' : `Playing your message at ${timing.wpm} WPM. Press Stop to end it.`;
  frame = requestAnimationFrame(tick);
}

$('#demo').addEventListener('submit', event => { event.preventDefault(); play(); });
input.addEventListener('input', renderMessage);
speed.addEventListener('change', () => { renderMessage(); closeOptions(); });
soundButton.addEventListener('click', () => { setSound(!soundEnabled); closeOptions(); });
$('#clear-message').addEventListener('click', () => { input.value = ''; renderMessage(); input.focus(); });
replayButtons.forEach(button => button.addEventListener('click', play));
channelButtons.forEach(button => button.addEventListener('click', () => {
  channel = button.dataset.channel;
  channelButtons.forEach(choice => choice.setAttribute('aria-pressed', String(choice === button)));
  $('#channel-panel').dataset.channel = channel;
  $('#channel-title').textContent = channels[channel][0];
  $('#channel-description').textContent = channels[channel][1];
  if (channel === 'sound') setSound(true);
}));
document.addEventListener('visibilitychange', () => { if (document.hidden && (run || starting)) finish(false, 'Signal stopped while the page was in the background. Send again when you are ready.'); });
window.addEventListener('pagehide', () => { if (run || starting) finish(false); });
window.addEventListener('resize', () => { fitSignal(); moveTape(run?.letter || 0); });
options.addEventListener('keydown', event => { if (event.key === 'Escape') closeOptions(); });
document.addEventListener('pointerdown', event => { if (options.open && !options.contains(event.target)) options.open = false; });
renderMessage();
document.fonts.ready.then(() => { fitSignal(); moveTape(0); });
