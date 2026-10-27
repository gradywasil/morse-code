import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = new URL('../native-web/', import.meta.url);
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
await writeFile(new URL('index.html', output), html);
console.log('Bundled Morse assets and native hardware test page.');
