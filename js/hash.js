// js/hash.js — Share hash: the URL fragment as the app's shareable state.
//
// Task F7 of docs/ultron/plan.md. The whole shareable state of the app is
// the message plus the speed step, and it lives in the URL fragment so no
// server ever sees it (plan: "No server"):
//
//     #m=<base64url(UTF-8 message)>&s=<step id>
//
// e.g. "#m=U09T&s=STANDARD" is "SOS" at 8 WPM. base64url is RFC 4648 §5
// without padding: alphabet A–Z a–z 0–9 - _ , no '=' — URL-safe verbatim
// (nothing in it ever needs percent-encoding inside a fragment). Speed-step
// ids are F2's (js/schedule.js `SPEED_STEPS` / `SPEED_STEP_ORDER` /
// `DEFAULT_STEP_ID` — imported here, never redeclared).
//
// Behaviour contract:
//
//   - `encode(message, stepId)` is PURE and total: same input → same string
//     (stable/idempotent — re-encoding a decode result is a fixed point).
//     It throws TypeError only for wiring bugs (non-string message, unknown
//     step id): the encoder must never EMIT an unshareable hash.
//   - `decode(input)` NEVER THROWS. It accepts a hash string ("#m=…&s=…"),
//     a bare fragment ("m=…&s=…"), or a full URL (the fragment is what
//     follows the first '#'). Every malformed shape falls back to defaults,
//     per part:
//         m missing / not base64url / not valid UTF-8 → message ''
//         s missing / unknown id (case-sensitive)     → DEFAULT_STEP_ID
//     so a mangled link still opens a working app: empty composer, safe
//     default speed (LEARNER 5 — photosafety default from F2). decode('')
//     and decode('#') are the all-defaults shape.
//   - `readHash(loc)` — the on-load auto-fill helper: `decode(loc.hash)`,
//     or null when there is no fragment at all ('' or '#'), so I2 can tell
//     "no shared link" apart from "link with garbage in it".
//   - `applyHash(hash, env)` — rewrites the fragment via
//     `history.replaceState`: NO history entry (Back never walks
//     keystrokes), NO scroll jump and NO hashchange event (replaceState is
//     not a navigation) — I2 re-renders from its own state and must NOT
//     listen for hashchange.
//   - `shareUrl(hash, loc)` — the copy-link helper: the page's current URL
//     with the fragment swapped for `hash`. The clipboard write itself
//     stays in I2 (it needs the user gesture).
//
// DOM-optional (Node-testable): every browser/Node global (TextEncoder,
// TextDecoder, btoa, atob, location, history) is resolved lazily behind a
// typeof guard, and the location/history helpers take injectable
// stand-ins. encode/decode never touch location/history at all.

import { SPEED_STEP_ORDER, DEFAULT_STEP_ID } from './schedule.js';

// ---------------------------------------------------------------------------
// UTF-8 ⇄ bytes (TextEncoder path, with a compact pre-TextEncoder fallback)
// ---------------------------------------------------------------------------

/** UTF-8 bytes of `text`. Primary path: TextEncoder — global in Node ≥ 11
 *  and in every ES-module browser, and it is the WHATWG-standard encoder
 *  (a lone surrogate becomes U+FFFD). Fallback: unroll encodeURIComponent's
 *  percent-escaped UTF-8 into bytes (for embeddings without TextEncoder). */
