// js/screen.js — Screen-flash channel: the every-device light.
//
// Task F4 of docs/ultron/plan.md. One fixed-position overlay element that
// paints the whole viewport white (mark) or black (gap) with next-frame
// accurate on/off timing. DOM-only — no camera, no permission prompt, no
// frames read (privacy scope) — so this is the fallback that can never be
// denied, first-class per the plan ("screen-flash everywhere"). Plain ES
// module. In Node it imports cleanly but needs a DOM to attach: pass
// `{ doc, raf, caf }` stubs — exactly what test/screen.test.mjs does.
//
// Channel shape (drop-in alongside F3 torch / F5 audio for the F6 conductor):
//
//   const screen = createScreenChannel();
//   await screen.attach();   // install overlay (call inside the Broadcast
//                            // gesture: fullscreen needs user activation;
//                            // silently plain-overlay otherwise)
//   screen.on();             // → white on the next frame
//   screen.off();            // → black on the next frame
//   await screen.hide();     // carrier down: app visible again between
//                            // broadcasts (fullscreen is KEPT so replay
//                            // needs no new gesture)
//   await screen.destroy();  // teardown: element removed, fullscreen
//                            // exited, listeners unbound
//
// Timing contract (F6): on()/off() mutate the DOM inside a
// requestAnimationFrame callback; mutations during the rAF callback are
// rendered by that same rendering opportunity, so the paint lands on the
// NEXT frame after the call — ≈1 frame (≤16.7 ms at 60 Hz) of latency,
// inside R2's SYNC_TOLERANCE_MS = 45. Fire at the exact event tMs and
// accept the sub-frame lag, or lead by one frame. Each call returns a
// promise that resolves INSIDE the applying callback — after the DOM
// mutation, before that frame's paint. R2 §committed: "screen overlay
// toggles at tMs (≈1 frame ≈17 ms lag, within tolerance)".
//
// Async-safety: on/off/hide are desired-state commands, coalesced per
// frame. However rapidly they are called, at most ONE frame is pending;
// that frame applies the LATEST desired state; every call's promise
// resolves once its carrying frame ran (a call superseded within the same
// frame still resolves — nothing hangs, the newest state wins). Hidden
// tabs suspend rAF, so a pending promise waits until the tab is visible
// again — F6's visibilitychange pause (per R2) is the paired mechanism.
// on()/off()/hide() before attach() or after destroy() throw
// SYNCHRONOUSLY: that is a wiring bug, not a runtime condition. After a
// successful attach(), channel promises never reject (fullscreen failures
// included — they degrade silently).
//
// attach() installs the overlay element synchronously, before its first
// await; only the fullscreen attempt resolves asynchronously. Calling
// on() in the same task as attach() is therefore safe.
//
// Pointer-events policy (exported as POINTER_POLICY; consumed by F6/I2):
//   the overlay NEVER intercepts pointer events — `pointer-events: none`
//   in every state (lit, dark, hidden). Rationale: a user who must stop a
//   broadcast has to be able to tap STOP at any instant; a click-hungry
//   black viewport would trap them (Esc only helps in fullscreen, only on
//   devices with a keyboard). The one INTENTIONAL exception is layering,
//   not interception: mid-broadcast controls render ABOVE the overlay
//   (z-index > POINTER_POLICY.overlayZIndex, exported) and stay tappable
//   straight through the flashes.
//
// Fullscreen: requested on `document.documentElement` (the whole app goes
// fullscreen, overlay rides above it) synchronously inside attach(), so
// the user gesture is still alive. Where the Fullscreen API is missing or
// denied — notably iPhone Safari, where element fullscreen is restricted
// to <video> — the channel degrades SILENTLY to the plain overlay; the
// fixed-position + four-inset-longhand styling already covers the visual
// viewport there, and callers need no feature-detect branching. Legacy
// WebKit prefix (-webkit-requestFullscreen) is used when present; the
// legacy call returns no promise, so its result is optimistic and
// fullscreenchange events (surfaced via the onFullscreenChange option and
// status().fullscreen, both read live from the document) are the truth.
//
// Layout (AC: no scroll/layout shift, ever): the overlay is out-of-flow
// (`position: fixed`, all four insets 0 — longhands, since older iOS
// lacks the `inset` shorthand) and `display: none` while standby, so
// installing or flashing it cannot reflow the page; state changes swap
// classes only, and background-color changes are paint-only.
//
// prefers-reduced-motion — DESIGN STANCE (deliberate, documented here and
// on SCREEN_CSS): the flash IS the product; it carries the message. This
// module does not consult prefers-reduced-motion and does not dim, fade,
// or slow the broadcast — dimming the flash would erase the message
// itself. Photosafety is carried where it belongs: F2's speed guard
// (js/schedule.js — default LEARNER 5 WPM keeps sustained dots ≈2.08 Hz,
// under the 3 Hz WCAG 2.3.1 general-flash threshold; hard cap 12 WPM) and
// U1's pre-broadcast hazard plate. I3 honors reduced-motion for all
// DECORATIVE motion (tape advance, lamp pulse) instead. Q2 audits this
// split.

