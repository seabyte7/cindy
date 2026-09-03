import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DshAcpInitializeResult, DshAcpSessionClient } from '@cindy/maker-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DshHostManager } from '../host-manager.js';
import {
  buildDshChildEnvironment,
  cleanupDshHostScopePaths,
  createDshHostScopeId,
  createDshHostScopePaths,
} from '../scope.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const result = mkdtempSync(join(tmpdir(), 'cindy-dsh-host-scope-'));
  temporaryRoots.push(result);
  return result;
}

function initialize(): DshAcpInitializeResult {
  return {
    protocolVersion: 1,
    agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' },
    agentCapabilities: { sessionCapabilities: { close: {}, list: {}, resume: {} } },
  };
}

describe('DSH host scope', () => {
  it('hashes account identity into scope keys and creates isolated managed Home and launcher paths', () => {
    const base = root();
    const userData = join(base, 'user-data');
    const temp = join(base, 'temp');
    mkdirSync(userData, { mode: 0o700 });
    mkdirSync(temp, { mode: 0o700 });
    const input = { accountId: 'account-A', releaseId: 'dsh-test-release', homeMode: 'cindy-managed' as const };
    const paths = createDshHostScopePaths({ ...input, userDataPath: userData, tempPath: temp });

    expect(paths.scopeId).not.toContain('account-A');
    expect(paths.dshHome).toContain('dsh-agent-home');
    expect(paths.launcherCwd).toContain('cindy-dsh-launcher-');
    const env = buildDshChildEnvironment({
      paths,
      secrets: [{ name: 'CINDY_DSH_API_KEY', value: 'test-only-secret' }],
    });
    expect(env).toEqual({
      PATH: '/usr/bin:/bin',
      HOME: paths.processHome,
      TMPDIR: paths.launcherCwd,
      DSH_HOME: paths.dshHome,
      CINDY_DSH_API_KEY: 'test-only-secret',
    });
    expect(() => buildDshChildEnvironment({
      paths,
      secrets: [{ name: 'PATH', value: '/unsafe' }],
    })).toThrow('credential name or value is invalid');

    cleanupDshHostScopePaths(paths);
    expect(() => cleanupDshHostScopePaths(paths)).toThrow();
  });

  it('leaves an explicit existing DSH Home untouched when its launcher is cleaned', () => {
    const base = root();
    const userData = join(base, 'user-data');
    const temp = join(base, 'temp');
    const existing = join(base, 'existing-dsh-home');
    mkdirSync(userData, { mode: 0o700 });
    mkdirSync(temp, { mode: 0o700 });
    mkdirSync(existing, { mode: 0o700 });
    const sentinel = join(existing, 'user-profile');
    writeFileSync(sentinel, 'keep');
    const paths = createDshHostScopePaths({
      accountId: 'account-A',
      releaseId: 'dsh-test-release',
      homeMode: 'existing-dsh-home',
      existingDshHome: existing,
      userDataPath: userData,
      tempPath: temp,
    });
    cleanupDshHostScopePaths(paths);
    expect(readFileSync(sentinel, 'utf8')).toBe('keep');
    expect(() => createDshHostScopeId({
      accountId: 'account-A',
      releaseId: 'dsh-test-release',
      homeMode: 'existing-dsh-home',
    })).toThrow('requires an explicit DSH home');
    expect(() => createDshHostScopeId({
      accountId: 'account-A',
      releaseId: 'dsh-test-release',
      homeMode: 'cindy-managed',
      existingDshHome: existing,
    })).toThrow('must not accept');
  });
});

