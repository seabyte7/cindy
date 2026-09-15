/**
 * Per-task DSH bridge router.
 *
 * A sandbox grant is attached to a Helper process at launch. Sharing one ACP
 * process across tasks would turn the process into the union of every task's
 * workspace authority, so the product-facing DSH adapter receives this router
 * rather than a singleton DshControlPlane. Each task gets one supervised
 * process and one task-scoped managed Home; maker-core still sees only its
 * narrow DshBridgePort contract.
 */

import { randomUUID } from 'node:crypto';

import type {
  DshBridgeAgentReceipt,
  DshBridgeAgentResumeReceipt,
  DshBridgeAgentSessionReceipt,
  DshBridgeAgentSessionRef,
  DshBridgeCommittedFollowHandler,
  DshBridgePermissionResolver,
  DshBridgePort,
  DshBridgePromptContent,
} from '@cindy/maker-core';

import { hasDshAsciiControlCharacter } from '../../shared/dshSession.js';
import type { MacosSupervisedDshBridge } from './macos-supervised-bridge.js';
import type { DshWorkspaceBookmarkHandoff } from './implicit-bookmark-handoff.js';
import type { DshWorkspaceBookmarkClaim } from './session-cwd-admission.js';
import type { DshRuntimeConfigurationSnapshot } from '../../shared/dshRuntimeConfiguration.js';
import type { DshMainConfigurationId } from '../maker-host/dsh-control-plane.js';

export const DSH_TASK_BRIDGE_ROUTER_SCOPE_ID = 'dsh-task-router-v1';

/** Main-generated diagnostics only; never carry a path, bookmark or upstream exception. */
export interface DshTaskStartupFailure {
  readonly cindySessionId: string;
  readonly stage: 'workspace-admission' | 'host-start' | 'native-create' | 'native-resume';
}

interface RoutedTask {
  readonly external: DshBridgeAgentSessionRef;
  readonly internal: DshBridgeAgentSessionRef;
  readonly host: MacosSupervisedDshBridge;
}

export interface DshTaskBridgeRouter extends DshBridgePort {
  readonly scopeId: typeof DSH_TASK_BRIDGE_ROUTER_SCOPE_ID;
  closeAll(reason: string): Promise<void>;
  getRuntimeConfigurationForProduct(cindySessionId: string): DshRuntimeConfigurationSnapshot;
  setRuntimeConfigurationForProduct(input: {
    cindySessionId: string;
    configId: DshMainConfigurationId;
    choiceId: string;
  }): Promise<DshRuntimeConfigurationSnapshot>;
}

function assertSessionId(value: string): void {
  if (!value.trim() || value.length > 512 || hasDshAsciiControlCharacter(value)) {
    throw new Error('DSH task router session id is invalid');
  }
}

function makeExternalReference(cindySessionId: string): DshBridgeAgentSessionRef {
  return Object.freeze({
    cindySessionId,
    scopeId: DSH_TASK_BRIDGE_ROUTER_SCOPE_ID,
    bridgeSessionKey: `dsh-task-${randomUUID()}`,
  });
}

function externalReceipt<Operation extends 'create' | 'resume' | 'cancel' | 'close'>(
  receipt: DshBridgeAgentReceipt<Operation>,
  external: DshBridgeAgentSessionRef,
): DshBridgeAgentReceipt<Operation> {
  return Object.freeze({
    ...receipt,
    cindySessionId: external.cindySessionId,
    scopeId: external.scopeId,
    bridgeSessionKey: external.bridgeSessionKey,
  });
}

/**
 * The factory must obtain a freshly Main-authorized handoff before starting a
 * Helper. It receives no raw workspace path, provider credential, or Renderer
 * data; the calling Main composition has already checked the exact task pair.
 */
