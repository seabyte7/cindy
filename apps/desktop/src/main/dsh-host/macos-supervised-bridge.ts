/**
 * F3 bridge composition for one packaged macOS DSH bridge.
 *
 * It deliberately builds on the F2 Helper.app admission path instead of the
 * unsupervised F0 source-runtime probe. The returned object stays Main-only:
 * neither the bridge nor its runtime identity is an IPC/preload payload. F5a
 * may dynamically register an adapter only after this composition and its
 * owner/provider revalidation succeed.
 */

import { createHash } from 'node:crypto';

import { DshAcpClient, type Logger } from '@cindy/maker-core';

import {
  DshControlPlane,
  type DshAcpCapabilitySnapshot,
  type DshDurableRuntimeIdentity,
} from '../maker-host/dsh-control-plane.js';
import { createDshPromptContentAdmission } from './prompt-content-admission.js';
import type { DshSessionBindingStore } from '../localDb/dshSessionBindings.js';
import type { DshPromptReceiptStore } from '../localDb/dshPromptReceipts.js';
import type { DshProjectionJournal } from '../localDb/dshProjectionJournal.js';
import type { DshActivitySnapshotStore } from '../localDb/dshActivitySnapshots.js';
import { createDshAcpStdioTransport } from '../maker-host/dsh-acp-stdio-transport.js';
import { createDshFollowProjectionCoordinator } from '../maker-host/dsh-follow-projection.js';
import {
  createDshSessionActivityCoordinator,
  dshActivityMutationGate,
} from '../maker-host/dsh-session-activity.js';
import {
  buildDshChildEnvironment,
  cleanupDshHostScopePaths,
  createDshExistingHomeLaunchPaths,
  createDshHostScopePaths,
  type DshChildSecret,
  type DshHostScopeInput,
  type DshLaunchScopePaths,
} from './scope.js';
import { materializeDshManagedAcpProviderPatch, type DshProviderRoute } from './provider-route.js';
import {
  resolveMacosSupervisedDshRuntime,
  type ResolveMacosSupervisedDshRuntimeOptions,
} from './macos-supervised-runtime.js';
import type { DshInternalMcpLeaseFactory } from './internal-mcp-lease.js';
import type { DshImplicitBookmarkHandoff } from './implicit-bookmark-handoff.js';
import type { DshWorkspaceBookmarkHandoff } from './implicit-bookmark-handoff.js';

export interface StartMacosSupervisedDshBridgeOptions extends ResolveMacosSupervisedDshRuntimeOptions {
  logger: Logger;
  /** Main secure-store adapter. Values live only in the supervised child env. */
  loadSecrets: (input: DshHostScopeInput) => readonly DshChildSecret[];
  /** Main-admitted provider route; omitted for credential-free ACP lifecycle only. */
  providerRoute?: DshProviderRoute;
  /** The same Main-side Cindy task/workspace authorization as every other harness. */
  assertAuthorizedCwd: (cwd: string, cindySessionId: string) => void;
  bindingStore: DshSessionBindingStore;
  /** F3 no-replay prompt ledger owned by the same Main database. */
  promptReceiptStore: DshPromptReceiptStore;
  /** F4 finite projection journal owned by the same Main database. */
  projectionJournal: DshProjectionJournal;
  /**
   * F6 Main-only lifecycle activity projection. Production supplies this from
   * the same owner-scoped DB client as the binding/receipt/journal stores.
   * Test-only bridge composition may omit it until it includes migration 0103.
   */
  activitySnapshotStore?: DshActivitySnapshotStore;
  /**
   * Optional Main-only F7 factory. No product endpoint is registered by
   * default; callers must inject a static, allowlisted endpoint factory.
   */
  internalMcpLeaseFactory?: DshInternalMcpLeaseFactory;
  /**
   * Existing-Home only.  Cindy Main creates this fresh opaque handoff from
   * the encrypted persistent bookmark immediately before the fixed Helper is
   * spawned.  It never contains a filesystem pathname.
   */
  implicitHomeBookmark?: DshImplicitBookmarkHandoff;
  /** Task-scoped authority; tool-capable sessions never borrow another task's grant. */
  workspaceBookmark?: DshWorkspaceBookmarkHandoff;
  /** Main-resolved tool path, intentionally distinct from the fixed runtime PATH. */
  toolPath?: string;
}

export interface MacosSupervisedDshBridge {
  readonly bridge: DshControlPlane;
  readonly scopeId: string;
  /** Main-only supervisor identity for BaseAgent construction; never spawned by the adapter. */
  readonly binaryPath: string;
  readonly runtimeIdentity: DshDurableRuntimeIdentity;
  /** Required verbatim when Main creates the still-unregistered DshAgent. */
  readonly adapterAdmission: Readonly<{
    committedFollowProjection: true;
    promptReceiptLedger: true;
  }>;
  /** Idempotent process/path teardown for the owning Main lifecycle. */
  close(reason?: string): Promise<void>;
}

