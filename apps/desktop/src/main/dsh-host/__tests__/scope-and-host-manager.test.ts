import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DshAcpInitializeResult, DshAcpSessionClient } from '@cindy/maker-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DshHostManager } from '../host-manager.js';
import {
  buildDshChildEnvironment,
  cleanupDshHostScopePaths,
  createDshExistingHomeLaunchPaths,
  createDshHostScopeId,
  createDshHostScopePaths,
} from '../scope.js';
import { createLoopbackE2eDshProviderRoute } from '../provider-route.js';

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
    const input = {
      accountId: 'account-A',
      releaseId: 'dsh-test-release',
      homeMode: 'cindy-managed' as const,
    };
    const paths = createDshHostScopePaths({ ...input, userDataPath: userData, tempPath: temp });

    expect(paths.scopeId).not.toContain('account-A');
    expect(paths.dshHome).toContain('dsh-agent-home');
    expect(paths.launcherCwd).toContain('cindy-dsh-launcher-');
    const env = buildDshChildEnvironment({
      paths,
      providerRoute: createLoopbackE2eDshProviderRoute('http://127.0.0.1:43123'),
      secrets: [{ name: 'CINDY_DSH_PROVIDER_API_KEY', value: 'test-only-secret' }],
    });
    expect(env).toEqual({
      PATH: '/usr/bin:/bin',
      HOME: paths.processHome,
      TMPDIR: paths.launcherCwd,
      DSH_HOME: paths.dshHome,
      DSH_TELEMETRY_DISABLED: '1',
      CINDY_DSH_PROVIDER_BASE_URL: 'http://127.0.0.1:43123',
      CINDY_DSH_PROVIDER_API_KEY: 'test-only-secret',
    });
    expect(() =>
      buildDshChildEnvironment({
        paths,
        secrets: [{ name: 'CINDY_DSH_PROVIDER_API_KEY', value: 'test-only-secret' }],
      }),
    ).toThrow('requires an admitted provider route');
    expect(() =>
      buildDshChildEnvironment({
        paths,
        providerRoute: createLoopbackE2eDshProviderRoute('http://127.0.0.1:43123'),
        secrets: [],
      }),
    ).toThrow('requires exactly one Main-owned API key');

    cleanupDshHostScopePaths(paths);
    expect(() => cleanupDshHostScopePaths(paths)).toThrow();
  });

  it('does not allow an existing DSH Home pathname through the generic scope boundary', () => {
    const base = root();
    const userData = join(base, 'user-data');
    const temp = join(base, 'temp');
    mkdirSync(userData, { mode: 0o700 });
    mkdirSync(temp, { mode: 0o700 });
    const existingInput = {
      accountId: 'account-A',
      releaseId: 'dsh-test-release',
      homeMode: 'existing-dsh-home',
    } as const;
    expect(createDshHostScopeId(existingInput).scopeId).not.toContain('account-A');
    expect(() =>
      createDshHostScopePaths({
        ...existingInput,
        userDataPath: userData,
        tempPath: temp,
      }),
    ).toThrow('fixed Helper bookmark handoff');
    const legacyInput = { ...existingInput, existingDshHome: '/user-selected/dsh-home' };
    expect(() => createDshHostScopeId(legacyInput as never)).toThrow(
      'no longer accepts an existing Home path',
    );
    expect(() =>
      createDshHostScopePaths({ ...legacyInput, userDataPath: userData, tempPath: temp } as never),
    ).toThrow('no longer accepts an existing Home path');

    const launchPaths = createDshExistingHomeLaunchPaths({
      ...existingInput,
      userDataPath: userData,
      tempPath: temp,
    });
    expect('dshHome' in launchPaths).toBe(false);
    expect(launchPaths.processHome).toContain('dsh-existing-home-launch');
    expect(buildDshChildEnvironment({ paths: launchPaths })).not.toHaveProperty('DSH_HOME');
    cleanupDshHostScopePaths(launchPaths);
  });

  it('rejects a pre-existing symlink instead of recursively creating a managed Home through it', () => {
    const base = root();
    const userData = join(base, 'user-data');
    const temp = join(base, 'temp');
    const outside = join(base, 'outside');
    mkdirSync(userData, { mode: 0o700 });
    mkdirSync(temp, { mode: 0o700 });
    mkdirSync(outside, { mode: 0o700 });
    symlinkSync(outside, join(userData, 'dsh-agent-home'));

    expect(() =>
      createDshHostScopePaths({
        accountId: 'account-A',
        releaseId: 'dsh-test-release',
        homeMode: 'cindy-managed',
        userDataPath: userData,
        tempPath: temp,
      }),
    ).toThrow('DSH managed Home root must be a real directory');
  });
});

