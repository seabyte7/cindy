#!/usr/bin/env node
/**
 * Stage the locally verified DSH supervised runtime inside a macOS Cindy App
 * bundle. This is deliberately an opt-in packaging step: it has no download,
 * source checkout, userData installer, system-runtime fallback, or non-macOS
 * target. The caller must hand it the exact local archive/manifest produced
 * from tools/dsh/macos-supervised-source-release.json.
 */
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  extractVerifiedRuntimeBundle,
  readSourceRelease,
  verifyReleaseBundle,
} from '../../../scripts/dsh-source-build-release.mjs';

const TARGET = 'darwin-arm64';
const SUPERVISOR_NAME = 'cindy-dsh-sandbox-supervisor';
const SUPERVISOR_BUNDLE_NAME = 'Cindy DSH Supervisor.app';
const RUNTIME_DESCRIPTOR_NAME = 'cindy-dsh-supervised-runtime.json';
const PKG_NATIVE_CACHE_STAGE_NAME = 'dsh-pkg-native-cache';
const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const EXPECTED_RELEASE_PATH = path.join(REPO_ROOT, 'tools/dsh/macos-supervised-source-release.json');
const SUPERVISOR_SOURCE = path.join(REPO_ROOT, 'apps/desktop/native/dsh/macos-dsh-sandbox-supervisor.c');
const IMPLICIT_BOOKMARK_SOURCE = path.join(REPO_ROOT, 'apps/desktop/native/dsh/macos-dsh-implicit-bookmark.m');
const MAIN_BOOKMARK_BRIDGE_SOURCE = path.join(REPO_ROOT, 'apps/desktop/native/dsh/macos-dsh-main-bookmark-bridge.mm');
const SUPERVISOR_ENTITLEMENTS = path.join(REPO_ROOT, 'apps/desktop/native/dsh/macos-dsh-sandbox-supervisor.entitlements');
const RUNTIME_ENTITLEMENTS = path.join(REPO_ROOT, 'apps/desktop/native/dsh/macos-dsh-runtime-inherit.entitlements');
const MAIN_BOOKMARK_BRIDGE_NAME = 'cindy-dsh-main-bookmark-bridge.node';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error('arguments must be --key value pairs');
    }
    const normalized = key.slice(2);
    if (!['app', 'archive', 'manifest', 'release'].includes(normalized) || values[normalized] !== undefined) {
      throw new Error('only one each of --app --archive --manifest --release is supported');
    }
    values[normalized] = value;
  }
  if (!values.app || !values.archive || !values.manifest || !values.release) {
    throw new Error('usage: stage-dsh-macos-supervised-runtime --app <Cindy.app> --archive <local-tar.gz> --manifest <local-json> --release <checked-in-json>');
  }
  return values;
}

function assertRegularFile(candidate, label, { executable = false } = {}) {
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink() || (executable && (stat.mode & 0o100) === 0)) {
    throw new Error(`${label} must be a regular${executable ? ' executable' : ''} file`);
  }
}

function assertRealDirectory(candidate, label) {
  const stat = fs.lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(candidate) !== path.resolve(candidate)) {
    throw new Error(`${label} must be a real directory`);
  }
}

function assertDirectChild(root, candidate, label) {
  if (path.dirname(candidate) !== root) throw new Error(`${label} must be a direct child of its app bundle directory`);
}

function removeManagedDestination(candidate, label) {
  if (!fs.existsSync(candidate)) return;
  const stat = fs.lstatSync(candidate);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} is not a removable managed directory`);
  }
  fs.rmSync(candidate, { recursive: true, force: false });
}

function removeManagedFile(candidate, label) {
  if (!fs.existsSync(candidate)) return;
  const stat = fs.lstatSync(candidate);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} is not a removable managed file`);
  }
  fs.unlinkSync(candidate);
}

function nodeIncludeDirectory() {
  const installation = path.resolve(path.dirname(process.execPath), '..');
  const include = path.join(installation, 'include', 'node');
  assertRegularFile(path.join(include, 'node_api.h'), 'Node N-API header');
  return include;
}

function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed${result.status === null ? '' : ` (exit ${result.status})`}: ${(result.stderr || result.error?.message || '').trim()}`);
  }
}

function parentBundleIdentifier(infoPlist) {
  assertRegularFile(infoPlist, 'parent app Info.plist');
  const result = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', infoPlist], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const identifier = result.status === 0 ? result.stdout.trim() : '';
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(identifier)) {
    throw new Error('parent app must have a valid CFBundleIdentifier before staging DSH');
  }
  return identifier;
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function writeSupervisorInfoPlist(destination, identifier) {
  fs.writeFileSync(destination, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>${escapeXml(identifier)}</string>
  <key>CFBundleExecutable</key><string>${SUPERVISOR_NAME}</string>
  <key>CFBundleName</key><string>Cindy DSH Supervisor</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.2</string>
  <key>CFBundleVersion</key><string>3</string>
  <key>LSBackgroundOnly</key><true/>
</dict></plist>
`, { mode: 0o644 });
}

