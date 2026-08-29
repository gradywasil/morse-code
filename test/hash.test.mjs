// test/hash.test.mjs — F7 validation. Run: `node --test test/hash.test.mjs`
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encode, decode, readHash, applyHash, shareUrl } from '../js/hash.js';
import { SPEED_STEPS, SPEED_STEP_ORDER, DEFAULT_STEP_ID } from '../js/schedule.js';

/** Independent oracle: Node's own UTF-8 → unpadded base64url codec. */
const b64url = (text) => Buffer.from(text, 'utf8').toString('base64url');

const ITU_PUNCTUATION = `.,?'!/()&:;=+-_"$@`;

// Round-trip corpus: ITU text shapes, the full punctuation set, CJK, emoji
// (incl. multi-codepoint: skin-tone modifier, ZWJ family), bidi Arabic,
// Cyrillic, control-ish whitespace, and the base64-alphabet characters as
// MESSAGE content (they must survive the base64url encoding unharmed).
const CORPUS = [
  '',
  'SOS',
  'PARIS',
  'HI YOU',
  'CQ CQ DX DE MORSE',
  ITU_PUNCTUATION,
  'HELLO, WORLD? 73!',
  '你好，摩尔斯电码',
  'こんにちは',
  'Привет',
  'مرحبا',
  '👋',
  '👋📡',
  '👍🏽',
  '👨‍👩‍👧‍👦',
  'SOS 你好 👋 73!',
  'line1\nline2\ttabbed  spaced',
  '  leading and trailing  ',
  '+=/=/',
  "it's a \"quoted\" test",
  'The quick brown fox jumps over the lazy dog 0123456789',
  'x'.repeat(10000), // long input: chunked binary-string path
];

const HASH_SHAPE = /^#m=[A-Za-z0-9_-]*&s=(LEARNER|STANDARD|BRISK)$/;

describe('F7 · encode: format and stability', () => {
  test('exact literals: hand-computed base64url, param order m-then-s, default step', () => {
    assert.equal(encode('SOS', 'STANDARD'), '#m=U09T&s=STANDARD');
    assert.equal(encode('hi'), `#m=aGk&s=${DEFAULT_STEP_ID}`); // 'hi' → 'aGk=' unpadded
    assert.equal(encode(''), `#m=&s=${DEFAULT_STEP_ID}`); // empty message is representable
    assert.equal(encode('SOS', 'BRISK'), '#m=U09T&s=BRISK');
    assert.ok(encode('SOS').startsWith('#m=U09T&s=LEARNER'));
  });

  test('matches Node Buffer base64url byte-for-byte across the corpus and every step', () => {
    for (const message of CORPUS) {
      for (const stepId of SPEED_STEP_ORDER) {
        const hash = encode(message, stepId);
        assert.ok(HASH_SHAPE.test(hash), `shape: ${hash.slice(0, 42)}…`);
        const m = hash.slice(3, hash.indexOf('&s='));
        assert.equal(m, b64url(message), `base64url of ${JSON.stringify(message.slice(0, 12))}…`);
        assert.ok(hash.endsWith(`&s=${stepId}`));
      }
    }
  });

  test('never emits padded, standard-base64 or percent-escaped characters', () => {
    for (const message of CORPUS) {
      const hash = encode(message, 'BRISK');
      const m = hash.slice(3, hash.indexOf('&s='));
      assert.ok(!/[=+/\\%]/.test(m), `bad charset in ${m.slice(0, 24)}…`);
    }
  });

  test('default step and SPEED_STEPS entry objects resolve to their ids', () => {
    assert.equal(encode('SOS'), encode('SOS', DEFAULT_STEP_ID));
    assert.equal(encode('SOS', SPEED_STEPS.LEARNER), '#m=U09T&s=LEARNER');
    assert.equal(encode('SOS', SPEED_STEPS.BRISK), '#m=U09T&s=BRISK');
    assert.equal(encode('SOS', null), '#m=U09T&s=LEARNER'); // explicit null → default
    assert.equal(encode('SOS', undefined), '#m=U09T&s=LEARNER');
  });

  test('pure and stable: repeated calls are byte-identical', () => {
    for (const message of CORPUS.slice(0, 10)) {
      const a = encode(message, 'BRISK');
      const b = encode(message, 'BRISK');
      assert.equal(a, b);
    }
  });

  test('wiring bugs throw: non-string message, unknown step (incl. prototype keys)', () => {
    assert.throws(() => encode(42), TypeError);
    assert.throws(() => encode(null), TypeError);
    assert.throws(() => encode(undefined), TypeError);
    assert.throws(() => encode(['SOS']), TypeError);
    assert.throws(() => encode('x', 'FAST'), /FAST/);
    assert.throws(() => encode('x', 12), TypeError); // bare WPM is not a step id
    assert.throws(() => encode('x', 'learner'), TypeError); // ids are case-sensitive
    // "constructor" must not pass via Object.prototype lookup
    assert.throws(() => encode('x', 'constructor'), TypeError);
    assert.throws(() => encode('x', 'toString'), TypeError);
    assert.throws(() => encode('x', { id: 'FAST' }), /FAST/);
  });
});

