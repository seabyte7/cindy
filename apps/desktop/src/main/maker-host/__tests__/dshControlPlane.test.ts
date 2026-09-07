import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  DshAcpInitializeResult,
  DshAcpNotificationHandler,
  DshAcpPromptResult,
  DshAcpServerRequestHandler,
  DshAcpSessionClient,
  DshAcpTransportCloseHandler,
} from '@cindy/maker-core';

import { DshControlPlane } from '../dsh-control-plane.js';
import type { DshInternalMcpLeaseFactory } from '../../dsh-host/internal-mcp-lease.js';
import type { DshSessionActivityCoordinator } from '../dsh-session-activity.js';
import type {
  DshFollowProjectionCoordinator,
  DshFollowProjectionResult,
} from '../dsh-follow-projection.js';
import type {
  DshCreateReceiptBinding,
  DshProjectionAdvanceResult,
  DshSessionBinding,
  DshSessionBindingStore,
} from '../../localDb/dshSessionBindings.js';
import type { DshPromptReceiptStore } from '../../localDb/dshPromptReceipts.js';

function deferred<Value>(): { promise: Promise<Value>; resolve: (value: Value) => void } {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const assertProjectCwd = (cwd: string): void => {
  if (cwd !== '/project') throw new Error(`DSH bridge cwd is not authorized: ${cwd}`);
};

class FakeDshAcpClient implements DshAcpSessionClient {
  started = 0;
  readonly calls: Array<{ method: string; value?: unknown }> = [];
  private readonly notificationHandlers = new Map<string, DshAcpNotificationHandler>();
  private readonly serverRequestHandlers = new Map<string, DshAcpServerRequestHandler>();
  private readonly transportCloseHandlers = new Set<DshAcpTransportCloseHandler>();
  capabilities: NonNullable<DshAcpInitializeResult['agentCapabilities']['sessionCapabilities']> = {
    close: {},
    list: {},
    resume: {},
  };
  protocolVersion = 1;
  agentName = 'deepseek-harness-acp';
  agentVersion = '0.0.1';
  listNeverSettles = false;
  initializeFailure: Error | undefined;
  createConfigOptions: unknown = undefined;
  resumeConfigOptions: unknown = undefined;
  setConfigOptions: unknown = undefined;
  promptGate: Promise<DshAcpPromptResult> | undefined;
  setConfigGate: Promise<{ configOptions?: unknown }> | undefined;

  start(): void {
    this.started += 1;
  }
  async initialize(): Promise<DshAcpInitializeResult> {
    if (this.initializeFailure) throw this.initializeFailure;
    return {
      protocolVersion: this.protocolVersion,
      agentInfo: { name: this.agentName, version: this.agentVersion },
      agentCapabilities: { sessionCapabilities: this.capabilities },
    };
  }
  async createSession(input: {
    cwd: string;
    mcpServers?: readonly unknown[];
  }): Promise<{ sessionId: string; configOptions?: unknown }> {
    this.calls.push({ method: 'session/new', value: input });
    return {
      sessionId: 'runtime-1',
      ...(this.createConfigOptions === undefined ? {} : { configOptions: this.createConfigOptions }),
    };
  }
  listSessions(): Promise<unknown> {
    if (this.listNeverSettles) return new Promise<never>(() => undefined);
    return Promise.resolve({ sessions: [{ sessionId: 'runtime-1' }] });
  }
  async resumeSession(input: {
    sessionId: string;
    cwd: string;
    mcpServers?: readonly unknown[];
  }): Promise<{ configOptions?: unknown }> {
    this.calls.push({ method: 'session/resume', value: input });
    return this.resumeConfigOptions === undefined ? {} : { configOptions: this.resumeConfigOptions };
  }
  async setSessionConfigOption(input: {
    sessionId: string;
    configId: 'model' | 'reasoning_effort';
    value: string;
  }): Promise<{ configOptions?: unknown }> {
    this.calls.push({ method: 'session/set_config_option', value: input });
    if (this.setConfigGate) return this.setConfigGate;
    return this.setConfigOptions === undefined ? {} : { configOptions: this.setConfigOptions };
  }
  async prompt(input: {
    sessionId: string;
    prompt: readonly unknown[];
  }): Promise<DshAcpPromptResult> {
    this.calls.push({ method: 'session/prompt', value: input });
    if (this.promptGate) return this.promptGate;
    return { stopReason: 'end_turn' };
  }
  async cancel(sessionId: string): Promise<void> {
    this.calls.push({ method: 'session/cancel', value: sessionId });
  }
  async closeSession(sessionId: string): Promise<unknown> {
    this.calls.push({ method: 'session/close', value: sessionId });
    return {};
  }
  onNotification(method: string, handler: DshAcpNotificationHandler): void {
    this.notificationHandlers.set(method, handler);
  }
  onServerRequest(method: string, handler: DshAcpServerRequestHandler): void {
    this.serverRequestHandlers.set(method, handler);
  }
  onTransportClose(handler: DshAcpTransportCloseHandler): () => void {
    this.transportCloseHandlers.add(handler);
    return () => this.transportCloseHandlers.delete(handler);
  }
  async close(reason?: string): Promise<void> {
    this.calls.push({ method: 'transport/close', value: reason });
  }
  emitNotification(method: string, params: unknown): void {
    void this.notificationHandlers.get(method)?.(params);
  }
  requestFromRuntime(method: string, params: unknown): Promise<unknown> {
    const handler = this.serverRequestHandlers.get(method);
    if (!handler) return Promise.reject(new Error(`no handler for ${method}`));
    return handler(params, { id: 'runtime-request-1', method });
  }
  emitTransportClose(reason: string): void {
    for (const handler of this.transportCloseHandlers) handler(reason);
  }
}

class MemoryDshBindingStore implements DshSessionBindingStore {
  readonly rows = new Map<string, DshSessionBinding>();
  failCreate = false;

  async recordCreateReceipt(input: DshCreateReceiptBinding): Promise<DshSessionBinding> {
    if (this.failCreate) throw new Error('fixture durable database is unavailable');
    if (
      this.rows.has(input.cindySessionId) ||
      [...this.rows.values()].some(
        (row) =>
          row.hostScopeId === input.hostScopeId && row.runtimeSessionId === input.runtimeSessionId,
      )
    ) {
      throw new Error('fixture unique constraint');
    }
    const row: DshSessionBinding = {
      ...input,
      lifecycleState: 'active',
      lastProjectedSequence: 0,
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    this.rows.set(row.cindySessionId, row);
    return row;
  }

  async getByCindySessionId(cindySessionId: string): Promise<DshSessionBinding | null> {
    return this.rows.get(cindySessionId) ?? null;
  }

  async listByScopeId(hostScopeId: string): Promise<readonly DshSessionBinding[]> {
    return [...this.rows.values()].filter((row) => row.hostScopeId === hostScopeId);
  }

  async markClosed(input: {
    cindySessionId: string;
    expectedRevision: number;
  }): Promise<DshSessionBinding | null> {
    return this.transition(input, ['active'], 'closed');
  }

  async markClosedAfterVerifiedRuntimeHistory(input: {
    cindySessionId: string;
    expectedRevision: number;
  }): Promise<DshSessionBinding | null> {
    return this.transition(input, ['active'], 'closed');
  }

  async markActiveAfterVerifiedRuntimeState(input: {
    cindySessionId: string;
    expectedRevision: number;
  }): Promise<DshSessionBinding | null> {
    return this.transition(input, ['closed', 'needs_reconcile'], 'active');
  }

  async markNeedsReconcile(input: {
    cindySessionId: string;
    expectedRevision: number;
  }): Promise<DshSessionBinding | null> {
    return this.transition(input, ['active', 'closed', 'needs_reconcile'], 'needs_reconcile');
  }

  async advanceProjectionCursor(input: {
    cindySessionId: string;
    expectedRevision: number;
    nextSequence: number;
  }): Promise<DshProjectionAdvanceResult> {
    const row = this.rows.get(input.cindySessionId) ?? null;
    if (!row || row.revision !== input.expectedRevision) return { kind: 'conflict', binding: row };
    if (row.lifecycleState !== 'active') return { kind: 'inactive', binding: row };
    if (input.nextSequence <= row.lastProjectedSequence) return { kind: 'duplicate', binding: row };
    if (input.nextSequence !== row.lastProjectedSequence + 1) {
      const binding = await this.markNeedsReconcile(input);
      return binding
        ? { kind: 'gap', binding }
        : { kind: 'conflict', binding: this.rows.get(input.cindySessionId) ?? null };
    }
    const binding = {
      ...row,
      lastProjectedSequence: input.nextSequence,
      revision: row.revision + 1,
    };
    this.rows.set(binding.cindySessionId, binding);
    return { kind: 'advanced', binding };
  }

  private transition(
    input: { cindySessionId: string; expectedRevision: number },
    expectedStates: readonly DshSessionBinding['lifecycleState'][],
    lifecycleState: DshSessionBinding['lifecycleState'],
  ): DshSessionBinding | null {
    const current = this.rows.get(input.cindySessionId);
    if (
      !current ||
      current.revision !== input.expectedRevision ||
      !expectedStates.includes(current.lifecycleState)
    ) {
      return null;
    }
    const updated = {
      ...current,
      lifecycleState,
      revision: current.revision + 1,
      updatedAt: current.updatedAt + 1,
    };
    this.rows.set(updated.cindySessionId, updated);
    return updated;
  }
}

function durableOptions(store: DshSessionBindingStore, promptReceiptStore?: DshPromptReceiptStore) {
  return {
    store,
    runtimeIdentity: {
      runtimeReleaseId: 'cindy-dsh-0.1.2-alpha.3-build.3-macos-supervised',
      runtimeVersion: '0.1.2-alpha.3',
      controllerApiVersion: 1,
      capabilityFingerprint: 'sha256:dsh-capability-fixture',
      homeMode: 'cindy-managed' as const,
    },
    promptReceiptStore,
  };
}

async function initializeWithDurableBinding(
  bridge: DshControlPlane,
  store: DshSessionBindingStore,
  promptReceiptStore?: DshPromptReceiptStore,
): Promise<void> {
  await bridge.initialize();
  bridge.configureDurableBinding(durableOptions(store, promptReceiptStore));
}

function fakePromptReceiptStore(unresolved = false): DshPromptReceiptStore & {
  recordPending: ReturnType<typeof vi.fn>;
  acknowledge: ReturnType<typeof vi.fn>;
  markUncertain: ReturnType<typeof vi.fn>;
  hasUnresolved: ReturnType<typeof vi.fn>;
} {
  return {
    recordPending: vi.fn().mockImplementation(async ({ receiptId, cindySessionId }) => ({
      receiptId,
      cindySessionId,
      state: 'pending',
      stopReason: null,
      createdAt: 1,
      resolvedAt: null,
    })),
    acknowledge: vi.fn().mockImplementation(async ({ receiptId, cindySessionId, stopReason }) => ({
      receiptId,
      cindySessionId,
      state: 'acknowledged',
      stopReason,
      createdAt: 1,
      resolvedAt: 2,
    })),
    markUncertain: vi.fn().mockResolvedValue(undefined),
    hasUnresolved: vi.fn().mockResolvedValue(unresolved),
  } as DshPromptReceiptStore & {
    recordPending: ReturnType<typeof vi.fn>;
    acknowledge: ReturnType<typeof vi.fn>;
    markUncertain: ReturnType<typeof vi.fn>;
    hasUnresolved: ReturnType<typeof vi.fn>;
  };
}

function fakeSessionActivityCoordinator(): DshSessionActivityCoordinator & {
  created: ReturnType<typeof vi.fn>;
  resumed: ReturnType<typeof vi.fn>;
  closed: ReturnType<typeof vi.fn>;
  restored: ReturnType<typeof vi.fn>;
  disconnected: ReturnType<typeof vi.fn>;
  revokeMutations: ReturnType<typeof vi.fn>;
} {
  return {
    created: vi.fn(async () => undefined),
    resumed: vi.fn(async () => undefined),
    closed: vi.fn(async () => undefined),
    restored: vi.fn(async () => undefined),
    disconnected: vi.fn(async () => undefined),
    revokeMutations: vi.fn(),
  };
}

function fakeInternalMcpLeaseFactory(): DshInternalMcpLeaseFactory & {
  acquire: ReturnType<typeof vi.fn>;
  revokeAll: ReturnType<typeof vi.fn>;
  releases: ReturnType<typeof vi.fn>;
} {
  const releases = vi.fn(async () => undefined);
  const acquire = vi.fn(async (input: {
    scopeId: string;
    cindySessionId: string;
    sessionInstanceId: string;
  }) => Object.freeze({
    mcpServers: Object.freeze([Object.freeze({
      name: 'cindy_dsh_fixture',
      type: 'http' as const,
      url: `http://127.0.0.1:43123/dsh-mcp/${input.sessionInstanceId}`,
      headers: Object.freeze([Object.freeze({
        name: 'authorization',
        value: `Bearer test-${input.sessionInstanceId}`,
      })]),
    })]),
    release: releases,
  }));
  return {
    acquire,
    revokeAll: vi.fn(async () => undefined),
    releases,
  };
}

describe('DshControlPlane', () => {
  afterEach(() => vi.useRealTimers());

  it('binds cwd authorization to the exact Cindy session before native creation', async () => {
    const client = new FakeDshAcpClient();
    const assertAuthorizedCwd = vi.fn();
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd,
    });
    await bridge.initialize();

    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });

    expect(assertAuthorizedCwd).toHaveBeenCalledWith('/project', 'cindy-1');
  });

  it('owns the complete public ACP lifecycle and emits Cindy receipts', async () => {
    const client = new FakeDshAcpClient();
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
      now: () => new Date('2026-09-02T00:00:00.000Z'),
      receiptId: () => 'receipt-1',
    });
    await bridge.initialize();
    const created = await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    const binding = (await bridge.list({ scopeId: 'scope-a' }))[0]!;
    const firstClosed = await bridge.close(binding);
    const resumed = await bridge.resume({ ...binding, cwd: '/project' });
    const prompted = await bridge.prompt({ ...binding, text: 'hello' });
    const cancelled = await bridge.cancel(binding);
    await expect(bridge.reconcile({ scopeId: 'scope-a' })).resolves.toEqual([binding]);
    const closed = await bridge.close(binding);

    expect(client.started).toBe(1);
    expect([created, firstClosed, resumed, prompted, cancelled, closed]).toEqual([
      expect.objectContaining({
        operation: 'create',
        receiptId: 'receipt-1',
        cindySessionId: 'cindy-1',
        scopeId: 'scope-a',
        bridgeSessionKey: expect.any(String),
      }),
      expect.objectContaining({ operation: 'close' }),
      expect.objectContaining({ operation: 'resume' }),
      expect.objectContaining({ operation: 'prompt', stopReason: 'end_turn' }),
      expect.objectContaining({ operation: 'cancel' }),
      expect.objectContaining({ operation: 'close' }),
    ]);
    for (const adapterReceipt of [created, firstClosed, prompted, cancelled, closed]) {
      expect(JSON.stringify(adapterReceipt)).not.toContain('runtime-1');
    }
    expect(client.calls).toEqual(
      expect.arrayContaining([
        { method: 'session/new', value: { cwd: '/project', mcpServers: [] } },
        { method: 'session/close', value: 'runtime-1' },
        { method: 'session/resume', value: { sessionId: 'runtime-1', cwd: '/project' } },
        {
          method: 'session/prompt',
          value: { sessionId: 'runtime-1', prompt: [{ type: 'text', text: 'hello' }] },
        },
        { method: 'session/cancel', value: 'runtime-1' },
        { method: 'session/close', value: 'runtime-1' },
      ]),
    );
  });

  it('keeps ACP model and reasoning selections Main-only and accepts only the live option allowlist', async () => {
    const client = new FakeDshAcpClient();
    client.createConfigOptions = [
      {
        id: 'model',
        type: 'select',
        currentValue: '["fixture","model-a"]',
        options: [{
          group: 'fixture',
          name: 'Fixture',
          options: [
            { value: '["fixture","model-a"]', name: 'Model A' },
            { value: '["fixture","model-b"]', name: 'Model B' },
          ],
        }],
      },
      {
        id: 'reasoning_effort',
        type: 'select',
        currentValue: 'low',
        options: [
          { value: '', name: 'Provider default' },
          { value: 'low', name: 'Low' },
          { value: 'high', name: 'High' },
        ],
      },
      // Cindy must not accidentally turn an unrelated ACP control into a
      // product setting while the projection schema remains intentionally small.
      { id: 'unrelated', type: 'select', currentValue: 'on', options: [{ value: 'on' }] },
    ];
    client.setConfigOptions = [
      {
        id: 'model',
        type: 'select',
        currentValue: '["fixture","model-b"]',
        options: [{
          group: 'fixture',
          name: 'Fixture',
          options: [{ value: '["fixture","model-b"]', name: 'Model B' }],
        }],
      },
      {
        id: 'reasoning_effort',
        type: 'select',
        currentValue: '',
        options: [{ value: '', name: 'Provider default' }],
      },
    ];
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await bridge.initialize();
    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    const [binding] = await bridge.list({ scopeId: 'scope-a' });

    expect(bridge.getConfigurationOptionsForMain(binding!)).toEqual([
      {
        id: 'model',
        currentValue: '["fixture","model-a"]',
        allowedValues: ['["fixture","model-a"]', '["fixture","model-b"]'],
      },
      {
        id: 'reasoning_effort',
        currentValue: 'low',
        allowedValues: ['', 'low', 'high'],
      },
    ]);
    const initialProductSnapshot = bridge.getRuntimeConfigurationForProduct('cindy-1');
    const initialModel = initialProductSnapshot.controls.find((control) => control.id === 'model');
    const initialReasoning = initialProductSnapshot.controls.find(
      (control) => control.id === 'reasoning_effort',
    );
    expect(initialModel).toMatchObject({
      id: 'model',
      choices: [
        { label: 'Model A' },
        { label: 'Model B' },
      ],
    });
    expect(initialReasoning).toMatchObject({
      id: 'reasoning_effort',
      choices: [
        { label: 'Provider default' },
        { label: 'Low' },
        { label: 'High' },
      ],
    });
    const productJson = JSON.stringify(initialProductSnapshot);
    expect(productJson).not.toContain('runtime-1');
    expect(productJson).not.toContain('scope-a');
    expect(productJson).not.toContain('["fixture","model-a"]');
    expect(productJson).not.toContain('["fixture","model-b"]');
    const modelBChoice = initialModel?.choices.find((choice) => choice.label === 'Model B');
    expect(modelBChoice).toBeDefined();
    await expect(
      bridge.setRuntimeConfigurationForProduct({
        cindySessionId: 'cindy-1',
        configId: 'model',
        choiceId: 'not-a-main-issued-capability',
      }),
    ).rejects.toThrow('choice is unavailable');
    await expect(
      bridge.setRuntimeConfigurationForProduct({
        cindySessionId: 'cindy-1',
        configId: 'model',
        choiceId: modelBChoice!.id,
      }),
    ).resolves.toMatchObject({
      controls: [
        {
          id: 'model',
          choices: [{ label: 'Model B' }],
        },
        {
          id: 'reasoning_effort',
          choices: [{ label: 'Provider default' }],
        },
      ],
    });
    await expect(
      bridge.setRuntimeConfigurationForProduct({
        cindySessionId: 'cindy-1',
        configId: 'model',
        choiceId: modelBChoice!.id,
      }),
    ).rejects.toThrow('choice is unavailable');
    const configurationCallCount = client.calls.filter(
      (call) => call.method === 'session/set_config_option',
    ).length;
    await expect(
      bridge.setConfigurationOptionForMain({
        ...binding!,
        configId: 'model',
        value: '["fixture","unadvertised"]',
      }),
    ).rejects.toThrow('not advertised');
    expect(
      client.calls.filter((call) => call.method === 'session/set_config_option'),
    ).toHaveLength(configurationCallCount);

    await expect(
      bridge.setConfigurationOptionForMain({
        ...binding!,
        configId: 'model',
        value: '["fixture","model-b"]',
      }),
    ).resolves.toEqual([
      {
        id: 'model',
        currentValue: '["fixture","model-b"]',
        allowedValues: ['["fixture","model-b"]'],
      },
      {
        id: 'reasoning_effort',
        currentValue: '',
        allowedValues: [''],
      },
    ]);
    expect(client.calls).toContainEqual({
      method: 'session/set_config_option',
      value: {
        sessionId: 'runtime-1',
        configId: 'model',
        value: '["fixture","model-b"]',
      },
    });
  });

  it('serializes configuration with native prompts and closing lifecycle operations', async () => {
    const client = new FakeDshAcpClient();
    client.createConfigOptions = [{
      id: 'model',
      type: 'select',
      currentValue: 'model-a',
      options: [
        { value: 'model-a', name: 'Model A' },
        { value: 'model-b', name: 'Model B' },
      ],
    }];
    client.setConfigOptions = [{
      id: 'model',
      type: 'select',
      currentValue: 'model-b',
      options: [{ value: 'model-b', name: 'Model B' }],
    }];
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await bridge.initialize();
    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    const [binding] = await bridge.list({ scopeId: 'scope-a' });

    const promptDeferred = deferred<DshAcpPromptResult>();
    client.promptGate = promptDeferred.promise;
    const inFlightPrompt = bridge.prompt({ ...binding!, text: 'wait for response' });
    await expect(
      bridge.setConfigurationOptionForMain({
        ...binding!,
        configId: 'model',
        value: 'model-b',
      }),
    ).rejects.toThrow('prompt outcome is pending');
    promptDeferred.resolve({ stopReason: 'end_turn' });
    await expect(inFlightPrompt).resolves.toMatchObject({ operation: 'prompt' });

    const setDeferred = deferred<{ configOptions?: unknown }>();
    client.setConfigGate = setDeferred.promise;
    const inFlightSet = bridge.setConfigurationOptionForMain({
      ...binding!,
      configId: 'model',
      value: 'model-b',
    });
    await expect(bridge.prompt({ ...binding!, text: 'must wait' })).rejects.toThrow(
      'runtime configuration is changing',
    );
    await expect(bridge.close(binding!)).rejects.toThrow('runtime configuration is changing');
    setDeferred.resolve({ configOptions: client.setConfigOptions });
    await expect(inFlightSet).resolves.toHaveLength(1);
  });

  it('fails closed when an ACP configuration response cannot acknowledge the selected value', async () => {
    const client = new FakeDshAcpClient();
    client.createConfigOptions = [{
      id: 'model',
      type: 'select',
      currentValue: '["fixture","model-a"]',
      options: [{
        group: 'fixture',
        name: 'Fixture',
        options: [
          { value: '["fixture","model-a"]', name: 'Model A' },
          { value: '["fixture","model-b"]', name: 'Model B' },
        ],
      }],
    }];
    // The native request may have applied even though its response is stale.
    // Retrying would hide a route ambiguity, so Main has to retire the carrier.
    client.setConfigOptions = [{
      id: 'model',
      type: 'select',
      currentValue: '["fixture","model-a"]',
      options: [{
        group: 'fixture',
        name: 'Fixture',
        options: [{ value: '["fixture","model-a"]', name: 'Model A' }],
      }],
    }];
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await bridge.initialize();
    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    const [binding] = await bridge.list({ scopeId: 'scope-a' });

    await expect(
      bridge.setConfigurationOptionForMain({
        ...binding!,
        configId: 'model',
        value: '["fixture","model-b"]',
      }),
    ).rejects.toThrow('configuration is uncertain');
    expect(client.calls).toContainEqual({
      method: 'transport/close',
      value: 'DSH session configuration outcome is uncertain',
    });
    await expect(bridge.prompt({ ...binding!, text: 'must not run' })).rejects.toThrow(
      'needs reconciliation',
    );
  });

  it('mounts a Main-only internal MCP lease before create/resume and releases it at every lifecycle boundary', async () => {
    const client = new FakeDshAcpClient();
    const internalMcpLeaseFactory = fakeInternalMcpLeaseFactory();
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
      internalMcpLeaseFactory,
    });
    await bridge.initialize();

    await expect(bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' })).rejects.toThrow(
      'requires a Maker session instance id',
    );
    const created = await bridge.create({
      cindySessionId: 'cindy-1',
      cwd: '/project',
      sessionInstanceId: 'instance-a',
    });
    expect(internalMcpLeaseFactory.acquire).toHaveBeenCalledWith({
      scopeId: 'scope-a',
      cindySessionId: 'cindy-1',
      sessionInstanceId: 'instance-a',
    });
    expect(client.calls).toContainEqual({
      method: 'session/new',
      value: {
        cwd: '/project',
        mcpServers: [{
          name: 'cindy_dsh_fixture',
          type: 'http',
          url: 'http://127.0.0.1:43123/dsh-mcp/instance-a',
          headers: [{ name: 'authorization', value: 'Bearer test-instance-a' }],
        }],
      },
    });
    await bridge.close(created);
    expect(internalMcpLeaseFactory.releases).toHaveBeenCalledTimes(1);

    const [binding] = await bridge.list({ scopeId: 'scope-a' });
    await bridge.resume({
      ...binding!,
      cwd: '/project',
      sessionInstanceId: 'instance-b',
    });
    expect(internalMcpLeaseFactory.acquire).toHaveBeenLastCalledWith({
      scopeId: 'scope-a',
      cindySessionId: 'cindy-1',
      sessionInstanceId: 'instance-b',
    });
    expect(client.calls).toContainEqual({
      method: 'session/resume',
      value: {
        sessionId: 'runtime-1',
        cwd: '/project',
        mcpServers: [{
          name: 'cindy_dsh_fixture',
          type: 'http',
          url: 'http://127.0.0.1:43123/dsh-mcp/instance-b',
          headers: [{ name: 'authorization', value: 'Bearer test-instance-b' }],
        }],
      },
    });

    client.emitTransportClose('fixture EOF');
    await vi.waitFor(() => expect(internalMcpLeaseFactory.revokeAll).toHaveBeenCalledOnce());
  });

  it('projects only acknowledged lifecycle facts to the Main-owned session activity coordinator', async () => {
    const client = new FakeDshAcpClient();
    const store = new MemoryDshBindingStore();
    const sessionActivity = fakeSessionActivityCoordinator();
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
      sessionActivity,
    });
    await initializeWithDurableBinding(bridge, store);

    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    const [binding] = await bridge.list({ scopeId: 'scope-a' });
    await bridge.close(binding!);
    await bridge.resume({ ...binding!, cwd: '/project' });
    client.emitTransportClose('fixture EOF');
    // Carrier-close notification is synchronous. The durable binding/activity
    // writes below may still be awaiting SQLite, but local plan/todo admission
    // must already be revoked on this same Main turn.
    expect(sessionActivity.revokeMutations).toHaveBeenCalledWith({
      cindySessionId: 'cindy-1',
      scopeId: 'scope-a',
    });
    await vi.waitFor(() => {
      expect(sessionActivity.disconnected).toHaveBeenCalledWith({
        cindySessionId: 'cindy-1',
        scopeId: 'scope-a',
      });
    });

    expect(sessionActivity.created).toHaveBeenCalledWith({
      cindySessionId: 'cindy-1',
      scopeId: 'scope-a',
    });
    expect(sessionActivity.closed).toHaveBeenCalledWith({
      cindySessionId: 'cindy-1',
      scopeId: 'scope-a',
    });
    expect(sessionActivity.resumed).toHaveBeenCalledWith({
      cindySessionId: 'cindy-1',
      scopeId: 'scope-a',
    });
    const activityInputs = [
      ...sessionActivity.created.mock.calls,
      ...sessionActivity.closed.mock.calls,
      ...sessionActivity.resumed.mock.calls,
      ...sessionActivity.disconnected.mock.calls,
    ];
    expect(JSON.stringify(activityInputs)).not.toContain('runtime-1');
  });

  it('fails closed if acknowledged lifecycle state cannot be projected to the activity store', async () => {
    const client = new FakeDshAcpClient();
    const store = new MemoryDshBindingStore();
    const sessionActivity = fakeSessionActivityCoordinator();
    sessionActivity.created.mockRejectedValueOnce(
      new Error('fixture activity store is unavailable'),
    );
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
      sessionActivity,
    });
    await initializeWithDurableBinding(bridge, store);

    await expect(bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' })).rejects.toThrow(
      'requires reconciliation because could not project DSH session activity created',
    );
    expect(client.calls).toContainEqual(
      expect.objectContaining({
        method: 'transport/close',
        value: expect.stringContaining('durable binding failure'),
      }),
    );
  });

  it('fails closed for cross-scope or forged runtime bindings', async () => {
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client: new FakeDshAcpClient(),
      assertAuthorizedCwd: assertProjectCwd,
    });
    await bridge.initialize();
    const created = await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    await expect(bridge.list({ scopeId: 'scope-b' })).rejects.toThrow('scope ownership mismatch');
    await expect(
      bridge.cancel({ cindySessionId: 'cindy-1', runtimeSessionId: 'forged', scopeId: 'scope-a' }),
    ).rejects.toThrow('session ownership mismatch');
    await expect(
      bridge.cancel({ ...created, bridgeSessionKey: 'forged-bridge-session-key' }),
    ).rejects.toThrow('adapter session capability mismatch');
    await expect(
      bridge.resume({
        cindySessionId: 'cindy-1',
        runtimeSessionId: 'runtime-1',
        scopeId: 'scope-a',
        cwd: '/project',
      }),
    ).rejects.toThrow('cannot resume an active');
    await expect(bridge.create({ cindySessionId: 'cindy-2', cwd: 'relative' })).rejects.toThrow(
      'cwd must be absolute',
    );
    await expect(
      bridge.create({ cindySessionId: 'cindy-2', cwd: '/not-authorized' }),
    ).rejects.toThrow('cwd is not authorized');
  });

  it('cancels every ACP permission request until the owner-bound adapter resolver is installed', async () => {
    const client = new FakeDshAcpClient();
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await bridge.initialize();

    await expect(
      client.requestFromRuntime('session/request_permission', {
        sessionId: 'runtime-1',
        toolCall: { toolCallId: 'unknown-tool-call' },
        options: [{ optionId: 'allow-once', kind: 'allow_once' }],
      }),
    ).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
  });

  it('allows one offered permission only after the owned tool call has a display-safe correlation', async () => {
    const resolver = vi.fn(async (request) => {
      expect(request).toMatchObject({
        toolUseId: expect.stringMatching(/^dsh:tool:/),
        toolName: 'bash',
        input: { token: '[REDACTED]', command: 'pwd' },
        kind: 'other',
      });
      expect(JSON.stringify(request)).not.toContain('native-tool-1');
      return 'allow-once' as const;
    });
    const client = new FakeDshAcpClient();
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await bridge.initialize();
    const adapter = await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    bridge.bindPermissionResolver(adapter, resolver);
    const binding = (await bridge.list({ scopeId: 'scope-a' }))[0]!;

    client.emitNotification('session/update', {
      sessionId: binding.runtimeSessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'native-tool-1',
        title: 'bash',
        status: 'in_progress',
        rawInput: { token: 'dsh-test-token', command: 'pwd' },
      },
    });
    await Promise.resolve();

    await expect(
      client.requestFromRuntime('session/request_permission', {
        sessionId: binding.runtimeSessionId,
        toolCall: { toolCallId: 'native-tool-1' },
        options: [
          { optionId: 'allow-once', kind: 'allow_once' },
          { optionId: 'reject-once', kind: 'reject_once' },
        ],
      }),
    ).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } });
    expect(resolver).toHaveBeenCalledTimes(1);

    await expect(
      client.requestFromRuntime('session/request_permission', {
        sessionId: binding.runtimeSessionId,
        toolCall: { toolCallId: 'native-tool-1' },
        options: [{ optionId: 'allow-once', kind: 'allow_once' }],
      }),
    ).resolves.toEqual({ outcome: { outcome: 'cancelled' } });

    client.emitNotification('session/update', {
      sessionId: binding.runtimeSessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'native-tool-unknown-option',
        title: 'bash',
        status: 'in_progress',
        rawInput: { command: 'pwd' },
      },
    });
    await expect(
      client.requestFromRuntime('session/request_permission', {
        sessionId: binding.runtimeSessionId,
        toolCall: { toolCallId: 'native-tool-unknown-option' },
        options: [
          { optionId: 'allow-once', kind: 'allow_once' },
          { optionId: 'surprise', kind: 'other' },
        ],
      }),
    ).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('cancels unknown, unavailable, or timed-out permission decisions', async () => {
    vi.useFakeTimers();
    const resolver = vi.fn(() => new Promise<'allow-once'>(() => undefined));
    const client = new FakeDshAcpClient();
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
      permissionTimeoutMs: 5,
    });
    await bridge.initialize();
    const adapter = await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    bridge.bindPermissionResolver(adapter, resolver);
    const binding = (await bridge.list({ scopeId: 'scope-a' }))[0]!;

    await expect(
      client.requestFromRuntime('session/request_permission', {
        sessionId: binding.runtimeSessionId,
        toolCall: { toolCallId: 'never-seen' },
        options: [{ optionId: 'reject-once', kind: 'reject_once' }],
      }),
    ).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
    expect(resolver).not.toHaveBeenCalled();

    client.emitNotification('session/update', {
      sessionId: binding.runtimeSessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'native-tool-timeout',
        title: 'bash',
        status: 'in_progress',
        rawInput: { command: 'pwd' },
      },
    });
    const waiting = client.requestFromRuntime('session/request_permission', {
      sessionId: binding.runtimeSessionId,
      toolCall: { toolCallId: 'native-tool-timeout' },
      options: [{ optionId: 'allow-once', kind: 'allow_once' }],
    });
    await vi.advanceTimersByTimeAsync(5);
    await expect(waiting).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending permission when the carrier closes before its decision', async () => {
    const decision = deferred<'allow-once'>();
    const resolver = vi.fn(() => decision.promise);
    const client = new FakeDshAcpClient();
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await bridge.initialize();
    const adapter = await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    bridge.bindPermissionResolver(adapter, resolver);
    const binding = (await bridge.list({ scopeId: 'scope-a' }))[0]!;
    client.emitNotification('session/update', {
      sessionId: binding.runtimeSessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'native-tool-eof',
        title: 'bash',
        status: 'in_progress',
        rawInput: { command: 'pwd' },
      },
    });

    const waiting = client.requestFromRuntime('session/request_permission', {
      sessionId: binding.runtimeSessionId,
      toolCall: { toolCallId: 'native-tool-eof' },
      options: [{ optionId: 'allow-once', kind: 'allow_once' }],
    });
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(1));
    client.emitTransportClose('unexpected EOF');
    decision.resolve('allow-once');

    await expect(waiting).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
  });

  it('serializes create, resume and close transitions for one Cindy session', async () => {
    const client = new FakeDshAcpClient();
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await bridge.initialize();

    const creating = deferred<{ sessionId: string }>();
    client.createSession = vi.fn(() => creating.promise);
    const firstCreate = bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    await expect(bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' })).rejects.toThrow(
      'create lifecycle operation in flight',
    );
    expect(client.createSession).toHaveBeenCalledTimes(1);
    creating.resolve({ sessionId: 'runtime-1' });
    await firstCreate;

    const binding = (await bridge.list({ scopeId: 'scope-a' }))[0]!;
    await bridge.close(binding);
    const resuming = deferred<{ configOptions?: unknown }>();
    client.resumeSession = vi.fn(() => resuming.promise);
    const firstResume = bridge.resume({ ...binding, cwd: '/project' });
    await expect(bridge.resume({ ...binding, cwd: '/project' })).rejects.toThrow(
      'resume lifecycle operation in flight',
    );
    expect(client.resumeSession).toHaveBeenCalledTimes(1);
    resuming.resolve({});
    await firstResume;

    const closing = deferred<unknown>();
    client.closeSession = vi.fn(() => closing.promise);
    const firstClose = bridge.close(binding);
    await expect(bridge.close(binding)).rejects.toThrow('close lifecycle operation in flight');
    expect(client.closeSession).toHaveBeenCalledTimes(1);
    closing.resolve({});
    await firstClose;
  });

  it('rejects an oversized prompt before allocating an ACP request frame', async () => {
    const client = new FakeDshAcpClient();
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await bridge.initialize();
    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    const binding = (await bridge.list({ scopeId: 'scope-a' }))[0]!;

    await expect(
      bridge.prompt({ ...binding, text: 'a'.repeat(4 * 1024 * 1024 + 1) }),
    ).rejects.toThrow('prompt text exceeds');
    expect(client.calls).not.toContainEqual(expect.objectContaining({ method: 'session/prompt' }));
  });

  it('records a durable prompt receipt before ACP send and acknowledges it only after the native reply', async () => {
    const client = new FakeDshAcpClient();
    const store = new MemoryDshBindingStore();
    const promptReceipts = fakePromptReceiptStore();
    client.prompt = vi.fn(async (): Promise<DshAcpPromptResult> => {
      expect(promptReceipts.recordPending).toHaveBeenCalledWith({
        receiptId: 'receipt-1',
        cindySessionId: 'cindy-1',
      });
      expect(promptReceipts.acknowledge).not.toHaveBeenCalled();
      return { stopReason: 'end_turn' };
    });
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
      receiptId: () => 'receipt-1',
    });
    await initializeWithDurableBinding(bridge, store, promptReceipts);
    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    const binding = (await bridge.list({ scopeId: 'scope-a' }))[0]!;

    await expect(bridge.prompt({ ...binding, text: 'safe fixture prompt' })).resolves.toMatchObject(
      {
        receiptId: 'receipt-1',
        stopReason: 'end_turn',
      },
    );
    expect(promptReceipts.hasUnresolved).toHaveBeenCalledWith('cindy-1');
    expect(promptReceipts.acknowledge).toHaveBeenCalledWith({
      receiptId: 'receipt-1',
      cindySessionId: 'cindy-1',
      stopReason: 'end_turn',
    });
    expect(promptReceipts.markUncertain).not.toHaveBeenCalled();
  });

  it('blocks a prompt behind an unresolved durable receipt without calling the native runtime', async () => {
    const client = new FakeDshAcpClient();
    const store = new MemoryDshBindingStore();
    const promptReceipts = fakePromptReceiptStore(true);
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await initializeWithDurableBinding(bridge, store, promptReceipts);
    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    const binding = (await bridge.list({ scopeId: 'scope-a' }))[0]!;

    await expect(bridge.prompt({ ...binding, text: 'must not replay' })).rejects.toThrow(
      'prompt outcome is uncertain',
    );
    expect(promptReceipts.recordPending).not.toHaveBeenCalled();
    expect(client.calls).not.toContainEqual(expect.objectContaining({ method: 'session/prompt' }));
  });

  it('marks a failed prompt receipt uncertain without exposing the native error text', async () => {
    const client = new FakeDshAcpClient();
    const store = new MemoryDshBindingStore();
    const promptReceipts = fakePromptReceiptStore();
    client.prompt = vi.fn(async () => {
      throw new Error('fixture-native-prompt-error contains dsh-test-token');
    });
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
      receiptId: () => 'receipt-1',
    });
    await initializeWithDurableBinding(bridge, store, promptReceipts);
    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    const binding = (await bridge.list({ scopeId: 'scope-a' }))[0]!;

    const failure = await bridge.prompt({ ...binding, text: 'deterministic failed fixture' }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('prompt outcome is uncertain');
    expect((failure as Error).message).not.toContain('dsh-test-token');
    expect(promptReceipts.markUncertain).toHaveBeenCalledWith({
      cindySessionId: 'cindy-1',
      receiptIds: ['receipt-1'],
    });
    await expect(bridge.prompt({ ...binding, text: 'must not retry' })).rejects.toThrow(
      'needs reconciliation',
    );
  });

  it('does not close a session while its native prompt outcome remains pending', async () => {
    const client = new FakeDshAcpClient();
    const store = new MemoryDshBindingStore();
    const promptReceipts = fakePromptReceiptStore();
    const nativePrompt = deferred<DshAcpPromptResult>();
    client.prompt = vi.fn(() => nativePrompt.promise);
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
      receiptId: () => 'receipt-1',
    });
    await initializeWithDurableBinding(bridge, store, promptReceipts);
    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    const binding = (await bridge.list({ scopeId: 'scope-a' }))[0]!;

    const prompting = bridge.prompt({ ...binding, text: 'wait for fixture completion' });
    await vi.waitFor(() => expect(promptReceipts.recordPending).toHaveBeenCalledTimes(1));
    await expect(bridge.close(binding)).rejects.toThrow('prompt outcome is pending');
    expect(client.calls).not.toContainEqual({
      method: 'session/close',
      value: binding.runtimeSessionId,
    });

    nativePrompt.resolve({ stopReason: 'cancelled' });
    await expect(prompting).resolves.toMatchObject({ stopReason: 'cancelled' });
  });

  it('does not resume an inactive session over an unresolved durable prompt receipt', async () => {
    const client = new FakeDshAcpClient();
    const store = new MemoryDshBindingStore();
    const promptReceipts = fakePromptReceiptStore(true);
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await initializeWithDurableBinding(bridge, store, promptReceipts);
    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    const binding = (await bridge.list({ scopeId: 'scope-a' }))[0]!;
    await bridge.close(binding);

    await expect(bridge.resume({ ...binding, cwd: '/project' })).rejects.toThrow(
      'prompt outcome is uncertain',
    );
    expect(client.calls).not.toContainEqual({
      method: 'session/resume',
      value: { sessionId: binding.runtimeSessionId, cwd: '/project' },
    });
  });

  it('routes ordered follow updates only to the owned active session and fails closed after EOF', async () => {
    const client = new FakeDshAcpClient();
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
      now: () => new Date('2026-09-02T00:00:00.000Z'),
    });
    await bridge.initialize();
    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    const binding = (await bridge.list({ scopeId: 'scope-a' }))[0]!;
    const received: unknown[] = [];
    const stopFollowing = bridge.followRawForMain(binding, (event) => received.push(event));

    client.emitNotification('session/update', {
      sessionId: 'foreign',
      update: { sessionUpdate: 'agent_message_chunk' },
    });
    client.emitNotification('session/update', {
      sessionId: binding.runtimeSessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { text: 'one' } },
    });
    client.emitNotification('session/update', {
      sessionId: binding.runtimeSessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { text: 'two' } },
    });
    await Promise.resolve();

    expect(received).toEqual([
      expect.objectContaining({
        cindySessionId: 'cindy-1',
        sequence: 1,
      }),
      expect.objectContaining({
        cindySessionId: 'cindy-1',
        sequence: 2,
      }),
    ]);
    expect(JSON.stringify(received)).not.toContain(binding.runtimeSessionId);
    stopFollowing();
    client.emitTransportClose('unexpected EOF');
    await expect(bridge.prompt({ ...binding, text: 'must not be replayed' })).rejects.toThrow(
      'needs reconciliation',
    );
    await expect(bridge.reconcile({ scopeId: 'scope-a' })).rejects.toThrow('needs reconciliation');
  });

  it('numbers each owned follow stream independently', async () => {
    const client = new FakeDshAcpClient();
    client.createSession = vi
      .fn()
      .mockResolvedValueOnce({ sessionId: 'runtime-1' })
      .mockResolvedValueOnce({ sessionId: 'runtime-2' });
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await bridge.initialize();
    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    await bridge.create({ cindySessionId: 'cindy-2', cwd: '/project' });
    const [first, second] = await bridge.list({ scopeId: 'scope-a' });
    const received: Array<{ cindySessionId: string; sequence: number }> = [];
    bridge.followRawForMain(first!, (event) => received.push(event));
    bridge.followRawForMain(second!, (event) => received.push(event));

    client.emitNotification('session/update', {
      sessionId: first!.runtimeSessionId,
      update: { sessionUpdate: 'agent_message_chunk' },
    });
    client.emitNotification('session/update', {
      sessionId: second!.runtimeSessionId,
      update: { sessionUpdate: 'agent_message_chunk' },
    });
    client.emitNotification('session/update', {
      sessionId: first!.runtimeSessionId,
      update: { sessionUpdate: 'agent_message_chunk' },
    });
    await Promise.resolve();

    expect(received.map(({ cindySessionId, sequence }) => ({ cindySessionId, sequence }))).toEqual([
      { cindySessionId: 'cindy-1', sequence: 1 },
      { cindySessionId: 'cindy-2', sequence: 1 },
      { cindySessionId: 'cindy-1', sequence: 2 },
    ]);
  });

  it('refuses a projection-enabled runtime session before its durable binding is configured', async () => {
    const coordinator: DshFollowProjectionCoordinator = { project: vi.fn() };
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client: new FakeDshAcpClient(),
      assertAuthorizedCwd: assertProjectCwd,
      projectionCoordinator: coordinator,
    });
    await bridge.initialize();

    await expect(bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' })).rejects.toThrow(
      'follow projection requires durable binding',
    );
  });

  it('waits for a queued projection before resolving the same native permission request', async () => {
    const pendingProjection = deferred<void>();
    const resolver = vi.fn(async () => 'allow-once' as const);
    const client = new FakeDshAcpClient();
    const store = new MemoryDshBindingStore();
    const coordinator: DshFollowProjectionCoordinator = {
      project: vi.fn(
        async ({ event, expectedBindingRevision }): Promise<DshFollowProjectionResult> => {
          await pendingProjection.promise;
          const committed = await store.advanceProjectionCursor({
            cindySessionId: event.cindySessionId,
            expectedRevision: expectedBindingRevision,
            nextSequence: event.sequence,
          });
          return committed.kind === 'advanced'
            ? { kind: 'translated', events: [], binding: committed.binding }
            : { kind: 'failed', reason: 'commit-conflict' };
        },
      ),
    };
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
      projectionCoordinator: coordinator,
    });
    await initializeWithDurableBinding(bridge, store);
    const adapter = await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    bridge.bindPermissionResolver(adapter, resolver);
    const binding = (await bridge.list({ scopeId: 'scope-a' }))[0]!;
    const received: number[] = [];
    bridge.followRawForMain(binding, (event) => received.push(event.sequence));

    client.emitNotification('session/update', {
      sessionId: binding.runtimeSessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'native-tool-1',
        title: 'bash',
        status: 'in_progress',
        rawInput: { command: 'pwd' },
      },
    });

    const permission = client.requestFromRuntime('session/request_permission', {
      sessionId: binding.runtimeSessionId,
      toolCall: { toolCallId: 'native-tool-1' },
      options: [{ optionId: 'allow-once', kind: 'allow_once' }],
    });
    await Promise.resolve();
    expect(received).toEqual([]);
    expect(resolver).not.toHaveBeenCalled();

    pendingProjection.resolve();
    await vi.waitFor(() => expect(received).toEqual([1]));
    expect(coordinator.project).toHaveBeenCalledWith({
      event: expect.objectContaining({ cindySessionId: 'cindy-1', sequence: 1 }),
      expectedBindingRevision: 1,
    });

    await expect(permission).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } });
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('offers product adapters only the committed safe projection, never the raw ACP update', async () => {
    const client = new FakeDshAcpClient();
    const store = new MemoryDshBindingStore();
    const coordinator: DshFollowProjectionCoordinator = {
      project: vi.fn(
        async ({ event, expectedBindingRevision }): Promise<DshFollowProjectionResult> => {
          const current = await store.getByCindySessionId(event.cindySessionId);
          if (!current || current.revision !== expectedBindingRevision) {
            return { kind: 'failed', reason: 'commit-conflict' };
          }
          // dshFollowProjection has its own transaction tests; this fixture
          // models its already-committed safe result so this test isolates the
          // port that leaves Main for a product adapter.
          return {
            kind: 'translated',
            events: [
              {
                type: 'text',
                data: {
                  text: 'safe projection',
                  isFinal: true,
                  agentMessageId: 'dsh:message:opaque',
                },
                source: 'dsh',
                agentMeta: { dsh: { projectionSequence: event.sequence } },
              },
            ],
            binding: {
              ...current,
              lastProjectedSequence: event.sequence,
              revision: current.revision + 1,
            },
          };
        },
      ),
    };
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
      projectionCoordinator: coordinator,
    });
    await initializeWithDurableBinding(bridge, store);
    const created = await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    const binding = (await bridge.list({ scopeId: 'scope-a' }))[0]!;
    const received: unknown[] = [];
    bridge.followCommitted(created, (event) => received.push(event));
    expect(JSON.stringify(created)).not.toContain(binding.runtimeSessionId);

    client.emitNotification('session/update', {
      sessionId: binding.runtimeSessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'native-message-id',
        content: { type: 'text', text: 'native payload must not cross the adapter port' },
      },
    });

    await vi.waitFor(() => expect(coordinator.project).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toEqual(
      expect.objectContaining({
        cindySessionId: 'cindy-1',
        scopeId: 'scope-a',
        sequence: 1,
        events: [
          expect.objectContaining({
            type: 'text',
            data: expect.objectContaining({ text: 'safe projection' }),
          }),
        ],
      }),
    );
    expect(JSON.stringify(received[0])).not.toContain('native-message-id');
    expect(JSON.stringify(received[0])).not.toContain(
      'native payload must not cross the adapter port',
    );
    expect(JSON.stringify(received[0])).not.toContain('runtime-1');
  });

  it('waits for the serialized projection tail before closing its native session', async () => {
    const pendingProjection = deferred<void>();
    const client = new FakeDshAcpClient();
    const store = new MemoryDshBindingStore();
    const coordinator: DshFollowProjectionCoordinator = {
      project: vi.fn(
        async ({ event, expectedBindingRevision }): Promise<DshFollowProjectionResult> => {
          await pendingProjection.promise;
          const committed = await store.advanceProjectionCursor({
            cindySessionId: event.cindySessionId,
            expectedRevision: expectedBindingRevision,
            nextSequence: event.sequence,
          });
          return committed.kind === 'advanced'
            ? { kind: 'translated', events: [], binding: committed.binding }
            : { kind: 'failed', reason: 'commit-conflict' };
        },
      ),
    };
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
      projectionCoordinator: coordinator,
    });
    await initializeWithDurableBinding(bridge, store);
    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    const binding = (await bridge.list({ scopeId: 'scope-a' }))[0]!;

    client.emitNotification('session/update', {
      sessionId: binding.runtimeSessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'native-1',
        content: { text: 'one' },
      },
    });
    const closing = bridge.close(binding);
    await Promise.resolve();
    expect(client.calls).not.toContainEqual({
      method: 'session/close',
      value: binding.runtimeSessionId,
    });

    pendingProjection.resolve();
    await expect(closing).resolves.toMatchObject({ operation: 'close' });
    expect(client.calls).toContainEqual({
      method: 'session/close',
      value: binding.runtimeSessionId,
    });
  });

  it('drains an update delivered during native close before returning its close receipt', async () => {
    const pendingProjection = deferred<void>();
    const client = new FakeDshAcpClient();
    const store = new MemoryDshBindingStore();
    const coordinator: DshFollowProjectionCoordinator = {
      project: vi.fn(
        async ({ event, expectedBindingRevision }): Promise<DshFollowProjectionResult> => {
          await pendingProjection.promise;
          const committed = await store.advanceProjectionCursor({
            cindySessionId: event.cindySessionId,
            expectedRevision: expectedBindingRevision,
            nextSequence: event.sequence,
          });
          return committed.kind === 'advanced'
            ? { kind: 'translated', events: [], binding: committed.binding }
            : { kind: 'failed', reason: 'commit-conflict' };
        },
      ),
    };
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
      projectionCoordinator: coordinator,
    });
    await initializeWithDurableBinding(bridge, store);
    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    const binding = (await bridge.list({ scopeId: 'scope-a' }))[0]!;
    const nativeClose = deferred<unknown>();
    client.closeSession = vi.fn(() => nativeClose.promise);

    const closing = bridge.close(binding);
    await vi.waitFor(() =>
      expect(client.closeSession).toHaveBeenCalledWith(binding.runtimeSessionId),
    );
    client.emitNotification('session/update', {
      sessionId: binding.runtimeSessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'native-during-close',
        content: { text: 'must persist before close receipt' },
      },
    });
    await vi.waitFor(() => expect(coordinator.project).toHaveBeenCalledTimes(1));
    nativeClose.resolve({});
    let settled = false;
    void closing.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    pendingProjection.resolve();
    await expect(closing).resolves.toMatchObject({ operation: 'close' });
    expect(store.rows.get('cindy-1')).toMatchObject({
      lifecycleState: 'closed',
      lastProjectedSequence: 1,
      revision: 3,
    });
  });

  it('closes the carrier without notifying subscribers when projection cannot commit', async () => {
    const coordinator: DshFollowProjectionCoordinator = {
      project: vi.fn().mockResolvedValue({ kind: 'failed', reason: 'commit-conflict' }),
    };
    const client = new FakeDshAcpClient();
    const store = new MemoryDshBindingStore();
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
      projectionCoordinator: coordinator,
    });
    await initializeWithDurableBinding(bridge, store);
    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    const binding = (await bridge.list({ scopeId: 'scope-a' }))[0]!;
    const received: unknown[] = [];
    bridge.followRawForMain(binding, (event) => received.push(event));

    client.emitNotification('session/update', {
      sessionId: binding.runtimeSessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'native-1',
        content: { text: 'one' },
      },
    });
    await vi.waitFor(() =>
      expect(client.calls).toContainEqual(
        expect.objectContaining({
          method: 'transport/close',
          value:
            'DSH bridge follow projection failure: DSH follow projection failed: commit-conflict',
        }),
      ),
    );

    expect(received).toEqual([]);
    expect(store.rows.get('cindy-1')).toMatchObject({ lifecycleState: 'needs_reconcile' });
    await expect(
      bridge.prompt({ ...binding, text: 'must not reach native runtime' }),
    ).rejects.toThrow('needs reconciliation');
  });

  it('refuses a runtime that omits a required public lifecycle capability', async () => {
    const client = new FakeDshAcpClient();
    client.capabilities = { close: {}, list: {} };
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await expect(bridge.initialize()).rejects.toThrow('session/resume');
    expect(client.calls).toContainEqual({
      method: 'transport/close',
      value: 'ACP omitted required session capability: resume',
    });
  });

  it('closes the carrier when initialization rejects or a capability has an invalid shape', async () => {
    const rejectedClient = new FakeDshAcpClient();
    rejectedClient.initializeFailure = new Error('runtime initialize rejected');
    const rejectedBridge = new DshControlPlane({
      scopeId: 'scope-a',
      client: rejectedClient,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await expect(rejectedBridge.initialize()).rejects.toThrow('runtime initialize rejected');
    expect(rejectedClient.calls).toContainEqual({
      method: 'transport/close',
      value: 'DSH ACP initialization failed',
    });
    await expect(rejectedBridge.initialize()).rejects.toThrow('needs reconciliation');

    const malformedCapabilitiesClient = new FakeDshAcpClient();
    malformedCapabilitiesClient.capabilities = {
      close: 'present-but-invalid' as unknown as object,
      list: {},
      resume: {},
    };
    const malformedCapabilitiesBridge = new DshControlPlane({
      scopeId: 'scope-b',
      client: malformedCapabilitiesClient,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await expect(malformedCapabilitiesBridge.initialize()).rejects.toThrow('session/close');
    expect(malformedCapabilitiesClient.calls).toContainEqual({
      method: 'transport/close',
      value: 'ACP omitted required session capability: close',
    });
  });

  it('rejects an incompatible ACP protocol version before creating a binding', async () => {
    const client = new FakeDshAcpClient();
    client.protocolVersion = 2;
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await expect(bridge.initialize()).rejects.toThrow(
      'protocol version 2 is unsupported; expected 1',
    );
    expect(client.calls).toContainEqual({
      method: 'transport/close',
      value: 'DSH ACP protocol version 2 is unsupported; expected 1',
    });
    await expect(bridge.initialize()).rejects.toThrow('needs reconciliation');
  });

  it('rejects an unsafe ACP capability identity before it can become a durable fingerprint input', async () => {
    const client = new FakeDshAcpClient();
    client.agentName = 'runtime\nidentity';
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });

    await expect(bridge.initialize()).rejects.toThrow('agent name is invalid');
    expect(client.calls).toContainEqual({
      method: 'transport/close',
      value: 'DSH ACP initialization failed',
    });
  });

  it('closes the carrier and fails closed when a runtime operation times out', async () => {
    vi.useFakeTimers();
    const client = new FakeDshAcpClient();
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
      operationTimeoutMs: 5,
    });
    await bridge.initialize();
    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    client.listNeverSettles = true;

    const reconciling = bridge.reconcile({ scopeId: 'scope-a' });
    const timeoutExpectation = expect(reconciling).rejects.toThrow(
      'DSH bridge reconcile timed out after 5ms',
    );
    await vi.advanceTimersByTimeAsync(5);
    await timeoutExpectation;
    expect(client.calls).toContainEqual({
      method: 'transport/close',
      value: 'DSH bridge reconcile timed out after 5ms',
    });
    await expect(bridge.list({ scopeId: 'scope-a' })).rejects.toThrow('needs reconciliation');
  });

  it('rejects an invalid operation timeout at construction', () => {
    expect(
      () =>
        new DshControlPlane({
          scopeId: 'scope-a',
          client: new FakeDshAcpClient(),
          assertAuthorizedCwd: assertProjectCwd,
          operationTimeoutMs: 0,
        }),
    ).toThrow('operationTimeoutMs must be a positive safe integer');
  });

  it('requires Main to supply a workdir authorization policy', () => {
    expect(
      () =>
        new DshControlPlane({
          scopeId: 'scope-a',
          client: new FakeDshAcpClient(),
          // TypeScript callers cannot omit this; preserve the runtime check for
          // JavaScript/IPC construction paths too.
          assertAuthorizedCwd: undefined as unknown as (cwd: string) => void,
        }),
    ).toThrow('assertAuthorizedCwd is required');
  });

  it('rejects attaching durable ownership before the ACP handshake', async () => {
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client: new FakeDshAcpClient(),
      assertAuthorizedCwd: assertProjectCwd,
    });
    const store = new MemoryDshBindingStore();

    expect(() => bridge.configureDurableBinding(durableOptions(store))).toThrow(
      'must initialize before durable binding is configured',
    );
    await initializeWithDurableBinding(bridge, store);
  });

  it('persists the immutable binding only after an acknowledged native create receipt', async () => {
    const client = new FakeDshAcpClient();
    const store = new MemoryDshBindingStore();
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await initializeWithDurableBinding(bridge, store);
    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });

    expect(store.rows.get('cindy-1')).toMatchObject({
      cindySessionId: 'cindy-1',
      runtimeSessionId: 'runtime-1',
      hostScopeId: 'scope-a',
      lifecycleState: 'active',
      revision: 1,
    });
  });

  it('closes the carrier and does not expose a native session when create-receipt persistence fails', async () => {
    const client = new FakeDshAcpClient();
    const store = new MemoryDshBindingStore();
    store.failCreate = true;
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await initializeWithDurableBinding(bridge, store);

    await expect(bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' })).rejects.toThrow(
      'requires reconciliation',
    );
    await expect(bridge.list({ scopeId: 'scope-a' })).rejects.toThrow('needs reconciliation');
    expect(client.calls).toContainEqual(
      expect.objectContaining({
        method: 'transport/close',
        value: expect.stringContaining('durable binding failure'),
      }),
    );
  });

  it('restores only runtime-listed bindings and normalizes a post-restart active row to explicitly resumable', async () => {
    const store = new MemoryDshBindingStore();
    await store.recordCreateReceipt({
      cindySessionId: 'cindy-1',
      runtimeSessionId: 'runtime-1',
      hostScopeId: 'scope-a',
      ...durableOptions(store).runtimeIdentity,
    });
    const client = new FakeDshAcpClient();
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await initializeWithDurableBinding(bridge, store);

    const [binding] = await bridge.restoreVerifiedBindings();
    expect(binding).toEqual({
      cindySessionId: 'cindy-1',
      runtimeSessionId: 'runtime-1',
      scopeId: 'scope-a',
    });
    expect(store.rows.get('cindy-1')).toMatchObject({ lifecycleState: 'closed', revision: 2 });
    await expect(bridge.prompt({ ...binding!, text: 'must resume first' })).rejects.toThrow(
      'inactive',
    );
    await bridge.resume({ ...binding!, cwd: '/project' });
    expect(store.rows.get('cindy-1')).toMatchObject({ lifecycleState: 'active', revision: 3 });
    expect(client.calls).not.toContainEqual(expect.objectContaining({ method: 'session/new' }));
  });

  it('leaves a runtime-listed binding in reconciliation when its prior prompt outcome is unresolved', async () => {
    const store = new MemoryDshBindingStore();
    await store.recordCreateReceipt({
      cindySessionId: 'cindy-1',
      runtimeSessionId: 'runtime-1',
      hostScopeId: 'scope-a',
      ...durableOptions(store).runtimeIdentity,
    });
    const promptReceipts = fakePromptReceiptStore(true);
    const client = new FakeDshAcpClient();
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await initializeWithDurableBinding(bridge, store, promptReceipts);

    await expect(bridge.restoreVerifiedBindings()).resolves.toEqual([]);
    expect(promptReceipts.hasUnresolved).toHaveBeenCalledWith('cindy-1');
    expect(store.rows.get('cindy-1')).toMatchObject({
      lifecycleState: 'needs_reconcile',
      revision: 2,
    });
    expect(client.calls).not.toContainEqual(expect.objectContaining({ method: 'session/resume' }));
  });

  it('never normalizes an already needs-reconcile binding from session/list alone', async () => {
    const store = new MemoryDshBindingStore();
    const created = await store.recordCreateReceipt({
      cindySessionId: 'cindy-1',
      runtimeSessionId: 'runtime-1',
      hostScopeId: 'scope-a',
      ...durableOptions(store).runtimeIdentity,
    });
    await store.markNeedsReconcile({
      cindySessionId: created.cindySessionId,
      expectedRevision: created.revision,
    });
    const client = new FakeDshAcpClient();
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await initializeWithDurableBinding(bridge, store);

    await expect(bridge.restoreVerifiedBindings()).resolves.toEqual([]);
    expect(store.rows.get('cindy-1')).toMatchObject({
      lifecycleState: 'needs_reconcile',
      revision: 2,
    });
    expect(client.calls).not.toContainEqual(expect.objectContaining({ method: 'session/resume' }));
  });

  it('fails closed if receipt-ledger state cannot be read during restart recovery', async () => {
    const store = new MemoryDshBindingStore();
    await store.recordCreateReceipt({
      cindySessionId: 'cindy-1',
      runtimeSessionId: 'runtime-1',
      hostScopeId: 'scope-a',
      ...durableOptions(store).runtimeIdentity,
    });
    const promptReceipts = fakePromptReceiptStore();
    promptReceipts.hasUnresolved.mockRejectedValueOnce(new Error('fixture ledger read failure'));
    const client = new FakeDshAcpClient();
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await initializeWithDurableBinding(bridge, store, promptReceipts);

    await expect(bridge.restoreVerifiedBindings()).rejects.toThrow('requires reconciliation');
    expect(client.calls).toContainEqual(
      expect.objectContaining({
        method: 'transport/close',
        value: expect.stringContaining('durable binding failure'),
      }),
    );
  });

  it('continues a restored binding from its durable projection cursor', async () => {
    const store = new MemoryDshBindingStore();
    const created = await store.recordCreateReceipt({
      cindySessionId: 'cindy-1',
      runtimeSessionId: 'runtime-1',
      hostScopeId: 'scope-a',
      ...durableOptions(store).runtimeIdentity,
    });
    await expect(
      store.advanceProjectionCursor({
        cindySessionId: created.cindySessionId,
        expectedRevision: created.revision,
        nextSequence: 1,
      }),
    ).resolves.toMatchObject({ kind: 'advanced' });
    const client = new FakeDshAcpClient();
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await initializeWithDurableBinding(bridge, store);
    const [binding] = await bridge.restoreVerifiedBindings();
    await bridge.resume({ ...binding!, cwd: '/project' });
    const received: number[] = [];
    bridge.followRawForMain(binding!, (event) => received.push(event.sequence));

    client.emitNotification('session/update', {
      sessionId: binding!.runtimeSessionId,
      update: { sessionUpdate: 'agent_message_chunk' },
    });
    await Promise.resolve();

    expect(received).toEqual([2]);
  });

  it('marks a persisted binding needs_reconcile when the freshly listed runtime history disagrees', async () => {
    const store = new MemoryDshBindingStore();
    await store.recordCreateReceipt({
      cindySessionId: 'cindy-1',
      runtimeSessionId: 'runtime-missing',
      hostScopeId: 'scope-a',
      ...durableOptions(store).runtimeIdentity,
    });
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client: new FakeDshAcpClient(),
      assertAuthorizedCwd: assertProjectCwd,
    });
    await initializeWithDurableBinding(bridge, store);

    await expect(bridge.restoreVerifiedBindings()).resolves.toEqual([]);
    expect(store.rows.get('cindy-1')).toMatchObject({
      lifecycleState: 'needs_reconcile',
      revision: 2,
    });
  });

  it('never treats an active runtime session missing from public session/list as lost', async () => {
    const client = new FakeDshAcpClient();
    const store = new MemoryDshBindingStore();
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await initializeWithDurableBinding(bridge, store);
    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    client.listSessions = async () => ({ sessions: [] });

    await expect(bridge.reconcile({ scopeId: 'scope-a' })).resolves.toEqual([]);
    expect(store.rows.get('cindy-1')).toMatchObject({ lifecycleState: 'active', revision: 1 });
  });

  it('does not reattach a runtime history from a different verified release identity', async () => {
    const store = new MemoryDshBindingStore();
    await store.recordCreateReceipt({
      cindySessionId: 'cindy-1',
      runtimeSessionId: 'runtime-1',
      hostScopeId: 'scope-a',
      ...durableOptions(store).runtimeIdentity,
      runtimeReleaseId: 'another-release',
    });
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client: new FakeDshAcpClient(),
      assertAuthorizedCwd: assertProjectCwd,
    });
    await initializeWithDurableBinding(bridge, store);

    await expect(bridge.restoreVerifiedBindings()).resolves.toEqual([]);
    expect(store.rows.get('cindy-1')).toMatchObject({
      lifecycleState: 'needs_reconcile',
      revision: 2,
    });
  });
});
