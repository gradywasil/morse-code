// test/privacy-scan.test.mjs — Q2 privacy source-hygiene net.
//
// The town-hall privacy criteria are code-level invariants (AC 7: "no video
// frame APIs invoked anywhere in the codebase") — this suite pins them over
// ALL shipped sources (every js/*.js + index.html), so a regression cannot
// ship silently. It generalizes T-F3's single-file torch.js scan to the
// whole shipped surface, with the fuller token list the T-F3 verifier
// prescribed for Q2 (bare VideoFrame, texImage2D, MediaStreamTrackProcessor,
// ImageDecoder, takePhoto, grabFrame, plus createImageBitmap/toBlob/
// captureStream/requestVideoFrameCallback/getContext and any `canvas` at
// all, case-insensitive).
//
// The frame-token scan runs over RAW text (comments included) — stricter
// than comment-stripping; the storage/getUserMedia scans strip comments so
// the modules' own explanatory comments about these laws do not trip them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS_DIR = path.join(ROOT, 'js');
const shippedJs = readdirSync(JS_DIR).filter((f) => f.endsWith('.js')).sort();
const indexHtml = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sources = [
  ...shippedJs.map((f) => ({ name: `js/${f}`, text: readFileSync(path.join(JS_DIR, f), 'utf8') })),
  { name: 'index.html', text: indexHtml },
];

/** Strip /* … *​/ then // comments (scan-legibility only; the frame scan is raw). */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

/** Every (file, token) hit for a token list — the shared detector. */
function findTokens(files, tokens, { caseInsensitive = false } = {}) {
  const hits = [];
  for (const { name, text } of files) {
    for (const token of tokens) {
      const hay = caseInsensitive ? text.toLowerCase() : text;
      const needle = caseInsensitive ? token.toLowerCase() : token;
      if (hay.includes(needle)) hits.push(`${name}: "${token}"`);
    }
  }
  return hits;
}

test('Q2 hygiene: shipped source set is non-empty and includes the app + torch', () => {
  assert.ok(shippedJs.includes('app.js'), 'app.js shipped');
  assert.ok(shippedJs.includes('torch.js'), 'torch.js shipped');
  assert.ok(sources.length >= 11, `expected the full shipped set, got ${sources.length}`);
});

test('PRIVACY (AC7): zero frame-access tokens in ALL shipped sources, comments included', () => {
  const BANNED = [
    'drawImage', 'ImageCapture', 'canvas', // canvas is scanned case-insensitively — there is no canvas at all
    'getVideoFrame', 'VideoFrame', 'texImage2D', 'texImage', 'getImageData',
    'createImageBitmap', 'toBlob', 'toDataURL', 'captureStream',
    'requestVideoFrameCallback', 'MediaStreamTrackProcessor',
    'ImageDecoder', 'grabFrame', 'takePhoto', 'getContext',
    'readPixels', 'OffscreenCanvas',
  ];
  const hits = [
    ...findTokens(sources, BANNED.filter((t) => t !== 'canvas')),
    ...findTokens(sources, ['canvas'], { caseInsensitive: true }),
  ];
  assert.deepEqual(hits, [], `frame-access tokens must never appear in shipped sources:\n${hits.join('\n')}`);
});

test('PRIVACY (AC7): no <canvas>/<video>/<img> elements ship in index.html — the app renders no frame surfaces', () => {
  for (const tag of ['<canvas', '<video', '<img ', '<img>', '<audio']) {
    assert.ok(!indexHtml.toLowerCase().includes(tag.toLowerCase()), `index.html must not contain ${tag}`);
  }
});

test('PRIVACY: the ONE sanctioned stream use is torch.js keep-alive sink (srcObject attach + detach)', () => {
  const torch = sources.find((s) => s.name === 'js/torch.js');
  assert.ok(torch, 'torch.js present');
  assert.ok(/\.srcObject = stream/.test(torch.text), 'sanctioned sink attach present');
  assert.ok(/srcObject = null/.test(torch.text), 'sanctioned sink detach present');
  // srcObject must not appear in any OTHER shipped source
  const others = sources.filter((s) => s.name !== 'js/torch.js' && s.text.includes('srcObject'));
  assert.deepEqual(others.map((s) => s.name), [], 'srcObject outside torch.js would be an unsanctioned stream sink');
});

test('PRIVACY: camera door is torch.js only — getUserMedia appears in executable code nowhere else', () => {
  for (const { name, text } of sources) {
    const code = stripComments(text);
    if (name === 'js/torch.js') {
      assert.ok(code.includes('getUserMedia'), 'torch.js owns the one gUM call site');
    } else {
      assert.ok(!code.includes('getUserMedia'), `${name} must not call getUserMedia (comments exempt)`);
    }
  }
});

test('PRIVACY: zero storage APIs in shipped code (message/speed/mute are memory-only)', () => {
  const STORAGE = [
    'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie',
    'caches.', 'cacheStorage', 'navigator.storage', 'IDB', 'StorageManager',
  ];
  const files = sources.map((s) => ({ name: s.name, text: stripComments(s.text) }));
  assert.deepEqual(findTokens(files, STORAGE), [], 'no storage API may appear in shipped executable code');
});

test('PRIVACY: zero network call surfaces in shipped JS; index.html requests only the Google Fonts pair', () => {
  const NET = ['fetch(', 'XMLHttpRequest', 'new WebSocket', 'EventSource', 'sendBeacon', 'import('];
  const jsFiles = sources.filter((s) => s.name !== 'index.html').map((s) => ({ name: s.name, text: stripComments(s.text) }));
  assert.deepEqual(findTokens(jsFiles, NET), [], 'shipped JS must open no network request surface');

  // index.html: every external URL is a static Google Fonts asset (fixed
  // families/weights — the request carries no user data), everything else same-origin.
  const external = [...indexHtml.matchAll(/(?:href|src)="(https?:)?\/\/([^"]+)"/g)].map((m) => m[2]);
  assert.ok(external.length >= 3, `expected the fonts pair, found ${JSON.stringify(external)}`);
  for (const hostPath of external) {
    assert.match(hostPath, /^(fonts\.googleapis\.com|fonts\.gstatic\.com)(\/|$)/, `only Google Fonts may be external, found ${hostPath}`);
  }
});

test('Q2 detector self-test: the token scanner catches planted violations (non-vacuous)', () => {
  const planted = [
    { name: 'planted.js', text: 'const c = document.createElement("canvas"); ctx["drawImage"](v, 0, 0);' },
    { name: 'planted2.js', text: 'track.takePhoto(); x = new VideoFrame(); y = `${canvas}`;' },
  ];
  const hits = [
    ...findTokens(planted, ['drawImage', 'takePhoto', 'VideoFrame']),
    ...findTokens(planted, ['canvas'], { caseInsensitive: true }),
  ];
  assert.ok(hits.length >= 4, `detector must catch planted frame tokens, got ${JSON.stringify(hits)}`);
  const storageHits = findTokens([{ name: 'p3.js', text: stripComments('localStorage.setItem("m", msg); // localStorage note') }], ['localStorage']);
  assert.deepEqual(storageHits, ['p3.js: "localStorage"'], 'comment-stripped storage scan catches real calls, not comments');
  const benignStorage = findTokens([{ name: 'p4.js', text: stripComments('// no localStorage anywhere\nconst x = 1;') }], ['localStorage']);
  assert.deepEqual(benignStorage, [], 'pure comments do not trip the stripped scan');
});
