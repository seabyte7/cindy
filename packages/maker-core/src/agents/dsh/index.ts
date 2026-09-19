/**
 * Minimal DSH adapter over Cindy's Main-owned bridge.
 *
 * This package deliberately owns neither process creation nor native runtime
 * configuration. Desktop Main must supply a ready, owner-scoped DshBridgePort;
 * that boundary keeps credentials, runtime ids and raw ACP traffic out of
 * maker-core. Product registration remains a separate host admission gate.
 */

import { createHash, randomUUID } from 'node:crypto';

import type { Capabilities } from '../../types/capabilities.js';
import type { AgentEvent, InteractionResolver, UsageSnapshot } from '../../types/events.js';
import type { UserMessage } from '../../types/common.js';
import {
  BaseAgent,
  TurnDispatchRejectedError,
  type AgentDeps,
  type AgentSessionHandle,
  type AgentSessionTeardownOptions,
  type SendOptions,
  type StartSessionOptions,
} from '../base-agent.js';
import type {
  DshBridgeAgentSessionRef,
  DshBridgeCommittedFollowEvent,
  DshBridgePermissionRequest,
  DshBridgePort,
  DshBridgePromptFailureCode,
  DshBridgePromptContent,
  DshBridgePromptStopReason,
} from './bridge-port.js';
import { DshBridgePromptFailure } from './bridge-port.js';
import { createAsyncQueue, type AsyncQueue } from '../shared/async-queue.js';

const CAPABILITIES: Capabilities = {
  switchModel: {
    supported: false,
    reason: 'not-implemented',
    message: 'DSH native model selection is not yet available in Cindy.',
  },
  availableModels: [],
  hasFastMode: false,
  effort: {
    supported: false,
    reason: 'not-implemented',
    message: 'DSH native reasoning controls are not yet available in Cindy.',
  },
  effortLevels: [],
  reasoningDisplay: [],
  permissionModes: [],
  setPermissionModeMidSession: {
    supported: false,
    reason: 'not-implemented',
    message: 'DSH permission decisions are Main-owned and request-scoped.',
  },
  multimodal: {
    text: { supported: true },
    // Main stages every local reference and adds an inline ACP image only
    // when this runtime handshake advertises it. A file reference remains
    // useful to DSH even where the current model has no vision support.
    image: { supported: true },
    file: { supported: true },
  },
  fork: {
    supported: false,
    reason: 'not-implemented',
    message: 'DSH history fork is unavailable until recovery is evidenced.',
  },
  rewind: {
    supported: false,
    reason: 'not-implemented',
    message: 'DSH history rewind is unavailable until recovery is evidenced.',
  },
  abort: { supported: true },
  sameTurnSteer: {
    supported: false,
    reason: 'not-implemented',
    message: 'DSH same-turn steering is not yet available in Cindy.',
  },
  memory: {
    supported: {
      supported: false,
      reason: 'not-implemented',
      message: 'DSH memory controls are not yet available in Cindy.',
    },
  },
  extraDirs: {
    supported: false,
    reason: 'not-implemented',
    message: 'DSH extra directory access is not yet available in Cindy.',
  },
  writableDirs: {
    supported: false,
    reason: 'not-implemented',
    message: 'DSH writable directory access is not yet available in Cindy.',
  },
};

export interface DshAgentOptions {
  /**
   * Main owns runtime startup, authorization, durable receipt persistence and
   * teardown. The adapter is deliberately restricted to this versioned port.
   */
  bridge: DshBridgePort;
  /** Opaque Main-owned bridge scope; it is never inferred from a runtime id. */
  scopeId: string;
  /**
   * Main may construct this adapter only after it has proven that follow
   * delivery is committed and that prompt dispatch has the no-replay ledger.
   * This is deliberately an explicit host admission assertion rather than an
   * inferred capability of the generic bridge port.
   */
  admission: {
    committedFollowProjection: true;
    promptReceiptLedger: true;
  };
  /**
   * Main owns the supervised bridge process. The adapter calls this only once
   * every bridge session it handed to Maker has completed its native close.
   */
  onDispose?: () => Promise<void>;
  /**
   * Main revalidates the owner-scoped provider snapshot before a native create
   * or prompt. A changed/deleted route or API key must fail closed; the
   * existing supervised child remains usable only long enough to close an
   * already-created native session.
   */
  assertCurrentConfiguration?: () => void | Promise<void>;
}