describe('F7 · round trips', () => {
  for (const message of CORPUS) {
    for (const stepId of SPEED_STEP_ORDER) {
      test(`"${message.length > 16 ? `${message.slice(0, 12)}…(${message.length})` : message}" @ ${stepId}`, () => {
        assert.deepEqual(decode(encode(message, stepId)), { message, stepId });
      });
    }
  }

  test('full URLs decode (fragment taken from the first #)', () => {
    const hash = encode('SOS 你好', 'BRISK');
    assert.deepEqual(decode(`https://example.test/app?x=1${hash}`), {
      message: 'SOS 你好',
      stepId: 'BRISK',
    });
    assert.deepEqual(decode(`file:///srv/share/index.html${hash}`), {
      message: 'SOS 你好',
      stepId: 'BRISK',
    });
    assert.deepEqual(decode(`http://localhost:8080${hash}`), { message: 'SOS 你好', stepId: 'BRISK' });
  });

  test('bare fragments (no leading #) are accepted', () => {
    assert.deepEqual(decode('m=U09T&s=BRISK'), { message: 'SOS', stepId: 'BRISK' });
  });

  test('idempotent: re-encoding a decode result is a fixed point', () => {
    for (const message of CORPUS.slice(0, 12)) {
      const hash = encode(message, 'STANDARD');
      const round = decode(hash);
      assert.equal(encode(round.message, round.stepId), hash);
    }
  });

  test('decoded output is a fresh plain object each call', () => {
    const a = decode('#m=U09T');
    const b = decode('#m=U09T');
    assert.notEqual(a, b);
    assert.deepEqual(Object.keys(a).sort(), ['message', 'stepId']);
  });
});

