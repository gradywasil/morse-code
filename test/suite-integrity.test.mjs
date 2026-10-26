// T-Q1 — suite-integrity meta-test.
//
// Purpose: prove the single-command suite (`npm test` → `node --test 'test/*.test.mjs'`)
// cannot silently skip a test file. Three independent guards:
//
//   1. package.json's test script stays the glob form that resolves on this Node
//      (per T-F2: bare `node --test test/` fails to resolve the directory on
//      Node 24.8.0), and the artifact stays dependency-free.
//   2. No test-looking file anywhere under test/ escapes the glob. The silent-skip
//      failure mode is path/extension drift: a file like `test/unit/foo.test.mjs`
//      (the glob's `*` does not cross `/`) or `foo.spec.mjs` would never run and
//      nothing would fail. This guard fails loudly instead.
//   3. The runner's OWN glob discovery is exercised for real: the suite is spawned
//      with a never-matching `--test-name-pattern` so test bodies are skipped and
//      only module loads + per-file reporting happen, then the TAP file list is
//      compared against the on-disk `*.test.mjs` set (same count, same names).
//
//      The fact that this test is executing at all is itself live proof for one
//      file; guard 3 extends the proof to every file, this one included.

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

// No trailing slash (dirname form), so path.dirname() comparisons below hold.
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..');
// Must stay byte-identical to the glob in package.json's test script.
const GLOB = 'test/*.test.mjs';
// Set in the discovery-probe child so this file's own test bodies are skipped
// there by an independent mechanism (they are already filtered out by the
// never-matching name pattern) — a belt-and-braces recursion guard.
const CHILD_GUARD = 'MORSE_SUITE_INTEGRITY_PROBE';

const onDiskRelative = () =>
  readdirSync(TEST_DIR)
    .filter((f) => f.endsWith('.test.mjs'))
    .map((f) => `test/${f}`)
    .sort();

test('npm test runs the glob form that resolves on this Node, and package.json stays dependency-free', () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.private, true, 'package.json must stay private');
  assert.equal(pkg.type, 'module', 'the js/ modules are ESM');
  assert.equal(pkg.dependencies, undefined, 'no dependencies, ever (PRODUCT.md: no build step)');
  assert.equal(pkg.devDependencies, undefined, 'no devDependencies, ever');
  const script = pkg.scripts?.test ?? '';
  // Double quotes work in both cmd.exe (npm on Windows) and POSIX shells.
  assert.equal(
    script,
    `node --test "${GLOB}"`,
    'the glob must use double quotes; cmd.exe passes single quotes literally and Node runs zero tests'
  );
});

test('no test-looking file under test/ escapes the glob (path or extension drift = silent skip)', () => {
  const onDisk = onDiskRelative();
  assert.ok(
    onDisk.includes('test/suite-integrity.test.mjs'),
    'this file must itself be glob-matched — if it is not, this test never runs'
  );
  assert.ok(onDisk.length >= 9, 'expected the nine logic suites to be present');

  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const p = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(p) : [p];
    });
  const strays = walk(TEST_DIR).filter(
    (p) =>
      /\.(test|spec)\.(js|mjs|cjs)$/.test(p) &&
      !(path.dirname(p) === TEST_DIR && p.endsWith('.test.mjs'))
  );
  assert.deepEqual(
    strays.map((p) => path.relative(REPO_ROOT, p)),
    [],
    'files above are test-like but not matched by the glob; they would be silently skipped'
  );
});

test(
  'the runner actually discovers every on-disk *.test.mjs via the glob (count + names, this file included)',
  { skip: process.env[CHILD_GUARD] === '1' ? 'discovery probe child: test bodies never execute there' : false },
  () => {
    const onDisk = onDiskRelative();
    // NODE_TEST_CONTEXT marks this process as a runner file-child; a spawned
    // `node --test` inheriting it detects recursion and silently skips every
    // file (exit 0, empty output) — it must be stripped for a real discovery run.
    const env = { ...process.env, [CHILD_GUARD]: '1' };
    delete env.NODE_TEST_CONTEXT;
    const probe = spawnSync(
      process.execPath,
      ['--test', '--test-name-pattern', '__suite_integrity_probe_never_matches__', '--test-reporter=tap', GLOB],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120_000, env }
    );
    assert.equal(probe.error, undefined, String(probe.error));
    assert.ok(!/recursively/.test(probe.stderr), `discovery probe was skipped as recursive:\n${probe.stderr}`);
    assert.equal(probe.status, 0, `discovery probe exited nonzero\nstdout:\n${probe.stdout}\nstderr:\n${probe.stderr}`);
    // Top-level `# Subtest:` lines sit at column 0; anything nested is indented.
    const discovered = [...probe.stdout.matchAll(/^# Subtest: (\S+)$/gm)]
      .map((m) => m[1].replace(/\\+/g, '/')).sort();
    assert.deepEqual(
      discovered,
      onDisk,
      'runner glob discovery does not match the on-disk test file set — files above differ'
    );
    assert.ok(
      discovered.includes('test/suite-integrity.test.mjs'),
      'this file must appear in the runner discovery output'
    );
  }
);
