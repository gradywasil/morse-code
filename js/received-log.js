// js/received-log.js — the backlog of messages this device has received.
//
// Every message the receiver finishes decoding is filed here, newest first,
// so it can be read back, copied, shown as Morse, or deleted later. Pure
// logic over an injected device store (js/device-store.js): the web build's
// store forgets when the page closes; the native build's persists.
//
// Bounded on purpose: at most LOG_LIMIT messages of LOG_TEXT_LIMIT characters
// each; the oldest fall off the end. A damaged or foreign stored value is
// ignored rather than trusted — the log starts empty instead of throwing.

export const LOG_KEY = 'received-log.v1';
export const LOG_LIMIT = 100;
export const LOG_TEXT_LIMIT = 2000;

function sanitize(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set();
  const entries = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const { id, at, text, partial } = item;
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    if (!Number.isFinite(at) || typeof text !== 'string' || !text.trim()) continue;
    seen.add(id);
    entries.push({ id, at, text: text.slice(0, LOG_TEXT_LIMIT), partial: partial === true });
    if (entries.length === LOG_LIMIT) break;
  }
  return entries;
}

/**
 * @param {{store: {persistent: boolean, get: Function, set: Function}, now?: () => number}} options
 */
export function createReceivedLog({ store, now = Date.now }) {
  let entries = sanitize(store.get(LOG_KEY));
  let counter = 0;
  const listeners = new Set();

  function commit() {
    try { store.set(LOG_KEY, JSON.stringify(entries)); } catch { /* the in-memory list still works */ }
    for (const fn of listeners) fn();
  }

  return {
    /** True when entries outlive the app being closed. */
    persistent: store.persistent === true,

    /** Newest first. Returns copies; callers cannot corrupt the log. */
    list: () => entries.map((entry) => ({ ...entry })),

    count: () => entries.length,

    /** File a finished message. Empty text is not a message. */
    add({ text, partial = false }) {
      const clean = String(text ?? '').trim().slice(0, LOG_TEXT_LIMIT);
      if (!clean) return null;
      const at = now();
      counter += 1;
      const entry = { id: `${at.toString(36)}-${counter}`, at, text: clean, partial: partial === true };
      entries = [entry, ...entries].slice(0, LOG_LIMIT);
      commit();
      return { ...entry };
    },

    remove(id) {
      const next = entries.filter((entry) => entry.id !== id);
      if (next.length === entries.length) return false;
      entries = next;
      commit();
      return true;
    },

    clear() {
      if (entries.length === 0) return;
      entries = [];
      commit();
    },

    /** Subscribe to any change; returns an unsubscribe function. */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