/**
 * This is an identity record for Desktop Main, not a launcher instruction.
 * The native supervisor derives all executable paths from its own bundle and
 * never reads it. Keeping the record inside the separately signed Helper.app
 * means Main can reject a missing or mismatched package without accepting a
 * path, command, runtime or credential from mutable user state.
 */
function writeRuntimeDescriptor(destination, { release, manifest, parentIdentifier }) {
  fs.writeFileSync(destination, `${JSON.stringify({
    formatVersion: 1,
    target: TARGET,
    releaseId: release.releaseId,
    expectedVersion: release.runtime.expectedVersion,
    parentBundleIdentifier: parentIdentifier,
    helperBundleIdentifier: `${parentIdentifier}.dsh-supervisor`,
    supervisorExecutable: SUPERVISOR_NAME,
    runtimeExecutable: manifest.runtime.executable,
    requiredSidecars: manifest.runtime.requiredSidecars,
    requiredNativeAddons: manifest.runtime.requiredNativeAddons,
    requiredPkgNativeCache: manifest.runtime.requiredPkgNativeCache,
  }, null, 2)}\n`, { mode: 0o644 });
}

function signAdHoc(candidate, entitlements) {
  const args = ['--force', '--sign', '-', '--options', 'runtime'];
  if (entitlements) args.push('--entitlements', entitlements);
  args.push(candidate);
  run('/usr/bin/codesign', args, `codesign ${path.basename(candidate)}`);
  run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', candidate], `codesign verify ${path.basename(candidate)}`);
}

/**
 * `codesign --verify` proves the signature is internally valid, not that the
 * expected capability was actually embedded. The separately signed Helper is
 * deliberately not the app-scoped-bookmark owner: that persistent authority
 * is tied to Cindy Main's signing identity. F7 will pass only a one-shot
 * implicit bookmark, so fail staging if a signer expands Helper file access.
 */
function assertSignedBooleanEntitlement(candidate, entitlement) {
  const result = spawnSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', candidate], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const marker = `<key>${entitlement}</key>`;
  const start = output.indexOf(marker);
  if (result.error || result.status !== 0 || start === -1 || !/<true\s*\/>/.test(output.slice(start, start + 128))) {
    throw new Error(`signed ${path.basename(candidate)} is missing required ${entitlement} entitlement`);
  }
}

function assertMissingEntitlement(candidate, entitlement) {
  const result = spawnSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', candidate], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.error || result.status !== 0 || output.includes(`<key>${entitlement}</key>`)) {
    throw new Error(`signed ${path.basename(candidate)} must not contain ${entitlement}`);
  }
}

function sameReleaseInputs(release, manifest) {
  return manifest.releaseId === release.releaseId
    && manifest.target === TARGET
    && isDeepStrictEqual(manifest.source, release.source)
    && isDeepStrictEqual(manifest.builder, release.builder)
    && isDeepStrictEqual(manifest.targets, release.targets)
    && manifest.runtime?.expectedVersion === release.runtime.expectedVersion
    && isDeepStrictEqual(manifest.runtime?.acpHandshake, release.runtime.acpHandshake);
}

