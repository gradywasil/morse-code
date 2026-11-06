// js/device-store.js — where on-device preferences and the received log live.
//
// The web build keeps its privacy stance: nothing is written anywhere, so
// this store holds values for the life of the open page only. The native
// Android build swaps this module for a persistent one (native-channels.js
// exports the same createDeviceStore) so the received log and the flash
// colour survive closing the app. Values are plain strings; callers own
// their own serialisation.

/**
 * @returns {{persistent: boolean, get: (key: string) => (string|null), set: (key: string, value: string) => void, remove: (key: string) => void}}
 */
export function createDeviceStore() {
  const values = new Map();
  return {
    persistent: false,
    get: (key) => (values.has(key) ? values.get(key) : null),
    set: (key, value) => { values.set(key, String(value)); },
    remove: (key) => { values.delete(key); },
  };
}
