/**
 * Local signed-package evidence for the F7 existing-Home authority handoff.
 *
 * It is called only by the explicit packaged-app evidence flag in Main.  The
 * picker is real (not a test double): it must return Electron's security
 * scoped bookmark, which is encrypted in Cindy-owned temporary userData,
 * converted by the signed Main N-API bridge, and passed once to the signed
 * Helper over fd 3.  No pathname or bookmark is part of the result.
 */

import fs from 'node:fs';
import path from 'node:path';

import { createConsoleLogger, DshAcpClient } from '@cindy/maker-core';

import { createDshAcpStdioTransport } from '../maker-host/dsh-acp-stdio-transport.js';
import {
  createDshExistingHomeSettingsStore,
  selectExistingDshHomeFromMain,
  type DshExistingHomePicker,
  type DshExistingHomeSafeStorage,
} from './existing-home-settings.js';
import { resolveDshExistingHomeLaunch } from './existing-home-launch.js';
import {
  createDshImplicitBookmarkHandoff,
  loadMacosDshMainBookmarkBridge,
} from './main-bookmark-bridge.js';
import { resolveMacosSupervisedDshRuntime } from './macos-supervised-runtime.js';
import {
  buildDshChildEnvironment,
  cleanupDshHostScopePaths,
  createDshExistingHomeLaunchPaths,
  type DshExistingHomeLaunchPaths,
} from './scope.js';
import type { DshExistingHomePackagedE2eMode } from './existing-home-packaged-e2e-mode.js';

export type { DshExistingHomePackagedE2eMode } from './existing-home-packaged-e2e-mode.js';

const E2E_ACCOUNT_ID = 'dsh-existing-home-packaged-e2e';
export const DSH_EXISTING_HOME_PACKAGED_E2E_RESULT_NAME = 'dsh-existing-home-packaged-e2e-result.json';
export type DshExistingHomePackagedE2ePhase =
  | 'picker'
  | 'protected-selection'
  | 'main-implicit'
  | 'helper-acp'
  | 'reset';

/**
 * `select` and `resume-reset` deliberately run in separate app processes.
 * This is the only way a local signed-package check can prove that a protected
 * selection survives restart before Main turns it into a one-shot implicit
 * bookmark. `full` remains a convenient single-process smoke path.
 */
export interface DshExistingHomePackagedE2eResult {
  readonly ok: true;
  readonly phases: readonly DshExistingHomePackagedE2ePhase[];
}

export class DshExistingHomePackagedE2eFailure extends Error {
  readonly phase: DshExistingHomePackagedE2ePhase;

  constructor(phase: DshExistingHomePackagedE2ePhase) {
    super('DSH existing Home packaged E2E failed');
    this.phase = phase;
  }
}

export function dshExistingHomePackagedE2eFailurePhase(
  error: unknown,
  fallback: DshExistingHomePackagedE2ePhase = 'picker',
): DshExistingHomePackagedE2ePhase {
  const phase = error && typeof error === 'object'
    ? (error as { phase?: unknown }).phase
    : undefined;
  return phase === 'picker' || phase === 'protected-selection' || phase === 'main-implicit' ||
      phase === 'helper-acp' || phase === 'reset'
    ? phase
    : fallback;
}

/**
 * The application process may detach from the invoking terminal when a native
 * picker takes focus. Persist a minimal, secret-free verdict in the explicit
 * isolated userData root so local evidence can reliably observe the result.
 */
export function writeDshExistingHomePackagedE2eVerdict(input: {
  readonly userDataPath: string;
  readonly result: Readonly<{ ok: true; phases: readonly string[] }> | Readonly<{
    ok: false;
    errorCode: 'DSH_EXISTING_HOME_PACKAGED_E2E_FAILED';
    failedPhase: DshExistingHomePackagedE2ePhase;
  }>;
}): void {
  const rootStat = fs.lstatSync(input.userDataPath);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('DSH existing Home packaged E2E userData is unavailable');
  }
  const root = fs.realpathSync(input.userDataPath);
  const target = path.join(root, DSH_EXISTING_HOME_PACKAGED_E2E_RESULT_NAME);
  if (path.dirname(target) !== root) {
    throw new Error('DSH existing Home packaged E2E result escaped userData');
  }
  // This format deliberately cannot contain an error message, path, bookmark,
  // provider route, token, native id, or child output.
  fs.writeFileSync(
    target,
    `${JSON.stringify({ kind: 'dsh-existing-home-packaged-e2e', ...input.result })}\n`,
    { encoding: 'utf8', mode: 0o600, flag: 'w' },
  );
  fs.chmodSync(target, 0o600);
}

/**
 * Runs a deliberately credential-free ACP initialize/close sequence.  The
 * chosen directory can contain a user-native DSH profile, but this evidence
 * never sends a prompt, copies a provider configuration, or logs its path.
 */
