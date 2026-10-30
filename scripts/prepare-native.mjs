import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = new URL('../native-web/', import.meta.url);
const release = process.argv.includes('--release');
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const outputPath = resolve(fileURLToPath(output));
if (dirname(outputPath) !== root || outputPath !== resolve(root, 'native-web')) throw new Error('Invalid native bundle directory');
await rm(outputPath, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ['index.html', 'privacy.html', 'css', 'js', 'icons', 'favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'manifest.webmanifest']) {
  await cp(new URL(`../${name}`, import.meta.url), new URL(name, output), { recursive: true });
}
await cp(new URL('../native/web/', import.meta.url), output, { recursive: true });
await cp(new URL('../node_modules/@capacitor/core/dist/index.js', import.meta.url), new URL('capacitor.js', output));
let html = await readFile(new URL('index.html', output), 'utf8');
html = html.replace(/  <link[^>]*(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>\r?\n/g, '');
html = html.replace('href="privacy"', 'href="privacy.html"');
html = html.replace('<link rel="stylesheet" href="css/main.css">', '<link rel="stylesheet" href="fonts.css">\n  <link rel="stylesheet" href="css/main.css">');
html = html.replace('Your browser controls the flashlight through a live camera stream.', 'Android requires camera permission to control your flashlight.');
html = html.replaceAll('Allow camera access for your browser in Android settings and for this site in browser settings, then try again.', 'Allow Camera permission for Morse Native Test in Android settings, then try again.');
html = html.replaceAll('A blocked request may not show a new prompt.', 'A blocked request may require a change in app settings.');
html = html.replaceAll('<p class="permission-settings">', '<button class="key" type="button" data-native-settings>OPEN APP SETTINGS</button><p class="permission-settings">');
html = html.replace('<p class="gate-first">', '<label class="native-warning-choice"><input id="remember-flash-warning" type="checkbox"> Don’t show this warning again</label><p class="gate-first">');
html = html.replace(/<ul class="gate-facts">[\s\S]*?<\/ul>/, '');
html = html.replace('<section class="audio-option"', '<p><button class="key" type="button" data-show-flash-warning>SHOW FLASHING-LIGHT WARNING AGAIN</button></p><section class="audio-option"');
html = html.replace('href="fonts.css">', 'href="fonts.css">\n  <link rel="stylesheet" href="native.css">');
if (release) {
  html = html.replaceAll('Morse Native Test', 'Morse');
  for (const name of ['hardware-proof.html', 'hardware-proof.js']) await rm(new URL(name, output));
} else {
  html = html.replace('<section class="audio-option"', '<p><a href="hardware-proof.html">Native hardware diagnostics</a></p>\n    <section class="audio-option"');
}
await writeFile(new URL('index.html', output), html);
const appFile = new URL('js/app.js', output);
let app = await readFile(appFile, 'utf8');
app = app.replace("from './torch.js'", "from './native-channels.js'");
app = app.replace("from './watcher.js'", "from './native-channels.js'");
app = app.replace("if (result.outcome === 'torch-ready') fireTestDot();", '');
app = app.replace('shareUrl(encode(messageInput.value, stepId))', "shareUrl(encode(messageInput.value, stepId), { href: 'https://morse.graydonwasil.com/' })");
await writeFile(appFile, app);
console.log(`Bundled Morse assets for ${release ? 'release' : 'hardware testing'}.`);