export function createDshTaskBridgeRouter(input: {
  claimWorkspaceBookmark(claim: DshWorkspaceBookmarkClaim): DshWorkspaceBookmarkHandoff;
  onStartupFailure?(failure: DshTaskStartupFailure): void;
  startTaskBridge(input: {
    cindySessionId: string;
    cwd: string;
    workspaceBookmark: DshWorkspaceBookmarkHandoff;
  }): Promise<MacosSupervisedDshBridge>;
}): DshTaskBridgeRouter {
  const byExternalKey = new Map<string, RoutedTask>();
  const byCindySession = new Map<string, RoutedTask>();

  const reportFailure = (cindySessionId: string, stage: DshTaskStartupFailure['stage']): void => {
    // Observability must not change authorization or failure cleanup semantics.
    try { input.onStartupFailure?.({ cindySessionId, stage }); } catch { /* best effort */ }
  };

  const requireTask = (reference: DshBridgeAgentSessionRef): RoutedTask => {
    if (reference.scopeId !== DSH_TASK_BRIDGE_ROUTER_SCOPE_ID) {
      throw new Error('DSH task router scope is invalid');
    }
    const task = byExternalKey.get(reference.bridgeSessionKey);
    if (
      !task ||
      task.external.cindySessionId !== reference.cindySessionId ||
      task.external.scopeId !== reference.scopeId
    ) {
      throw new Error('DSH task router session authority is unavailable');
    }
    return task;
  };

  const start = async (cindySessionId: string, cwd: string): Promise<RoutedTask> => {
    assertSessionId(cindySessionId);
    if (byCindySession.has(cindySessionId)) {
      throw new Error('DSH task router already owns this Cindy session');
    }
    let workspaceBookmark: DshWorkspaceBookmarkHandoff;
    try {
      workspaceBookmark = input.claimWorkspaceBookmark({ cindySessionId, cwd });
    } catch (error) {
      reportFailure(cindySessionId, 'workspace-admission');
      throw error;
    }
    let host: MacosSupervisedDshBridge;
    try {
      host = await input.startTaskBridge({ cindySessionId, cwd, workspaceBookmark });
    } catch (error) {
      reportFailure(cindySessionId, 'host-start');
      throw error;
    }
    const external = makeExternalReference(cindySessionId);
    const task: RoutedTask = { external, internal: external, host };
    // `internal` is replaced only after the actual DshControlPlane returns a
    // Main-issued session capability below. Do not publish an external token
    // until native session creation/resume has succeeded.
    return task;
  };

  const publish = (task: RoutedTask, internal: DshBridgeAgentSessionRef): RoutedTask => {
    const published: RoutedTask = Object.freeze({ ...task, internal });
    byExternalKey.set(published.external.bridgeSessionKey, published);
    byCindySession.set(published.external.cindySessionId, published);
    return published;
  };

  const discard = async (task: RoutedTask, reason: string): Promise<void> => {
    byExternalKey.delete(task.external.bridgeSessionKey);
    byCindySession.delete(task.external.cindySessionId);
    await task.host.close(reason).catch(() => undefined);
  };

  return {
    scopeId: DSH_TASK_BRIDGE_ROUTER_SCOPE_ID,
    async create({ cindySessionId, cwd, sessionInstanceId }) {
      const task = await start(cindySessionId, cwd);
      try {
        const receipt = await task.host.bridge.create({
          cindySessionId,
          cwd,
          ...(sessionInstanceId === undefined ? {} : { sessionInstanceId }),
        });
        publish(task, receipt);
        return externalReceipt(receipt, task.external) as DshBridgeAgentSessionReceipt;
      } catch (error) {
        reportFailure(cindySessionId, 'native-create');
        await discard(task, 'DSH task bridge create failed');
        throw error;
      }
    },
    async resumeForAdapter({ cindySessionId, cwd, sessionInstanceId }) {
      const task = await start(cindySessionId, cwd);
      try {
        const receipt = await task.host.bridge.resumeForAdapter({
          cindySessionId,
          cwd,
          ...(sessionInstanceId === undefined ? {} : { sessionInstanceId }),
        });
        // Main resolves the native id from its durable binding. The router
        // receives and stores only the resulting opaque Main capability.
        publish(task, receipt);
        return externalReceipt(receipt, task.external) as DshBridgeAgentResumeReceipt;
      } catch (error) {
        reportFailure(cindySessionId, 'native-resume');
        await discard(task, 'DSH task bridge resume failed');
        throw error;
      }
    },
    followCommitted(reference, handler: DshBridgeCommittedFollowHandler) {
      const task = requireTask(reference);
      return task.host.bridge.followCommitted(task.internal, (event) => {
        handler(Object.freeze({
          ...event,
          cindySessionId: task.external.cindySessionId,
          scopeId: task.external.scopeId,
          bridgeSessionKey: task.external.bridgeSessionKey,
        }));
      });
    },
    bindPermissionResolver(reference, resolver: DshBridgePermissionResolver) {
      return requireTask(reference).host.bridge.bindPermissionResolver(
        requireTask(reference).internal,
        resolver,
      );
    },
    async prompt(inputValue: DshBridgeAgentSessionRef & { content: readonly DshBridgePromptContent[] }) {
      const task = requireTask(inputValue);
      return await task.host.bridge.prompt({ ...task.internal, content: inputValue.content });
    },
    async cancel(reference) {
      const task = requireTask(reference);
      return externalReceipt(await task.host.bridge.cancel(task.internal), task.external);
    },
    async close(reference) {
      const task = requireTask(reference);
      try {
        return externalReceipt(await task.host.bridge.close(task.internal), task.external);
      } finally {
        await discard(task, 'DSH task session closed');
      }
    },
    async closeAll(reason) {
      const tasks = [...byExternalKey.values()];
      byExternalKey.clear();
      byCindySession.clear();
      await Promise.all(tasks.map(async (task) => {
        await task.host.close(reason).catch(() => undefined);
      }));
    },
    getRuntimeConfigurationForProduct(cindySessionId) {
      const task = byCindySession.get(cindySessionId);
      return task
        ? task.host.bridge.getRuntimeConfigurationForProduct(cindySessionId)
        : Object.freeze({ controls: Object.freeze([]) });
    },
    async setRuntimeConfigurationForProduct(configuration) {
      const task = byCindySession.get(configuration.cindySessionId);
      if (!task) throw new Error('DSH task runtime configuration is unavailable');
      return await task.host.bridge.setRuntimeConfigurationForProduct(configuration);
    },
  };
}
