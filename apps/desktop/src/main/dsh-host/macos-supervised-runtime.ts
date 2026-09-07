/**
 * Packaged macOS F2 DSH launch composition.
 *
 * This is intentionally Main-only and intentionally not a product-Agent
 * registration. It accepts neither a Renderer-selected executable, runtime,
 * argv, environment nor Home. Its Main-only options supply the Desktop app's
 * resource and user-home roots; every launch re-discovers the fixed signed
 * Helper.app, then gives the helper's own App Sandbox container to the
 * existing Main-owned scope registry.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { DshAcpClient, type Logger } from '@cindy/maker-core';

import { createDshAcpStdioTransport } from '../maker-host/dsh-acp-stdio-transport.js';
import { DshHostManager, type DshHostLaunch } from './host-manager.js';
import type { VerifiedDshRuntime } from './local-runtime.js';
import {
  buildDshChildEnvironment,
  cleanupDshHostScopePaths,
  createDshHostScopePaths,
  type DshChildSecret,
  type DshHostScopeInput,
  type DshHostScopePaths,
} from './scope.js';
import {
  materializeDshManagedAcpProviderPatch,
  type DshProviderRoute,
} from './provider-route.js';

const TARGET = 'darwin-arm64';
const HELPER_BUNDLE_NAME = 'Cindy DSH Supervisor.app';
const SUPERVISOR_NAME = 'cindy-dsh-sandbox-supervisor';
const RUNTIME_DESCRIPTOR_NAME = 'cindy-dsh-supervised-runtime.json';
const RUNTIME_DIRECTORY_NAME = 'dsh-runtime';
const PKG_NATIVE_CACHE_DIRECTORY_NAME = 'dsh-pkg-native-cache';
const HELPER_TEMP_DIRECTORY_NAME = 'dsh-runtime-tmp';
const CONTAINER_LIBRARY = 'Library';
const CONTAINER_DIRECTORY = 'Containers';
const CONTAINER_DATA_DIRECTORY = 'Data';

interface SupervisedRuntimeDescriptor {
  formatVersion: 1;
  target: typeof TARGET;
  releaseId: string;
  expectedVersion: string;
  parentBundleIdentifier: string;
  helperBundleIdentifier: string;
  supervisorExecutable: typeof SUPERVISOR_NAME;
  runtimeExecutable: string;
  requiredSidecars: readonly string[];
  requiredNativeAddons: readonly Readonly<{ sourcePath: string; cachePath: string }> [];
  requiredPkgNativeCache: Readonly<{ sourceDirectory: string; cacheDirectory: string }>;
}

export interface MacosSupervisedDshRuntimeLayout {
  readonly runtime: VerifiedDshRuntime;
  /** Fixed executable inside the separately signed Helper.app. */
  readonly supervisorPath: string;
  /** App Sandbox container for the Helper.app, never Cindy parent userData. */
  readonly helperContainerDataPath: string;
  /** Main-owned temporary root inside that same Helper.app container. */
  readonly helperTempRoot: string;
  readonly helperBundleIdentifier: string;
}

export interface ResolveMacosSupervisedDshRuntimeOptions {
  readonly resourcesPath: string;
  readonly homePath: string;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
}

export interface CreateMacosSupervisedDshHostManagerOptions extends ResolveMacosSupervisedDshRuntimeOptions {
  readonly logger: Logger;
  /** Main secure-store adapter. Returned values exist only during child spawn. */
  readonly loadSecrets: (input: DshHostScopeInput) => readonly DshChildSecret[];
  /**
   * Optional Main-owned route source. Its absence deliberately preserves the
   * credential-free no-network lifecycle; it is not inferred from a profile,
   * process environment, Renderer payload, or user-selected endpoint.
   */
  readonly resolveProviderRoute?: (input: DshHostScopeInput) => DshProviderRoute | undefined;
}