describe('DshHostManager', () => {
  it('single-flights a scope, exposes only a capability snapshot, and tears down on account switch', async () => {
    const close = vi.fn(async () => undefined);
    const client = {
      initialize: vi.fn(async () => initialize()),
      close,
    } as unknown as DshAcpSessionClient;
    const identity = createDshHostScopeId({ accountId: 'account-A', releaseId: 'release', homeMode: 'cindy-managed' });
    const paths = {
      scopeId: identity.scopeId,
      accountScopeId: identity.accountScopeId,
      homeMode: 'cindy-managed' as const,
      processHome: '/main-owned/home',
      dshHome: '/main-owned/dsh-home',
      launcherCwd: '/main-owned/launcher',
      tempRoot: '/main-owned',
    };
    const cleanupPaths = vi.fn();
    const manager = new DshHostManager({
      resolveRuntime: vi.fn(() => ({
        installDirectory: '/main-owned/runtime',
        binaryPath: '/main-owned/runtime/dsh',
        sidecarPaths: ['/main-owned/runtime/dsh-rg'],
        releaseId: 'release',
        expectedVersion: '0.0.test',
      })),
      createScopePaths: vi.fn(() => paths),
      buildChildEnvironment: vi.fn(() => ({ DSH_HOME: paths.dshHome })),
      loadSecrets: vi.fn(() => [{ name: 'CINDY_DSH_API_KEY', value: 'never-log' }]),
      createContainedClient: vi.fn(() => client),
      cleanupPaths,
    });
    const input = { accountId: 'account-A', releaseId: 'release', homeMode: 'cindy-managed' as const };

    const [first, second] = await Promise.all([manager.start(input), manager.start(input)]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ scopeId: identity.scopeId, agentName: 'deepseek-harness-acp' });
    expect(manager.getSnapshot(input)).toEqual(first);
    expect(client.initialize).toHaveBeenCalledTimes(1);

    await manager.stopAccount('account-A', 'account switched');
    expect(close).toHaveBeenCalledWith('account switched');
    expect(cleanupPaths).toHaveBeenCalledWith(paths);
    expect(manager.getSnapshot(input)).toBeNull();
  });

  it('closes a failed startup and cleans only that scope', async () => {
    const close = vi.fn(async () => undefined);
    const cleanupPaths = vi.fn();
    const identity = createDshHostScopeId({ accountId: 'account-A', releaseId: 'release', homeMode: 'cindy-managed' });
    const paths = {
      scopeId: identity.scopeId,
      accountScopeId: identity.accountScopeId,
      homeMode: 'cindy-managed' as const,
      processHome: '/home', dshHome: '/dsh-home', launcherCwd: '/launcher', tempRoot: '/tmp',
    };
    const manager = new DshHostManager({
      resolveRuntime: () => ({ installDirectory: '/runtime', binaryPath: '/runtime/dsh', sidecarPaths: [], releaseId: 'release', expectedVersion: '0.0.test' }),
      createScopePaths: () => paths,
      buildChildEnvironment: () => ({ DSH_HOME: '/dsh-home' }),
      loadSecrets: () => [],
      createContainedClient: () => ({
        initialize: async () => { throw new Error('handshake failed'); },
        close,
      } as unknown as DshAcpSessionClient),
      cleanupPaths,
    });
    const input = { accountId: 'account-A', releaseId: 'release', homeMode: 'cindy-managed' as const };
    await expect(manager.start(input)).rejects.toThrow('handshake failed');
    expect(close).toHaveBeenCalledWith('DSH host startup failed');
    expect(cleanupPaths).toHaveBeenCalledWith(paths);
    expect(manager.getSnapshot(input)).toBeNull();
  });

  it('keeps existing-home execution unavailable until the F7 extension gate', async () => {
    const createScopePaths = vi.fn();
    const manager = new DshHostManager({
      resolveRuntime: vi.fn(),
      createScopePaths,
      buildChildEnvironment: vi.fn(),
      loadSecrets: vi.fn(),
      createContainedClient: vi.fn(),
      cleanupPaths: vi.fn(),
    });
    await expect(manager.start({
      accountId: 'account-A',
      releaseId: 'release',
      homeMode: 'existing-dsh-home',
      existingDshHome: '/user-selected/dsh-home',
    })).rejects.toThrow('F7 native-extension gate');
    expect(createScopePaths).not.toHaveBeenCalled();
  });
});