function utf8Bytes(text) {
  const Encoder = typeof TextEncoder !== 'undefined' ? TextEncoder : null;
  if (Encoder) return new Encoder().encode(text);
  const escaped = encodeURIComponent(text);
  const bytes = [];
  for (let i = 0; i < escaped.length; ) {
    if (escaped[i] === '%') {
      bytes.push(parseInt(escaped.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      bytes.push(escaped.charCodeAt(i));
      i += 1;
    }
  }
  return new Uint8Array(bytes);
}

/** Bytes → string, with validation. Returns null when the bytes are not
 *  valid UTF-8 (fatal TextDecoder → SyntaxError → caught); decode() turns
 *  null into the default message. The manual fallback enforces the same
 *  never-throw rule with structural (truncation/lead) checking. */
function utf8Text(bytes) {
  const Decoder = typeof TextDecoder !== 'undefined' ? TextDecoder : null;
  if (Decoder) {
    try {
      return new Decoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  }
  return utf8TextFallback(bytes);
}

function utf8TextFallback(bytes) {
  let out = '';
  let i = 0;
  const n = bytes.length;
  const cont = (j) => {
    if (j >= n || (bytes[j] & 0xc0) !== 0x80) throw new Error('truncated UTF-8');
    return bytes[j] & 0x3f;
  };
  try {
    while (i < n) {
      const b = bytes[i];
      if (b < 0x80) {
        out += String.fromCharCode(b);
        i += 1;
      } else if (b < 0xc0) {
        throw new Error('stray continuation byte');
      } else if (b < 0xe0) {
        out += String.fromCharCode(((b & 0x1f) << 6) | cont(i + 1));
        i += 2;
      } else if (b < 0xf0) {
        out += String.fromCharCode(((b & 0x0f) << 12) | (cont(i + 1) << 6) | cont(i + 2));
        i += 3;
      } else {
        const cp =
          (((b & 0x07) << 18) | (cont(i + 1) << 12) | (cont(i + 2) << 6) | cont(i + 3)) - 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        i += 4;
      }
    }
  } catch {
    return null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// base64url (RFC 4648 §5, unpadded)
// ---------------------------------------------------------------------------

const B64URL_CHARS = /^[A-Za-z0-9_-]*$/;

/** Bytes → binary string in chunks (stays inside the engine's apply()
 *  argument window for arbitrarily long messages). */
function bytesToBinaryString(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return bin;
}

/** UTF-8 bytes → unpadded base64url string. */
function bytesToBase64url(bytes) {
  const toBase64 = typeof btoa === 'function' ? btoa : null;
  if (!toBase64) {
    throw new TypeError('encode() needs btoa (present in every ES-module browser and Node ≥ 16)');
  }
  return toBase64(bytesToBinaryString(bytes)).replace(/[+/]/g, (c) => (c === '+' ? '-' : '_')).replace(/=+$/, '');
}

/** Unpadded (or tolerantly padded) base64url → bytes, or null when the
 *  value is not well-formed base64url: wrong alphabet (standard base64
 *  +/ or stray percent-escapes), '=' anywhere but the end, or an
 *  impossible byte count (length % 4 === 1 — a truncated sequence). */
function base64urlToBytes(value) {
  if (typeof value !== 'string') return null;
  const unpadded = value.replace(/=+$/, '');
  if (!B64URL_CHARS.test(unpadded) || unpadded.length % 4 === 1) return null;
  const fromBase64 = typeof atob === 'function' ? atob : null;
  if (!fromBase64) return null; // no codec to check with → treat as malformed
  const std = unpadded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
  try {
    const bin = fromBase64(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fragment parsing
// ---------------------------------------------------------------------------

/** The fragment of a hash string / bare fragment / full URL: everything
 *  after the FIRST '#' (no '#' anywhere → the whole input is taken as a
 *  bare fragment). */
function fragmentOf(input) {
  const hashAt = input.indexOf('#');
  return hashAt === -1 ? input : input.slice(hashAt + 1);
}

/** Fragment → params, FIRST occurrence per key wins (mirrors
 *  URLSearchParams.get); keys/values are taken verbatim — base64url and
 *  step ids never need fragment escaping. Stray unknown keys are simply
 *  carried and ignored by decode(). */
function parseFragment(fragment) {
  const params = new Map();
  for (const pair of fragment.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? '' : pair.slice(eq + 1);
    if (!params.has(key)) params.set(key, value);
  }
  return params;
}

// ---------------------------------------------------------------------------
// encode / decode
// ---------------------------------------------------------------------------

/**
 * Encode message + speed step as the share fragment (leading '#'
 * included — exactly what `applyHash` / `shareUrl` consume).
 *
 * @param {string} message - any string (unicode, punctuation, empty).
 * @param {string|{id:string}} [step] - a SPEED_STEP id or entry object;
 *   defaults to `DEFAULT_STEP_ID`.
 * @returns {string} `#m=<base64url>&s=<step id>` — pure, stable, idempotent.
 * @throws {TypeError} non-string message or unknown step id (wiring bugs —
 *   the encoder never emits an unshareable hash).
 */
export function encode(message, step = DEFAULT_STEP_ID) {
  if (typeof message !== 'string') {
    throw new TypeError(`encode(message, stepId) expects a string message, got ${typeof message}`);
  }
  return `#m=${bytesToBase64url(utf8Bytes(message))}&s=${resolveStepId(step)}`;
}

/**
 * Decode a hash string, bare fragment, or full URL. NEVER THROWS: every
 * malformed shape falls back per part (bad/missing `m` → message '',
 * unknown/missing `s` → `DEFAULT_STEP_ID`).
 *
 * @param {string} input - '#m=…&s=…' | 'm=…&s=…' | 'https://…/#m=…&s=…'.
 * @returns {{message:string, stepId:string}} a fresh plain object.
 */
export function decode(input) {
  if (typeof input !== 'string') return { message: '', stepId: DEFAULT_STEP_ID };
  const params = parseFragment(fragmentOf(input));
  const m = params.get('m');
  const s = params.get('s');
  const bytes = m === undefined ? null : base64urlToBytes(m);
  const message = bytes === null ? '' : utf8Text(bytes) ?? '';
  const stepId = s !== undefined && SPEED_STEP_ORDER.includes(s) ? s : DEFAULT_STEP_ID;
  return { message, stepId };
}

/** Step id from an id / SPEED_STEPS entry / omitted-or-null (default).
 *  Membership is checked against SPEED_STEP_ORDER, so prototype keys like
 *  "constructor" can never pass as step ids. */
function resolveStepId(step) {
  if (step === undefined || step === null) return DEFAULT_STEP_ID;
  const id = typeof step === 'string' ? step : step && typeof step.id === 'string' ? step.id : null;
  if (id === null || !SPEED_STEP_ORDER.includes(id)) {
    throw new TypeError(
      `Unknown speed step ${JSON.stringify(id ?? step)}. Known steps: ${SPEED_STEP_ORDER.join(', ')}.`
    );
  }
  return id;
}

// ---------------------------------------------------------------------------
// location / history helpers (thin wrappers over injectable globals)
// ---------------------------------------------------------------------------

/** The page location, or a descriptive error in environments without one
 *  (bare Node) — callers inject a `{hash}`-shaped stand-in there. */
function defaultLocation() {
  const loc = typeof location !== 'undefined' ? location : null;
  if (!loc) {
    throw new TypeError('no page location in this environment — pass one explicitly ({hash}, {href, …})');
  }
  return loc;
}

/**
 * On-load auto-fill: decode the page's current fragment.
 *
 * @param {{hash:string}} [loc] - location-like stand-in (tests); defaults
 *   to the page location.
 * @returns {{message:string, stepId:string}|null} null when there is no
 *   fragment at all (hash '' or '#') — "no shared link", kept distinct
 *   from a garbage link, which decodes to the defaults.
 */
export function readHash(loc = defaultLocation()) {
  const hash = typeof loc.hash === 'string' ? loc.hash : '';
  if (hash === '' || hash === '#') return null;
  return decode(hash);
}

/**
 * Rewrite the page fragment via `history.replaceState` — no history entry
 * (Back never walks keystrokes), no scroll jump, no hashchange event.
 * The current `history.state` is passed through untouched.
 *
 * @param {string} hash - the fragment to write; leading '#' optional
 *   (encode() output goes in directly).
 * @param {{history:object, location:object}} [env] - injectable
 *   `{history, location}` pair (tests); defaults to the page globals.
 * @returns {string} the URL handed to replaceState
 *   (`pathname + search + '#' + fragment`).
 * @throws {TypeError} non-string hash, or no page globals to default to.
 */
export function applyHash(hash, env = defaultEnv()) {
  if (typeof hash !== 'string') {
    throw new TypeError(`applyHash(hash, env) expects a string hash, got ${typeof hash}`);
  }
  const fragment = hash.startsWith('#') ? hash : `#${hash}`;
  const url = `${env.location.pathname}${env.location.search}${fragment}`;
  env.history.replaceState(env.history.state, '', url);
  return url;
}

/** The page's {history, location} pair, or a descriptive error without one. */
function defaultEnv() {
  const hist = typeof history !== 'undefined' ? history : null;
  const loc = typeof location !== 'undefined' ? location : null;
  if (!hist || !loc) {
    throw new TypeError(
      'no page history/location in this environment — pass env = {history, location} explicitly'
    );
  }
  return { history: hist, location: loc };
}

/**
 * The copy-link helper: the page's current URL with the fragment swapped
 * for `hash` (existing fragment dropped, search preserved).
 *
 * @param {string} hash - the fragment to share; leading '#' optional.
 * @param {{href:string}} [loc] - location-like stand-in (tests); defaults
 *   to the page location.
 * @returns {string} absolute URL string (I2 hands this to the clipboard
 *   inside the share gesture).
 */
export function shareUrl(hash, loc = defaultLocation()) {
  if (typeof hash !== 'string') {
    throw new TypeError(`shareUrl(hash, loc) expects a string hash, got ${typeof hash}`);
  }
  const fragment = hash.startsWith('#') ? hash : `#${hash}`;
  const href = loc.href;
  const hashAt = href.indexOf('#');
  return `${hashAt === -1 ? href : href.slice(0, hashAt)}${fragment}`;
}
