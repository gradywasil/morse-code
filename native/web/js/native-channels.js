import { registerPlugin } from '../capacitor.js';
import { installNativeOnboarding } from './native-onboarding.js';
import { createWatcher as createBrightnessWatcher } from './watcher.js';
import { createNativeTorchChannel, createNativeFrameSource, NATIVE_CONTRAST_GATE } from './native-channel-core.js';

const hardware = registerPlugin('MorseHardware');
installNativeOnboarding(hardware);
export const createTorchChannel = () => createNativeTorchChannel(hardware);
export const createWatcher = options => createBrightnessWatcher({
  ...options, contrastGate: NATIVE_CONTRAST_GATE,
  frameSource: createNativeFrameSource(hardware, options.video),
});

document.addEventListener('click', event => {
  if (event.target.closest('[data-native-settings]')) hardware.openSettings().catch(() => {});
});

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
