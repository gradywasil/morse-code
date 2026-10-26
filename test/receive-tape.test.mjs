import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createReceiveSession } from '../js/receive-session.js';
import { translate } from '../js/morse.js';
import { schedule } from '../js/schedule.js';

// Execute the shipped tape and event handler, with only their DOM calls stubbed.
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
class Element {
  children = [];
  className = '';
  textContent = '';
  clientWidth = 390;
  style = { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } };
  append(...children) { children.forEach(child => this.appendChild(child)); }
  appendChild(child) { this.children.push(child); child.parentElement = this; }
  querySelector(selector) { return this.children.find(child => child.className.split(' ').includes(selector.slice(1))); }
  set innerHTML(value) { assert.equal(value, ''); this.children = []; }
}
function makeTape() {
  const strip = new Element();
  strip.parentElement = new Element();
  const context = vm.createContext({
    document: { createElement: () => new Element() }, rxStrip: strip,
    rxMachine: { state: 'active' }, RECEIVE_STATES: { ARMED: 'armed' },
    firePulse() {}, renderRx() {}, requestTranscript() {}, announceRxBurst() {}, announceRxWord() {},
  });
  vm.runInContext(app.slice(app.indexOf('const RX_PUNCH ='), app.indexOf('// -- announcements')), context);
  vm.runInContext(app.slice(app.indexOf('function onSessionEvent('), app.indexOf('// -- receive render')), context);
  context.rxResetTapeDom();
  return { strip, event: context.onSessionEvent };
}

test('live ticker keeps the newest received letter inside the visible tape', () => {
  const { strip, event } = makeTape();
  for (let i = 0; i < 20; i++) {
    event({ type: 'mark', mark: 'dash' });
    event({ type: 'letter', known: true, char: 'T', marks: ['dash'] });
    const latest = strip.children.at(-1);
    const shift = parseFloat(strip.style['--strip-shift'] || '0');
    const center = 390 / 2 + parseFloat(latest.style.left) - shift + parseFloat(latest.style.width) / 2;
    assert.ok(center >= 0 && center <= 390, `letter ${i} moved outside the tape: x=${center}`);
  }
});

test('live ticker reconstructs the opening H from buffered marks without merging letters', () => {
  const { strip, event } = makeTape();
  const session = createReceiveSession({ onEvent: e => { if (['mark', 'letter', 'word', 'replay-start'].includes(e.type)) event(e); } });
  const { events } = schedule(translate('HELLO ROOM').tokens, 'LEARNER');
  for (let i = 1; i < events.length; i++) {
    const ms = events[i].tMs - events[i - 1].tMs;
    if (events[i].on) session.feedGap(ms, events[i].tMs);
    else session.feedMark(ms, events[i].tMs);
  }
  const opening = strip.children[0];
  assert.equal(opening.querySelector('.tg-char').textContent, 'H');
  assert.equal(opening.querySelector('.tg-marks').children.length, 4);
  assert.equal(strip.children[1].querySelector('.tg-marks').children.length, 1);
});
