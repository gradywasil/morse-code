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
  const policy = readFileSync(new URL('../native-web/privacy.html', import.meta.url), 'utf8');
  assert.match(policy, /bundles its interface and fonts/);
  assert.doesNotMatch(policy, /loads typefaces from/);
  const fontCss = readFileSync(new URL('../native-web/fonts.css', import.meta.url), 'utf8');
  assert.doesNotMatch(fontCss, /https?:/);
  assert.match(fontCss, /url\(fonts\//);
});