function assertRealDirectory(candidate: string, label: string): string {
  if (!path.isAbsolute(candidate)) throw new Error(`${label} must be absolute`);
  const resolved = path.resolve(candidate);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolved);
  } catch (error) {
    // A missing signed resource is an unavailable package. Do not expose its
    // host filesystem path or suggest that a mutable Home cache is acceptable.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${label} must be a real directory`);
    }
    throw error;
  }
  // macOS normally exposes /var through /private/var. Canonicalize that
  // ancestor-level alias once, while still rejecting a symlink at the
  // directory being admitted (and at every direct child below it).
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`);
  }
  return fs.realpathSync(resolved);
}

function assertRealDirectChildDirectory(parent: string, name: string, label: string): string {
  if (!name || name.includes(path.sep) || name === '.' || name === '..') {
    throw new Error(`${label} name is invalid`);
  }
  const candidate = path.join(parent, name);
  if (path.dirname(candidate) !== parent) throw new Error(`${label} must be a direct child`);
  return assertRealDirectory(candidate, label);
}

function assertRealContainedFile(root: string, relative: string, label: string, executable = false): string {
  if (!relative || relative.includes('\\') || path.isAbsolute(relative)) {
    throw new Error(`${label} path is invalid`);
  }
  const parts = relative.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${label} path is invalid`);
  }
  let cursor = root;
  for (const part of parts.slice(0, -1)) {
    cursor = assertRealDirectChildDirectory(cursor, part, `${label} parent`);
  }
  const candidate = path.join(cursor, parts.at(-1)!);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(candidate);
  } catch (error) {
    // Missing runtime/sidecar/cache entries are an unavailable package, not a
    // reason to let a caller infer an alternate source or cache location.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${label} must be a regular${executable ? ' executable' : ''} file`);
    }
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || (executable && (stat.mode & 0o100) === 0)) {
    throw new Error(`${label} must be a regular${executable ? ' executable' : ''} file`);
  }
  if (fs.realpathSync(candidate) !== candidate) throw new Error(`${label} must not resolve through a symlink`);
  return candidate;
}

/** Re-resolve a launch directory and reject lexical-in-root symlink escapes. */
function assertRealContainedDirectory(root: string, candidate: string, label: string): string {
  const realRoot = assertRealDirectory(root, `${label} root`);
  if (!path.isAbsolute(candidate)) throw new Error(`${label} must be absolute`);
  const stat = fs.lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`);
  }
  const resolved = fs.realpathSync(candidate);
  const relative = path.relative(realRoot, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the Helper.app sandbox container`);
  }
  return resolved;
}

function assertSafeString(value: unknown, label: string, maxLength = 512): string {
  if (typeof value !== 'string' || !value || value.length > maxLength || value.includes('\0')) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function assertDirectChildName(value: unknown, label: string): string {
  const name = assertSafeString(value, label);
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    throw new Error(`${label} is invalid`);
  }
  return name;
}

function assertBundleIdentifier(value: unknown, label: string): string {
  const identifier = assertSafeString(value, label);
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(identifier)) {
    throw new Error(`${label} is invalid`);
  }
  return identifier;
}