/** z-index occupied by the flash overlay. Intentional mid-broadcast controls
 *  (e.g. STOP) must render above this to stay reachable during flashes. */
export const OVERLAY_Z_INDEX = 2147483645;

/** State class names (I2/I3 may style or detect these; they are stable). */
export const SCREEN_CLASSES = Object.freeze({
  overlay: 'mcb-screen-overlay',
  lit: 'mcb-lit',
  dark: 'mcb-dark',
});

/**
 * Pointer-events policy of the screen channel — the contract F6 (conductor)
 * and I2 (UI) consume. The overlay never intercepts pointers in any state;
 * reachability of mid-broadcast controls is achieved purely by layering.
 */
export const POINTER_POLICY = Object.freeze({
  /** False in every state (lit, dark, hidden) — `pointer-events: none`. */
  overlayInterceptsPointerEvents: false,
  /** The z-index the overlay occupies (=== OVERLAY_Z_INDEX). */
  overlayZIndex: OVERLAY_Z_INDEX,
  escapeControls:
    'Render intentional mid-broadcast controls (e.g. STOP) at z-index > ' +
    'overlayZIndex and position them above the overlay; they stay tappable ' +
    'through the flashes because the overlay itself never intercepts pointers.',
  rationale:
    'A click-hungry overlay could trap a user inside a flashing broadcast; ' +
    'stopping must remain possible at every instant.',
});

/** Id of the injected <style> (idempotency key — one tag per document). */
const STYLE_ID = 'mcb-screen-style';

// Injected once per document so the channel is self-contained before I1's
// stylesheets exist. The stance comment lives in the CSS on purpose — it
// travels with the rules it explains.
const SCREEN_CSS = `/* F4 screen-flash overlay (js/screen.js).
   Layout safety: fixed + out-of-flow + four inset longhands (older iOS has
   no "inset" shorthand) -> attaching or flashing can never reflow the page;
   state changes swap background-color only (paint-only, no transitions:
   fading would blur mark boundaries and break next-frame timing).
   DESIGN STANCE (deliberate): the flash is the product — these rules do NOT
   dim, fade, or slow it under prefers-reduced-motion. Photosafety is carried
   by the speed guard in js/schedule.js (default LEARNER 5 WPM keeps
   sustained dots ~2.08 Hz, under the 3 Hz WCAG 2.3.1 general-flash
   threshold; hard cap 12 WPM) and the U1 hazard plate; I3's styles honor
   reduced-motion for all decorative motion instead. */
.${SCREEN_CLASSES.overlay}{position:fixed;top:0;right:0;bottom:0;left:0;z-index:${OVERLAY_Z_INDEX};display:none;background:#000;pointer-events:none;}
.${SCREEN_CLASSES.overlay}.${SCREEN_CLASSES.dark}{display:block;background:#000;}
.${SCREEN_CLASSES.overlay}.${SCREEN_CLASSES.lit}{display:block;background:#fff;}
`;

/**
 * Create a screen-flash channel. All DOM/timing globals are injectable for
 * the headless suite; defaults bind lazily-safe (typeof guards) so the
 * module imports cleanly in Node.
 *
 * @param {{
 *   doc?: Document,
 *   raf?: (cb: () => void) => number,
 *   caf?: (handle: number) => void,
 *   fullscreen?: boolean,
 *   trailingQuietMs?: number,
 *   onFullscreenChange?: (active: boolean) => void,
 * }} [options]
 *   - `doc`/`raf`/`caf`: DOM + frame scheduler (defaults: the globals).
 *   - `fullscreen: false` skips the Fullscreen API entirely (plain overlay).
 *   - `trailingQuietMs`: conductor's dark interval before hiding the carrier.
 *   - `onFullscreenChange` fires on fullscreenchange (incl. the user's Esc
 *     exit mid-broadcast) with the live fullscreen state.
 * @returns {{
 *   attach: () => Promise<{fullscreen: boolean}>,
 *   on: () => Promise<void>,
 *   off: () => Promise<void>,
 *   hide: () => Promise<void>,
 *   destroy: () => Promise<void>,
 *   isLit: () => boolean,
 *   status: () => {attached: boolean, desired: (null|'dark'|'lit'), applied: (null|'dark'|'lit'), pendingFrame: boolean, fullscreen: boolean},
 * }}
 */
