import { describe, expect, it } from 'vitest';

import {
  assertDshDevelopmentCapsule,
  assertDshDevelopmentCapsulePin,
  developmentCapsuleAppPath,
  resolveDshRuntimeResources,
} from '../development-capsule.js';

describe('DSH development capsule', () => {
  it('uses the running package unless the explicit development flag is enabled', () => {
    expect(resolveDshRuntimeResources({
      isPackaged: false,
      desktopAppPath: '/work/cindy/apps/desktop',
      currentResourcesPath: '/runtime/Electron.app/Contents/Resources',
      developmentCapsuleEnabled: false,
      platform: 'darwin',
      arch: 'arm64',
    })).toEqual({
      resourcesPath: '/runtime/Electron.app/Contents/Resources',
      source: 'current-app',
    });
  });

  it('uses only the fixed local package path when development mode is enabled', () => {
    expect(developmentCapsuleAppPath('/work/cindy/apps/desktop')).toBe(
      '/work/cindy/apps/desktop/out/Cindy-darwin-arm64/Cindy.app',
    );
    expect(resolveDshRuntimeResources({
      isPackaged: false,
      desktopAppPath: '/work/cindy/apps/desktop',
      currentResourcesPath: '/runtime/Electron.app/Contents/Resources',
      developmentCapsuleEnabled: true,
      platform: 'darwin',
      arch: 'arm64',
    })).toEqual({
      resourcesPath: '/work/cindy/apps/desktop/out/Cindy-darwin-arm64/Cindy.app/Contents/Resources',
      source: 'development-capsule',
      capsuleAppPath: '/work/cindy/apps/desktop/out/Cindy-darwin-arm64/Cindy.app',
    });
  });

  it('does not enable a source or PATH fallback on another platform', () => {
    expect(() => resolveDshRuntimeResources({
      isPackaged: false,
      desktopAppPath: '/work/cindy/apps/desktop',
      currentResourcesPath: '/runtime/Electron.app/Contents/Resources',
      developmentCapsuleEnabled: true,
      platform: 'linux',
      arch: 'x64',
    })).toThrow('only darwin-arm64 is admitted');
  });

  it('requires the fixed pin and a verified signature for the development capsule', () => {
    const resources = resolveDshRuntimeResources({
      isPackaged: false,
      desktopAppPath: '/work/cindy/apps/desktop',
      currentResourcesPath: '/runtime/Electron.app/Contents/Resources',
      developmentCapsuleEnabled: true,
      platform: 'darwin',
      arch: 'arm64',
    });
    const verified: string[] = [];
    assertDshDevelopmentCapsule(resources, {
      verifySignature: (candidate) => verified.push(candidate),
    });
    expect(verified).toEqual(['/work/cindy/apps/desktop/out/Cindy-darwin-arm64/Cindy.app']);
    expect(() => assertDshDevelopmentCapsulePin(resources, {
      releaseId: 'another-release',
      expectedVersion: '0.1.6-alpha.2',
    })).toThrow('does not match the checked-in DSH release pin');
  });
});
