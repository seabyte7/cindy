/**
 * Cindy-owned DSH control plane for one Main-owned scope.
 *
 * The runtime remains authoritative for its ACP session/history. This class is authoritative only
 * for the live bridge ownership relation and operation receipts. It deliberately has no renderer
 * inputs, filesystem access, credential access, or DSH private-state access.
 */

import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

import {
  DSH_BRIDGE_CONTRACT_VERSION,
  type DshAcpSessionClient,
  type DshBridgeFollowEvent,
  type DshBridgeFollowHandler,
  type DshBridgePort,
  type DshBridgePromptReceipt,
  type DshBridgeReceipt,
  type DshBridgeSessionRef,
} from '@cindy/maker-core';

interface DshControlPlaneOptions {
  scopeId: string;
  client: DshAcpSessionClient;
  /**
   * Main-owned workdir authorization. An absolute path alone is not a grant
   * to execute DSH there; the production bridge must inject the same policy
   * that authorized the Cindy task/workspace.
   */
  assertAuthorizedCwd: (cwd: string) => void;
  now?: () => Date;
  receiptId?: () => string;
  /**
   * Bound every operation that can have reached the runtime. A timeout is an
   * ambiguous native outcome, so this control plane closes its carrier and
   * requires a fresh, durable F3 bridge to reconcile rather than retrying.
   */
  operationTimeoutMs?: number;
}

interface LiveBindingState {
  binding: DshBridgeSessionRef;
  /** An ACP session may be closed yet remain resumable in the runtime history. */
  active: boolean;
  followHandlers: Set<DshBridgeFollowHandler>;
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`DSH bridge ${label} is required`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;
/** Bound user-originated prompt allocation before it becomes an ACP JSON frame. */
export const DSH_BRIDGE_MAX_PROMPT_BYTES = 4 * 1024 * 1024;

function parseListedSessionIds(value: unknown): ReadonlySet<string> {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { sessions?: unknown }).sessions)) {
    throw new Error('DSH ACP session/list returned an invalid response');
  }
  const ids = new Set<string>();
  for (const entry of (value as { sessions: unknown[] }).sessions) {
    if (typeof entry === 'object' && entry !== null && typeof (entry as { sessionId?: unknown }).sessionId === 'string') {
      ids.add((entry as { sessionId: string }).sessionId);
    }
  }
  return ids;
}

export class DshControlPlane implements DshBridgePort {
  private readonly scopeId: string;
  private readonly client: DshAcpSessionClient;
  private readonly assertAuthorizedCwd: (cwd: string) => void;
  private readonly now: () => Date;
  private readonly newReceiptId: () => string;
  private readonly operationTimeoutMs: number;
  private readonly byCindySession = new Map<string, LiveBindingState>();
  /**
   * Native lifecycle calls mutate a binding only after an ACP reply. Keep one
   * transition in flight per Cindy session so two callers cannot both pass an
   * old state check and create/orphan or double-transition a runtime session.
   * Prompt and cancel deliberately remain independently available: cancelling
   * a running prompt is a normal ACP operation, not a lifecycle transition.
   */
  private readonly lifecycleOperations = new Map<string, 'create' | 'resume' | 'close'>();
  private initialized = false;
  private needsReconcileReason: string | null = null;
  private nextFollowSequence = 1;

