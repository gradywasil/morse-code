// test/screen.test.mjs — F4 validation (headless: minimal DOM + rAF stubs).
// Run: `node --test test/screen.test.mjs`
//
// F4 is a DOM module, so its logic is tested against a dependency-free
// stub: just enough document (createElement/getElementById/append/
// fullscreen hooks) and a manually-pumped requestAnimationFrame to make
// the "next frame" observable. Everything headlessly checkable is checked:
// the overlay state machine, class toggling, frame coalescing under rapid
// fire, attach/destroy lifecycle, fullscreen degradation paths, the
// injected layout/pointer CSS, and the two documented stances
// (prefers-reduced-motion ignored by design; overlay never intercepts
// pointers). Real-device behavior (paint, iOS Safari viewport, actual
// fullscreen chrome) is Q3's scripted check via harness.html.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createScreenChannel,
  POINTER_POLICY,
  OVERLAY_Z_INDEX,
  SCREEN_CLASSES,
} from '../js/screen.js';

// ---------------------------------------------------------------------------
// Stubs (tiny, dependency-free)

/** Element stub: classList over a Set (so external classes coexist),
 *  append/remove bookkeeping, attributes. No layout — that is asserted
 *  against the injected CSS text instead, which is where layout lives. */
function createDocStub({ fullscreenApi = 'modern' } = {}) {
  const ids = new Map();
  const listeners = new Map();

  function makeElement(tagName) {
    const classes = new Set();
    const el = {
      tagName,
      id: '',
      textContent: '',
      style: {},
      attributes: {},
      parentNode: null,
      children: [],
      classList: {
        add: (...names) => names.forEach((n) => classes.add(n)),
        remove: (...names) => names.forEach((n) => classes.delete(n)),
        contains: (n) => classes.has(n),
      },
      setAttribute(key, value) {
        el.attributes[key] = String(value);
      },
      getAttribute(key) {
        return key in el.attributes ? el.attributes[key] : null;
      },
      appendChild(child) {
        child.parentNode = el;
        el.children.push(child);
        if (child.id) ids.set(child.id, child);
        return child;
      },
      removeChild(child) {
        child.parentNode = null;
        const i = el.children.indexOf(child);
        if (i >= 0) el.children.splice(i, 1);
      },
      remove() {
        if (el.parentNode) el.parentNode.removeChild(el);
      },
    };
    Object.defineProperty(el, 'className', {
      get: () => [...classes].join(' '),
    });
    return el;
  }

  const documentElement = makeElement('html');
  const head = makeElement('head');
  const body = makeElement('body');
  documentElement.appendChild(head);
  documentElement.appendChild(body);

  const doc = {
    _created: [], // every createElement — the tests' element registry
    _exitCalls: 0,
    createElement(tag) {
      const el = makeElement(tag);
      doc._created.push(el);
      return el;
    },
    getElementById: (id) => ids.get(id) ?? null,
    documentElement,
    head,
    body,
    fullscreenElement: null,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const l = listeners.get(type);
      if (l) {
        const i = l.indexOf(fn);
        if (i >= 0) l.splice(i, 1);
      }
    },
    dispatch(type) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
    exitFullscreen: async () => {
      doc._exitCalls += 1;
      doc.fullscreenElement = null;
    },
    // STANCE GUARD: screen.js must never consult matchMedia — the flash is
    // the product and is deliberately not dimmed under prefers-reduced-motion
    // (documented stance in js/screen.js). If the module regresses, this throws.
    matchMedia() {
      throw new Error('screen.js must not consult matchMedia — the flash is the product');
    },
  };

  if (fullscreenApi === 'modern') {
    documentElement.requestFullscreen = async () => {
      doc.fullscreenElement = documentElement;
    };
  } else if (fullscreenApi === 'legacy') {
    // Old WebKit: prefixed, returns undefined (no promise).
    documentElement.webkitRequestFullscreen = function () {
      doc.fullscreenElement = documentElement;
    };
  }
  // 'none' → iPhone-Safari-like: no element fullscreen at all.

  return doc;
}

/** rAF stub with a manual pump: frame() runs the callbacks scheduled so far
 *  (callbacks scheduled DURING a frame land on the next frame()). */
function createRafStub() {
  let nextId = 0;
  const queue = new Map();
  return {
    raf(cb) {
      const id = ++nextId;
      queue.set(id, cb);
      return id;
    },
    caf(id) {
      return queue.delete(id);
    },
    frame() {
      const cbs = [...queue.values()];
      queue.clear();
      for (const cb of cbs) cb();
    },
    get pending() {
      return queue.size;
    },
  };
}