describe('F7 · decode fallbacks (never throws, defaults per part)', () => {
  test('unknown step id → DEFAULT_STEP_ID, message preserved', () => {
    assert.deepEqual(decode('#m=U09T&s=FAST'), { message: 'SOS', stepId: DEFAULT_STEP_ID });
    assert.deepEqual(decode('#m=U09T&s=learner'), { message: 'SOS', stepId: DEFAULT_STEP_ID });
    assert.deepEqual(decode('#m=U09T&s='), { message: 'SOS', stepId: DEFAULT_STEP_ID });
    assert.deepEqual(decode('#m=U09T&s'), { message: 'SOS', stepId: DEFAULT_STEP_ID });
    assert.deepEqual(decode('#m=U09T&s=constructor'), { message: 'SOS', stepId: DEFAULT_STEP_ID });
  });

  test('missing parts → defaults per part', () => {
    assert.deepEqual(decode('#m=U09T'), { message: 'SOS', stepId: DEFAULT_STEP_ID }); // no s
    assert.deepEqual(decode('#s=BRISK'), { message: '', stepId: 'BRISK' }); // no m
    assert.deepEqual(decode('#'), { message: '', stepId: DEFAULT_STEP_ID });
    assert.deepEqual(decode(''), { message: '', stepId: DEFAULT_STEP_ID });
    assert.deepEqual(decode('#m=&s=BRISK'), { message: '', stepId: 'BRISK' }); // explicit empty m
  });

  test('malformed base64url → default message', () => {
    assert.deepEqual(decode('#m=a&s=BRISK'), { message: '', stepId: 'BRISK' }); // truncated (len %4 = 1)
    assert.deepEqual(decode('#m=AAAAA&s=BRISK'), { message: '', stepId: 'BRISK' }); // len %4 = 1
    assert.deepEqual(decode('#m=aG=k&s=BRISK'), { message: '', stepId: 'BRISK' }); // '=' mid-value
    assert.deepEqual(decode('#m=aGk/&s=BRISK'), { message: '', stepId: 'BRISK' }); // standard-base64 '/'
    assert.deepEqual(decode('#m=aG+k&s=BRISK'), { message: '', stepId: 'BRISK' }); // standard-base64 '+'
    assert.deepEqual(decode('#m=%2B%2F&s=BRISK'), { message: '', stepId: 'BRISK' }); // percent-escapes
    assert.deepEqual(decode('#m=%%%&s=BRISK'), { message: '', stepId: 'BRISK' });
    assert.deepEqual(decode('#m=你&s=BRISK'), { message: '', stepId: 'BRISK' }); // raw unicode is not base64url
    assert.deepEqual(decode('#m= ${}`&s=BRISK'), { message: '', stepId: 'BRISK' });
  });

  test('invalid UTF-8 byte sequences → default message', () => {
    const ff = Buffer.from([0xff]).toString('base64url'); // lone 0xFF
    assert.deepEqual(decode(`#m=${ff}&s=BRISK`), { message: '', stepId: 'BRISK' });
    const truncated3 = Buffer.from([0xe4, 0xbd]).toString('base64url'); // 3-byte lead cut short
    assert.equal(decode(`#m=${truncated3}`).message, '');
    const surrogate = Buffer.from([0xed, 0xa0, 0x80]).toString('base64url'); // UTF-16 surrogate range
    assert.equal(decode(`#m=${surrogate}`).message, '');
  });

  test('tolerates trailing padding (base64url producers that pad)', () => {
    assert.deepEqual(decode('#m=aGk=&s=BRISK'), { message: 'hi', stepId: 'BRISK' });
    assert.deepEqual(decode('#m=U09T&s=STANDARD'), { message: 'SOS', stepId: 'STANDARD' }); // no padding
  });

  test('wrong param and stray params', () => {
    assert.deepEqual(decode('#x=U09T&s=BRISK'), { message: '', stepId: 'BRISK' }); // wrong key
    assert.deepEqual(decode('#message=U09T&s=BRISK'), { message: '', stepId: 'BRISK' });
    assert.deepEqual(decode('#m=U09T&s=STANDARD&z=1'), { message: 'SOS', stepId: 'STANDARD' }); // trailing stray
    assert.deepEqual(decode('#z=1&m=U09T'), { message: 'SOS', stepId: DEFAULT_STEP_ID }); // leading stray
    assert.deepEqual(decode('#a=1&b=2'), { message: '', stepId: DEFAULT_STEP_ID }); // only strays
    assert.deepEqual(decode('#m=U09T&s=STANDARD&extra'), { message: 'SOS', stepId: 'STANDARD' }); // bare stray
  });

  test('duplicate keys: first occurrence wins', () => {
    assert.deepEqual(decode('#m=U09T&m=aGk&s=BRISK'), { message: 'SOS', stepId: 'BRISK' });
    assert.deepEqual(decode('#m=aGk&m=U09T&s=BRISK'), { message: 'hi', stepId: 'BRISK' });
    assert.deepEqual(decode('#m=U09T&s=BRISK&s=LEARNER'), { message: 'SOS', stepId: 'BRISK' });
  });

  test('URL forms without a usable fragment → all defaults', () => {
    assert.deepEqual(decode('https://example.test/app'), { message: '', stepId: DEFAULT_STEP_ID });
    assert.deepEqual(decode('https://example.test/app#section'), { message: '', stepId: DEFAULT_STEP_ID });
    assert.deepEqual(decode('https://example.test/app#/m=U09T'), { message: '', stepId: DEFAULT_STEP_ID });
    assert.deepEqual(decode('###'), { message: '', stepId: DEFAULT_STEP_ID });
  });

  test('non-string inputs never throw → all defaults', () => {
    for (const bad of [undefined, null, 42, {}, [], Symbol('x'), true]) {
      assert.deepEqual(decode(bad), { message: '', stepId: DEFAULT_STEP_ID });
    }
  });

  test('lone-surrogate message never throws on encode/decode (pathological input)', () => {
    const hash = encode('\ud800', 'LEARNER'); // WHATWG: replaced by U+FFFD
    const out = decode(hash);
    assert.equal(typeof out.message, 'string');
    assert.equal(out.stepId, 'LEARNER');
  });

  test('decode result always names a known step id', () => {
    const nasties = ['', '#', '#m=a&s=x', '#m', '#s', '#m=&&&&&s=', '#m=' + 'A'.repeat(6) + '&s='];
    for (const n of nasties) {
      const out = decode(n);
      assert.ok(SPEED_STEP_ORDER.includes(out.stepId), `${JSON.stringify(n)} → ${out.stepId}`);
      assert.equal(typeof out.message, 'string');
    }
  });
});

