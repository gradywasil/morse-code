// test/privacy-scan.test.mjs — Q2 privacy source-hygiene net.
//
// The privacy law as RE-SCOPED at the run-2 town hall (user-approved
// 2026-09-01): frame access exists ONLY in the receiver's watcher module
// and ONLY in its sanctioned downsampled forms (one 32×32 sampling
// canvas; drawImage scaled down; getImageData over that same rect;
// requestVideoFrameCallback for per-frame sampling). Everywhere else the
// v1 absolute holds: no frame APIs anywhere, no frame surfaces in
// markup, no export/encode/record/capture surfaces ANYWHERE (watcher
// included), nothing stored, nothing transmitted.
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

/** The ONLY module the re-scoped law permits to touch frames (run 2). */
const FRAME_SANCTIONED_MODULE = 'js/watcher.js';

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

test('Q2 hygiene: shipped source set is non-empty and includes the app + torch + watcher', () => {
  assert.ok(shippedJs.includes('app.js'), 'app.js shipped');
  assert.ok(shippedJs.includes('torch.js'), 'torch.js shipped');
  assert.ok(shippedJs.includes('watcher.js'), 'watcher.js shipped');
  assert.ok(sources.length >= 12, `expected the full shipped set, got ${sources.length}`);
});

test('PRIVACY (re-scoped law): frame-access tokens only in the watcher, sanctioned forms only', () => {
  // Banned in EVERY shipped source, watcher included — raw text scan.
  // ('VideoFrame' is handled separately: it is a substring of the
  // sanctioned requestVideoFrameCallback.)
  const BANNED_EVERYWHERE = [
    'ImageCapture', 'getVideoFrame', 'texImage2D', 'texImage',
    'createImageBitmap', 'toBlob', 'toDataURL', 'captureStream',
    'MediaStreamTrackProcessor', 'ImageDecoder', 'grabFrame', 'takePhoto',
    'readPixels', 'OffscreenCanvas', 'MediaRecorder',
  ];
  assert.deepEqual(findTokens(sources, BANNED_EVERYWHERE), [],
    'export/encode/record/capture surfaces must never appear anywhere');

  // Watcher-only tokens: permitted inside js/watcher.js, banned elsewhere.
  const WATCHER_ONLY = [
    'drawImage', 'getImageData', 'getContext', 'requestVideoFrameCallback',
    'VideoFrame',
  ];
  const outside = sources.filter((s) => s.name !== FRAME_SANCTIONED_MODULE);
  assert.deepEqual(findTokens(outside, WATCHER_ONLY), [],
    'frame-reading APIs are confined to the watcher module');
  // …and the word "canvas" (any case) too.
  assert.deepEqual(findTokens(outside, ['canvas'], { caseInsensitive: true }), [],
    'no canvas may exist outside the watcher');

  // Inside the watcher, a bare VideoFrame (outside the rVFC API name)
  // would still be an unsanctioned frame surface.
  const watcher = sources.find((s) => s.name === FRAME_SANCTIONED_MODULE);
  assert.ok(watcher, 'watcher.js present');
  const vfAll = watcher.text.split('VideoFrame').length - 1;
  const vfRvfc = watcher.text.split('requestVideoFrameCallback').length - 1;
  assert.equal(vfAll, vfRvfc, 'every VideoFrame occurrence must be the rVFC API name');
  assert.ok(watcher.text.includes('samplingCtx.drawImage(video, 0, 0, SAMPLE_GRID, SAMPLE_GRID)'),
    'watcher drawImage must target the 32×32 grid only');
  assert.ok(watcher.text.includes('samplingCtx.getImageData(0, 0, SAMPLE_GRID, SAMPLE_GRID)'),
    'watcher getImageData must read the 32×32 grid only');
  assert.ok(watcher.text.includes('export const SAMPLE_GRID = 32'),
    'the sampling grid is a named exported constant (32)');
});

test('PRIVACY (v1 law): no <canvas>/<img> in markup; the aperture <video> is the sanctioned preview', () => {
  for (const tag of ['<canvas', '<img ', '<img>', '<audio']) {
    assert.ok(!indexHtml.toLowerCase().includes(tag.toLowerCase()), `index.html must not contain ${tag}`);
  }
});

test('PRIVACY: sanctioned stream sinks are torch.js keep-alive + watcher.js preview (attach + detach)', () => {
  const torch = sources.find((s) => s.name === 'js/torch.js');
  assert.ok(torch, 'torch.js present');
  assert.ok(/\.srcObject = stream/.test(torch.text), 'torch sink attach present');
  assert.ok(/srcObject = null/.test(torch.text), 'torch sink detach present');
  const watcher = sources.find((s) => s.name === 'js/watcher.js');
  assert.ok(/video\.srcObject = liveStream/.test(watcher.text), 'watcher preview attach present');
  assert.ok(/video\.srcObject = null/.test(watcher.text), 'watcher preview detach present');
  const others = sources.filter((s) => s.name !== 'js/torch.js' && s.name !== 'js/watcher.js' && s.text.includes('srcObject'));
  assert.deepEqual(others.map((s) => s.name), [], 'srcObject outside the sanctioned sinks is forbidden');
});

test('PRIVACY: camera doors are torch.js + watcher.js only', () => {
  for (const { name, text } of sources) {
    const code = stripComments(text);
    if (name === 'js/torch.js' || name === 'js/watcher.js') {
      assert.ok(code.includes('getUserMedia'), `${name} owns its gUM call site`);
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

test('Q2 detector self-test (run 2): the watcher allowlist is non-vacuous', () => {
  // A frame token outside the watcher is caught by the confinement scan.
  const outside = [{ name: 'js/app.js', text: 'const d = ctx.getImageData(0, 0, w, h);' }];
  assert.deepEqual(findTokens(outside, ['getImageData']), ['js/app.js: "getImageData"']);

  // A banned-everywhere token inside the watcher is still caught.
  const evilWatcher = [{ name: 'js/watcher.js', text: 'samplingCtx.drawImage(video, 0, 0, 32, 32); track.takePhoto();' }];
  assert.deepEqual(findTokens(evilWatcher, ['takePhoto']), ['js/watcher.js: "takePhoto"']);

  // The sanctioned-form pins are exact-string: drifting the downsample
  // shape breaks the pin (a full-res read could not pass unnoticed).
  const driftedWatcher = 'samplingCtx.drawImage(video, 0, 0, 1920, 1080);';
  assert.ok(!driftedWatcher.includes('samplingCtx.drawImage(video, 0, 0, SAMPLE_GRID, SAMPLE_GRID)'),
    'a full-resolution drawImage fails the sanctioned-form pin');

  // A bare VideoFrame outside the rVFC API name is caught inside watcher.
  const bareVF = 'const f = new VideoFrame(buf); requestVideoFrameCallback(cb);';
  const vfAll = bareVF.split('VideoFrame').length - 1;
  const vfRvfc = bareVF.split('requestVideoFrameCallback').length - 1;
  assert.ok(vfAll > vfRvfc, 'a bare VideoFrame constructor is distinguishable from the rVFC API');
});