function assertSessionReceipt(
  value: unknown,
  cindySessionId: string,
  scopeId: string,
  operation: 'create' | 'resume',
): DshBridgeAgentSessionRef {
  if (
    !value ||
    typeof value !== 'object' ||
    (value as { contractVersion?: unknown }).contractVersion !== 1 ||
  (value as { operation?: unknown }).operation !== operation ||
  (value as { cindySessionId?: unknown }).cindySessionId !== cindySessionId ||
    (value as { scopeId?: unknown }).scopeId !== scopeId ||
    typeof (value as { bridgeSessionKey?: unknown }).bridgeSessionKey !== 'string' ||
    !(value as { bridgeSessionKey: string }).bridgeSessionKey.trim() ||
    (value as { bridgeSessionKey: string }).bridgeSessionKey.trim() !==
      (value as { bridgeSessionKey: string }).bridgeSessionKey ||
    (value as { bridgeSessionKey: string }).bridgeSessionKey.length > 256 ||
    /[\u0000-\u001f\u007f]/.test((value as { bridgeSessionKey: string }).bridgeSessionKey)
  ) {
    throw new Error(`DSH bridge returned an invalid ${operation} receipt`);
  }
  return {
    cindySessionId,
    scopeId,
    bridgeSessionKey: (value as { bridgeSessionKey: string }).bridgeSessionKey,
  };
}

function assertPromptReceipt(value: unknown): DshBridgePromptStopReason {
  if (
    !value ||
    typeof value !== 'object' ||
    (value as { contractVersion?: unknown }).contractVersion !== 1 ||
    (value as { operation?: unknown }).operation !== 'prompt'
  ) {
    throw new Error('DSH bridge returned an invalid prompt receipt');
  }
  const stopReason = (value as { stopReason?: unknown }).stopReason;
  if (stopReason !== 'end_turn' && stopReason !== 'cancelled') {
    throw new Error('DSH bridge returned an unknown prompt stop reason');
  }
  return stopReason;
}

function promptFailureCode(error: unknown): DshBridgePromptFailureCode {
  return error instanceof DshBridgePromptFailure ? error.code : 'prompt-failed';
}

function promptFailureErrorName(error: unknown): string {
  if (error instanceof DshBridgePromptFailure) return 'DshBridgePromptFailure';
  return error instanceof Error ? 'Error' : typeof error;
}

function promptFailureMessage(code: DshBridgePromptFailureCode): string {
  if (code === 'image-input-unavailable') {
    return 'DSH image input is unavailable in the active runtime; update and restart DSH.';
  }
  return 'DSH prompt did not complete; reconcile the session before retrying.';
}

function isOwnedCommittedFollowEvent(value: unknown, reference: DshBridgeAgentSessionRef): boolean {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<DshBridgeCommittedFollowEvent>;
  return (
    event.contractVersion === 1 &&
    event.cindySessionId === reference.cindySessionId &&
    event.scopeId === reference.scopeId &&
    event.bridgeSessionKey === reference.bridgeSessionKey &&
    Number.isSafeInteger(event.sequence) &&
    event.sequence! > 0 &&
    Array.isArray(event.events) &&
    event.events.every((item) =>
      Boolean(
        item &&
        typeof item === 'object' &&
        item.source === 'dsh' &&
        item.agentMeta &&
        typeof item.agentMeta === 'object' &&
        (item.agentMeta as { dsh?: { projectionSequence?: unknown } }).dsh?.projectionSequence === event.sequence,
      ),
    )
  );
}