export async function runDshExistingHomePackagedE2e(input: {
  readonly picker: DshExistingHomePicker;
  readonly safeStorage: DshExistingHomeSafeStorage;
  readonly userDataPath: string;
  readonly resourcesPath: string;
  readonly homePath: string;
  /** Omitted only for the original all-in-one local smoke sequence. */
  readonly mode?: DshExistingHomePackagedE2eMode;
}): Promise<DshExistingHomePackagedE2eResult> {
  const mode = input.mode ?? 'full';
  const store = createDshExistingHomeSettingsStore({
    userDataPath: input.userDataPath,
    safeStorage: input.safeStorage,
  });
  let selected = false;
  let paths: DshExistingHomeLaunchPaths | null = null;
  let client: DshAcpClient | null = null;
  let phase: DshExistingHomePackagedE2ePhase = 'picker';
  let result: DshExistingHomePackagedE2eResult | null = null;
  let failedPhase: DshExistingHomePackagedE2ePhase | null = null;
  try {
    if (mode === 'resume-reset') {
      phase = 'main-implicit';
      const projection = store.getProjection(E2E_ACCOUNT_ID);
      if (projection.mode !== 'existing-dsh-home' || projection.status !== 'configured') {
        throw new Error('DSH existing Home packaged E2E requires a prior protected selection');
      }
      // A configured choice came from the prior, separate process. Clear it
      // below even when launch fails so this local evidence cannot retain a
      // reusable authorization choice.
      selected = true;
    } else {
      const projection = await selectExistingDshHomeFromMain({
        accountId: E2E_ACCOUNT_ID,
        picker: input.picker,
        store,
      });
      if (projection.mode !== 'existing-dsh-home' || projection.status !== 'configured') {
        throw new Error('DSH existing Home packaged E2E requires one selected directory');
      }
      selected = true;
    }

    if (mode === 'select') {
      result = Object.freeze({
        ok: true as const,
        phases: Object.freeze(['picker', 'protected-selection'] as const),
      });
    } else {
      phase = 'main-implicit';
      const launch = resolveDshExistingHomeLaunch({
        accountId: E2E_ACCOUNT_ID,
        store,
        createImplicitBookmark: (persistentBookmark) =>
          createDshImplicitBookmarkHandoff({
            persistentBookmark,
            bridge: loadMacosDshMainBookmarkBridge({ resourcesPath: input.resourcesPath }),
          }),
      });
      if (launch.homeMode !== 'existing-dsh-home' || !launch.implicitHomeBookmark) {
        throw new Error('DSH existing Home packaged E2E did not create an implicit bookmark');
      }

      phase = 'helper-acp';
      const layout = resolveMacosSupervisedDshRuntime({
        resourcesPath: input.resourcesPath,
        homePath: input.homePath,
      });
      const scope = {
        accountId: E2E_ACCOUNT_ID,
        releaseId: layout.runtime.releaseId,
        homeMode: 'existing-dsh-home' as const,
      };
      paths = createDshExistingHomeLaunchPaths({
        ...scope,
        userDataPath: layout.helperContainerDataPath,
        tempPath: layout.helperTempRoot,
      });
      const env = buildDshChildEnvironment({ paths });
      if (env.DSH_HOME !== undefined) {
        throw new Error('DSH existing Home packaged E2E child environment exposed DSH_HOME');
      }
      client = new DshAcpClient({
        logger: createConsoleLogger('dsh-existing-home-packaged-e2e'),
        createTransport: () =>
          createDshAcpStdioTransport({
            binaryPath: layout.supervisorPath,
            launcherCwd: paths!.launcherCwd,
            env,
            implicitHomeBookmark: launch.implicitHomeBookmark,
          }),
      });
      await client.initialize();
      launch.assertStillCurrent();

      const phases: readonly DshExistingHomePackagedE2ePhase[] =
        mode === 'full'
          ? ['picker', 'protected-selection', 'main-implicit', 'helper-acp', 'reset']
          : ['main-implicit', 'helper-acp', 'reset'];
      result = Object.freeze({ ok: true as const, phases: Object.freeze(phases) });
    }
  } catch {
    failedPhase = phase;
  }
  try {
    await client?.close('DSH existing Home packaged E2E completed');
  } catch {
    failedPhase ??= 'helper-acp';
  }
  try {
    if (paths) cleanupDshHostScopePaths(paths);
  } catch {
    failedPhase ??= 'helper-acp';
  }
  if (selected && mode !== 'select') {
    try {
      phase = 'reset';
      const reset = store.reset(E2E_ACCOUNT_ID);
      if (reset.mode !== 'cindy-managed' || reset.status !== 'default') {
        throw new Error('DSH existing Home packaged E2E reset did not restore managed mode');
      }
    } catch {
      failedPhase ??= 'reset';
    }
  }
  if (failedPhase) throw new DshExistingHomePackagedE2eFailure(failedPhase);
  if (!result) throw new DshExistingHomePackagedE2eFailure('picker');
  return result;
}
