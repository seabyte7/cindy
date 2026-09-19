/**
 * Fixed development capsule admission for the macOS DSH Helper.
 *
 * Source Desktop deliberately never launches a DSH executable from PATH or
 * from an unpackaged source checkout.  `pnpm dsh:dev` instead opts into the
 * one local, signed Cindy package produced by `package:dsh:local-macos`.
 * That package remains stable while ordinary Main/Renderer code is edited, so
 * the edit-test loop does not need a new package for every change.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const DSH_DEVELOPMENT_CAPSULE_ENV = 'XDT_DSH_DEVELOPMENT_CAPSULE';

const DSH_DEVELOPMENT_CAPSULE_RELATIVE_PATH = Object.freeze([
  'out',
  'Cindy-darwin-arm64',
  'Cindy.app',
]);

/** Keep this in lockstep with tools/dsh/macos-supervised-source-release.json. */
export const DSH_DEVELOPMENT_CAPSULE_PIN = Object.freeze({
  releaseId: 'cindy-dsh-0.1.6-alpha.2-build.1-macos-supervised',
  expectedVersion: '0.1.6-alpha.2',
});

export interface DshRuntimeResources {
  readonly resourcesPath: string;
  readonly source: 'current-app' | 'development-capsule';
  /** Present only for the fixed local package, never supplied by a caller. */
  readonly capsuleAppPath?: string;
}

export function developmentCapsuleAppPath(desktopAppPath: string): string {
  return path.resolve(desktopAppPath, ...DSH_DEVELOPMENT_CAPSULE_RELATIVE_PATH);
}

export function resolveDshRuntimeResources(input: {
  readonly isPackaged: boolean;
  readonly desktopAppPath: string;
  readonly currentResourcesPath: string;
  readonly developmentCapsuleEnabled: boolean;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
}): DshRuntimeResources {
  if (input.isPackaged || !input.developmentCapsuleEnabled) {
    return Object.freeze({
      resourcesPath: input.currentResourcesPath,
      source: 'current-app',
    });
  }

  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  if (platform !== 'darwin' || arch !== 'arm64') {
    throw new Error(
      `DSH development capsule is unavailable on ${platform}-${arch}; only darwin-arm64 is admitted`,
    );
  }

  const capsuleAppPath = developmentCapsuleAppPath(input.desktopAppPath);
  return Object.freeze({
    resourcesPath: path.join(capsuleAppPath, 'Contents', 'Resources'),
    source: 'development-capsule',
    capsuleAppPath,
  });
}

function verifyDevelopmentCapsuleSignature(capsuleAppPath: string): void {
  try {
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', capsuleAppPath], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {
    throw new Error('DSH development capsule signature is invalid or unavailable');
  }
}

/**
 * Verify the package identity before its resources are admitted.  The
 * topology and every direct child remain checked by
 * resolveMacosSupervisedDshRuntime immediately afterwards.
 */
export function assertDshDevelopmentCapsule(
  resources: DshRuntimeResources,
  options: {
    readonly verifySignature?: (capsuleAppPath: string) => void;
  } = {},
): void {
  if (resources.source !== 'development-capsule') return;
  const capsuleAppPath = resources.capsuleAppPath;
  if (!capsuleAppPath) throw new Error('DSH development capsule path is unavailable');
  (options.verifySignature ?? verifyDevelopmentCapsuleSignature)(capsuleAppPath);
}

/** Do not accept a different local Helper release merely because it is signed. */
export function assertDshDevelopmentCapsulePin(
  resources: DshRuntimeResources,
  runtime: Readonly<{ releaseId: string; expectedVersion: string }>,
): void {
  if (resources.source !== 'development-capsule') return;
  if (
    runtime.releaseId !== DSH_DEVELOPMENT_CAPSULE_PIN.releaseId
    || runtime.expectedVersion !== DSH_DEVELOPMENT_CAPSULE_PIN.expectedVersion
  ) {
    throw new Error('DSH development capsule does not match the checked-in DSH release pin');
  }
}