/**
 * AgentSessionHandle.id is persisted by generic Maker storage. Before DSH
 * recovery is evidenced it must never be the native runtime session id. A
 * later resume can only present this exact task-scoped opaque value back to
 * the adapter; Main still resolves the native identity from its binding.
 */
function opaqueHandleId(cindySessionId: string): string {
  return `dsh:${createHash('sha256').update(cindySessionId).digest('base64url').slice(0, 32)}`;
}

async function resolveDshPermission(
  resolver: InteractionResolver | null,
  request: Readonly<DshBridgePermissionRequest>,
): Promise<'allow-once' | 'reject-once'> {
  if (!resolver) return 'reject-once';
  try {
    const decision = await resolver({
      kind: 'permission',
      // This is a Cindy-owned interaction correlation. It is deliberately
      // unrelated to the Main-private ACP request id.
      requestId: `dsh:permission:${randomUUID()}`,
      toolUseId: request.toolUseId,
      toolName: request.toolName,
      input: { ...request.input },
      metadata: { dsh: { approvalScope: 'once', toolKind: request.kind } },
    });
    // Do not accept vendor-specific input rewrites or permission updates.
    // DSH's ACP contract exposes only this individual request.
    return decision.kind === 'permission' && decision.behavior === 'allow'
      ? 'allow-once'
      : 'reject-once';
  } catch {
    return 'reject-once';
  }
}

function contentFromUserMessage(message: UserMessage): readonly DshBridgePromptContent[] {
  if (typeof message.content === 'string') return [{ type: 'text', text: message.content }];
  const content: DshBridgePromptContent[] = [];
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        content.push({ type: 'text', text: block.text });
        break;
      case 'image':
        content.push({ type: 'image', path: block.path, mimeType: block.mimeType });
        break;
      case 'file':
        content.push({ type: 'file', path: block.path, mimeType: block.mimeType });
        break;
      case 'mention':
        content.push({
          type: 'mention',
          name: block.name,
          path: block.path,
          kind: block.kind,
        });
        break;
    }
  }
  return content;
}

function usageSnapshotFromStatus(data: unknown): UsageSnapshot | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const value = data as Record<string, unknown>;
  if (!(
    typeof value.tokenUsage === 'number' && Number.isFinite(value.tokenUsage) && value.tokenUsage >= 0 &&
    typeof value.contextTokens === 'number' && Number.isSafeInteger(value.contextTokens) && value.contextTokens >= 0 &&
    typeof value.contextWindow === 'number' && Number.isSafeInteger(value.contextWindow) && value.contextWindow >= 0 &&
    typeof value.costUsd === 'number' && Number.isFinite(value.costUsd) && value.costUsd >= 0
  )) return null;
  // Keep lifecycle fields out of the cached usage snapshot. DSH usage updates
  // are status events, but their `Running` marker must never overwrite the
  // adapter-owned terminal `Done` status when the snapshot is spread later.
  return {
    tokenUsage: value.tokenUsage,
    contextTokens: value.contextTokens,
    contextWindow: value.contextWindow,
    costUsd: value.costUsd,
  };
}

/**
 * DSH's Main-gated adapter. A host may instantiate it only after its own
 * runtime admission succeeds; exporting this class still does not make DSH
 * selectable in the Desktop UI.
 */
export class DshAgent extends BaseAgent {
  readonly kind = 'dsh' as const;
  readonly capabilities: Capabilities;
  private readonly activeSessionTokens = new Set<object>();
  private disposalRequested = false;
  private disposalStarted = false;
  private disposalPromise: Promise<void> | null = null;
  private resolveDisposal: (() => void) | null = null;
  private rejectDisposal: ((reason?: unknown) => void) | null = null;

  constructor(
    deps: AgentDeps,
    private readonly options: DshAgentOptions,
  ) {
    super(deps);
    this.capabilities = this.buildCapabilities(CAPABILITIES);
  }

