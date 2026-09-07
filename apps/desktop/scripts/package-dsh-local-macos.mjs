#!/usr/bin/env node
/**
 * Build a local-only Cindy darwin-arm64 package with the already verified DSH
 * Helper runtime embedded, then run the signed-Helper bridge E2E against that
 * packaged app.  This is intentionally not a release command: it makes no
 * installer, archive, upload, attestation, remote-agent bundle, iOS asset, or
 * network runtime download.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { writeMacEntitlements } from './ci/lib.mjs';

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..');
const REPO_ROOT = path.resolve(DESKTOP_ROOT, '..', '..');
const SOURCE_RELEASE = path.join(REPO_ROOT, 'tools', 'dsh', 'macos-supervised-source-release.json');
const APP_NAME_BY_REGION = Object.freeze({ global: 'Cindy', cn: 'Cindy' });
const LOCAL_DSH_EXCLUDED_RESOURCES = Object.freeze([
  'cc-manager',
  'anthropic-compat-proxy',
  'remote-file-service',
  'pi-manager',
  'ios-simulator',
]);
const MAIN_BOOKMARK_BRIDGE_NAME = 'cindy-dsh-main-bookmark-bridge.node';

function usage() {
  return [
    'usage: pnpm --filter desktop package:dsh:local-macos --archive <local-tar.gz> --manifest <local-json> [--region global|cn]',
    'The archive and manifest must already exist locally and are verified again by the Forge staging hook.',
  ].join('\n');
}

export function parseLocalDshMacPackageArgs(argv) {
  const values = { archive: null, manifest: null, region: 'global' };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(usage());
    }
    const name = key.slice(2);
    if (!['archive', 'manifest', 'region'].includes(name) || seen.has(name)) {
      throw new Error(usage());
    }
    seen.add(name);
    values[name] = value;
  }
  if (!values.archive || !values.manifest || !['global', 'cn'].includes(values.region)) {
    throw new Error(usage());
  }
  return Object.freeze(values);
}

export function assertRegularLocalFile(candidate, label) {
  // Check the supplied path before resolving it.  lstat(realpath(candidate))
  // would inspect only a symlink's target and accidentally permit a caller to
  // swap the archive/manifest through an indirection after this validation.
  const supplied = fs.lstatSync(candidate);
  if (!supplied.isFile() || supplied.isSymbolicLink()) {
    throw new Error(`${label} must be a local regular file`);
  }
  const resolved = fs.realpathSync(candidate);
  if (!fs.lstatSync(resolved).isFile()) {
    throw new Error(`${label} must resolve to a local regular file`);
  }
  return resolved;
}

function nodeOptionsWithPackagingHeap(nodeOptions = '') {
  // Forge starts Vite worker processes that inherit NODE_OPTIONS.  Cindy's
  // complete Desktop production graph exceeds Node's default ~4 GiB heap on
  // this machine; make the local evidence command match the Desktop typecheck
  // headroom without changing the ordinary package/release commands.
  return /(?:^|\s)--max-old-space-size=\d+(?:\s|$)/.test(nodeOptions)
    ? nodeOptions
    : `${nodeOptions} --max-old-space-size=8192`.trim();
}

export function createLocalDshMacPackageEnv({ archive, manifest, region }, inherited = process.env) {
  return {
    ...inherited,
    NODE_ENV: 'production',
    NODE_OPTIONS: nodeOptionsWithPackagingHeap(inherited.NODE_OPTIONS),
    CINDY_AUTH_REGION: region,
    VITE_CINDY_AUTH_REGION: region,
    ELECTRON_FORGE_PLATFORM: 'darwin',
    ELECTRON_FORGE_ARCH: 'arm64',
    CINDY_DSH_LOCAL_MACOS_PACKAGE: '1',
    CINDY_DSH_MACOS_SUPERVISED_ARCHIVE: archive,
    CINDY_DSH_MACOS_SUPERVISED_MANIFEST: manifest,
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited ${result.status ?? 'without a status'}`);
}

function readReleaseId() {
  const release = JSON.parse(fs.readFileSync(SOURCE_RELEASE, 'utf8'));
  if (!release || typeof release.releaseId !== 'string' || !release.releaseId) {
    throw new Error('checked-in DSH macOS source release is invalid');
  }
  return release.releaseId;
}

function assertDshHelperEntitlements(appPath) {
  const helper = path.join(
    appPath,
    'Contents',
    'Helpers',
    'Cindy DSH Supervisor.app',
  );
  const inspected = spawnSync(
    '/usr/bin/codesign',
    ['-d', '--entitlements', ':-', helper],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const output = `${inspected.stdout || ''}\n${inspected.stderr || ''}`;
  if (
    inspected.error ||
    inspected.status !== 0 ||
    !/<key>com\.apple\.security\.app-sandbox<\/key>\s*<true\s*\/>/.test(output) ||
    !/<key>com\.apple\.security\.network\.client<\/key>\s*<true\s*\/>/.test(output) ||
    /<key>com\.apple\.security\.files\.user-selected\.read-write<\/key>/.test(output) ||
    /<key>com\.apple\.security\.files\.bookmarks\.app-scope<\/key>/.test(output)
  ) {
    throw new Error('packaged DSH supervisor has an invalid signed entitlement set');
  }
}

function assertDshMainProfileCompatibleEntitlements(appPath) {
  const inspected = spawnSync(
    '/usr/bin/codesign',
    ['-d', '--entitlements', ':-', appPath],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const output = `${inspected.stdout || ''}\n${inspected.stderr || ''}`;
  const required = [
    'com.apple.security.cs.allow-jit',
    'com.apple.security.cs.allow-unsigned-executable-memory',
    'com.apple.security.cs.disable-library-validation',
    'com.apple.security.device.audio-input',
    'com.apple.security.automation.apple-events',
  ];
  const forbidden = [
    'com.apple.security.app-sandbox',
    'com.apple.security.files.user-selected.read-write',
    'com.apple.security.files.bookmarks.app-scope',
  ];
  if (
    inspected.error ||
    inspected.status !== 0 ||
    required.some(
      (name) => !new RegExp(`<key>${name.replaceAll('.', '\\.')}</key>\\s*<true\\s*/>`).test(output),
    ) ||
    forbidden.some(
      (name) => new RegExp(`<key>${name.replaceAll('.', '\\.')}</key>\\s*<true\\s*/>`).test(output),
    )
  ) {
    throw new Error('packaged Cindy Main has an entitlement set incompatible with its existing desktop profile');
  }
}

function assertDshMainBookmarkBridge(appPath) {
  const bridge = path.join(appPath, 'Contents', 'Resources', MAIN_BOOKMARK_BRIDGE_NAME);
  const stat = fs.lstatSync(bridge);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(bridge) !== bridge) {
    throw new Error('packaged DSH Main bookmark bridge is unavailable');
  }
  run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', bridge]);
}

function walkRegularFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkRegularFiles(candidate));
    else if (entry.isFile() && !entry.isSymbolicLink()) files.push(candidate);
  }
  return files;
}

function isMachO(candidate) {
  const result = spawnSync('/usr/bin/file', ['-b', candidate], { encoding: 'utf8' });
  return result.status === 0 && /\bMach-O\b/.test(result.stdout || '');
}

export function writeElectronEntitlements(directory) {
  const helper = path.join(directory, 'electron-helper.entitlements');
  const main = path.join(directory, 'electron-main.entitlements');
  // Cindy's established desktop profile is outside an App Sandbox. Applying
  // an App Sandbox entitlement here would make the launched Main process lose
  // access to its existing Application Support profile before it can create
  // its startup logs or migration lock. Reuse the canonical local signing
  // shape for Cindy and its framework helpers. The DSH Supervisor is not part
  // of this set: it remains separately signed with its narrow sandbox and
  // network-client entitlements below.
  writeMacEntitlements(helper);
  writeMacEntitlements(main, { appleEvents: true });
  return { helper, main };
}

function signAdHoc(candidate, entitlements) {
  const args = ['--force', '--sign', '-', '--options', 'runtime'];
  if (entitlements) args.push('--entitlements', entitlements);
  args.push(candidate);
  run('/usr/bin/codesign', args);
}

function sealAndVerifyPackagedApp(appPath) {
  // Forge's display-name post-hook invalidates Electron's original bundle
  // signatures. Re-sign the usual Electron code inside-out, exactly as the
  // local Desktop signer does. The separately staged DSH Helper lives under
  // Contents/Helpers and is deliberately absent from this traversal: it keeps
  // its own narrow app-sandbox/network-client entitlement.
  const signingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-signing-'));
  try {
    const { helper, main } = writeElectronEntitlements(signingRoot);
    const contents = path.join(appPath, 'Contents');
    const frameworks = path.join(contents, 'Frameworks');
    const signableRoots = [
      path.join(contents, 'Resources', 'app.asar.unpacked'),
      path.join(contents, 'Resources', 'tools'),
      frameworks,
    ];
    for (const file of signableRoots.flatMap(walkRegularFiles)) {
      if (isMachO(file)) signAdHoc(file);
    }
    for (const entry of fs.readdirSync(frameworks, { withFileTypes: true })) {
      const candidate = path.join(frameworks, entry.name);
      if (entry.isDirectory() && entry.name.endsWith('.app')) signAdHoc(candidate, helper);
    }
    for (const entry of fs.readdirSync(frameworks, { withFileTypes: true })) {
      const candidate = path.join(frameworks, entry.name);
      if (entry.isDirectory() && entry.name.endsWith('.framework')) signAdHoc(candidate);
    }
    signAdHoc(appPath, main);
  } finally {
    fs.rmSync(signingRoot, { recursive: true, force: true });
  }
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
  assertDshMainProfileCompatibleEntitlements(appPath);
  assertDshHelperEntitlements(appPath);
  assertDshMainBookmarkBridge(appPath);
}

function packagedAppPath(region) {
  const appName = APP_NAME_BY_REGION[region];
  return path.join(DESKTOP_ROOT, 'out', `${appName}-darwin-arm64`, `${appName}.app`);
}

export function assertLocalOnlyPackagedResources(appPath) {
  const resources = path.join(appPath, 'Contents', 'Resources');
  for (const excluded of LOCAL_DSH_EXCLUDED_RESOURCES) {
    if (fs.existsSync(path.join(resources, excluded))) {
      throw new Error(`local DSH evidence package unexpectedly contains excluded resource: ${excluded}`);
    }
  }
}

export function localDshMacForgeArgs() {
  return ['exec', 'electron-forge', 'package', '--platform=darwin', '--arch=arm64'];
}

export function localDshMacE2eArgs() {
  return [
    '--filter',
    'desktop',
    'exec',
    'vitest',
    'run',
    'src/main/dsh-host/__tests__/macos-supervised-runtime.integration.test.ts',
  ];
}

function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error(`local DSH package is limited to darwin-arm64, got ${process.platform}-${process.arch}`);
  }
  const parsed = parseLocalDshMacPackageArgs(process.argv.slice(2));
  const archive = assertRegularLocalFile(parsed.archive, 'DSH archive');
  const manifest = assertRegularLocalFile(parsed.manifest, 'DSH manifest');
  assertRegularLocalFile(SOURCE_RELEASE, 'checked-in DSH source release');

  const env = createLocalDshMacPackageEnv({ ...parsed, archive, manifest });
  process.stdout.write('==> Packaging local Cindy darwin-arm64 DSH evidence app (no remote/iOS build)\n');
  run('pnpm', localDshMacForgeArgs(), { cwd: DESKTOP_ROOT, env });

  const appPath = packagedAppPath(parsed.region);
  if (!fs.existsSync(appPath)) {
    throw new Error(`expected local packaged Cindy app is missing: ${appPath}`);
  }
  assertLocalOnlyPackagedResources(appPath);
  sealAndVerifyPackagedApp(appPath);

  process.stdout.write('==> Running packaged-app signed-Helper DSH E2E\n');
  run('pnpm', localDshMacE2eArgs(), {
    cwd: REPO_ROOT,
    env: {
      ...env,
      CINDY_DSH_E2E_APP: appPath,
      CINDY_DSH_E2E_HOME: os.homedir(),
      CINDY_DSH_E2E_RELEASE_ID: readReleaseId(),
      CINDY_DSH_E2E_PROMPT: '1',
    },
  });
  process.stdout.write(`DSH_LOCAL_MACOS_PACKAGE_VERDICT=ready app=${appPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`package-dsh-local-macos: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