describe('DshHostManager', () => {
  it('single-flights a scope, exposes only a capability snapshot, and tears down on account switch', async () => {
    const close = vi.fn(async () => undefined);
    const client = {
      initialize: vi.fn(async () => initialize()),
      close,
    } as unknown as DshAcpSessionClient;
    const identity = createDshHostScopeId({
      accountId: 'account-A',
      releaseId: 'release',
      homeMode: 'cindy-managed',
    });
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
    const loadSecrets = vi.fn(() => [
      { name: 'CINDY_DSH_PROVIDER_API_KEY' as const, value: 'never-log' },
    ]);
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
      loadSecrets,
      createContainedClient: vi.fn(() => client),
      cleanupPaths,
    });
    const input = {
      accountId: 'account-A',
      releaseId: 'release',
      homeMode: 'cindy-managed' as const,
    };

    const [first, second] = await Promise.all([manager.start(input), manager.start(input)]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ scopeId: identity.scopeId, agentName: 'deepseek-harness-acp' });
    expect(manager.getSnapshot(input)).toEqual(first);
    expect(client.initialize).toHaveBeenCalledTimes(1);
    expect(loadSecrets).not.toHaveBeenCalled();

    await manager.stopAccount('account-A', 'account switched');
    expect(close).toHaveBeenCalledWith('account switched');
    expect(cleanupPaths).toHaveBeenCalledWith(paths);
    expect(manager.getSnapshot(input)).toBeNull();
  });

  it('closes a failed startup and cleans only that scope', async () => {
    const close = vi.fn(async () => undefined);
    const cleanupPaths = vi.fn();
    const identity = createDshHostScopeId({
      accountId: 'account-A',
      releaseId: 'release',
      homeMode: 'cindy-managed',
    });
    const paths = {
      scopeId: identity.scopeId,
      accountScopeId: identity.accountScopeId,
      homeMode: 'cindy-managed' as const,
      processHome: '/home',
      dshHome: '/dsh-home',
      launcherCwd: '/launcher',
      tempRoot: '/tmp',
    };
    const manager = new DshHostManager({
      resolveRuntime: () => ({
        installDirectory: '/runtime',
        binaryPath: '/runtime/dsh',
        sidecarPaths: [],
        releaseId: 'release',
        expectedVersion: '0.0.test',
      }),
      createScopePaths: () => paths,
      buildChildEnvironment: () => ({ DSH_HOME: '/dsh-home' }),
      loadSecrets: () => [],
      createContainedClient: () =>
        ({
          initialize: async () => {
            throw new Error('handshake failed');
          },
          close,
        }) as unknown as DshAcpSessionClient,
      cleanupPaths,
    });
    const input = {
      accountId: 'account-A',
      releaseId: 'release',
      homeMode: 'cindy-managed' as const,
    };
    await expect(manager.start(input)).rejects.toThrow('handshake failed');
    expect(close).toHaveBeenCalledWith('DSH host startup failed');
    expect(cleanupPaths).toHaveBeenCalledWith(paths);
    expect(manager.getSnapshot(input)).toBeNull();
  });

  it('loads a provider key only after Main admits a route and materializes its fixed profile', async () => {
    const input = {
      accountId: 'account-A',
      releaseId: 'release',
      homeMode: 'cindy-managed' as const,
    };
    const identity = createDshHostScopeId(input);
    const paths = {
      scopeId: identity.scopeId,
      accountScopeId: identity.accountScopeId,
      homeMode: 'cindy-managed' as const,
      processHome: '/main-owned/home',
      dshHome: '/main-owned/dsh-home',
      launcherCwd: '/main-owned/launcher',
      tempRoot: '/main-owned',
    };
    const route = createLoopbackE2eDshProviderRoute('http://127.0.0.1:43123');
    const materializeProviderProfile = vi.fn();
    const loadSecrets = vi.fn(() => [
      { name: 'CINDY_DSH_PROVIDER_API_KEY' as const, value: 'test-only-secret' },
    ]);
    const buildChildEnvironment = vi.fn(() => ({ DSH_HOME: paths.dshHome }));
    const manager = new DshHostManager({
      resolveRuntime: () => ({
        installDirectory: '/runtime',
        binaryPath: '/runtime/dsh',
        sidecarPaths: [],
        releaseId: 'release',
        expectedVersion: '0.0.test',
      }),
      createScopePaths: () => paths,
      resolveProviderRoute: () => route,
      materializeProviderProfile,
      buildChildEnvironment,
      loadSecrets,
      createContainedClient: () =>
        ({
          initialize: async () => initialize(),
          close: async () => undefined,
        }) as DshAcpSessionClient,
      cleanupPaths: vi.fn(),
    });

    await manager.start(input);

    expect(materializeProviderProfile).toHaveBeenCalledWith(paths, route);
    expect(loadSecrets).toHaveBeenCalledWith(input);
    expect(buildChildEnvironment).toHaveBeenCalledWith({
      paths,
      providerRoute: route,
      secrets: [{ name: 'CINDY_DSH_PROVIDER_API_KEY', value: 'test-only-secret' }],
    });
    expect(materializeProviderProfile.mock.invocationCallOrder[0]!).toBeLessThan(
      loadSecrets.mock.invocationCallOrder[0]!,
    );
  });

  it('rejects a provider route when no Main-owned profile materializer is supplied', async () => {
    const input = {
      accountId: 'account-A',
      releaseId: 'release',
      homeMode: 'cindy-managed' as const,
    };
    const identity = createDshHostScopeId(input);
    const paths = {
      scopeId: identity.scopeId,
      accountScopeId: identity.accountScopeId,
      homeMode: 'cindy-managed' as const,
      processHome: '/main-owned/home',
      dshHome: '/main-owned/dsh-home',
      launcherCwd: '/main-owned/launcher',
      tempRoot: '/main-owned',
    };
    const loadSecrets = vi.fn();
    const manager = new DshHostManager({
      resolveRuntime: () => ({
        installDirectory: '/runtime',
        binaryPath: '/runtime/dsh',
        sidecarPaths: [],
        releaseId: 'release',
        expectedVersion: '0.0.test',
      }),
      createScopePaths: () => paths,
      resolveProviderRoute: () => createLoopbackE2eDshProviderRoute('http://127.0.0.1:43123'),
      buildChildEnvironment: vi.fn(),
      loadSecrets,
      createContainedClient: vi.fn(),
      cleanupPaths: vi.fn(),
    });

    await expect(manager.start(input)).rejects.toThrow('requires a Main-owned managed ACP profile');
    expect(loadSecrets).not.toHaveBeenCalled();
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
    await expect(
      manager.start({
        accountId: 'account-A',
        releaseId: 'release',
        homeMode: 'existing-dsh-home',
      }),
    ).rejects.toThrow('F7 native-extension gate');
    expect(createScopePaths).not.toHaveBeenCalled();
  });

  it('rejects a requested release that does not match the verified launch runtime', async () => {
    const createScopePaths = vi.fn();
    const createContainedClient = vi.fn();
    const manager = new DshHostManager({
      resolveRuntime: vi.fn(() => ({
        installDirectory: '/runtime',
        binaryPath: '/runtime/dsh',
        sidecarPaths: [],
        releaseId: 'verified-release',
        expectedVersion: '0.0.test',
      })),
      createScopePaths,
      buildChildEnvironment: vi.fn(),
      loadSecrets: vi.fn(),
      createContainedClient,
      cleanupPaths: vi.fn(),
    });

    await expect(
      manager.start({
        accountId: 'account-A',
        releaseId: 'stale-release',
        homeMode: 'cindy-managed',
      }),
    ).rejects.toThrow('release identity does not match');
    expect(createScopePaths).not.toHaveBeenCalled();
    expect(createContainedClient).not.toHaveBeenCalled();
  });
});
