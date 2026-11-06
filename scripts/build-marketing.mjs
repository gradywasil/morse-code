import { copyFile, cp, lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const marketing = await realpath(join(root, 'marketing'));
const output = resolve(root, 'marketing/dist');
if (output !== join(marketing, 'dist')) throw new Error('Marketing output must stay inside the project.');
const existing = await lstat(output).catch(error => { if (error.code !== 'ENOENT') throw error; });
if (existing?.isSymbolicLink()) throw new Error('Marketing output must not be a directory link.');
await rm(output, { recursive: true, force: true });

for (const [source, destination] of [
  ['marketing/index.html', 'index.html'],
  ['marketing/site.css', 'site.css'],
  ['marketing/site.js', 'site.js'],
  ['favicon.svg', 'favicon.svg'],
  ['js/morse.js', 'js/morse.js'],
  ['js/schedule.js', 'js/schedule.js'],
  ['js/hash.js', 'js/hash.js'],
  ['assets/plates/paper-material.png', 'assets/plates/paper-material.png'],
]) {
  const target = join(output, destination);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(root, source), target);
}

const deliveryTypes = new Set(['.webp', '.ttf', '.woff2', '.txt']);
await cp(join(marketing, 'assets'), join(output, 'assets'), {
  recursive: true,
  filter: async source => (await lstat(source)).isDirectory() || deliveryTypes.has(extname(source)),
});
console.log('Marketing release built in marketing/dist.');
