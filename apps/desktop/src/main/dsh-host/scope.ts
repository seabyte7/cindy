/**
 * Main-owned DSH scope paths and child environment.
 *
 * This module intentionally knows neither Renderer input nor process.env. A
 * caller supplies the account identity from Main, and receives only paths and
 * a narrowly constructed child environment. Existing DSH homes are explicit
 * non-secret overrides; they are never copied, migrated, or deleted.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  assertAdmittedDshProviderRoute,
  DSH_PROVIDER_API_KEY_ENV,
  DSH_PROVIDER_BASE_URL_ENV,
  type DshProviderRoute,
} from './provider-route.js';

export type DshHomeMode = 'cindy-managed' | 'existing-dsh-home';

export interface DshHostScopeInput {
  /** Main-derived account identity; it is hashed before it becomes a path or scope id. */
  accountId: string;
  releaseId: string;
  homeMode: DshHomeMode;
}

export interface DshHostScopePaths {
  scopeId: string;
  accountScopeId: string;
  homeMode: 'cindy-managed';
  /** Main-owned system HOME, separate from DSH_HOME and never a user worktree. */
  processHome: string;
  dshHome: string;
  /** Empty task-specific launcher cwd; session cwd is supplied independently by F3. */
  launcherCwd: string;
  tempRoot: string;
}

/**
 * Existing-home launches intentionally have no `dshHome` field.  The only
 * external Home authority is the opaque one-shot bookmark passed straight to
 * the fixed Helper through fd 3; making a pathname available in this object
 * would let it leak into a generic launch, environment, or diagnostic path.
 */
export interface DshExistingHomeLaunchPaths {
  scopeId: string;
  accountScopeId: string;
  homeMode: 'existing-dsh-home';
  /** Main-owned system HOME, separate from the user-selected DSH Home. */
  processHome: string;
  /** Empty task-specific launcher cwd; it is not the selected Home. */
  launcherCwd: string;
  tempRoot: string;
}

export type DshLaunchScopePaths = DshHostScopePaths | DshExistingHomeLaunchPaths;

export interface DshChildSecret {
  /** The sole credential input accepted by the fixed managed ACP profile. */
  name: typeof DSH_PROVIDER_API_KEY_ENV;
  value: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertAbsoluteDirectory(value: string, label: string): void {
  if (!path.isAbsolute(value)) throw new Error(`${label} must be absolute`);
  const stat = fs.lstatSync(value);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`${label} must be a real directory`);
}

function assertSafeIdentity(value: string, label: string): void {
  if (!value || value.length > 4096 || value.includes('\0')) throw new Error(`${label} is invalid`);
}

/**
 * F2 briefly carried an in-memory external path for a future existing-Home
 * feature. That shape is no longer a valid Main boundary: an external Home
 * must ultimately arrive at the fixed Helper as a one-time opaque bookmark,
 * never as a path crossing a generic host/scope API.
 */
function assertNoLegacyExistingHomePath(input: DshHostScopeInput): void {
  if (Object.prototype.hasOwnProperty.call(input, 'existingDshHome')) {
    throw new Error('DSH host scope no longer accepts an existing Home path');
  }
}

