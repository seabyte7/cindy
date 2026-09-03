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

export type DshHomeMode = 'cindy-managed' | 'existing-dsh-home';

export interface DshHostScopeInput {
  /** Main-derived account identity; it is hashed before it becomes a path or scope id. */
  accountId: string;
  releaseId: string;
  homeMode: DshHomeMode;
  /** Only meaningful for the explicit existing-home mode; never persisted here. */
  existingDshHome?: string;
}

export interface DshHostScopePaths {
  scopeId: string;
  accountScopeId: string;
  homeMode: DshHomeMode;
  /** Main-owned system HOME, separate from DSH_HOME and never a user worktree. */
  processHome: string;
  dshHome: string;
  /** Empty task-specific launcher cwd; session cwd is supplied independently by F3. */
  launcherCwd: string;
  tempRoot: string;
}

export interface DshChildSecret {
  /** Only Cindy-prefixed names can enter the runtime environment. */
  name: string;
  value: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertAbsoluteDirectory(value: string, label: string): void {
  if (!path.isAbsolute(value)) throw new Error(`${label} must be absolute`);
  const stat = fs.lstatSync(value);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a real directory`);
}

function assertSafeIdentity(value: string, label: string): void {
  if (!value || value.length > 4096 || value.includes('\0')) throw new Error(`${label} is invalid`);
}

function assertContained(root: string, candidate: string, label: string): void {
  const relative = path.relative(root, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes its Main-owned root`);
  }
}

/** Scope identity deliberately records home *mode*, never an external home pathname. */
export function createDshHostScopeId(input: DshHostScopeInput): { scopeId: string; accountScopeId: string } {
  assertSafeIdentity(input.accountId, 'DSH account identity');
  assertSafeIdentity(input.releaseId, 'DSH release identity');
  if (input.homeMode !== 'cindy-managed' && input.homeMode !== 'existing-dsh-home') {
    throw new Error('DSH home mode is invalid');
  }
  if (input.homeMode === 'existing-dsh-home' && !input.existingDshHome) {
    throw new Error('existing-dsh-home mode requires an explicit DSH home');
  }
  if (input.homeMode === 'cindy-managed' && input.existingDshHome !== undefined) {
    throw new Error('cindy-managed mode must not accept an existing DSH home');
  }
  const accountScopeId = sha256(input.accountId).slice(0, 32);
  const scopeId = sha256(JSON.stringify({
    accountScopeId,
    releaseId: input.releaseId,
    executionLocation: 'local',
    homeMode: input.homeMode,
  })).slice(0, 32);
  return { scopeId: `dsh-${scopeId}`, accountScopeId: `account-${accountScopeId}` };
}

/**
 * Explicitly creates only Cindy-owned paths. The launcher directory is a
 * fresh temp child and is never a project directory or a source checkout.
 */
export function createDshHostScopePaths(input: DshHostScopeInput & {
  userDataPath: string;
  tempPath: string;
}): DshHostScopePaths {
  assertAbsoluteDirectory(input.userDataPath, 'DSH userData path');
  assertAbsoluteDirectory(input.tempPath, 'DSH temp path');
  const userDataRoot = fs.realpathSync(input.userDataPath);
  const tempRoot = fs.realpathSync(input.tempPath);
  const identity = createDshHostScopeId(input);
  const managedRoot = path.join(userDataRoot, 'dsh-agent-home', identity.scopeId);
  fs.mkdirSync(managedRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(managedRoot, 0o700);
  const processHome = path.join(managedRoot, 'process-home');
  fs.mkdirSync(processHome, { recursive: true, mode: 0o700 });
  fs.chmodSync(processHome, 0o700);
  const dshHome = input.homeMode === 'cindy-managed'
    ? path.join(managedRoot, 'dsh-home')
    : fs.realpathSync(input.existingDshHome!);
  if (input.homeMode === 'cindy-managed') {
    fs.mkdirSync(dshHome, { recursive: true, mode: 0o700 });
    fs.chmodSync(dshHome, 0o700);
  } else {
    assertAbsoluteDirectory(dshHome, 'explicit existing DSH home');
  }
  const launcherCwd = fs.mkdtempSync(path.join(tempRoot, 'cindy-dsh-launcher-'));
  fs.chmodSync(launcherCwd, 0o700);
  return {
    ...identity,
    homeMode: input.homeMode,
    processHome,
    dshHome,
    launcherCwd,
    tempRoot,
  };
}

/**
 * DSH receives a deterministic baseline, not the parent process environment.
 * Credentials are memory-only named values supplied by a Main secure-store
 * adapter; neither this function nor its callers serialize or log them.
 */
export function buildDshChildEnvironment(input: {
  paths: DshHostScopePaths;
  secrets?: readonly DshChildSecret[];
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: '/usr/bin:/bin',
    HOME: input.paths.processHome,
    TMPDIR: input.paths.launcherCwd,
    DSH_HOME: input.paths.dshHome,
  };
  const names = new Set<string>();
  for (const secret of input.secrets ?? []) {
    if (!/^CINDY_DSH_[A-Z0-9_]{1,80}$/.test(secret.name) || !secret.value || names.has(secret.name)) {
      throw new Error('DSH child credential name or value is invalid');
    }
    names.add(secret.name);
    env[secret.name] = secret.value;
  }
  return env;
}

/** Remove only the temp launcher that this module created, never a user home. */
export function cleanupDshHostScopePaths(paths: DshHostScopePaths): void {
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
