import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  packageSourceRuntime,
  readSourceRelease,
} from '../../../scripts/dsh-source-build-release.mjs';
import { stageMacDshSupervisedRuntime } from './stage-dsh-macos-supervised-runtime.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const releasePath = path.join(repoRoot, 'tools/dsh/macos-supervised-source-release.json');

function writeInfoPlist(destination, identifier) {
  fs.writeFileSync(destination, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string></dict></plist>
`);
}

function signedEntitlements(candidate) {
  const result = spawnSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', candidate], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(result.status, 0, `codesign entitlement inspection failed: ${result.stderr || result.stdout}`);
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

test('staged macOS Helper moves the archive-bound pkg native cache into its signed resource root', {
  skip: process.platform !== 'darwin' || process.arch !== 'arm64',
}, () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-stage-pkg-cache-')));
  try {
    const release = readSourceRelease(releasePath);
    const runtime = path.join(root, release.runtime.directory);
    const target = release.targets['darwin-arm64'];
    fs.mkdirSync(runtime, { recursive: true });
    for (const relative of [target.executable, ...target.sidecars, ...target.nativeAddons.map((addon) => addon.sourcePath)]) {
      const destination = path.join(runtime, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync('/usr/bin/true', destination);
      fs.chmodSync(destination, relative.endsWith('.node') ? 0o644 : 0o755);
    }
    const cacheRoot = path.join(runtime, target.pkgNativeCache.sourceDirectory, target.pkgNativeCache.cacheDirectory, 'fixture-hash');
    const cacheNative = path.join(cacheRoot, '@scope', 'fixture', 'native.node');
    const cacheLibrary = path.join(cacheRoot, '@scope', 'fixture', 'libfixture.dylib');
    fs.mkdirSync(path.dirname(cacheNative), { recursive: true });
    fs.copyFileSync('/usr/bin/true', cacheNative);
    fs.copyFileSync('/usr/bin/true', cacheLibrary);
    fs.chmodSync(cacheNative, 0o644);
    fs.chmodSync(cacheLibrary, 0o644);

    const built = packageSourceRuntime({
      release,
      sourceRoot: root,
      targetKey: 'darwin-arm64',
      outputDir: path.join(root, 'archive'),
    });
    const app = path.join(root, 'Cindy.app');
    const resources = path.join(app, 'Contents', 'Resources');
    fs.mkdirSync(resources, { recursive: true });
    writeInfoPlist(path.join(app, 'Contents', 'Info.plist'), 'com.example.cindy');

    const staged = stageMacDshSupervisedRuntime({
      appPath: app,
      archivePath: built.archivePath,
      manifestPath: built.manifestPath,
      releasePath,
    });
    const helperResources = path.join(app, 'Contents', 'Helpers', 'Cindy DSH Supervisor.app', 'Contents', 'Resources');
    const descriptor = JSON.parse(fs.readFileSync(path.join(helperResources, 'cindy-dsh-supervised-runtime.json'), 'utf8'));
    const stagedCache = path.join(helperResources, 'dsh-pkg-native-cache', 'pkg', 'fixture-hash', '@scope', 'fixture');
    assert.equal(staged.pkgNativeCache, path.join(helperResources, 'dsh-pkg-native-cache'));
    assert.deepEqual(descriptor.requiredPkgNativeCache, target.pkgNativeCache);
    assert.ok(fs.lstatSync(path.join(stagedCache, 'native.node')).isFile());
    assert.ok(fs.lstatSync(path.join(stagedCache, 'libfixture.dylib')).isFile());
    assert.equal(fs.existsSync(path.join(helperResources, 'dsh-runtime', target.pkgNativeCache.sourceDirectory)), false);
    const runtimeEntitlements = signedEntitlements(staged.runtime);
    assert.match(runtimeEntitlements, /com\.apple\.security\.app-sandbox/);
    assert.match(runtimeEntitlements, /com\.apple\.security\.inherit/);
    assert.match(runtimeEntitlements, /com\.apple\.security\.cs\.allow-jit/);
    assert.match(runtimeEntitlements, /com\.apple\.security\.cs\.disable-library-validation/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
