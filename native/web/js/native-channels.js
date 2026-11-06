import { registerPlugin } from '../capacitor.js';
import { installNativeOnboarding } from './native-onboarding.js';
import { createWatcher as createBrightnessWatcher } from './watcher.js';
import { createNativeTorchChannel, createNativeFrameSource, NATIVE_CONTRAST_GATE } from './native-channel-core.js';

const hardware = registerPlugin('MorseHardware');
installNativeOnboarding(hardware);
// The WebView's Vibration API is not dependable; key each mark through the app.
navigator.vibrate = (pattern) => {
  const ms = Array.isArray(pattern) ? Number(pattern[0]) || 0 : Number(pattern) || 0;
  hardware.vibrate({ ms }).catch(error => console.warn('Morse haptics:', error?.message ?? error));
  return true;
};
export const createTorchChannel = () => createNativeTorchChannel(hardware);

// The window's keep-screen-on flag; the WebView's wake lock is not dependable.
export function createScreenAwake() {
  let held = false;
  return {
    set(wanted) {
      if (Boolean(wanted) === held) return;
      held = Boolean(wanted);
      hardware.keepScreenOn({ on: held }).catch(() => { held = !held; });
    },
    isHeld: () => held,
  };
}

// The native build keeps the received log and display preferences on the device.
export function createDeviceStore() {
  const safe = (action, fallback) => { try { return action(); } catch { return fallback; } };
  return {
    persistent: true,
    get: key => safe(() => localStorage.getItem(`morse.${key}`), null),
    set: (key, value) => safe(() => localStorage.setItem(`morse.${key}`, String(value))),
    remove: key => safe(() => localStorage.removeItem(`morse.${key}`)),
  };
}
export const createWatcher = options => createBrightnessWatcher({
  ...options, contrastGate: NATIVE_CONTRAST_GATE,
  frameSource: createNativeFrameSource(hardware, options.video),
});

document.addEventListener('click', event => {
  if (event.target.closest('[data-native-settings]')) hardware.openSettings().catch(() => {});
});

// The camera preview is a native view above the page, so web dialogs cannot cover
// it. Hide it whenever a dialog is open and bring it back when the last one closes.
let previewHidden = false;
const syncPreview = () => {
  const hidden = document.querySelector('dialog[open]') !== null;
  if (hidden === previewHidden) return;
  previewHidden = hidden;
  hardware.setPreviewHidden({ hidden }).catch(() => {});
};
const showModal = HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal = function () { showModal.call(this); syncPreview(); };
document.addEventListener('close', syncPreview, true);
document.addEventListener('cancel', () => setTimeout(syncPreview, 0), true);

// Status-bar and navigation-bar icons follow the theme (dark icons on a light theme).
window.morseNativeSystemBars = light => hardware.setSystemBars({ light: Boolean(light) }).catch(() => {});

window.morseNativeBack = () => {
  const dialog = document.querySelector('dialog[open]');
  if (dialog) {
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    if (dialog.open) dialog.close();
    return true;
  }
  if (document.body.dataset.mode === 'receive') {
    const stop = document.querySelector('[data-action="stop-listening"]');
    if (stop?.getClientRects().length) { stop.click(); return true; }
  }
  return false;
};
