import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('native packaging keeps private development files out and works without remote fonts', () => {
  execFileSync(process.execPath, ['scripts/prepare-native.mjs'], { cwd: root });
  const config = JSON.parse(readFileSync(new URL('../capacitor.config.json', import.meta.url)));
  assert.equal(config.server.url, undefined, 'the native app must load its local bundle');
  assert.ok(config.server.appStartPath.startsWith('/'), 'the start path must not become part of the hostname');
  const names = readdirSync(new URL('../native-web/', import.meta.url));
  for (const forbidden of ['android', 'android-native', 'node_modules', '.git', 'docs', 'test', 'package.json']) {
    assert.ok(!names.includes(forbidden), `${forbidden} must not enter the app bundle`);
  }
  const html = readFileSync(new URL('../native-web/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /https:\/\/fonts\.(?:googleapis|gstatic)\.com/);
  assert.match(html, /href="fonts.css"/);
  assert.match(html, /href="privacy.html"/);
  assert.match(html, /data-native-settings/);
  const app = readFileSync(new URL('../native-web/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /from '.\/native-channels.js'/);
  assert.doesNotMatch(app, /from '.\/(torch|watcher).js'/);
  assert.match(app, /href: 'https:\/\/morse.graydonwasil.com\/'/);
  assert.doesNotMatch(app, /shareUrl\(encode\(messageInput\.value, stepId\)\)/, 'every native share link names the public site');
  // This update: the receiver is warned too, web-only sharing is hidden, and the
  // device-backed log/colour store and the keep-screen-on hold replace the web ones.
  assert.match(html.match(/<aside[^>]*id="why-camera-receive"[\s\S]*?<\/aside>/)[0], /native-warning-choice/);
  assert.match(html, /class="key key-share web-only"/);
  assert.match(html, /class="bay web-only" id="share"/);
  assert.match(readFileSync(new URL('../native-web/native.css', import.meta.url), 'utf8'), /\.web-only\s*\{\s*display:\s*none\s*!important/);
  assert.match(app, /import \{ createDeviceStore \} from '\.\/native-channels\.js'/);
  assert.match(app, /import \{ createScreenAwake \} from '\.\/native-channels\.js'/);
  const channels = readFileSync(new URL('../native-web/js/native-channels.js', import.meta.url), 'utf8');
  assert.match(channels, /persistent: true/);
  assert.match(channels, /keepScreenOn/);
  const policy = readFileSync(new URL('../native-web/privacy.html', import.meta.url), 'utf8');
  assert.match(policy, /received log/);
  assert.match(policy, /keep the screen on/);
  assert.match(policy, /bundles its interface and fonts/);
  assert.doesNotMatch(policy, /loads typefaces from/);
  const fontCss = readFileSync(new URL('../native-web/fonts.css', import.meta.url), 'utf8');
  assert.doesNotMatch(fontCss, /https?:/);
  assert.match(fontCss, /url\(fonts\//);
});

test('the iOS bundle is the release build with iOS wording and the iOS privacy policy', () => {
  execFileSync(process.execPath, ['scripts/prepare-native.mjs', '--ios'], { cwd: root });
  try {
    const html = readFileSync(new URL('../native-web/index.html', import.meta.url), 'utf8');
    assert.doesNotMatch(html, /Android|Morse Native Test|hardware-proof/);
    assert.match(html, /Camera access for Morse in the Settings app/);
    const names = readdirSync(new URL('../native-web/', import.meta.url));
    assert.ok(!names.includes('hardware-proof.html'), 'diagnostics stay out of the store build');
    const copy = readFileSync(new URL('../native-web/js/copy.js', import.meta.url), 'utf8');
    assert.doesNotMatch(copy, /Android settings/);
    const policy = readFileSync(new URL('../native-web/privacy.html', import.meta.url), 'utf8');
    assert.match(policy, /Native iOS app/);
    assert.doesNotMatch(policy, /Android|Google/);
    assert.match(policy, /received log/);
    assert.match(policy, /keep the screen on/);
  } finally {
    execFileSync(process.execPath, ['scripts/prepare-native.mjs'], { cwd: root });
  }
});