function parseDescriptor(candidate: string): SupervisedRuntimeDescriptor {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(candidate, 'utf8'));
  } catch {
    throw new Error('packaged DSH supervised runtime descriptor is unreadable');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('packaged DSH supervised runtime descriptor is invalid');
  }
  const value = raw as Record<string, unknown>;
  if (value.formatVersion !== 1 || value.target !== TARGET || value.supervisorExecutable !== SUPERVISOR_NAME) {
    throw new Error('packaged DSH supervised runtime descriptor does not match the F2 macOS contract');
  }
  const requiredSidecars = value.requiredSidecars;
  if (!Array.isArray(requiredSidecars) || requiredSidecars.length > 32) {
    throw new Error('packaged DSH supervised runtime descriptor sidecars are invalid');
  }
  const sidecars = requiredSidecars.map((sidecar, index) => assertSafeString(sidecar, `packaged DSH sidecar ${index}`));
  if (new Set(sidecars).size !== sidecars.length) {
    throw new Error('packaged DSH supervised runtime descriptor sidecars are duplicated');
  }
  const requiredNativeAddons = value.requiredNativeAddons;
  if (!Array.isArray(requiredNativeAddons) || requiredNativeAddons.length > 32) {
    throw new Error('packaged DSH supervised runtime descriptor native addons are invalid');
  }
  const nativeAddons = requiredNativeAddons.map((addon, index) => {
    if (!addon || typeof addon !== 'object' || Array.isArray(addon)) {
      throw new Error(`packaged DSH native addon ${index} is invalid`);
    }
    const value = addon as Record<string, unknown>;
    return Object.freeze({
      sourcePath: assertSafeString(value.sourcePath, `packaged DSH native addon ${index} source`),
      cachePath: assertSafeString(value.cachePath, `packaged DSH native addon ${index} cache`),
    });
  });
  if (new Set(nativeAddons.map((addon) => addon.sourcePath)).size !== nativeAddons.length ||
      new Set(nativeAddons.map((addon) => addon.cachePath)).size !== nativeAddons.length) {
    throw new Error('packaged DSH supervised runtime descriptor native addons are duplicated');
  }
  const requiredPkgNativeCache = value.requiredPkgNativeCache;
  if (!requiredPkgNativeCache || typeof requiredPkgNativeCache !== 'object' || Array.isArray(requiredPkgNativeCache)) {
    throw new Error('packaged DSH supervised runtime descriptor pkg native-cache is invalid');
  }
  const pkgNativeCache = requiredPkgNativeCache as Record<string, unknown>;
  const sourceDirectory = assertDirectChildName(pkgNativeCache.sourceDirectory, 'packaged DSH pkg native-cache source directory');
  const cacheDirectory = assertDirectChildName(pkgNativeCache.cacheDirectory, 'packaged DSH pkg native-cache directory');
  if (sourceDirectory === cacheDirectory) {
    throw new Error('packaged DSH supervised runtime descriptor pkg native-cache directories must differ');
  }
  return Object.freeze({
    formatVersion: 1,
    target: TARGET,
    releaseId: assertSafeString(value.releaseId, 'packaged DSH release id'),
    expectedVersion: assertSafeString(value.expectedVersion, 'packaged DSH expected version'),
    parentBundleIdentifier: assertBundleIdentifier(value.parentBundleIdentifier, 'packaged DSH parent bundle identifier'),
    helperBundleIdentifier: assertBundleIdentifier(value.helperBundleIdentifier, 'packaged DSH helper bundle identifier'),
    supervisorExecutable: SUPERVISOR_NAME,
    runtimeExecutable: assertSafeString(value.runtimeExecutable, 'packaged DSH runtime executable'),
    requiredSidecars: Object.freeze(sidecars),
    requiredNativeAddons: Object.freeze(nativeAddons),
    requiredPkgNativeCache: Object.freeze({ sourceDirectory, cacheDirectory }),
  });
}

/** Create a path only when every existing component is a direct real directory. */
function ensureRealDirectChildDirectory(parent: string, name: string, label: string, mode: number): string {
  const realParent = assertRealDirectory(parent, `${label} parent`);
  const candidate = path.join(realParent, name);
  if (path.dirname(candidate) !== realParent) throw new Error(`${label} must be a direct child`);
  try {
    const stat = fs.lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${label} must be a real directory`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    fs.mkdirSync(candidate, { mode });
    const stat = fs.lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${label} must be a real directory`);
    }
  }
  return candidate;
}

function helperContainerPaths(homePath: string, helperBundleIdentifier: string): {
  dataPath: string;
  tempRoot: string;
} {
  const home = assertRealDirectory(homePath, 'macOS user home');
  // The user Home hierarchy is not a DSH-owned scratch location. It must
  // already be the macOS Library/Containers hierarchy; only this unique
  // Helper.app container and its own temp child may be provisioned here.
  const library = assertRealDirectChildDirectory(home, CONTAINER_LIBRARY, 'macOS Library');
  const containers = assertRealDirectChildDirectory(library, CONTAINER_DIRECTORY, 'macOS application containers');
  const helperContainer = ensureRealDirectChildDirectory(containers, helperBundleIdentifier, 'DSH Helper.app container', 0o700);
  const dataPath = ensureRealDirectChildDirectory(helperContainer, CONTAINER_DATA_DIRECTORY, 'DSH Helper.app container data', 0o700);
  const tempRoot = ensureRealDirectChildDirectory(dataPath, HELPER_TEMP_DIRECTORY_NAME, 'DSH Helper.app temporary root', 0o700);
  return { dataPath, tempRoot };
}