describe('F7 · readHash (on-load auto-fill)', () => {
  test('absent fragment ("" or "#") → null', () => {
    assert.equal(readHash({ hash: '' }), null);
    assert.equal(readHash({ hash: '#' }), null);
  });

  test('present fragment → decode result', () => {
    assert.deepEqual(readHash({ hash: '#m=U09T&s=BRISK' }), { message: 'SOS', stepId: 'BRISK' });
    assert.deepEqual(readHash({ hash: '#m=U09T' }), { message: 'SOS', stepId: DEFAULT_STEP_ID });
  });

  test('garbage fragment → defaults object (still non-null: a link was shared)', () => {
    assert.deepEqual(readHash({ hash: '#garbage' }), { message: '', stepId: DEFAULT_STEP_ID });
  });

  test('unicode survives the location round trip', () => {
    const hash = encode('你好 👋 SOS', 'BRISK');
    assert.deepEqual(readHash({ hash }), { message: '你好 👋 SOS', stepId: 'BRISK' });
  });

  test('missing loc.hash → treated as absent; no page location → descriptive throw', () => {
    assert.equal(readHash({}), null);
    // Bare Node has no `location` global: the default must refuse loudly,
    // not silently misread (wiring bug discipline shared with F3/F4/F5).
    assert.equal(typeof location, 'undefined');
    assert.throws(() => readHash(), /location/);
  });
});

describe('F7 · applyHash (replaceState, no history pollution, no scroll)', () => {
  function makeEnv({ search = '?src=share', href } = {}) {
    const calls = { replaceState: [], pushState: [], hashSets: 0 };
    const defaultHref = `https://example.test/index.html${search}#m=OLD&s=BRISK`;
    const locationStub = {
      pathname: '/index.html',
      search,
      href: href ?? defaultHref,
      get hash() {
        return '#m=OLD&s=BRISK';
      },
      set hash(_v) {
        calls.hashSets += 1; // assigning location.hash would push history + scroll
      },
    };
    const historyStub = {
      state: { marker: 'keep-me' },
      replaceState(state, title, url) {
        calls.replaceState.push({ state, title, url });
      },
      pushState(state, title, url) {
        calls.pushState.push({ state, title, url });
      },
    };
    return { env: { history: historyStub, location: locationStub }, calls };
  }

  test('writes pathname+search+fragment via replaceState exactly once', () => {
    const { env, calls } = makeEnv();
    const url = applyHash('#m=U09T&s=STANDARD', env);
    assert.equal(url, '/index.html?src=share#m=U09T&s=STANDARD');
    assert.equal(calls.replaceState.length, 1);
    assert.deepEqual(
      { state: calls.replaceState[0].state, title: calls.replaceState[0].title, url: calls.replaceState[0].url },
      { state: env.history.state, title: '', url: '/index.html?src=share#m=U09T&s=STANDARD' }
    );
  });

  test('no history entry, no location.hash assignment (no pollution, no scroll, no hashchange path)', () => {
    const { env, calls } = makeEnv();
    applyHash(encode('SOS', 'BRISK'), env);
    assert.equal(calls.pushState.length, 0);
    assert.equal(calls.hashSets, 0);
  });

  test('history.state passes through by identity', () => {
    const { env, calls } = makeEnv();
    const marker = { custom: 7 };
    env.history.state = marker;
    applyHash('#m=&s=LEARNER', env);
    assert.equal(calls.replaceState[0].state, marker);
  });

  test('leading # is optional; empty fragment still writes a bare #', () => {
    const { env, calls } = makeEnv({ search: '' });
    assert.equal(applyHash('m=U09T&s=BRISK', env), '/index.html#m=U09T&s=BRISK');
    assert.equal(applyHash('#m=U09T', env), '/index.html#m=U09T');
  });

  test('works without a search string', () => {
    const { env } = makeEnv({ search: '' });
    assert.equal(applyHash(encode('hi'), env), `/index.html#m=aGk&s=${DEFAULT_STEP_ID}`);
  });

  test('non-string hash → TypeError (wiring bug)', () => {
    const { env } = makeEnv();
    assert.throws(() => applyHash(null, env), TypeError);
    assert.throws(() => applyHash({ m: 'x' }, env), TypeError);
  });

  test('no page history/location in bare Node → descriptive throw', () => {
    assert.equal(typeof history, 'undefined');
    assert.throws(() => applyHash('#m=x'), /history/);
  });
});