function assertContained(root: string, candidate: string, label: string): void {
  const relative = path.relative(root, candidate);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} escapes its Main-owned root`);
  }
}

/**
 * Create one DSH-owned directory without ever following a pre-existing
 * symlink. `mkdir({ recursive: true })` is deliberately not used here: a
 * same-user local process could otherwise redirect the managed Home below a
 * chosen symlink before the first launch recheck.
 */
function ensureRealManagedDirectChild(parent: string, name: string, label: string): string {
  const realParent = fs.realpathSync(parent);
  const candidate = path.join(realParent, name);
  if (path.dirname(candidate) !== realParent) throw new Error(`${label} must be a direct child`);
  try {
    const stat = fs.lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${label} must be a real directory`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    fs.mkdirSync(candidate, { mode: 0o700 });
    const stat = fs.lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${label} must be a real directory`);
    }
  }
  const resolved = fs.realpathSync(candidate);
  assertContained(realParent, resolved, label);
  fs.chmodSync(resolved, 0o700);
  return resolved;
}

function createIsolatedLauncher(tempRoot: string): string {
  const launcherCwd = fs.mkdtempSync(path.join(tempRoot, 'cindy-dsh-launcher-'));
  const launcherStat = fs.lstatSync(launcherCwd);
  if (!launcherStat.isDirectory() || launcherStat.isSymbolicLink()) {
    throw new Error('DSH launcher must be a real directory');
  }
  const launcher = fs.realpathSync(launcherCwd);
  assertContained(tempRoot, launcher, 'DSH launcher path');
  fs.chmodSync(launcher, 0o700);
  return launcher;
}

/** Scope identity deliberately records home *mode*, never an external home pathname. */
export function createDshHostScopeId(input: DshHostScopeInput): {
  scopeId: string;
  accountScopeId: string;
} {
  assertNoLegacyExistingHomePath(input);
  assertSafeIdentity(input.accountId, 'DSH account identity');
  assertSafeIdentity(input.releaseId, 'DSH release identity');
  if (input.homeMode !== 'cindy-managed' && input.homeMode !== 'existing-dsh-home') {
    throw new Error('DSH home mode is invalid');
  }
  const accountScopeId = sha256(input.accountId).slice(0, 32);
  const scopeId = sha256(
    JSON.stringify({
      accountScopeId,
      releaseId: input.releaseId,
      executionLocation: 'local',
      homeMode: input.homeMode,
    }),
  ).slice(0, 32);
  return { scopeId: `dsh-${scopeId}`, accountScopeId: `account-${accountScopeId}` };
}

/**
 * Explicitly creates only Cindy-owned paths. The launcher directory is a
 * fresh temp child and is never a project directory or a source checkout.
 */
export function createDshHostScopePaths(
  input: DshHostScopeInput & {
    userDataPath: string;
    tempPath: string;
  },
): DshHostScopePaths {
  const identity = createDshHostScopeId(input);
  if (input.homeMode !== 'cindy-managed') {
    throw new Error(
      'DSH existing Home paths may be resolved only by the fixed Helper bookmark handoff',
    );
  }
  assertAbsoluteDirectory(input.userDataPath, 'DSH userData path');
  assertAbsoluteDirectory(input.tempPath, 'DSH temp path');
  const userDataRoot = fs.realpathSync(input.userDataPath);
  const tempRoot = fs.realpathSync(input.tempPath);
  const managedBase = ensureRealManagedDirectChild(
    userDataRoot,
    'dsh-agent-home',
    'DSH managed Home root',
  );
  const managedRoot = ensureRealManagedDirectChild(
    managedBase,
    identity.scopeId,
    'DSH managed scope root',
  );
  const processHome = ensureRealManagedDirectChild(managedRoot, 'process-home', 'DSH process Home');
  const dshHome = ensureRealManagedDirectChild(managedRoot, 'dsh-home', 'DSH managed Home');
  const launcher = createIsolatedLauncher(tempRoot);
  return {
    ...identity,
    homeMode: 'cindy-managed',
    processHome,
    dshHome,
    launcherCwd: launcher,
    tempRoot,
  };
}

/**
 * Creates only Helper-container state for an existing-Home launch.  This
 * function never receives, opens, resolves, or returns the selected Home.
 */
export function createDshExistingHomeLaunchPaths(
  input: DshHostScopeInput & {
    userDataPath: string;
    tempPath: string;
  },
): DshExistingHomeLaunchPaths {
  const identity = createDshHostScopeId(input);
  if (input.homeMode !== 'existing-dsh-home') {
    throw new Error('DSH existing Home launch paths require an existing Home mode');
  }
  assertAbsoluteDirectory(input.userDataPath, 'DSH userData path');
  assertAbsoluteDirectory(input.tempPath, 'DSH temp path');
  const userDataRoot = fs.realpathSync(input.userDataPath);
  const tempRoot = fs.realpathSync(input.tempPath);
  const launchBase = ensureRealManagedDirectChild(
    userDataRoot,
    'dsh-existing-home-launch',
    'DSH existing Home launch root',
  );
  const launchRoot = ensureRealManagedDirectChild(
    launchBase,
    identity.scopeId,
    'DSH existing Home launch scope root',
  );
  const processHome = ensureRealManagedDirectChild(
    launchRoot,
    'process-home',
    'DSH existing Home process Home',
  );
  return {
    ...identity,
    homeMode: 'existing-dsh-home',
    processHome,
    launcherCwd: createIsolatedLauncher(tempRoot),
    tempRoot,
  };
}

/**
 * DSH receives a deterministic baseline, not the parent process environment.
 * Credentials are memory-only named values supplied by a Main secure-store
 * adapter; neither this function nor its callers serialize or log them.
 */
export function buildDshChildEnvironment(input: {
  paths: DshLaunchScopePaths;
  /** Omitted for no-credential lifecycle admission; never supplied by Renderer. */
  providerRoute?: DshProviderRoute;
  secrets?: readonly DshChildSecret[];
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: '/usr/bin:/bin',
    HOME: input.paths.processHome,
    TMPDIR: input.paths.launcherCwd,
    // The supervised local harness never needs telemetry for task execution.
    // Pin this deny-by-default so a packaged local bridge cannot inherit or
    // silently re-enable an outbound telemetry setting from its parent.
    DSH_TELEMETRY_DISABLED: '1',
  };
  if (input.paths.homeMode === 'cindy-managed') {
    env.DSH_HOME = input.paths.dshHome;
  }
  const secrets = input.secrets ?? [];
  if (!input.providerRoute) {
    if (secrets.length > 0) {
      throw new Error('DSH child credential requires an admitted provider route');
    }
    return env;
  }
  assertAdmittedDshProviderRoute(input.providerRoute);
  if (secrets.length !== 1 || secrets[0]?.name !== DSH_PROVIDER_API_KEY_ENV || !secrets[0].value) {
    throw new Error('DSH provider route requires exactly one Main-owned API key');
  }
  env[DSH_PROVIDER_BASE_URL_ENV] = input.providerRoute.baseUrl;
  env[DSH_PROVIDER_API_KEY_ENV] = secrets[0].value;
  return env;
}

/** Remove only the temp launcher that this module created, never a user home. */
export function cleanupDshHostScopePaths(paths: DshLaunchScopePaths): void {
  const launcherStat = fs.lstatSync(paths.launcherCwd);
  if (!launcherStat.isDirectory() || launcherStat.isSymbolicLink()) {
    throw new Error('DSH launcher cleanup refuses a non-directory path');
  }
  const root = fs.realpathSync(paths.tempRoot);
  const launcher = fs.realpathSync(paths.launcherCwd);
  assertContained(root, launcher, 'DSH launcher cleanup path');
  if (!path.basename(launcher).startsWith('cindy-dsh-launcher-')) {
    throw new Error('DSH launcher cleanup refuses an unrecognized directory');
  }
  fs.rmSync(launcher, { recursive: true, force: true });
}