function readBundleIdentifier(contents: string, label: string): string {
  const infoPlist = assertRealContainedFile(contents, 'Info.plist', `${label} Info.plist`);
  let identifier: string;
  try {
    identifier = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', infoPlist], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error(`${label} bundle identifier is unreadable`);
  }
  return assertBundleIdentifier(identifier, `${label} bundle identifier`);
}

function assertPlatform(options: ResolveMacosSupervisedDshRuntimeOptions): void {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (platform !== 'darwin' || arch !== 'arm64') {
    throw new Error(`packaged supervised DSH runtime is unavailable on ${platform}-${arch}; only ${TARGET} is admitted`);
  }
}

/**
 * Re-check the signed Helper.app layout immediately before every managed
 * launch. This returns the native runtime for identity/evidence only; callers
 * must launch `supervisorPath`, never `runtime.binaryPath` directly.
 */
export function resolveMacosSupervisedDshRuntime(options: ResolveMacosSupervisedDshRuntimeOptions): MacosSupervisedDshRuntimeLayout {
  assertPlatform(options);
  const resources = assertRealDirectory(options.resourcesPath, 'Desktop resources path');
  if (path.basename(resources) !== 'Resources') throw new Error('Desktop resources path is not an app Resources directory');
  const contents = assertRealDirectory(path.dirname(resources), 'Desktop app Contents directory');
  if (path.basename(contents) !== 'Contents') throw new Error('Desktop resources path is not inside an app Contents directory');
  const helpers = assertRealDirectChildDirectory(contents, 'Helpers', 'Desktop app Helpers directory');
  const helperBundle = assertRealDirectChildDirectory(helpers, HELPER_BUNDLE_NAME, 'DSH supervisor Helper.app');
  const helperContents = assertRealDirectChildDirectory(helperBundle, 'Contents', 'DSH supervisor Helper.app Contents directory');
  const helperResources = assertRealDirectChildDirectory(helperContents, 'Resources', 'DSH supervisor Helper.app Resources directory');
  const helperMacOS = assertRealDirectChildDirectory(helperContents, 'MacOS', 'DSH supervisor Helper.app MacOS directory');
  const descriptor = parseDescriptor(assertRealContainedFile(helperResources, RUNTIME_DESCRIPTOR_NAME, 'packaged DSH supervised runtime descriptor'));
  const parentBundleIdentifier = readBundleIdentifier(contents, 'Desktop app');
  const helperBundleIdentifier = readBundleIdentifier(helperContents, 'DSH supervisor Helper.app');
  if (descriptor.parentBundleIdentifier !== parentBundleIdentifier ||
      descriptor.helperBundleIdentifier !== `${parentBundleIdentifier}.dsh-supervisor` ||
      descriptor.helperBundleIdentifier !== helperBundleIdentifier) {
    throw new Error('packaged DSH supervised runtime descriptor does not match the signed app identity');
  }
  const supervisorPath = assertRealContainedFile(helperMacOS, SUPERVISOR_NAME, 'packaged DSH supervisor', true);
  const runtimeDirectory = assertRealDirectChildDirectory(helperResources, RUNTIME_DIRECTORY_NAME, 'packaged DSH runtime directory');
  const binaryPath = assertRealContainedFile(runtimeDirectory, descriptor.runtimeExecutable, 'packaged DSH runtime binary', true);
  const sidecarPaths = descriptor.requiredSidecars.map((sidecar) => (
    assertRealContainedFile(runtimeDirectory, sidecar, 'packaged DSH runtime sidecar', true)
  ));
  const nativeAddonCache = assertRealDirectChildDirectory(helperResources, 'dsh-native-addons', 'packaged DSH sealed native addon cache');
  for (const addon of descriptor.requiredNativeAddons) {
    assertRealContainedFile(runtimeDirectory, addon.sourcePath, 'packaged DSH native addon source');
    assertRealContainedFile(nativeAddonCache, addon.cachePath, 'packaged DSH sealed native addon cache entry');
  }
  const pkgNativeCache = assertRealDirectChildDirectory(
    helperResources,
    PKG_NATIVE_CACHE_DIRECTORY_NAME,
    'packaged DSH sealed pkg native-cache',
  );
  assertRealDirectChildDirectory(
    pkgNativeCache,
    descriptor.requiredPkgNativeCache.cacheDirectory,
    'packaged DSH sealed pkg native-cache directory',
  );
  const container = helperContainerPaths(options.homePath, descriptor.helperBundleIdentifier);
  return Object.freeze({
    runtime: Object.freeze({
      installDirectory: runtimeDirectory,
      binaryPath,
      sidecarPaths: Object.freeze(sidecarPaths),
      releaseId: descriptor.releaseId,
      expectedVersion: descriptor.expectedVersion,
    }),
    supervisorPath,
    helperContainerDataPath: container.dataPath,
    helperTempRoot: container.tempRoot,
    helperBundleIdentifier: descriptor.helperBundleIdentifier,
  });
}