  /**
   * Maker shuts agents down concurrently with session handles. Keep the
   * supervised bridge alive until every handle has received its native close
   * receipt; otherwise an account switch or quit could turn a confirmed close
   * into an ambiguous, unrecoverable DSH session.
   */
  override dispose(): Promise<void> {
    this.disposalRequested = true;
    if (!this.disposalPromise) {
      this.disposalPromise = new Promise<void>((resolve, reject) => {
        this.resolveDisposal = resolve;
        this.rejectDisposal = reject;
      });
      this.finishDisposalIfIdle();
    }
    return this.disposalPromise;
  }

  private releaseSessionToken(token: object): void {
    this.activeSessionTokens.delete(token);
    this.finishDisposalIfIdle();
  }

  private finishDisposalIfIdle(): void {
    if (
      !this.disposalRequested ||
      this.disposalStarted ||
      this.activeSessionTokens.size !== 0 ||
      !this.disposalPromise
    ) {
      return;
    }
    this.disposalStarted = true;
    void Promise.resolve(this.options.onDispose?.()).then(
      () => this.resolveDisposal?.(),
      (error: unknown) => this.rejectDisposal?.(error),
    );
  }

  private async assertCurrentConfiguration(): Promise<void> {
    try {
      await this.options.assertCurrentConfiguration?.();
    } catch {
      throw new Error('DSH runtime configuration changed; restart DSH before continuing.');
    }
  }

