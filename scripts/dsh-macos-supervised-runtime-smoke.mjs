#!/usr/bin/env node
/**
 * Local-only F2 containment evidence for the signed macOS DSH supervisor.
 *
 * This consumes a build-bound source-release definition and an already signed
 * temporary App Sandbox bundle. It deliberately exercises only the public ACP
 * lifecycle (initialize/new/close/list/resume/close), with no model credential
 * and no prompt. It is not a Desktop registration or distribution path.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { readSourceRelease } from './dsh-source-build-release.mjs';
import { runAcpLifecycle, runVersion } from './dsh-native-host-gate.mjs';

const SUPERVISOR_BASENAME = 'cindy-dsh-sandbox-supervisor';
const RUNTIME_DESCRIPTOR_NAME = 'cindy-dsh-supervised-runtime.json';

function platformKey() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64';
  throw new Error(`supervised local DSH smoke is limited to darwin-arm64, got ${process.platform}-${process.arch}`);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) throw new Error('arguments must be --key value pairs');
    args[key.slice(2)] = value;
  }
  if (!args.release || !args.target || !args.supervisor || !args['container-root']) {
    throw new Error('usage: dsh-macos-supervised-runtime-smoke --release <json> --target <key> --supervisor <absolute-path> --container-root <absolute-directory>');
  }
  return args;
}

function assertRegularFile(candidate, { executable = false } = {}) {
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink() || (executable && (stat.mode & 0o111) === 0)) {
    throw new Error(`required bundled artifact is invalid: ${path.basename(candidate)}`);
  }
}

function assertContainedRealPath(root, candidate) {
  const canonicalRoot = fs.realpathSync(root);
  const canonicalCandidate = fs.realpathSync(candidate);
  if (!canonicalCandidate.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error('required bundled artifact escapes its app bundle');
  }
  return canonicalCandidate;
}

function bundleRootForSupervisor(supervisor) {
  const canonical = fs.realpathSync(supervisor);
  const expectedSuffix = `/Contents/MacOS/${SUPERVISOR_BASENAME}`;
  if (!canonical.endsWith(expectedSuffix) || path.basename(canonical) !== SUPERVISOR_BASENAME) {
    throw new Error('supervisor must be the fixed native helper inside an app bundle');
  }
  return canonical.slice(0, -expectedSuffix.length);
}

function readRuntimeDescriptor(helperResources) {
  const descriptorPath = path.join(helperResources, RUNTIME_DESCRIPTOR_NAME);
  assertRegularFile(descriptorPath);
  let descriptor;
  try {
    descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
  } catch {
    throw new Error('supervisor helper is missing a readable runtime descriptor');
  }
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor) ||
      descriptor.formatVersion !== 1 || descriptor.target !== 'darwin-arm64' ||
      descriptor.supervisorExecutable !== SUPERVISOR_BASENAME ||
      typeof descriptor.releaseId !== 'string' || typeof descriptor.expectedVersion !== 'string' ||
      typeof descriptor.runtimeExecutable !== 'string' || !Array.isArray(descriptor.requiredSidecars) ||
      !descriptor.requiredSidecars.every((sidecar) => typeof sidecar === 'string') ||
      !Array.isArray(descriptor.requiredNativeAddons) ||
      !descriptor.requiredNativeAddons.every((addon) => addon && typeof addon === 'object' &&
        typeof addon.sourcePath === 'string' && typeof addon.cachePath === 'string') ||
      !descriptor.requiredPkgNativeCache || typeof descriptor.requiredPkgNativeCache !== 'object' ||
      typeof descriptor.requiredPkgNativeCache.sourceDirectory !== 'string' ||
      typeof descriptor.requiredPkgNativeCache.cacheDirectory !== 'string') {
    throw new Error('supervisor helper runtime descriptor is invalid');
  }
  return descriptor;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const release = readSourceRelease(args.release);
  const target = release.targets[args.target];
  if (!target) throw new Error(`source release does not declare target ${args.target}`);
  if (args.target !== platformKey()) throw new Error(`target ${args.target} does not match this runner`);
  if (!path.isAbsolute(args.supervisor)) throw new Error('supervisor must be an absolute path');
  if (!path.isAbsolute(args['container-root'])) throw new Error('container-root must be an absolute path');

  const supervisor = path.resolve(args.supervisor);
  assertRegularFile(supervisor, { executable: true });
  const bundle = bundleRootForSupervisor(supervisor);
  const helperResources = path.join(bundle, 'Contents', 'Resources');
  assertContainedRealPath(bundle, helperResources);
  const descriptor = readRuntimeDescriptor(helperResources);
  if (descriptor.releaseId !== release.releaseId || descriptor.expectedVersion !== release.runtime.expectedVersion ||
      descriptor.runtimeExecutable !== target.executable ||
      JSON.stringify(descriptor.requiredSidecars) !== JSON.stringify(target.sidecars) ||
      JSON.stringify(descriptor.requiredNativeAddons) !== JSON.stringify(target.nativeAddons ?? []) ||
      JSON.stringify(descriptor.requiredPkgNativeCache) !== JSON.stringify(target.pkgNativeCache ?? null)) {
    throw new Error('supervisor helper runtime descriptor does not match the approved source release');
  }
  const runtimeRoot = path.join(helperResources, 'dsh-runtime');
  assertContainedRealPath(bundle, runtimeRoot);
  const runtime = path.join(runtimeRoot, target.executable);
  assertContainedRealPath(runtimeRoot, runtime);
  assertRegularFile(runtime, { executable: true });
  for (const sidecar of target.sidecars) {
    const candidate = path.join(runtimeRoot, sidecar);
    assertContainedRealPath(runtimeRoot, candidate);
    assertRegularFile(candidate, { executable: true });
  }
  const nativeCacheRoot = path.join(bundle, 'Contents', 'Resources', 'dsh-native-addons');
  assertContainedRealPath(bundle, nativeCacheRoot);
  for (const addon of target.nativeAddons ?? []) {
    const source = path.join(runtimeRoot, addon.sourcePath);
    const cache = path.join(nativeCacheRoot, addon.cachePath);
    assertContainedRealPath(runtimeRoot, source);
    assertContainedRealPath(nativeCacheRoot, cache);
    assertRegularFile(source);
    assertRegularFile(cache);
  }
  const pkgCache = target.pkgNativeCache;
  if (!pkgCache) throw new Error('source release is missing the sealed pkg native-cache declaration');
  const pkgNativeCacheRoot = path.join(bundle, 'Contents', 'Resources', 'dsh-pkg-native-cache');
  assertContainedRealPath(bundle, pkgNativeCacheRoot);
  assertContainedRealPath(pkgNativeCacheRoot, path.join(pkgNativeCacheRoot, pkgCache.cacheDirectory));

  const containerRoot = path.resolve(args['container-root']);
  const containerStat = fs.lstatSync(containerRoot);
  if (!containerStat.isDirectory() || containerStat.isSymbolicLink()) {
    throw new Error('container-root must be a real directory owned by the signed test app');
  }
  const root = fs.mkdtempSync(path.join(containerRoot, 'cindy-dsh-macos-supervised-smoke-'));
  const launcher = path.join(root, 'launcher');
  const home = path.join(root, 'home');
  const dshHome = path.join(root, 'dsh-home');
  fs.mkdirSync(launcher, { mode: 0o700 });
  fs.mkdirSync(home, { mode: 0o700 });
  fs.mkdirSync(dshHome, { mode: 0o700 });
  const env = { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: root, DSH_HOME: dshHome };
  try {
    const version = await runVersion(supervisor, launcher, env);
    if (version !== release.runtime.expectedVersion) throw new Error(`runtime --version ${JSON.stringify(version)} does not match release`);
    const acp = await runAcpLifecycle(supervisor, launcher, env, { acpHandshake: release.runtime.acpHandshake });
    process.stdout.write(`${JSON.stringify({
      status: 'PASS',
      target: args.target,
      version,
      agentInfo: acp.agentInfo,
      lifecycle: acp.lifecycle,
    })}\n`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`dsh-macos-supervised-runtime-smoke: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