function capabilityFingerprint(snapshot: DshAcpCapabilitySnapshot): string {
  // Canonical, non-secret proof of the limited public ACP surface actually
  // admitted for this bridge. Never hash a response object with arbitrary raw
  // fields: the schema below is deliberately closed and stable.
  const canonical = JSON.stringify({
    protocolVersion: snapshot.protocolVersion,
    agentName: snapshot.agentName,
    agentVersion: snapshot.agentVersion,
    sessionCapabilities: Object.keys(snapshot.sessionCapabilities).sort(),
    inlineImagePromptSupported: snapshot.inlineImagePromptSupported,
  });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

/**
 * Starts one F2-contained bridge and attaches F3 durable binding only after
 * the ACP handshake has supplied its exact capability fingerprint.
 */
export async function startMacosSupervisedDshBridge(
  options: StartMacosSupervisedDshBridgeOptions,
  scope: DshHostScopeInput,
): Promise<MacosSupervisedDshBridge> {
  if (scope.homeMode === 'existing-dsh-home' && !options.implicitHomeBookmark) {
    throw new Error('DSH existing Home launch requires a Main-owned implicit bookmark');
  }
  if (scope.homeMode === 'cindy-managed' && options.implicitHomeBookmark) {
    throw new Error('DSH managed Home launch must not carry an implicit bookmark');
  }
  const layout = resolveMacosSupervisedDshRuntime(options);
  if (scope.releaseId !== layout.runtime.releaseId) {
    throw new Error('DSH host scope release identity does not match the verified runtime');
  }
  const pathInput = {
    ...scope,
    userDataPath: layout.helperContainerDataPath,
    tempPath: layout.helperTempRoot,
  };
  const paths: DshLaunchScopePaths = scope.homeMode === 'cindy-managed'
    ? createDshHostScopePaths(pathInput)
    : createDshExistingHomeLaunchPaths(pathInput);
  let client: DshAcpClient | null = null;
  let closed = false;
  const close = async (reason = 'DSH supervised bridge stopped'): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      await client?.close(reason);
    } finally {
      cleanupDshHostScopePaths(paths);
    }
  };

  try {
    if (options.providerRoute && paths.homeMode === 'cindy-managed') {
      materializeDshManagedAcpProviderPatch(paths, options.providerRoute);
    }
    const env = buildDshChildEnvironment({
      paths,
      providerRoute: options.providerRoute,
      toolPath: options.toolPath,
      // Do not read a credential unless Main has admitted a route for this
      // exact contained spawn. A bare initialize cannot need a model key.
      secrets: options.providerRoute ? options.loadSecrets(scope) : [],
    });
    client = new DshAcpClient({
      logger: options.logger,
      createTransport: () =>
        createDshAcpStdioTransport({
          binaryPath: layout.supervisorPath,
          launcherCwd: paths.launcherCwd,
          env,
          implicitHomeBookmark: options.implicitHomeBookmark,
          workspaceBookmark: options.workspaceBookmark,
        }),
    });
    const bridge = new DshControlPlane({
      scopeId: paths.scopeId,
      client,
      assertAuthorizedCwd: options.assertAuthorizedCwd,
      promptContentAdmission: createDshPromptContentAdmission({ stagingRoot: paths.processHome }),
      internalMcpLeaseFactory: options.internalMcpLeaseFactory,
      projectionCoordinator: createDshFollowProjectionCoordinator(options.projectionJournal),
      sessionActivity: options.activitySnapshotStore
        ? createDshSessionActivityCoordinator(options.activitySnapshotStore, {
            mutationGate: dshActivityMutationGate,
          })
        : undefined,
    });
    await bridge.initialize();
    const snapshot = bridge.getCapabilitySnapshot();
    if (!snapshot) throw new Error('DSH bridge did not retain its ACP capability snapshot');
    const runtimeIdentity: DshDurableRuntimeIdentity = Object.freeze({
      runtimeReleaseId: layout.runtime.releaseId,
      runtimeVersion: layout.runtime.expectedVersion,
      controllerApiVersion: snapshot.protocolVersion,
      capabilityFingerprint: capabilityFingerprint(snapshot),
      homeMode: scope.homeMode,
    });
    bridge.configureDurableBinding({
      store: options.bindingStore,
      promptReceiptStore: options.promptReceiptStore,
      runtimeIdentity,
    });
    // A fresh carrier must prove every persisted binding against its own ACP
    // session/list result before any adapter can request a continuation. This
    // is deliberately rehydrate-only: it does not resume or replay a turn.
    await bridge.restoreVerifiedBindings();
    return Object.freeze({
      bridge,
      scopeId: paths.scopeId,
      binaryPath: layout.supervisorPath,
      runtimeIdentity,
      adapterAdmission: Object.freeze({
        committedFollowProjection: true,
        promptReceiptLedger: true,
      }),
      close,
    });
  } catch (error) {
    await close('DSH supervised bridge startup failed');
    throw error;
  }
}