export function createScreenChannel(options = {}) {
  const doc =
    options.doc ?? (typeof document === 'undefined' ? undefined : document);
  const raf =
    options.raf ??
    (typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame.bind(globalThis)
      : undefined);
  const caf =
    options.caf ??
    (typeof cancelAnimationFrame === 'function'
      ? cancelAnimationFrame.bind(globalThis)
      : undefined);
  const wantFullscreen = options.fullscreen !== false;
  const trailingQuietMs = options.trailingQuietMs ?? 0;
  if (!Number.isFinite(trailingQuietMs) || trailingQuietMs < 0 || trailingQuietMs > 10000) {
    throw new TypeError('screen trailingQuietMs must be between 0 and 10000');
  }
  const onFullscreenChange =
    typeof options.onFullscreenChange === 'function' ? options.onFullscreenChange : null;

  let overlayEl = null; // the flash element; null = detached (never attached / destroyed)
  let desired = null;   // null (hidden) | 'dark' | 'lit' — what the next frame will show
  let applied = null;   // what the DOM showed as of the last applied frame
  let frameHandle = null; // pending rAF id (null = none scheduled)
  let waiters = [];     // promise resolvers carried by the pending frame
  let fsAttempt = null; // memoized fullscreen attempt (reset by destroy)
  let fsListenersBound = false;

  /** Install the overlay (synchronously) and attempt fullscreen. Idempotent. */
  async function attach() {
    if (overlayEl) return { fullscreen: fullscreenNow() };
    if (!doc || typeof doc.createElement !== 'function') {
      throw new Error(
        'screen channel: no DOM available — attach() must run in a browser, ' +
          'or inject { doc, raf, caf } stubs for testing'
      );
    }
    if (typeof raf !== 'function' || typeof caf !== 'function') {
      throw new Error(
        'screen channel: requestAnimationFrame/cancelAnimationFrame unavailable'
      );
    }

    ensureStyle();
    overlayEl = doc.createElement('div');
    overlayEl.classList.add(SCREEN_CLASSES.overlay);
    // Decorative for AT: the flash duplicates what the audio channel and the
    // tape readout already carry (multimodal per PRODUCT.md).
    overlayEl.setAttribute('aria-hidden', 'true');
    (doc.body || doc.documentElement).appendChild(overlayEl);
    bindFullscreenListeners();

    if (wantFullscreen && fsAttempt === null) requestFullscreenQuietly();
    const fullscreen = await fsAttempt;
    return { fullscreen: Boolean(fullscreen) };
  }

  /** Desired-state command: white on the next frame (raises the carrier). */
  function on() {
    requireAttached('on()');
    desired = 'lit';
    return settle();
  }

  /** Desired-state command: black on the next frame. Never RAISES the
   *  carrier — before the first on() of a session it is a resolving no-op
   *  (no premature black screen; F2 schedules always open with on:true). */
  function off() {
    requireAttached('off()');
    if (desired === null) return Promise.resolve();
    desired = 'dark';
    return settle();
  }

  /** Desired-state command: carrier down — overlay display:none, app UI
   *  visible again. Fullscreen is kept so a replay needs no new gesture. */
  function hide() {
    requireAttached('hide()');
    desired = null;
    return settle();
  }

  /** Teardown: cancel pending frame, detach overlay, exit fullscreen if
   *  active, unbind listeners. Resolve (never reject) in-flight promises so
   *  callers awaiting on()/off() cannot hang. Re-attach afterwards works. */
  async function destroy() {
    if (frameHandle !== null) {
      caf(frameHandle);
      frameHandle = null;
    }
    flushWaiters();
    desired = null;
    applied = null;
    if (overlayEl) {
      if (typeof overlayEl.remove === 'function') overlayEl.remove();
      else if (overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
      overlayEl = null;
    }
    if (fullscreenNow()) {
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
      if (typeof exit === 'function') {
        try {
          await exit.call(doc);
        } catch {
          /* already leaving — nothing to do */
        }
      }
    }
    unbindFullscreenListeners();
    fsAttempt = null; // a later re-attach may request again (fresh gesture)
  }

  /** True iff the last APPLIED frame was lit (post-frame; not prospective). */
  function isLit() {
    return applied === 'lit';
  }

  /** Introspection for F6/I2 — the channel's whole observable state. */
  function status() {
    return {
      attached: overlayEl !== null,
      desired,
      applied,
      pendingFrame: frameHandle !== null,
      fullscreen: fullscreenNow(),
    };
  }

  // -------------------------------------------------------------------------
  // Internals

  function requireAttached(who) {
    if (!overlayEl) {
      throw new Error(
        `screen channel: attach() before ${who} — and re-attach after destroy()`
      );
    }
  }

  /** Resolve immediately when the DOM already shows the desired state and
   *  no frame is in flight; otherwise ride the (single) pending frame. */
  function settle() {
    if (frameHandle === null && applied === desired) return Promise.resolve();
    return new Promise((resolve) => {
      waiters.push(resolve);
      scheduleFrame();
    });
  }

  /** At most ONE frame pending at any time; it applies the LATEST desired. */
  function scheduleFrame() {
    if (frameHandle !== null) return;
    frameHandle = raf(() => {
      frameHandle = null;
      applyDesired();
      flushWaiters();
    });
  }

  function applyDesired() {
    if (!overlayEl) return; // destroyed mid-flight (frame already cancelled; belt+braces)
    const { lit, dark } = SCREEN_CLASSES;
    if (desired === 'lit') {
      overlayEl.classList.remove(dark);
      overlayEl.classList.add(lit);
    } else if (desired === 'dark') {
      overlayEl.classList.remove(lit);
      overlayEl.classList.add(dark);
    } else {
      overlayEl.classList.remove(lit, dark); // back to display:none via base class
    }
    applied = desired;
  }

  function flushWaiters() {
    const ws = waiters;
    waiters = [];
    for (const w of ws) w();
  }

  function ensureStyle() {
    if (typeof doc.getElementById === 'function' && doc.getElementById(STYLE_ID)) return;
    const styleEl = doc.createElement('style');
    styleEl.id = STYLE_ID;
    styleEl.textContent = SCREEN_CSS;
    (doc.head || doc.documentElement).appendChild(styleEl);
    // Kept for the document's lifetime (a re-attach reuses it): removing it
    // would race a re-attach, and it is inert without the overlay element.
  }

  /** Fullscreen on <html>, synchronously (user-gesture window), never
   *  throwing: missing API / denial / iPhone-Safari restriction all degrade
   *  silently to the plain overlay. */
  function requestFullscreenQuietly() {
    const root = doc.documentElement;
    const modern = root.requestFullscreen;
    const legacy = root.webkitRequestFullscreen;
    let request = null;
    if (typeof modern === 'function') {
      request = modern;
    } else if (typeof legacy === 'function') {
      request = legacy;
    }
    if (!request) {
      fsAttempt = Promise.resolve(false); // e.g. iPhone Safari: plain overlay
      return;
    }
    try {
      const ret = request.call(root);
      // modern: fulfilled → true, rejected → false. legacy: returns nothing
      // (undefined fulfills) → optimistic true; fullscreenchange events +
      // status().fullscreen remain the truth either way.
      fsAttempt = Promise.resolve(ret).then(
        () => true,
        () => false
      );
    } catch {
      fsAttempt = Promise.resolve(false);
    }
  }

  function fullscreenNow() {
    if (!doc) return false;
    return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null);
  }

  const onFsChange = () => {
    if (onFullscreenChange) onFullscreenChange(fullscreenNow());
  };

  function bindFullscreenListeners() {
    if (fsListenersBound || !doc || typeof doc.addEventListener !== 'function') return;
    doc.addEventListener('fullscreenchange', onFsChange);
    doc.addEventListener('webkitfullscreenchange', onFsChange);
    fsListenersBound = true;
  }

  function unbindFullscreenListeners() {
    if (!fsListenersBound || !doc || typeof doc.removeEventListener !== 'function') return;
    doc.removeEventListener('fullscreenchange', onFsChange);
    doc.removeEventListener('webkitfullscreenchange', onFsChange);
    fsListenersBound = false;
  }

  return { attach, on, off, hide, destroy, isLit, status, trailingQuietMs };
}