describe('F7 · shareUrl (copy-link helper)', () => {
  test('replaces an existing fragment, keeps scheme/host/path/search', () => {
    const loc = { href: 'https://example.test/app?x=1#m=OLD&s=LEARNER' };
    assert.equal(shareUrl(encode('SOS', 'BRISK'), loc), 'https://example.test/app?x=1#m=U09T&s=BRISK');
  });

  test('appends when no fragment exists; leading # optional', () => {
    const loc = { href: 'https://example.test/app' };
    assert.equal(shareUrl('#m=U09T&s=BRISK', loc), 'https://example.test/app#m=U09T&s=BRISK');
    assert.equal(shareUrl('m=U09T', loc), 'https://example.test/app#m=U09T');
  });

  test('non-string hash → TypeError; no page location → descriptive throw', () => {
    assert.throws(() => shareUrl(42, { href: 'https://x.test/' }), TypeError);
    assert.throws(() => shareUrl('#m=x'), /location/);
  });
});

describe('F7 · environment independence (DOM-optional, fallback codecs)', () => {
  test('without TextEncoder/TextDecoder: fallback codecs round-trip the whole corpus exactly', () => {
    const { TextEncoder: TE, TextDecoder: TD } = globalThis;
    delete globalThis.TextEncoder;
    delete globalThis.TextDecoder;
    try {
      for (const message of CORPUS) {
        const hash = encode(message, 'BRISK');
        assert.equal(hash, `#m=${b64url(message)}&s=BRISK`); // byte-identical to the primary path
        assert.deepEqual(decode(hash), { message, stepId: 'BRISK' });
      }
    } finally {
      globalThis.TextEncoder = TE;
      globalThis.TextDecoder = TD;
    }
  });

  test('fallback decoder still rejects invalid UTF-8 (never throws, defaults instead)', () => {
    const { TextEncoder: TE, TextDecoder: TD } = globalThis;
    delete globalThis.TextEncoder;
    delete globalThis.TextDecoder;
    try {
      assert.equal(decode(`#m=${Buffer.from([0xff]).toString('base64url')}&s=BRISK`).message, '');
      assert.equal(decode(`#m=${Buffer.from([0xe4, 0xbd]).toString('base64url')}&s=BRISK`).message, '');
      assert.equal(decode(`#m=${Buffer.from([0x80]).toString('base64url')}&s=BRISK`).message, ''); // stray continuation
    } finally {
      globalThis.TextEncoder = TE;
      globalThis.TextDecoder = TD;
    }
  });

  test('encode/decode never need location/history (bare Node runs the whole suite above)', () => {
    assert.equal(typeof location, 'undefined');
    assert.equal(typeof history, 'undefined');
    assert.deepEqual(decode(encode('SOS', 'LEARNER')), { message: 'SOS', stepId: 'LEARNER' });
  });

  test('source hygiene: no DOM/storage globals in js/hash.js code', () => {
    const src = readFileSync(new URL('../js/hash.js', import.meta.url), 'utf8');
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .split('\n')
      .map((l) => l.replace(/\s\/\/.*$/, '')) // indented/trailing line comments
      .join('\n');
    for (const banned of [
      'window',
      'document',
      'navigator',
      'localStorage',
      'sessionStorage',
      'querySelector',
      'getElementById',
      'innerHTML',
      'addEventListener',
    ]) {
      assert.ok(!new RegExp(`\\b${banned}\\b`).test(stripped), `unexpected "${banned}" in js/hash.js`);
    }
  });

  test('step data comes from schedule.js, not redeclared here', () => {
    // The hash module must consume F2's vocabulary: decode accepts exactly
    // SPEED_STEP_ORDER, and the fallback step is exactly DEFAULT_STEP_ID.
    for (const stepId of SPEED_STEP_ORDER) {
      assert.equal(decode(`#m=U09T&s=${stepId}`).stepId, stepId);
    }
    const notSteps = ['LEARNERX', 'standard', '', 'FAST', '5', '8', '12'];
    for (const bad of notSteps) {
      assert.equal(decode(`#m=U09T&s=${encodeURIComponent(bad)}`).stepId, DEFAULT_STEP_ID);
    }
    assert.equal(DEFAULT_STEP_ID, 'LEARNER');
    assert.deepEqual(SPEED_STEP_ORDER, ['LEARNER', 'STANDARD', 'BRISK']);
  });
});
