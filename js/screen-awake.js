// js/screen-awake.js — keep the phone awake while the app is mid-run.
//
// A phone with a short auto-lock window sleeps in the middle of a message:
// the receiver's camera stops hearing, or the broadcast goes dark. The app
// holds the screen awake from the moment a run is committed (or the camera
// is listening) until it ends, then lets go so battery and burn-in rules
// return to normal.
//
// Web build: the Screen Wake Lock API. The browser drops that lock whenever
// the page is hidden, so it is re-requested when the page comes back while a
// hold is still wanted. Where the API is missing or refuses, the hold is
// silently a no-op — the app works exactly as before, it just may sleep.
// The native Android build swaps this module for the window keep-screen-on
// flag (native-channels.js exports the same createScreenAwake).

/**
 * @param {{nav?: object, doc?: object}} [options] injectable for tests
 * @returns {{set: (wanted: boolean) => void, isHeld: () => boolean}}
 */
export function createScreenAwake({ nav = globalThis.navigator, doc = globalThis.document } = {}) {
  let wanted = false;
  let lock = null;
  let requesting = false;

  async function acquire() {
    if (!wanted || lock || requesting) return;
    if (typeof nav?.wakeLock?.request !== 'function' || doc?.visibilityState === 'hidden') return;
    requesting = true;
    try {
      const granted = await nav.wakeLock.request('screen');
      if (!wanted) {
        Promise.resolve(granted.release()).catch(() => {}); // the run ended while we waited
      } else {
        lock = granted;
        granted.addEventListener?.('release', () => { if (lock === granted) lock = null; });
      }
    } catch { /* refused (battery saver, no support): the screen may sleep */ }
    requesting = false; // a refusal is not retried in a loop
  }

  doc?.addEventListener?.('visibilitychange', () => {
    if (doc.visibilityState === 'visible') void acquire();
  });

  return {
    set(next) {
      wanted = Boolean(next);
      if (wanted) void acquire();
      else if (lock) {
        const held = lock;
        lock = null;
        Promise.resolve(held.release()).catch(() => {});
      }
    },
    isHeld: () => lock !== null,
  };
}