  constructor(options: DshControlPlaneOptions) {
    assertNonEmpty(options.scopeId, 'scopeId');
    if (typeof options.assertAuthorizedCwd !== 'function') {
      throw new Error('DSH bridge assertAuthorizedCwd is required');
    }
    this.scopeId = options.scopeId;
    this.client = options.client;
    this.assertAuthorizedCwd = options.assertAuthorizedCwd;
    this.now = options.now ?? (() => new Date());
    this.newReceiptId = options.receiptId ?? randomUUID;
    this.operationTimeoutMs = options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.operationTimeoutMs) || this.operationTimeoutMs <= 0) {
      throw new Error('DSH bridge operationTimeoutMs must be a positive safe integer');
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.needsReconcileReason !== null) this.throwNeedsReconcile();
    let closeReason = 'DSH ACP initialization failed';
    try {
      this.client.onNotification('session/update', (params) => this.handleSessionUpdate(params));
      // F0 proves the real ACP permission round trip without adding an
      // interaction surface. Until F4 owns a correlated Main-side resolver,
      // every runtime request is cancelled. This must be registered before
      // transport start so a fast runtime cannot observe an unhandled request
      // and turn an unavailable UI into an accidental grant.
      this.client.onServerRequest('session/request_permission', async () => ({ outcome: { outcome: 'cancelled' } }));
      this.client.onTransportClose((reason) => {
        // A prompt may already have reached the runtime when EOF/exit wins. Do
        // not retry it or incorrectly mark the native session closed. F3 will
        // persist this ambiguity and reconcile through a fresh bridge.
        this.needsReconcileReason ??= reason;
      });
      this.client.start();
      const initialized = await this.withOperationTimeout('initialize', this.client.initialize());
      if (initialized.protocolVersion !== 1) {
        closeReason = `DSH ACP protocol version ${initialized.protocolVersion} is unsupported; expected 1`;
        throw new Error(closeReason);
      }
      const sessionCapabilities = initialized.agentCapabilities.sessionCapabilities;
      for (const capability of ['close', 'list', 'resume'] as const) {
        if (!isRecord(sessionCapabilities?.[capability])) {
          closeReason = `ACP omitted required session capability: ${capability}`;
          throw new Error(`DSH ACP does not advertise session/${capability}`);
        }
      }
      this.initialized = true;
    } catch (error) {
      // No request has a usable receipt until initialization succeeds. The
      // carrier cannot be reused after any negotiation or capability failure.
      this.needsReconcileReason ??= closeReason;
      await this.client.close(closeReason).catch(() => undefined);
      throw error;
    }
  }

  async create(input: { cindySessionId: string; cwd: string }): Promise<DshBridgeReceipt> {
    this.assertReady();
    assertNonEmpty(input.cindySessionId, 'cindySessionId');
    this.assertCwd(input.cwd);
    return this.withLifecycleOperation(input.cindySessionId, 'create', async () => {
      if (this.byCindySession.has(input.cindySessionId)) {
        throw new Error(`DSH bridge already owns Cindy session ${input.cindySessionId}`);
      }
      const { sessionId } = await this.withOperationTimeout(
        'create',
        this.client.createSession({ cwd: input.cwd, mcpServers: [] }),
      );
      this.assertReady();
      this.byCindySession.set(input.cindySessionId, {
        binding: {
          cindySessionId: input.cindySessionId,
          runtimeSessionId: sessionId,
          scopeId: this.scopeId,
        },
        active: true,
        followHandlers: new Set(),
      });
      return this.receipt('create', sessionId);
    });
  }

  async list(input: { scopeId: string }): Promise<readonly DshBridgeSessionRef[]> {
    this.assertReady();
    this.assertScope(input.scopeId);
    return [...this.byCindySession.values()].map(({ binding }) => binding);
  }

  async resume(input: DshBridgeSessionRef & { cwd: string }): Promise<DshBridgeReceipt> {
    this.assertReady();
    this.assertCwd(input.cwd);
    return this.withLifecycleOperation(input.cindySessionId, 'resume', async () => {
      const state = this.requireBinding(input);
      if (state.active) throw new Error('DSH bridge cannot resume an active runtime session');
      await this.withOperationTimeout(
        'resume',
        this.client.resumeSession({ sessionId: input.runtimeSessionId, cwd: input.cwd }),
      );
      this.assertReady();
      state.active = true;
      return this.receipt('resume', input.runtimeSessionId);
    });
  }

  follow(input: DshBridgeSessionRef, handler: DshBridgeFollowHandler): () => void {
    this.assertReady();
    const state = this.requireBinding(input);
    if (!state.active) throw new Error('DSH bridge cannot follow an inactive runtime session');
    state.followHandlers.add(handler);
    return () => state.followHandlers.delete(handler);
  }

  async prompt(input: DshBridgeSessionRef & { text: string }): Promise<DshBridgePromptReceipt> {
    this.assertReady();
    const state = this.requireBinding(input);
    if (!state.active) throw new Error('DSH bridge cannot prompt an inactive runtime session');
    assertNonEmpty(input.text, 'prompt text');
    if (Buffer.byteLength(input.text, 'utf8') > DSH_BRIDGE_MAX_PROMPT_BYTES) {
      throw new Error(`DSH bridge prompt text exceeds ${DSH_BRIDGE_MAX_PROMPT_BYTES} UTF-8 bytes`);
    }
    // This timestamp is when Cindy accepts ownership of the request, before the ACP response
    // settles. F3 persists this boundary before transmission so an EOF can be reconciled without
    // replaying a potentially side-effecting prompt.
    const acceptedAt = this.now().toISOString();
    const result = await this.withOperationTimeout(
      'prompt',
      this.client.prompt({
        sessionId: input.runtimeSessionId,
        prompt: [{ type: 'text', text: input.text }],
      }),
    );
    return { ...this.receipt('prompt', input.runtimeSessionId, acceptedAt), stopReason: result.stopReason };
  }

  async cancel(input: DshBridgeSessionRef): Promise<DshBridgeReceipt> {
    this.assertReady();
    const state = this.requireBinding(input);
    if (!state.active) throw new Error('DSH bridge cannot cancel an inactive runtime session');
    await this.withOperationTimeout('cancel', this.client.cancel(input.runtimeSessionId));
    return this.receipt('cancel', input.runtimeSessionId);
  }

  async close(input: DshBridgeSessionRef): Promise<DshBridgeReceipt> {
    this.assertReady();
    return this.withLifecycleOperation(input.cindySessionId, 'close', async () => {
      const state = this.requireBinding(input);
      if (!state.active) throw new Error('DSH bridge runtime session is already inactive');
      await this.withOperationTimeout('close', this.client.closeSession(input.runtimeSessionId));
      this.assertReady();
      // ACP close releases the live carrier but does not delete runtime history. Preserve the
      // Cindy binding so a later explicit resume is ownership-checked rather than becoming a new
      // unrelated session. F3 persists this lifecycle state in the append-only binding store.
      state.active = false;
      return this.receipt('close', input.runtimeSessionId);
    });
  }

  async reconcile(input: { scopeId: string }): Promise<readonly DshBridgeSessionRef[]> {
    this.assertReady();
    this.assertScope(input.scopeId);
    const listed = parseListedSessionIds(await this.withOperationTimeout('reconcile', this.client.listSessions()));
    return [...this.byCindySession.values()]
      .map(({ binding }) => binding)
      .filter((binding) => listed.has(binding.runtimeSessionId));
  }

  private receipt<Operation extends DshBridgeReceipt['operation']>(
    operation: Operation,
    runtimeSessionId: string,
    acceptedAt = this.now().toISOString(),
  ): DshBridgeReceipt & { operation: Operation } {
    return {
      contractVersion: DSH_BRIDGE_CONTRACT_VERSION,
      operation,
      receiptId: this.newReceiptId(),
      runtimeSessionId,
      acceptedAt,
    };
  }

  private assertReady(): void {
    if (!this.initialized) throw new Error('DSH bridge is not initialized');
    if (this.needsReconcileReason !== null) this.throwNeedsReconcile();
  }

  private throwNeedsReconcile(): never {
    throw new Error(`DSH bridge needs reconciliation after transport close: ${this.needsReconcileReason}`);
  }

  private async withLifecycleOperation<Result>(
    cindySessionId: string,
    operation: 'create' | 'resume' | 'close',
    run: () => Promise<Result>,
  ): Promise<Result> {
    const inFlight = this.lifecycleOperations.get(cindySessionId);
    if (inFlight) {
      throw new Error(`DSH bridge ${cindySessionId} already has a ${inFlight} lifecycle operation in flight`);
    }
    this.lifecycleOperations.set(cindySessionId, operation);
    try {
      return await run();
    } finally {
      if (this.lifecycleOperations.get(cindySessionId) === operation) {
        this.lifecycleOperations.delete(cindySessionId);
      }
    }
  }

  private withOperationTimeout<Result>(operation: string, operationPromise: Promise<Result>): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const reason = `DSH bridge ${operation} timed out after ${this.operationTimeoutMs}ms`;
        this.needsReconcileReason ??= reason;
        // A request could have reached the runtime even though its receipt did
        // not return. Tear down the privileged carrier and leave F3 to inspect
        // durable receipt/history state; do not retry or mutate the binding.
        void this.client.close(reason).catch(() => undefined);
        reject(new Error(reason));
      }, this.operationTimeoutMs);
      timer.unref?.();

      operationPromise.then(
        (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private assertScope(scopeId: string): void {
    if (scopeId !== this.scopeId) throw new Error('DSH bridge scope ownership mismatch');
  }

  private requireBinding(input: DshBridgeSessionRef): LiveBindingState {
    this.assertScope(input.scopeId);
    const current = this.byCindySession.get(input.cindySessionId);
    if (!current || current.binding.runtimeSessionId !== input.runtimeSessionId) {
      throw new Error('DSH bridge session ownership mismatch');
    }
    return current;
  }

  private assertCwd(cwd: string): void {
    if (!isAbsolute(cwd)) throw new Error('DSH bridge cwd must be absolute');
    this.assertAuthorizedCwd(cwd);
  }

  private handleSessionUpdate(params: unknown): void {
    if (typeof params !== 'object' || params === null) return;
    const record = params as { sessionId?: unknown; update?: unknown };
    if (typeof record.sessionId !== 'string' || !Object.hasOwn(record, 'update')) return;
    const state = [...this.byCindySession.values()].find((candidate) =>
      candidate.active && candidate.binding.runtimeSessionId === record.sessionId,
    );
    if (!state) return;
    const event: DshBridgeFollowEvent = {
      contractVersion: DSH_BRIDGE_CONTRACT_VERSION,
      ...state.binding,
      sequence: this.nextFollowSequence++,
      receivedAt: this.now().toISOString(),
      update: record.update,
    };
    for (const handler of state.followHandlers) {
      try {
        handler(event);
      } catch {
        // One observer cannot interrupt the owned ACP follow stream. F4 adds
        // bounded diagnostic/event handling before product projection.
      }
    }
  }
}