/** A channel wired to fresh stubs. */
function makeChannel(docOpts = {}, channelOpts = {}) {
  const doc = createDocStub(docOpts);
  const r = createRafStub();
  const channel = createScreenChannel({ doc, raf: r.raf, caf: r.caf, ...channelOpts });
  return { channel, doc, raf: r };
}

/** Fire a transition and pump exactly one frame (the common test rhythm). */
async function fire(channel, raf, method) {
  const p = channel[method]();
  raf.frame();
  await p;
}

const overlaysInDom = (doc) => doc.body.children.filter((el) => el.classList.contains(SCREEN_CLASSES.overlay));
const styleTagsInDom = (doc) => doc.head.children.filter((el) => el.tagName === 'style');
const cssText = (doc) => styleTagsInDom(doc)[0]?.textContent ?? '';
/** CSS with comments stripped — assertions target the rules, not the prose. */
const cssRules = (doc) => cssText(doc).replace(/\/\*[\s\S]*?\*\//g, '');

// ---------------------------------------------------------------------------

describe('F4 · module surface & policy exports', () => {
  test('POINTER_POLICY: overlay never intercepts pointers; z-index exported for layering above', () => {
    assert.ok(Object.isFrozen(POINTER_POLICY));
    assert.equal(POINTER_POLICY.overlayInterceptsPointerEvents, false);
    assert.equal(POINTER_POLICY.overlayZIndex, OVERLAY_Z_INDEX);
    assert.equal(typeof OVERLAY_Z_INDEX, 'number');
    assert.ok(typeof POINTER_POLICY.escapeControls === 'string' && POINTER_POLICY.escapeControls.length > 0);
    assert.ok(typeof POINTER_POLICY.rationale === 'string' && POINTER_POLICY.rationale.length > 0);
    assert.ok(Object.isFrozen(SCREEN_CLASSES));
    assert.deepEqual(
      { ...SCREEN_CLASSES },
      { overlay: 'mcb-screen-overlay', lit: 'mcb-lit', dark: 'mcb-dark' }
    );
  });

  test('injected CSS carries the no-layout-shift + pointer-policy + paint-only guarantees', async () => {
    const { channel, doc } = makeChannel();
    await channel.attach();
    const css = cssRules(doc);
    // out-of-flow, viewport-pinned via four longhands (older iOS has no `inset`)
    assert.match(css, /position:\s*fixed/);
    assert.match(css, /top:\s*0/);
    assert.match(css, /right:\s*0/);
    assert.match(css, /bottom:\s*0/);
    assert.match(css, /left:\s*0/);
    // pointer policy + layering contract, exactly at the exported z-index
    assert.match(css, /pointer-events:\s*none/);
    assert.match(css, new RegExp(`z-index:\\s*${OVERLAY_Z_INDEX}[^0-9]`));
    // standby = display:none (no box at all → zero layout impact)
    assert.match(css, /display:\s*none/);
    // states: pure white / pure black
    assert.match(css, /background:\s*#fff/);
    assert.match(css, /background:\s*#000/);
    assert.ok(css.includes(`.${SCREEN_CLASSES.lit}`) && css.includes(`.${SCREEN_CLASSES.dark}`));
    // no fading: transitions/animations would blur mark boundaries and
    // break next-frame timing (and would be motion the flash never asked for)
    assert.doesNotMatch(css, /transition|animation|@media/);
  });

  test('attach() installs one overlay div on <body>, aria-hidden for AT', async () => {
    const { channel, doc } = makeChannel();
    await channel.attach();
    const els = overlaysInDom(doc);
    assert.equal(els.length, 1);
    assert.equal(els[0].tagName, 'div');
    assert.equal(els[0].className, SCREEN_CLASSES.overlay); // no state class yet
    assert.equal(els[0].getAttribute('aria-hidden'), 'true');
  });
});

describe('F4 · attach lifecycle', () => {
  test('attach() is idempotent: same element, single style tag, no reset', async () => {
    const { channel, doc } = makeChannel();
    await channel.attach();
    const first = overlaysInDom(doc)[0];
    const res = await channel.attach();
    assert.equal(overlaysInDom(doc).length, 1);
    assert.equal(overlaysInDom(doc)[0], first);
    assert.equal(styleTagsInDom(doc).length, 1);
    assert.deepEqual(res, { fullscreen: true }); // live read after the first attach
  });

  test('no DOM (plain Node) → attach() rejects with a descriptive error', async () => {
    const channel = createScreenChannel(); // no doc/raf/caf in Node
    await assert.rejects(channel.attach(), /no DOM available/);
  });

  test('on/off/hide before attach() throw synchronously (wiring bug, not runtime)', () => {
    const { channel } = makeChannel();
    assert.throws(() => channel.on(), /attach\(\) before on\(\)/);
    assert.throws(() => channel.off(), /attach\(\) before off\(\)/);
    assert.throws(() => channel.hide(), /attach\(\) before hide\(\)/);
    assert.deepEqual(channel.status(), {
      attached: false, desired: null, applied: null, pendingFrame: false, fullscreen: false,
    });
  });

  test('iPhone-Safari-like (no fullscreen API): silent degrade to plain overlay', async () => {
    const { channel, doc } = makeChannel({ fullscreenApi: 'none' });
    const res = await channel.attach();
    assert.deepEqual(res, { fullscreen: false });
    assert.equal(overlaysInDom(doc).length, 1); // the flash still works
    assert.equal(channel.status().fullscreen, false);
  });

  test('modern fullscreen: granted → {fullscreen:true}; requested synchronously (gesture window)', async () => {
    const doc = createDocStub({ fullscreenApi: 'modern' });
    const r = createRafStub();
    let syncPhase = true;
    let calledDuringSyncPhase = false;
    doc.documentElement.requestFullscreen = async () => {
      if (syncPhase) calledDuringSyncPhase = true;
      doc.fullscreenElement = doc.documentElement;
    };
    const channel = createScreenChannel({ doc, raf: r.raf, caf: r.caf });
    const p = channel.attach(); // NOT awaited yet
    syncPhase = false;
    assert.ok(calledDuringSyncPhase, 'requestFullscreen must be called before attach() first awaits');
    assert.equal((await p).fullscreen, true);
    assert.equal(channel.status().fullscreen, true);
  });

  test('fullscreen denied/rejected → {fullscreen:false}, overlay still attached, no crash', async () => {
    const doc = createDocStub();
    doc.documentElement.requestFullscreen = () => Promise.reject(new Error('NotAllowedError'));
    const r = createRafStub();
    const channel = createScreenChannel({ doc, raf: r.raf, caf: r.caf });
    const res = await channel.attach();
    assert.deepEqual(res, { fullscreen: false });
    assert.equal(overlaysInDom(doc).length, 1);
  });

  test('legacy -webkit-requestFullscreen is used when the modern API is absent', async () => {
    const { channel, doc } = makeChannel({ fullscreenApi: 'legacy' });
    const res = await channel.attach();
    assert.deepEqual(res, { fullscreen: true }); // optimistic; events are the truth
    assert.equal(doc.fullscreenElement, doc.documentElement);
    assert.equal(channel.status().fullscreen, true);
  });

  test('options.fullscreen:false never requests fullscreen', async () => {
    const { channel, doc } = makeChannel({ fullscreenApi: 'modern' }, { fullscreen: false });
    const res = await channel.attach();
    assert.deepEqual(res, { fullscreen: false });
    assert.equal(doc.fullscreenElement, null);
    assert.equal(overlaysInDom(doc).length, 1);
  });
});

describe('F4 · on/off next-frame semantics', () => {
  test('on(): nothing before the frame; white class after exactly one rAF; promise resolves post-application', async () => {
    const { channel, doc, raf } = makeChannel();
    await channel.attach();
    const el = overlaysInDom(doc)[0];
    const p = channel.on();
    assert.equal(raf.pending, 1); // exactly one frame scheduled
    assert.equal(el.classList.contains(SCREEN_CLASSES.lit), false); // not yet
    assert.equal(channel.isLit(), false);
    raf.frame(); // the next rendering opportunity
    await p;
    assert.equal(el.className, `${SCREEN_CLASSES.overlay} ${SCREEN_CLASSES.lit}`);
    assert.equal(channel.isLit(), true);
    assert.equal(raf.pending, 0);
  });

  test('off(): black class replaces white; exact class strings at every state', async () => {
    const { channel, doc, raf } = makeChannel();
    await channel.attach();
    const el = overlaysInDom(doc)[0];
    await fire(channel, raf, 'on');
    assert.equal(el.className, `${SCREEN_CLASSES.overlay} ${SCREEN_CLASSES.lit}`);
    await fire(channel, raf, 'off');
    assert.equal(el.className, `${SCREEN_CLASSES.overlay} ${SCREEN_CLASSES.dark}`);
    await fire(channel, raf, 'hide');
    assert.equal(el.className, SCREEN_CLASSES.overlay); // display:none via base class
  });

  test('idempotent no-ops when already in the target state: no frame scheduled, promise resolves', async () => {
    const { channel, raf } = makeChannel();
    await channel.attach();
    await fire(channel, raf, 'on');
    await channel.on(); // already lit and applied
    assert.equal(raf.pending, 0);
    await fire(channel, raf, 'off');
    await channel.off(); // already dark and applied
    assert.equal(raf.pending, 0);
  });

  test('off() before the first on() is a no-op: carrier NOT raised, no frame', async () => {
    const { channel, doc, raf } = makeChannel();
    await channel.attach();
    await channel.off();
    assert.equal(raf.pending, 0);
    const el = overlaysInDom(doc)[0];
    assert.equal(el.className, SCREEN_CLASSES.overlay); // still hidden (display:none)
  });

  test('on();off() within one frame: single frame, latest state (dark) wins, both promises resolve', async () => {
    const { channel, doc, raf } = makeChannel();
    await channel.attach();
    const p1 = channel.on();
    const p2 = channel.off();
    assert.equal(raf.pending, 1); // coalesced — not two frames
    raf.frame();
    await Promise.all([p1, p2]); // superseded call still resolves (never hangs)
    const el = overlaysInDom(doc)[0];
    assert.equal(el.className, `${SCREEN_CLASSES.overlay} ${SCREEN_CLASSES.dark}`);
  });

  test('on();off();on() within one frame: final state lit', async () => {
    const { channel, doc, raf } = makeChannel();
    await channel.attach();
    const promises = [channel.on(), channel.off(), channel.on()];
    assert.equal(raf.pending, 1);
    raf.frame();
    await Promise.all(promises);
    assert.equal(overlaysInDom(doc)[0].className, `${SCREEN_CLASSES.overlay} ${SCREEN_CLASSES.lit}`);
  });

  test('on();hide() within one frame: hidden wins (carrier never visibly rose)', async () => {
    const { channel, doc, raf } = makeChannel();
    await channel.attach();
    const p1 = channel.on();
    const p2 = channel.hide();
    raf.frame();
    await Promise.all([p1, p2]);
    assert.equal(overlaysInDom(doc)[0].className, SCREEN_CLASSES.overlay);
  });

  test('pending frame always applies the LATEST desired state (lit → hide → on before the frame)', async () => {
    const { channel, doc, raf } = makeChannel();
    await channel.attach();
    await fire(channel, raf, 'on'); // applied lit
    const ph = channel.hide(); // frame scheduled to hide…
    const po = channel.on(); // …but superseded back to lit before it ran
    raf.frame();
    await Promise.all([ph, po]);
    const el = overlaysInDom(doc)[0];
    assert.equal(el.className, `${SCREEN_CLASSES.overlay} ${SCREEN_CLASSES.lit}`);
    assert.equal(channel.isLit(), true);
  });

  test('status() narrates the transition frame-accurately', async () => {
    const { channel, raf } = makeChannel({ fullscreenApi: 'none' });
    await channel.attach();
    const p = channel.on();
    assert.deepEqual(channel.status(), {
      attached: true, desired: 'lit', applied: null, pendingFrame: true, fullscreen: false,
    });
    raf.frame();
    await p;
    assert.deepEqual(channel.status(), {
      attached: true, desired: 'lit', applied: 'lit', pendingFrame: false, fullscreen: false,
    });
  });

  test('app-added classes survive state toggles (classList-based, never clobbers className)', async () => {
    const { channel, doc, raf } = makeChannel();
    await channel.attach();
    const el = overlaysInDom(doc)[0];
    el.classList.add('app-own-class');
    await fire(channel, raf, 'on');
    await fire(channel, raf, 'off');
    await fire(channel, raf, 'hide');
    assert.ok(el.classList.contains('app-own-class'));
  });
});

describe('F4 · rapid-fire async safety', () => {
  test('a 60-call synchronous burst coalesces into ONE frame; last call wins; all resolve', async () => {
    const { channel, doc, raf } = makeChannel();
    await channel.attach();
    const promises = [];
    for (let i = 0; i < 60; i++) {
      promises.push(i % 2 === 0 ? channel.on() : channel.off());
    }
    assert.equal(raf.pending, 1); // the whole burst rides one frame
    raf.frame();
    await Promise.all(promises);
    assert.equal(promises.length, 60);
    assert.equal(overlaysInDom(doc)[0].className, `${SCREEN_CLASSES.overlay} ${SCREEN_CLASSES.dark}`); // call #59 was off()
    assert.equal(raf.pending, 0);
  });

  test('awaited on/off alternation applies strictly: lit, dark, lit, dark…', async () => {
    const { channel, raf } = makeChannel();
    await channel.attach();
    for (let i = 0; i < 5; i++) {
      await fire(channel, raf, 'on');
      assert.equal(channel.isLit(), true);
      await fire(channel, raf, 'off');
      assert.equal(channel.isLit(), false);
    }
  });
});

describe('F4 · destroy & re-attach', () => {
  test('destroy(): removes the element, cancels the pending frame, unhangs waiters', async () => {
    const { channel, doc, raf } = makeChannel();
    await channel.attach();
    const p = channel.on(); // frame scheduled, not yet run
    await channel.destroy();
    await p; // resolves (never rejects) — callers awaiting on() cannot hang
    assert.equal(raf.pending, 0); // the frame was cancelled, not run
    assert.equal(overlaysInDom(doc).length, 0);
    assert.deepEqual(channel.status(), {
      attached: false, desired: null, applied: null, pendingFrame: false, fullscreen: false,
    });
    assert.throws(() => channel.on(), /attach\(\) before on\(\)/);
  });

  test('destroy() exits fullscreen when active — and only then', async () => {
    const on = makeChannel({ fullscreenApi: 'modern' });
    await on.channel.attach();
    assert.equal(on.doc._exitCalls, 0);
    await on.channel.destroy();
    assert.equal(on.doc._exitCalls, 1);
    assert.equal(on.channel.status().fullscreen, false);

    const off = makeChannel({ fullscreenApi: 'none' }); // never fullscreen
    await off.channel.attach();
    await off.channel.destroy();
    assert.equal(off.doc._exitCalls, 0);
  });

  test('destroy() unbinds fullscreenchange listeners (no callback afterwards)', async () => {
    const events = [];
    const { channel, doc } = makeChannel({}, { onFullscreenChange: (fs) => events.push(fs) });
    await channel.attach();
    doc.fullscreenElement = null; // user pressed Esc mid-broadcast
    doc.dispatch('fullscreenchange');
    assert.deepEqual(events, [false]);
    await channel.destroy();
    doc.dispatch('fullscreenchange');
    assert.deepEqual(events, [false]); // no second event — unbound
  });

  test('re-attach after destroy(): fresh element, style not duplicated, channel works again', async () => {
    const { channel, doc, raf } = makeChannel();
    await channel.attach();
    await channel.destroy();
    const res = await channel.attach();
    assert.deepEqual(res, { fullscreen: true }); // fsAttempt was reset → asked again
    assert.equal(overlaysInDom(doc).length, 1);
    assert.equal(styleTagsInDom(doc).length, 1);
    await fire(channel, raf, 'on');
    assert.equal(channel.isLit(), true);
  });

  test('destroy() before attach(): clean no-op', async () => {
    const { channel, raf } = makeChannel();
    await channel.destroy();
    assert.equal(raf.pending, 0);
    assert.equal(channel.status().attached, false);
  });
});

describe('F4 · documented stances', () => {
  test('prefers-reduced-motion is deliberately NOT consulted; flash fires at full contrast', async () => {
    // createDocStub().matchMedia throws if called — the stance as an invariant.
    const { channel, doc, raf } = makeChannel();
    await channel.attach();
    await fire(channel, raf, 'on');
    const el = overlaysInDom(doc)[0];
    assert.ok(el.classList.contains(SCREEN_CLASSES.lit)); // undimmed
    assert.match(cssRules(doc), /background:\s*#fff/); // pure white
    assert.doesNotMatch(cssRules(doc), /@media/); // and no reduced-motion carve-out in the rules
  });

  test('fullscreenchange is observable by F6 (Esc exit mid-broadcast)', async () => {
    const events = [];
    const { channel, doc } = makeChannel({}, { onFullscreenChange: (fs) => events.push(fs) });
    await channel.attach();
    doc.fullscreenElement = null;
    doc.dispatch('fullscreenchange');
    doc.fullscreenElement = doc.documentElement;
    doc.dispatch('fullscreenchange');
    assert.deepEqual(events, [false, true]);
    assert.equal(channel.status().fullscreen, true); // status reads the document live
  });
});