function assertLaunchMatchesLayout(launch: DshHostLaunch, layout: MacosSupervisedDshRuntimeLayout): void {
  if (launch.runtime.releaseId !== layout.runtime.releaseId ||
      launch.runtime.expectedVersion !== layout.runtime.expectedVersion ||
      launch.runtime.binaryPath !== layout.runtime.binaryPath ||
      launch.runtime.installDirectory !== layout.runtime.installDirectory ||
      launch.runtime.sidecarPaths.length !== layout.runtime.sidecarPaths.length ||
      launch.runtime.sidecarPaths.some((sidecar, index) => sidecar !== layout.runtime.sidecarPaths[index])) {
    throw new Error('DSH supervised launch runtime changed after verification');
  }
  for (const candidate of [launch.paths.processHome, launch.paths.dshHome, launch.paths.launcherCwd, launch.paths.tempRoot]) {
    assertRealContainedDirectory(layout.helperContainerDataPath, candidate, 'DSH supervised launch path');
  }
}

/**
 * Main composition for the packaged supervisor. It stays opt-in until F3
 * registers a durable bridge/binding; importing this module does not expose
 * DSH in the catalog, IPC, Renderer, remote host or Mobile.
 */
export function createMacosSupervisedDshHostManager(options: CreateMacosSupervisedDshHostManagerOptions): DshHostManager {
  const resolve = (): MacosSupervisedDshRuntimeLayout => resolveMacosSupervisedDshRuntime(options);
  return new DshHostManager({
    resolveRuntime: () => resolve().runtime,
    createScopePaths: (input): DshHostScopePaths => {
      const layout = resolve();
      return createDshHostScopePaths({
        ...input,
        userDataPath: layout.helperContainerDataPath,
        tempPath: layout.helperTempRoot,
      });
    },
    buildChildEnvironment: buildDshChildEnvironment,
    loadSecrets: options.loadSecrets,
    resolveProviderRoute: options.resolveProviderRoute,
    materializeProviderProfile: (paths, route) => materializeDshManagedAcpProviderPatch(paths, route),
    createContainedClient: (launch) => {
      const layout = resolve();
      assertLaunchMatchesLayout(launch, layout);
      const client = new DshAcpClient({
        logger: options.logger,
        createTransport: () => createDshAcpStdioTransport({
          // The supervisor has a fixed runtime and fixed ACP argv. It is the
          // only path given to spawn(); the runtime path above is never argv.
          binaryPath: layout.supervisorPath,
          launcherCwd: launch.paths.launcherCwd,
          env: launch.env,
        }),
      });
      // DshHostManager is deliberately typed against the narrow portable
      // session-client port, whose contract does not expose start(). This
      // packaged Main factory owns the concrete ACP transport and therefore
      // starts it before handing the client to that lifecycle registry.
      client.start();
      return client;
    },
    cleanupPaths: cleanupDshHostScopePaths,
  });
}
