import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { delegatedPnpmArgs, isPinnedPkgDlx, patchSealedPkgPrelude, stageSealedPkgToolchain } from '../..//tools/dsh/pnpm-dsh-build-wrapper.mjs';

test('DSH source-build wrapper intercepts only the exact pinned pkg dlx invocation', () => {
  assert.equal(isPinnedPkgDlx(['dlx', '@yao-pkg/pkg@6.21.0', 'input']), true);
  assert.equal(isPinnedPkgDlx(['dlx', '@yao-pkg/pkg@6.21.1', 'input']), false);
  assert.equal(isPinnedPkgDlx(['exec', '@yao-pkg/pkg@6.21.0']), false);
});

test('offline DSH source builds force dependency-materializing pnpm commands to fail closed on cache misses', () => {
  assert.deepEqual(delegatedPnpmArgs(['install', '--production'], true), ['--offline', 'install', '--production', '--ignore-scripts']);
  assert.deepEqual(delegatedPnpmArgs(['install', '--offline'], true), ['--offline', 'install', '--offline', '--ignore-scripts']);
  assert.deepEqual(delegatedPnpmArgs(['exec', 'tsx', 'build.ts'], true), ['exec', 'tsx', 'build.ts']);
  assert.deepEqual(delegatedPnpmArgs(['--filter', 'closure', 'deploy'], true), ['--offline', '--filter', 'closure', 'deploy']);
  assert.deepEqual(delegatedPnpmArgs(['install', '--production'], false), ['install', '--production']);
  assert.deepEqual(delegatedPnpmArgs(['exec', 'tsx', 'build.ts'], true, true), ['exec', 'tsx', 'build.ts']);
  assert.deepEqual(delegatedPnpmArgs(['install', '--production'], true, true), ['--offline', 'install', '--production', '--ignore-scripts', '--pm-on-fail=ignore']);
  assert.deepEqual(delegatedPnpmArgs(['exec', 'tsx', '--pm-on-fail=warn'], false, true), ['exec', 'tsx', '--pm-on-fail=warn']);
});

test('sealed pkg prelude replaces dynamic cache extraction with a fail-closed resource lookup', () => {
  const prelude = [
    'before',
    '    function patchDlopen(insideSnapshot) {',
    '      dynamic extraction',
    '    }',
    '    function patchChildProcess(entrypoint) {',
    'after',
  ].join('\n');
  const patched = patchSealedPkgPrelude(prelude);
  assert.match(patched, /CINDY_DSH_SEALED_PKG_CACHE_DIR/);
  assert.match(patched, /sealed native cache entry is unavailable/);
  assert.doesNotMatch(patched.slice(patched.indexOf('function patchDlopen'), patched.indexOf('function patchChildProcess')), /dynamic extraction/);
  assert.throws(() => patchSealedPkgPrelude('no reviewed prelude'), /reviewed SEA dlopen prelude/);
});

test('sealed pkg staging contains the complete frozen runtime closure without symlinks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-pkg-toolchain-'));
  try {
    const staged = stageSealedPkgToolchain(root);
    assert.equal(fs.lstatSync(staged.stagedEntry).isSymbolicLink(), false);
    const version = spawnSync(process.execPath, [staged.stagedEntry, '--version'], { encoding: 'utf8' });
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout.trim(), '6.21.0');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function runSealedDlopen({ sourcePath, cacheRoot, insideSnapshot = true, forbidWrites = true }) {
  const originalDlopenCalls = [];
  const process = {
    env: { CINDY_DSH_SEALED_PKG_CACHE_DIR: cacheRoot },
    dlopen(...args) {
      originalDlopenCalls.push(args);
      return 'native-loaded';
    },
  };
  const sandboxFs = Object.assign({}, fs, {
    mkdirSync: forbidWrites ? () => { throw new Error('sealed pkg prelude must not create a cache directory'); } : fs.mkdirSync,
    writeFileSync: forbidWrites ? () => { throw new Error('sealed pkg prelude must not write a cache entry'); } : fs.writeFileSync,
  });
  const prelude = [
    'function install(insideSnapshot) {',
    '    function patchDlopen(insideSnapshot) {',
    '      placeholder',
    '    }',
    '    function patchChildProcess(entrypoint) {}',
    '    patchDlopen(insideSnapshot);',
    '}',
    `install(() => ${insideSnapshot ? 'true' : 'false'});`,
    `globalThis.result = process.dlopen({}, ${JSON.stringify(sourcePath)});`,
  ].join('\n');
  const context = { createHash, fs: sandboxFs, homedir: () => '/must-not-be-used', path, process };
  vm.runInNewContext(patchSealedPkgPrelude(prelude), context, { timeout: 1_000 });
  return { calls: originalDlopenCalls, result: context.result };
}

test('sealed pkg prelude maps a snapshot add-on to its signed cache without creating or copying anything', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-pkg-prelude-'));
  try {
    const source = path.join(root, 'snapshot', 'node_modules', '@scope', 'native-package', 'native.node');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, 'native-source-bytes');
    const digest = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    const cacheRoot = path.join(root, 'signed-helper-resource');
    const cached = path.join(cacheRoot, 'pkg', digest, '@scope', 'native-package', 'native.node');
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.writeFileSync(cached, 'already-signed-native-bytes');

    const outcome = runSealedDlopen({ sourcePath: source, cacheRoot });
    assert.equal(outcome.result, 'native-loaded');
    assert.equal(outcome.calls.length, 1);
    assert.equal(outcome.calls[0][1], cached);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sealed pkg prelude leaves non-snapshot paths untouched and rejects missing or symlinked cache entries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-pkg-prelude-'));
  try {
    const source = path.join(root, 'snapshot', 'node_modules', 'native-package', 'native.node');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, 'native-source-bytes');
    const digest = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    const cacheRoot = path.join(root, 'signed-helper-resource');
    fs.mkdirSync(cacheRoot);

    assert.throws(
      () => runSealedDlopen({ sourcePath: source, cacheRoot }),
      /sealed native cache entry is unavailable/,
    );

    const cached = path.join(cacheRoot, 'pkg', digest, 'native-package', 'native.node');
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.symlinkSync(source, cached);
    assert.throws(
      () => runSealedDlopen({ sourcePath: source, cacheRoot }),
      /sealed native cache entry is unavailable/,
    );

    const undeclared = path.join(root, 'snapshot', 'undeclared-native.node');
    fs.writeFileSync(undeclared, 'undeclared-native-source');
    assert.throws(
      () => runSealedDlopen({ sourcePath: undeclared, cacheRoot }),
      /sealed native module is outside node_modules/,
    );

    const ordinary = path.join(root, 'ordinary.node');
    fs.writeFileSync(ordinary, 'not-a-snapshot');
    const outcome = runSealedDlopen({ sourcePath: ordinary, cacheRoot, insideSnapshot: false });
    assert.equal(outcome.result, 'native-loaded');
    assert.equal(outcome.calls.length, 1);
    assert.equal(outcome.calls[0][1], ordinary);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