  override async startSession(opts: StartSessionOptions): Promise<AgentSessionHandle> {
    const agent = this;
    const bridge = this.options.bridge;
    const scopeId = this.options.scopeId;
    const logger = this.deps.logger;
    if (this.disposalRequested) throw new Error('DSH agent is shutting down');
    await this.assertCurrentConfiguration();
    if (!scopeId.trim()) throw new Error('DSH agent bridge scope is required');
    if (
      this.options.admission?.committedFollowProjection !== true ||
      this.options.admission.promptReceiptLedger !== true
    ) {
      throw new Error('DSH agent requires committed follow projection and a prompt receipt ledger');
    }
    if (opts.remoteHostId) {
      throw new Error('DSH remote sessions are not available in this Cindy release');
    }
    if (!opts.sessionId?.trim()) {
      throw new Error('DSH requires a Cindy-owned session id before bridge creation');
    }
    const isResume = opts.resumeSessionId !== undefined;
    if (isResume && opts.resumeSessionId !== opaqueHandleId(opts.sessionId)) {
      throw new Error('DSH resume requires this Cindy task\'s verified opaque handle');
    }

    // Retain the lifecycle lease before the first await. A concurrent
    // Maker.shutdown() must wait for a partially-created bridge session to be
    // closed or rejected before it tears down the process that owns it.
    const sessionToken = {};
    this.activeSessionTokens.add(sessionToken);

    let reference: DshBridgeAgentSessionRef;
    try {
      // Main uses this identity only to bind an internal MCP lease to this
      // in-memory Maker instance. It is absent in legacy/direct adapter tests
      // and never becomes a native DSH session id or model-visible input.
      const sessionInstance = opts.sessionInstanceId === undefined
        ? {}
        : { sessionInstanceId: opts.sessionInstanceId };
      const sessionReceipt = isResume
        ? await bridge.resumeForAdapter({
            cindySessionId: opts.sessionId,
            cwd: opts.workingDir,
            ...sessionInstance,
          })
        : await bridge.create({
            cindySessionId: opts.sessionId,
            cwd: opts.workingDir,
            ...sessionInstance,
          });
      reference = assertSessionReceipt(
        sessionReceipt,
        opts.sessionId,
        scopeId,
        isResume ? 'resume' : 'create',
      );
      try {
        await this.assertCurrentConfiguration();
      } catch (error) {
        await bridge.close(reference).catch(() => undefined);
        throw error;
      }
    } catch (error: unknown) {
      void error;
      logger.warn('DSH bridge session creation failed', {
        cindySessionId: opts.sessionId,
        reason: isResume ? 'resume-failed' : 'create-failed',
      });
      this.releaseSessionToken(sessionToken);
      throw new Error('DSH bridge session could not be created; reconcile before retrying.');
    }
    const queue = createAsyncQueue<AgentEvent>();
    let usage: UsageSnapshot = {
      tokenUsage: 0,
      contextTokens: 0,
      contextWindow: 0,
      costUsd: 0,
    };
    let closed = false;
    let promptInFlight = false;
    let promptTerminalReceived = false;
    let cancelPromise: Promise<void> | null = null;
    let promptCompletion: Promise<void> | null = null;
    let interactionResolver: InteractionResolver | null = null;

    let stopFollowing: (() => void) | null = null;
    let stopPermissionBinding: (() => void) | null = null;
    try {
      const unsubscribe = bridge.followCommitted(reference, (follow) => {
        if (!isOwnedCommittedFollowEvent(follow, reference)) {
          logger.warn('DSH bridge delivered an invalid committed event outside this adapter session', {
            cindySessionId: reference.cindySessionId,
            reason: 'committed-follow-owner-mismatch',
          });
          return;
        }
        for (const event of follow.events) {
          const nextUsage = event.type === 'status'
            ? usageSnapshotFromStatus(event.data)
            : null;
          if (nextUsage) {
            usage = nextUsage;
            // ACP usage is telemetry, not an independent turn lifecycle. A
            // delayed update may refresh the next terminal snapshot, but it
            // cannot start or revive a task outside the current prompt.
            if (!promptInFlight || promptTerminalReceived) continue;
          }
          queue.push(event);
        }
      });
      if (typeof unsubscribe !== 'function') {
        throw new Error('DSH bridge committed follow did not return an unsubscribe function');
      }
      stopFollowing = unsubscribe;
      const unbindPermission = bridge.bindPermissionResolver(reference, async (request) => {
        return await resolveDshPermission(interactionResolver, request);
      });
      if (typeof unbindPermission !== 'function') {
        throw new Error('DSH bridge permission binding did not return a cleanup function');
      }
      stopPermissionBinding = unbindPermission;
    } catch (error: unknown) {
      void error;
      logger.warn('DSH bridge committed follow initialization failed', {
        cindySessionId: reference.cindySessionId,
        reason: 'follow-init-failed',
      });
      stopPermissionBinding?.();
      stopFollowing?.();
      await bridge.close(reference).catch(() => {
        logger.warn('DSH bridge cleanup after follow initialization failure failed', {
          cindySessionId: reference.cindySessionId,
          reason: 'follow-init-cleanup-failed',
        });
      });
      this.releaseSessionToken(sessionToken);
      throw new Error('DSH bridge session could not be observed; reconcile before retrying.');
    }

    if (this.disposalRequested) {
      stopFollowing?.();
      stopPermissionBinding?.();
      await bridge.close(reference).catch(() => {
        logger.warn('DSH bridge cleanup after agent shutdown request failed', {
          cindySessionId: reference.cindySessionId,
          reason: 'shutdown-startup-cleanup-failed',
        });
      });
      this.releaseSessionToken(sessionToken);
      throw new Error('DSH agent is shutting down');
    }

    const requestCancel = async (): Promise<void> => {
      if (!promptInFlight || cancelPromise) {
        await cancelPromise;
        return;
      }
      cancelPromise = bridge.cancel(reference)
        .then(() => undefined)
        .catch((error: unknown) => {
          void error;
          logger.warn('DSH cancel request failed', {
            cindySessionId: reference.cindySessionId,
            reason: 'cancel-request-failed',
          });
        });
      await cancelPromise;
    };

    const finishPrompt = (completion: Promise<void>): void => {
      void completion.finally(() => {
        if (promptCompletion === completion) promptCompletion = null;
        promptInFlight = false;
        cancelPromise = null;
      });
    };

    const handle: AgentSessionHandle = {
      id: opaqueHandleId(reference.cindySessionId),
      agentKind: 'dsh',
      model: opts.model,
      async send(message: UserMessage, sendOpts?: SendOptions): Promise<void> {
        if (closed) throw new Error('DSH session is closed');
        if (promptInFlight) throw new Error('DSH session already has a prompt in flight');
        await agent.assertCurrentConfiguration();
        if (sendOpts?.signal?.aborted) {
          throw new TurnDispatchRejectedError('DSH prompt was cancelled before dispatch');
        }
        const content = contentFromUserMessage(message);
        if (!content.length || !content.some((block) => block.type !== 'text' || block.text.trim())) {
          throw new TurnDispatchRejectedError('DSH requires text or a local attachment');
        }
        promptInFlight = true;
        promptTerminalReceived = false;
        queue.push({
          type: 'status',
          data: { status: 'Running', ...usage, isRunning: true },
          source: 'dsh',
        });

        const completion = bridge.prompt({ ...reference, content })
          .then((receipt) => {
            const stopReason = assertPromptReceipt(receipt);
            promptTerminalReceived = true;
            queue.push({
              type: 'done',
              data: { stopReason },
              source: 'dsh',
              agentMeta: { dsh: { stopReason } },
            });
            queue.push({
              type: 'status',
              data: { status: 'Done', ...usage, isRunning: false },
              source: 'dsh',
            });
          })
          .catch((error: unknown) => {
            const failureCode = promptFailureCode(error);
            promptTerminalReceived = true;
            logger.warn('DSH prompt did not reach a terminal receipt', {
              cindySessionId: reference.cindySessionId,
              reason: 'terminal-receipt-unavailable',
              failureCode,
              errorName: promptFailureErrorName(error),
            });
            queue.push({
              type: 'error',
              data: {
                message: promptFailureMessage(failureCode),
                isTerminal: true,
                reason: failureCode === 'image-input-unavailable'
                  ? 'dsh-prompt-rejected'
                  : 'dsh-prompt-unconfirmed',
                code: failureCode,
              },
              source: 'dsh',
            });
          })
          .finally(() => {
            if (cancelFromSignal) sendOpts?.signal?.removeEventListener('abort', cancelFromSignal);
          });
        let cancelFromSignal: (() => void) | undefined;
        if (sendOpts?.signal) {
          cancelFromSignal = () => { void requestCancel(); };
          sendOpts.signal.addEventListener('abort', cancelFromSignal, { once: true });
          if (sendOpts.signal.aborted) cancelFromSignal();
        }
        promptCompletion = completion;
        finishPrompt(completion);
      },
      async steer(): Promise<void> {
        return agent.throwNotSupported('sameTurnSteer', 'not-implemented');
      },
      async abort(): Promise<void> {
        await requestCancel();
      },
      async close(_teardown?: AgentSessionTeardownOptions): Promise<void> {
        if (closed) return;
        closed = true;
        stopFollowing?.();
        stopPermissionBinding?.();
        try {
          await requestCancel();
          await promptCompletion;
          try {
            await bridge.close(reference);
          } catch (error: unknown) {
            void error;
            logger.warn('DSH bridge close was not confirmed', {
              cindySessionId: reference.cindySessionId,
              reason: 'close-unconfirmed',
            });
            throw new Error('DSH session close could not be confirmed; reconcile before retrying.');
          }
        } finally {
          queue.end();
          agent.releaseSessionToken(sessionToken);
        }
      },
      events(): AsyncIterable<AgentEvent> {
        return queue;
      },
      getUsageSnapshot(): UsageSnapshot {
        return { ...usage };
      },
      setInteractionResolver(resolver: InteractionResolver): void {
        // Session installs this Main-owned resolver. It is converted only to
        // a one-shot outcome by the narrow bridge port; renderer callbacks,
        // ACP ids and persistent permission updates never cross this boundary.
        interactionResolver = resolver;
      },
    };
    return handle;
  }
}
