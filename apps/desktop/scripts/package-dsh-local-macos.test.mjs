import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertRegularLocalFile,
  assertLocalOnlyPackagedResources,
  createLocalDshMacPackageEnv,
  localDshMacE2eArgs,
  localDshMacForgeArgs,
  parseLocalDshMacPackageArgs,
  writeElectronEntitlements,
} from './package-dsh-local-macos.mjs';

test('local DSH macOS package rejects symlinked runtime inputs before resolution', () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-package-input-'));
  try {
    const regular = path.join(fixtureDir, 'runtime.tar.gz');
    const symlink = path.join(fixtureDir, 'runtime-link.tar.gz');
    fs.writeFileSync(regular, 'local test artifact');
    fs.symlinkSync(regular, symlink);

    assert.equal(assertRegularLocalFile(regular, 'DSH archive'), fs.realpathSync(regular));
    assert.throws(
      () => assertRegularLocalFile(symlink, 'DSH archive'),
      /must be a local regular file/,
    );
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('local DSH macOS package rejects remote or iOS resources in its output App', () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-package-output-'));
  try {
    const resources = path.join(fixtureDir, 'Cindy.app', 'Contents', 'Resources');
    fs.mkdirSync(resources, { recursive: true });
    assert.doesNotThrow(() => assertLocalOnlyPackagedResources(path.join(fixtureDir, 'Cindy.app')));
    fs.mkdirSync(path.join(resources, 'remote-file-service'));
    assert.throws(
      () => assertLocalOnlyPackagedResources(path.join(fixtureDir, 'Cindy.app')),
      /excluded resource: remote-file-service/,
    );
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('local DSH macOS package accepts only explicit local archive and manifest inputs', () => {
  assert.deepEqual(
    parseLocalDshMacPackageArgs([
      '--archive',
      '/private/tmp/dsh.tar.gz',
      '--manifest',
      '/private/tmp/dsh.json',
    ]),
    { archive: '/private/tmp/dsh.tar.gz', manifest: '/private/tmp/dsh.json', region: 'global' },
  );
  assert.deepEqual(
    parseLocalDshMacPackageArgs([
      '--archive',
      '/private/tmp/dsh.tar.gz',
      '--manifest',
      '/private/tmp/dsh.json',
      '--region',
      'cn',
    ]),
    { archive: '/private/tmp/dsh.tar.gz', manifest: '/private/tmp/dsh.json', region: 'cn' },
  );
  assert.throws(
    () => parseLocalDshMacPackageArgs(['--archive', '/one', '--archive', '/two', '--manifest', '/m']),
    /usage:/,
  );
  assert.throws(
    () => parseLocalDshMacPackageArgs(['--archive', '/one', '--manifest', '/m', '--region', 'dev']),
    /usage:/,
  );
});

test('local DSH macOS package fixes the Forge target and carries only local runtime inputs', () => {
  const env = createLocalDshMacPackageEnv(
    { archive: '/private/tmp/dsh.tar.gz', manifest: '/private/tmp/dsh.json', region: 'global' },
    { PATH: '/usr/bin:/bin', KEEP: 'value' },
  );
  assert.equal(env.KEEP, 'value');
  assert.equal(env.CINDY_DSH_LOCAL_MACOS_PACKAGE, '1');
  assert.equal(env.CINDY_DSH_MACOS_SUPERVISED_ARCHIVE, '/private/tmp/dsh.tar.gz');
  assert.equal(env.CINDY_DSH_MACOS_SUPERVISED_MANIFEST, '/private/tmp/dsh.json');
  assert.equal(env.ELECTRON_FORGE_PLATFORM, 'darwin');
  assert.equal(env.ELECTRON_FORGE_ARCH, 'arm64');
  assert.match(env.NODE_OPTIONS, /--max-old-space-size=8192/);
  assert.deepEqual(localDshMacForgeArgs(), [
    'exec',
    'electron-forge',
    'package',
    '--platform=darwin',
    '--arch=arm64',
  ]);
  assert.deepEqual(localDshMacE2eArgs(), [
    '--filter',
    'desktop',
    'exec',
    'vitest',
    'run',
    'src/main/dsh-host/__tests__/macos-supervised-runtime.integration.test.ts',
  ]);
});

test('local DSH macOS package preserves an explicit caller heap setting', () => {
  const env = createLocalDshMacPackageEnv(
    { archive: '/private/tmp/dsh.tar.gz', manifest: '/private/tmp/dsh.json', region: 'global' },
    { NODE_OPTIONS: '--max-old-space-size=12288' },
  );
  assert.equal(env.NODE_OPTIONS, '--max-old-space-size=12288');
});

test('local DSH macOS signer keeps the Cindy process profile-compatible and the DSH Helper separate', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-package-entitlements-'));
  try {
    const { helper, main } = writeElectronEntitlements(fixtureDir);
    const helperEntitlements = fs.readFileSync(helper, 'utf8');
    const mainEntitlements = fs.readFileSync(main, 'utf8');

    for (const entitlements of [helperEntitlements, mainEntitlements]) {
      assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/);
      assert.match(entitlements, /com\.apple\.security\.device\.audio-input/);
      assert.doesNotMatch(entitlements, /com\.apple\.security\.app-sandbox/);
      assert.doesNotMatch(entitlements, /com\.apple\.security\.inherit/);
      assert.doesNotMatch(entitlements, /files\.user-selected\.read-write/);
      assert.doesNotMatch(entitlements, /files\.bookmarks\.app-scope/);
    }
    assert.match(mainEntitlements, /com\.apple\.security\.automation\.apple-events/);
    assert.doesNotMatch(helperEntitlements, /com\.apple\.security\.automation\.apple-events/);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }

  const source = await fs.promises.readFile(
    new URL('./package-dsh-local-macos.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /Contents\/Helpers and is deliberately absent from this traversal/);
  assert.match(source, /assertDshHelperEntitlements\(appPath\)/);
  assert.match(source, /assertDshMainProfileCompatibleEntitlements\(appPath\)/);
  assert.match(source, /assertDshMainBookmarkBridge\(appPath\)/);
  assert.match(source, /cindy-dsh-main-bookmark-bridge\.node/);
  assert.match(source, /writeMacEntitlements\(helper\)/);
  assert.match(source, /writeMacEntitlements\(main, \{ appleEvents: true \}\)/);
  assert.doesNotMatch(source, /--deep[^\n]*--sign/);
});