/** Copy only a previously archive-verified cache tree; links are never data. */
function copyVerifiedTree(source, destination) {
  assertRealDirectory(source, 'verified pkg native-cache source');
  fs.mkdirSync(destination, { mode: 0o755 });
  const copied = [];
  function visit(from, to, relative) {
    for (const entry of fs.readdirSync(from, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const sourceEntry = path.join(from, entry.name);
      const targetEntry = path.join(to, entry.name);
      const entryRelative = path.join(relative, entry.name);
      const stat = fs.lstatSync(sourceEntry);
      if (stat.isSymbolicLink()) throw new Error(`verified pkg native-cache contains a symlink: ${entryRelative}`);
      if (stat.isDirectory()) {
        fs.mkdirSync(targetEntry, { mode: 0o755 });
        visit(sourceEntry, targetEntry, entryRelative);
      } else if (stat.isFile()) {
        fs.copyFileSync(sourceEntry, targetEntry, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(targetEntry, 0o644);
        copied.push(targetEntry);
      } else {
        throw new Error(`verified pkg native-cache contains a non-regular entry: ${entryRelative}`);
      }
    }
  }
  visit(source, destination, '');
  if (copied.length === 0) throw new Error('verified pkg native-cache is empty');
  return copied;
}

function isNativeCodePath(candidate) {
  return candidate.endsWith('.node') || candidate.endsWith('.dylib');
}

export function stageMacDshSupervisedRuntime({ appPath, archivePath, manifestPath, releasePath }) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error(`DSH supervised staging is limited to local ${TARGET}, got ${process.platform}-${process.arch}`);
  }
  const expectedRelease = fs.realpathSync(EXPECTED_RELEASE_PATH);
  const requestedRelease = fs.realpathSync(releasePath);
  if (requestedRelease !== expectedRelease) {
    throw new Error('DSH supervised staging accepts only the checked-in macOS supervised source release');
  }
  assertRegularFile(requestedRelease, 'source release');
  assertRegularFile(archivePath, 'source-built runtime archive');
  assertRegularFile(manifestPath, 'source-built runtime manifest');
  assertRegularFile(SUPERVISOR_SOURCE, 'native supervisor source');
  assertRegularFile(IMPLICIT_BOOKMARK_SOURCE, 'native implicit-bookmark source');
  assertRegularFile(MAIN_BOOKMARK_BRIDGE_SOURCE, 'native Main bookmark bridge source');
  assertRegularFile(SUPERVISOR_ENTITLEMENTS, 'native supervisor entitlements');
  assertRegularFile(RUNTIME_ENTITLEMENTS, 'runtime entitlements');

  const release = readSourceRelease(requestedRelease);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!sameReleaseInputs(release, manifest)) {
    throw new Error('source-built runtime manifest is not bound to the checked-in supervised source release');
  }
  verifyReleaseBundle({ manifest, archivePath });

  const app = path.resolve(appPath);
  assertRealDirectory(app, 'packaged macOS app');
  if (!app.endsWith('.app')) throw new Error('packaged macOS app must end with .app');
  const contents = path.join(app, 'Contents');
  const resources = path.join(contents, 'Resources');
  assertRealDirectory(contents, 'app Contents');
  assertRealDirectory(resources, 'app Resources');
  const parentIdentifier = parentBundleIdentifier(path.join(contents, 'Info.plist'));
  const helpers = path.join(contents, 'Helpers');
  if (fs.existsSync(helpers)) {
    assertRealDirectory(helpers, 'app Helpers');
  } else {
    fs.mkdirSync(helpers, { mode: 0o755 });
  }
  const supervisorDestination = path.join(helpers, SUPERVISOR_BUNDLE_NAME);
  assertDirectChild(helpers, supervisorDestination, 'supervisor helper destination');
  const mainBookmarkBridgeDestination = path.join(resources, MAIN_BOOKMARK_BRIDGE_NAME);
  assertDirectChild(resources, mainBookmarkBridgeDestination, 'Main bookmark bridge destination');

  const stageRoot = fs.mkdtempSync(path.join(helpers, '.cindy-dsh-macos-stage-'));
  try {
    const helperBundleStage = path.join(stageRoot, SUPERVISOR_BUNDLE_NAME);
    const helperContentsStage = path.join(helperBundleStage, 'Contents');
    const helperResourcesStage = path.join(helperContentsStage, 'Resources');
    const helperMacOSStage = path.join(helperContentsStage, 'MacOS');
    const runtimeStage = path.join(helperResourcesStage, 'dsh-runtime');
    const cacheStage = path.join(helperResourcesStage, 'dsh-native-addons');
    const pkgCacheStage = path.join(helperResourcesStage, PKG_NATIVE_CACHE_STAGE_NAME);
    const supervisorStage = path.join(helperMacOSStage, SUPERVISOR_NAME);
    const mainBookmarkBridgeStage = path.join(stageRoot, MAIN_BOOKMARK_BRIDGE_NAME);
    fs.mkdirSync(helperResourcesStage, { recursive: true, mode: 0o755 });
    fs.mkdirSync(helperMacOSStage, { recursive: true, mode: 0o755 });
    writeSupervisorInfoPlist(path.join(helperContentsStage, 'Info.plist'), `${parentIdentifier}.dsh-supervisor`);
    writeRuntimeDescriptor(path.join(helperResourcesStage, RUNTIME_DESCRIPTOR_NAME), {
      release,
      manifest,
      parentIdentifier,
    });
    extractVerifiedRuntimeBundle({ manifest, archivePath, outputDir: runtimeStage });
    fs.mkdirSync(cacheStage, { mode: 0o700 });
    for (const addon of manifest.runtime.requiredNativeAddons) {
      const source = path.join(runtimeStage, addon.sourcePath);
      const cache = path.join(cacheStage, addon.cachePath);
      assertRegularFile(source, 'verified staged native addon');
      fs.mkdirSync(path.dirname(cache), { recursive: true, mode: 0o700 });
      fs.copyFileSync(source, cache, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(cache, 0o644);
    }
    const pkgNativeCache = manifest.runtime.requiredPkgNativeCache;
    if (!pkgNativeCache) throw new Error('source-built runtime is missing its sealed pkg native-cache declaration');
    const pkgCacheSource = path.resolve(runtimeStage, pkgNativeCache.sourceDirectory);
    if (!pkgCacheSource.startsWith(`${runtimeStage}${path.sep}`)) {
      throw new Error('sealed pkg native-cache source escapes the verified runtime');
    }
    const pkgCacheFiles = copyVerifiedTree(pkgCacheSource, pkgCacheStage);
    assertRealDirectory(path.join(pkgCacheStage, pkgNativeCache.cacheDirectory), 'sealed pkg native-cache directory');
    // The cache belongs only to the separately signed Helper resource. Keeping
    // a second inert copy beside the runtime would expand the signed surface
    // without giving the SEA bootstrap another allowed search path.
    fs.rmSync(pkgCacheSource, { recursive: true, force: false });
    run('/usr/bin/xcrun', [
      'clang', '-std=c17', '-Wall', '-Wextra', '-Werror', '-Wpedantic',
      `-DCINDY_DSH_RUNTIME_EXECUTABLE=${JSON.stringify(manifest.runtime.executable)}`,
      SUPERVISOR_SOURCE, IMPLICIT_BOOKMARK_SOURCE, '-framework', 'Foundation', '-fobjc-arc', '-o', supervisorStage,
    ], 'compile native DSH supervisor');
    fs.chmodSync(supervisorStage, 0o755);
    run('/usr/bin/xcrun', [
      'clang++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-Wpedantic',
      '-fobjc-arc', `-I${nodeIncludeDirectory()}`, '-dynamiclib', '-undefined', 'dynamic_lookup',
      MAIN_BOOKMARK_BRIDGE_SOURCE, '-framework', 'Foundation', '-o', mainBookmarkBridgeStage,
    ], 'compile native DSH Main bookmark bridge');
    fs.chmodSync(mainBookmarkBridgeStage, 0o755);

    signAdHoc(path.join(runtimeStage, manifest.runtime.executable), RUNTIME_ENTITLEMENTS);
    for (const sidecar of manifest.runtime.requiredSidecars) {
      signAdHoc(path.join(runtimeStage, sidecar), RUNTIME_ENTITLEMENTS);
    }
    for (const addon of manifest.runtime.requiredNativeAddons) {
      signAdHoc(path.join(cacheStage, addon.cachePath));
    }
    for (const cacheFile of pkgCacheFiles.filter(isNativeCodePath)) {
      signAdHoc(cacheFile);
    }
    signAdHoc(mainBookmarkBridgeStage);
    signAdHoc(helperBundleStage, SUPERVISOR_ENTITLEMENTS);
    assertSignedBooleanEntitlement(helperBundleStage, 'com.apple.security.app-sandbox');
    assertSignedBooleanEntitlement(helperBundleStage, 'com.apple.security.network.client');
    assertMissingEntitlement(helperBundleStage, 'com.apple.security.files.user-selected.read-write');
    assertMissingEntitlement(helperBundleStage, 'com.apple.security.files.bookmarks.app-scope');

    removeManagedDestination(supervisorDestination, 'existing DSH supervisor helper destination');
    fs.renameSync(helperBundleStage, supervisorDestination);
    if (fs.realpathSync(supervisorDestination) !== supervisorDestination) {
      throw new Error('staged DSH supervisor helper became a symlinked app-bundle path');
    }
    removeManagedFile(mainBookmarkBridgeDestination, 'existing DSH Main bookmark bridge destination');
    fs.renameSync(mainBookmarkBridgeStage, mainBookmarkBridgeDestination);
    if (fs.realpathSync(mainBookmarkBridgeDestination) !== mainBookmarkBridgeDestination) {
      throw new Error('staged DSH Main bookmark bridge became a symlinked path');
    }

    return {
      app,
      releaseId: release.releaseId,
      target: TARGET,
      supervisor: path.join(supervisorDestination, 'Contents', 'MacOS', SUPERVISOR_NAME),
      runtime: path.join(supervisorDestination, 'Contents', 'Resources', 'dsh-runtime', manifest.runtime.executable),
      pkgNativeCache: path.join(supervisorDestination, 'Contents', 'Resources', PKG_NATIVE_CACHE_STAGE_NAME),
      mainBookmarkBridge: mainBookmarkBridgeDestination,
    };
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = stageMacDshSupervisedRuntime({
    appPath: args.app,
    archivePath: args.archive,
    manifestPath: args.manifest,
    releasePath: args.release,
  });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', ...result })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`stage-dsh-macos-supervised-runtime: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
