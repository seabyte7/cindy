import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createConsoleLogger } from '@cindy/maker-core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createMacosSupervisedDshHostManager,
  resolveMacosSupervisedDshRuntime,
} from '../macos-supervised-runtime.js';
import { createDshHostScopeId } from '../scope.js';
import { createLoopbackE2eDshProviderRoute } from '../provider-route.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const result = mkdtempSync(join(tmpdir(), 'cindy-dsh-macos-supervised-layout-'));
  temporaryRoots.push(result);
  return result;
}

function writeExecutable(candidate: string): void {
  writeFileSync(candidate, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  chmodSync(candidate, 0o755);
}

function writeInfoPlist(candidate: string, identifier: string): void {
  writeFileSync(candidate, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string></dict></plist>\n`);
}

function createPackagedHelper(base: string): { resourcesPath: string; homePath: string; descriptorPath: string } {
  const app = join(base, 'Cindy.app');
  const contents = join(app, 'Contents');
  const resourcesPath = join(contents, 'Resources');
  const helperContents = join(contents, 'Helpers', 'Cindy DSH Supervisor.app', 'Contents');
  const helperResources = join(helperContents, 'Resources');
  const helperMacOS = join(helperContents, 'MacOS');
  const runtime = join(helperResources, 'dsh-runtime');
  const nativeAddonSource = join(runtime, 'node', 'bootstrap.node');
  const nativeAddonCache = join(helperResources, 'dsh-native-addons', 'node', 'bootstrap.node');
  const homePath = join(base, 'home');
  mkdirSync(homePath, { mode: 0o700 });
  mkdirSync(resourcesPath, { recursive: true });
  mkdirSync(runtime, { recursive: true });
  mkdirSync(join(runtime, 'node'), { recursive: true });
  mkdirSync(join(helperResources, 'dsh-native-addons', 'node'), { recursive: true });
  mkdirSync(join(helperResources, 'dsh-pkg-native-cache', 'pkg'), { recursive: true });
  mkdirSync(helperMacOS, { recursive: true });
  mkdirSync(join(homePath, 'Library', 'Containers'), { recursive: true });
  writeInfoPlist(join(contents, 'Info.plist'), 'com.example.cindy');
  writeInfoPlist(join(helperContents, 'Info.plist'), 'com.example.cindy.dsh-supervisor');
  writeExecutable(join(helperMacOS, 'cindy-dsh-sandbox-supervisor'));
  writeExecutable(join(runtime, 'dsh-runtime'));
  writeExecutable(join(runtime, 'dsh-runtime-rg'));
  writeFileSync(nativeAddonSource, 'fixture native addon');
  writeFileSync(nativeAddonCache, 'fixture sealed native addon');
  const descriptorPath = join(helperResources, 'cindy-dsh-supervised-runtime.json');
  writeFileSync(descriptorPath, `${JSON.stringify({
    formatVersion: 1,
    target: 'darwin-arm64',
    releaseId: 'cindy-dsh-test-release',
    expectedVersion: '0.1.test',
    parentBundleIdentifier: 'com.example.cindy',
    helperBundleIdentifier: 'com.example.cindy.dsh-supervisor',
    supervisorExecutable: 'cindy-dsh-sandbox-supervisor',
    runtimeExecutable: 'dsh-runtime',
    requiredSidecars: ['dsh-runtime-rg'],
    requiredNativeAddons: [{ sourcePath: 'node/bootstrap.node', cachePath: 'node/bootstrap.node' }],
    requiredPkgNativeCache: { sourceDirectory: 'pkg-native-cache', cacheDirectory: 'pkg' },
  })}\n`);
  return { resourcesPath, homePath, descriptorPath };
}

describe('packaged macOS supervised DSH runtime layout', () => {
  it('admits only the fixed Helper.app topology and gives scopes the helper sandbox container', () => {
    const fixture = createPackagedHelper(root());
    const layout = resolveMacosSupervisedDshRuntime({
      ...fixture,
      platform: 'darwin',
      arch: 'arm64',
    });

    expect(layout.runtime).toMatchObject({
      releaseId: 'cindy-dsh-test-release',
      expectedVersion: '0.1.test',
      binaryPath: expect.stringMatching(/dsh-runtime$/),
      sidecarPaths: [expect.stringMatching(/dsh-runtime-rg$/)],
    });
    expect(layout.supervisorPath).toMatch(/Cindy DSH Supervisor\.app\/Contents\/MacOS\/cindy-dsh-sandbox-supervisor$/);
    expect(layout.helperContainerDataPath).toBe(join(
      realpathSync(fixture.homePath),
      'Library',
      'Containers',
      'com.example.cindy.dsh-supervisor',
      'Data',
    ));
    expect(layout.helperTempRoot).toBe(join(layout.helperContainerDataPath, 'dsh-runtime-tmp'));
  });

  it('fails closed for another platform before it accepts any package layout', () => {
    const fixture = createPackagedHelper(root());
    expect(() => resolveMacosSupervisedDshRuntime({
      ...fixture,
      platform: 'linux',
      arch: 'x64',
    })).toThrow('only darwin-arm64 is admitted');
  });

  it('rejects a descriptor attempting to escape the fixed runtime directory', () => {
    const fixture = createPackagedHelper(root());
    writeFileSync(fixture.descriptorPath, `${JSON.stringify({
      formatVersion: 1,
      target: 'darwin-arm64',
      releaseId: 'cindy-dsh-test-release',
      expectedVersion: '0.1.test',
      parentBundleIdentifier: 'com.example.cindy',
      helperBundleIdentifier: 'com.example.cindy.dsh-supervisor',
      supervisorExecutable: 'cindy-dsh-sandbox-supervisor',
      runtimeExecutable: '../../outside',
      requiredSidecars: [],
      requiredNativeAddons: [],
      requiredPkgNativeCache: { sourceDirectory: 'pkg-native-cache', cacheDirectory: 'pkg' },
    })}\n`);

    expect(() => resolveMacosSupervisedDshRuntime({
      ...fixture,
      platform: 'darwin',
      arch: 'arm64',
    })).toThrow('runtime binary path is invalid');
  });

  it('rejects a descriptor whose Helper.app identity differs from the actual helper bundle', () => {
    const fixture = createPackagedHelper(root());
    const helperInfo = join(
      fixture.resourcesPath,
      '..',
      'Helpers',
      'Cindy DSH Supervisor.app',
      'Contents',
      'Info.plist',
    );
    writeInfoPlist(helperInfo, 'com.example.other-helper');

    expect(() => resolveMacosSupervisedDshRuntime({
      ...fixture,
      platform: 'darwin',
      arch: 'arm64',
    })).toThrow('does not match the signed app identity');
  });

  it('rejects a missing sealed native-addon cache entry instead of treating the source copy as a fallback', () => {
    const fixture = createPackagedHelper(root());
    rmSync(join(
      fixture.resourcesPath,
      '..',
      'Helpers',
      'Cindy DSH Supervisor.app',
      'Contents',
      'Resources',
      'dsh-native-addons',
      'node',
      'bootstrap.node',
    ));

    expect(() => resolveMacosSupervisedDshRuntime({
      ...fixture,
      platform: 'darwin',
      arch: 'arm64',
    })).toThrow('sealed native addon cache entry must be a regular file');
  });

  it('rejects a missing sealed pkg native-cache instead of accepting a Home extraction fallback', () => {
    const fixture = createPackagedHelper(root());
    rmSync(join(
      fixture.resourcesPath,
      '..',
      'Helpers',
      'Cindy DSH Supervisor.app',
      'Contents',
      'Resources',
      'dsh-pkg-native-cache',
    ), { recursive: true });

    expect(() => resolveMacosSupervisedDshRuntime({
      ...fixture,
      platform: 'darwin',
      arch: 'arm64',
    })).toThrow('sealed pkg native-cache must be a real directory');
  });

  it('rejects a scope whose lexical Helper-container path is redirected through a symlink before spawn', async () => {
    const base = root();
    const fixture = createPackagedHelper(base);
    const input = { accountId: 'account-A', releaseId: 'cindy-dsh-test-release', homeMode: 'cindy-managed' as const };
    const scope = createDshHostScopeId(input);
    const layout = resolveMacosSupervisedDshRuntime({ ...fixture, platform: 'darwin', arch: 'arm64' });
    const outsideRoot = join(base, 'outside');
    mkdirSync(join(outsideRoot, scope.scopeId, 'process-home'), { recursive: true, mode: 0o700 });
    mkdirSync(join(outsideRoot, scope.scopeId, 'dsh-home'), { recursive: true, mode: 0o700 });
    const managedBase = join(layout.helperContainerDataPath, 'dsh-agent-home');
    const manager = createMacosSupervisedDshHostManager({
      ...fixture,
      platform: 'darwin',
      arch: 'arm64',
      logger: createConsoleLogger('dsh-symlink-scope-test'),
      resolveProviderRoute: () => createLoopbackE2eDshProviderRoute('http://127.0.0.1:43123'),
      loadSecrets: () => {
        rmSync(managedBase, { recursive: true, force: true });
        symlinkSync(outsideRoot, managedBase);
        return [{ name: 'CINDY_DSH_PROVIDER_API_KEY', value: 'test-only-secret' }];
      },
    });

    await expect(manager.start(input)).rejects.toThrow('escapes the Helper.app sandbox container');
  });
});
