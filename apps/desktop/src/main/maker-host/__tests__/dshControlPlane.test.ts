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

function deferred<Value>(): { promise: Promise<Value>; resolve: (value: Value) => void } {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => { resolve = resolvePromise; });
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
  listNeverSettles = false;
  initializeFailure: Error | undefined;

  start(): void { this.started += 1; }
  async initialize(): Promise<DshAcpInitializeResult> {
    if (this.initializeFailure) throw this.initializeFailure;
    return {
      protocolVersion: this.protocolVersion,
      agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' },
      agentCapabilities: { sessionCapabilities: this.capabilities },
    };
  }
  async createSession(input: { cwd: string }): Promise<{ sessionId: string }> {
    this.calls.push({ method: 'session/new', value: input });
    return { sessionId: 'runtime-1' };
  }
  listSessions(): Promise<unknown> {
    if (this.listNeverSettles) return new Promise<never>(() => undefined);
    return Promise.resolve({ sessions: [{ sessionId: 'runtime-1' }] });
  }
  async resumeSession(input: { sessionId: string; cwd: string }): Promise<unknown> { this.calls.push({ method: 'session/resume', value: input }); return {}; }
  async prompt(input: { sessionId: string; prompt: readonly unknown[] }): Promise<DshAcpPromptResult> { this.calls.push({ method: 'session/prompt', value: input }); return { stopReason: 'end_turn' }; }
  async cancel(sessionId: string): Promise<void> { this.calls.push({ method: 'session/cancel', value: sessionId }); }
  async closeSession(sessionId: string): Promise<unknown> { this.calls.push({ method: 'session/close', value: sessionId }); return {}; }
  onNotification(method: string, handler: DshAcpNotificationHandler): void { this.notificationHandlers.set(method, handler); }
  onServerRequest(method: string, handler: DshAcpServerRequestHandler): void { this.serverRequestHandlers.set(method, handler); }
  onTransportClose(handler: DshAcpTransportCloseHandler): () => void {
    this.transportCloseHandlers.add(handler);
    return () => this.transportCloseHandlers.delete(handler);
  }
  async close(reason?: string): Promise<void> { this.calls.push({ method: 'transport/close', value: reason }); }
  emitNotification(method: string, params: unknown): void { void this.notificationHandlers.get(method)?.(params); }
  requestFromRuntime(method: string, params: unknown): Promise<unknown> {
    const handler = this.serverRequestHandlers.get(method);
    if (!handler) return Promise.reject(new Error(`no handler for ${method}`));
    return handler(params, { id: 'runtime-request-1', method });
  }
  emitTransportClose(reason: string): void { for (const handler of this.transportCloseHandlers) handler(reason); }
}

describe('DshControlPlane', () => {
  afterEach(() => vi.useRealTimers());

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
      expect.objectContaining({ operation: 'create', receiptId: 'receipt-1', runtimeSessionId: 'runtime-1' }),
      expect.objectContaining({ operation: 'close' }),
      expect.objectContaining({ operation: 'resume' }),
      expect.objectContaining({ operation: 'prompt', stopReason: 'end_turn' }),
      expect.objectContaining({ operation: 'cancel' }),
      expect.objectContaining({ operation: 'close' }),
    ]);
    expect(client.calls).toEqual(expect.arrayContaining([
      { method: 'session/new', value: { cwd: '/project', mcpServers: [] } },
      { method: 'session/close', value: 'runtime-1' },
      { method: 'session/resume', value: { sessionId: 'runtime-1', cwd: '/project' } },
      { method: 'session/prompt', value: { sessionId: 'runtime-1', prompt: [{ type: 'text', text: 'hello' }] } },
      { method: 'session/cancel', value: 'runtime-1' },
      { method: 'session/close', value: 'runtime-1' },
    ]));
  });

  it('fails closed for cross-scope or forged runtime bindings', async () => {
    const bridge = new DshControlPlane({
      scopeId: 'scope-a',
      client: new FakeDshAcpClient(),
      assertAuthorizedCwd: assertProjectCwd,
    });
    await bridge.initialize();
    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    await expect(bridge.list({ scopeId: 'scope-b' })).rejects.toThrow('scope ownership mismatch');
    await expect(bridge.cancel({ cindySessionId: 'cindy-1', runtimeSessionId: 'forged', scopeId: 'scope-a' })).rejects.toThrow('session ownership mismatch');
    await expect(bridge.resume({ cindySessionId: 'cindy-1', runtimeSessionId: 'runtime-1', scopeId: 'scope-a', cwd: '/project' })).rejects.toThrow('cannot resume an active');
    await expect(bridge.create({ cindySessionId: 'cindy-2', cwd: 'relative' })).rejects.toThrow('cwd must be absolute');
    await expect(bridge.create({ cindySessionId: 'cindy-2', cwd: '/not-authorized' })).rejects.toThrow('cwd is not authorized');
  });

  it('cancels every F0 ACP permission request until F4 provides a correlated interaction resolver', async () => {
    const client = new FakeDshAcpClient();
    const bridge = new DshControlPlane({ scopeId: 'scope-a', client, assertAuthorizedCwd: assertProjectCwd });
    await bridge.initialize();

    await expect(client.requestFromRuntime('session/request_permission', {
      sessionId: 'runtime-1',
      toolCall: { toolCallId: 'unknown-tool-call' },
      options: [{ optionId: 'allow-once', kind: 'allow_once' }],
    })).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
  });

  it('serializes create, resume and close transitions for one Cindy session', async () => {
    const client = new FakeDshAcpClient();
    const bridge = new DshControlPlane({ scopeId: 'scope-a', client, assertAuthorizedCwd: assertProjectCwd });
    await bridge.initialize();

    const creating = deferred<{ sessionId: string }>();
    client.createSession = vi.fn(() => creating.promise);
    const firstCreate = bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    await expect(bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' })).rejects.toThrow('create lifecycle operation in flight');
    expect(client.createSession).toHaveBeenCalledTimes(1);
    creating.resolve({ sessionId: 'runtime-1' });
    await firstCreate;

    const binding = (await bridge.list({ scopeId: 'scope-a' }))[0]!;
    await bridge.close(binding);
    const resuming = deferred<unknown>();
    client.resumeSession = vi.fn(() => resuming.promise);
    const firstResume = bridge.resume({ ...binding, cwd: '/project' });
    await expect(bridge.resume({ ...binding, cwd: '/project' })).rejects.toThrow('resume lifecycle operation in flight');
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
    const bridge = new DshControlPlane({ scopeId: 'scope-a', client, assertAuthorizedCwd: assertProjectCwd });
    await bridge.initialize();
    await bridge.create({ cindySessionId: 'cindy-1', cwd: '/project' });
    const binding = (await bridge.list({ scopeId: 'scope-a' }))[0]!;

    await expect(bridge.prompt({ ...binding, text: 'a'.repeat(4 * 1024 * 1024 + 1) }))
      .rejects.toThrow('prompt text exceeds');
    expect(client.calls).not.toContainEqual(expect.objectContaining({ method: 'session/prompt' }));
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
    const stopFollowing = bridge.follow(binding, (event) => received.push(event));

    client.emitNotification('session/update', { sessionId: 'foreign', update: { sessionUpdate: 'agent_message_chunk' } });
    client.emitNotification('session/update', { sessionId: binding.runtimeSessionId, update: { sessionUpdate: 'agent_message_chunk', content: { text: 'one' } } });
    client.emitNotification('session/update', { sessionId: binding.runtimeSessionId, update: { sessionUpdate: 'agent_message_chunk', content: { text: 'two' } } });
    await Promise.resolve();

    expect(received).toEqual([
      expect.objectContaining({ cindySessionId: 'cindy-1', runtimeSessionId: 'runtime-1', sequence: 1 }),
      expect.objectContaining({ cindySessionId: 'cindy-1', runtimeSessionId: 'runtime-1', sequence: 2 }),
    ]);
    stopFollowing();
    client.emitTransportClose('unexpected EOF');
    await expect(bridge.prompt({ ...binding, text: 'must not be replayed' })).rejects.toThrow('needs reconciliation');
    await expect(bridge.reconcile({ scopeId: 'scope-a' })).rejects.toThrow('needs reconciliation');
  });

  it('refuses a runtime that omits a required public lifecycle capability', async () => {
    const client = new FakeDshAcpClient();
    client.capabilities = { close: {}, list: {} };
    const bridge = new DshControlPlane({ scopeId: 'scope-a', client, assertAuthorizedCwd: assertProjectCwd });
    await expect(bridge.initialize()).rejects.toThrow('session/resume');
    expect(client.calls).toContainEqual({ method: 'transport/close', value: 'ACP omitted required session capability: resume' });
  });

  it('closes the carrier when initialization rejects or a capability has an invalid shape', async () => {
    const rejectedClient = new FakeDshAcpClient();
    rejectedClient.initializeFailure = new Error('runtime initialize rejected');
    const rejectedBridge = new DshControlPlane({ scopeId: 'scope-a', client: rejectedClient, assertAuthorizedCwd: assertProjectCwd });
    await expect(rejectedBridge.initialize()).rejects.toThrow('runtime initialize rejected');
    expect(rejectedClient.calls).toContainEqual({ method: 'transport/close', value: 'DSH ACP initialization failed' });
    await expect(rejectedBridge.initialize()).rejects.toThrow('needs reconciliation');

    const malformedCapabilitiesClient = new FakeDshAcpClient();
    malformedCapabilitiesClient.capabilities = { close: 'present-but-invalid' as unknown as object, list: {}, resume: {} };
    const malformedCapabilitiesBridge = new DshControlPlane({
      scopeId: 'scope-b',
      client: malformedCapabilitiesClient,
      assertAuthorizedCwd: assertProjectCwd,
    });
    await expect(malformedCapabilitiesBridge.initialize()).rejects.toThrow('session/close');
    expect(malformedCapabilitiesClient.calls).toContainEqual({ method: 'transport/close', value: 'ACP omitted required session capability: close' });
  });

  it('rejects an incompatible ACP protocol version before creating a binding', async () => {
    const client = new FakeDshAcpClient();
    client.protocolVersion = 2;
    const bridge = new DshControlPlane({ scopeId: 'scope-a', client, assertAuthorizedCwd: assertProjectCwd });
    await expect(bridge.initialize()).rejects.toThrow('protocol version 2 is unsupported; expected 1');
    expect(client.calls).toContainEqual({
      method: 'transport/close',
      value: 'DSH ACP protocol version 2 is unsupported; expected 1',
    });
    await expect(bridge.initialize()).rejects.toThrow('needs reconciliation');
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
    const timeoutExpectation = expect(reconciling).rejects.toThrow('DSH bridge reconcile timed out after 5ms');
    await vi.advanceTimersByTimeAsync(5);
    await timeoutExpectation;
    expect(client.calls).toContainEqual({
      method: 'transport/close',
      value: 'DSH bridge reconcile timed out after 5ms',
    });
    await expect(bridge.list({ scopeId: 'scope-a' })).rejects.toThrow('needs reconciliation');
  });

  it('rejects an invalid operation timeout at construction', () => {
    expect(() => new DshControlPlane({
      scopeId: 'scope-a',
      client: new FakeDshAcpClient(),
      assertAuthorizedCwd: assertProjectCwd,
      operationTimeoutMs: 0,
    })).toThrow('operationTimeoutMs must be a positive safe integer');
  });

  it('requires Main to supply a workdir authorization policy', () => {
    expect(() => new DshControlPlane({
      scopeId: 'scope-a',
      client: new FakeDshAcpClient(),
      // TypeScript callers cannot omit this; preserve the runtime check for
      // JavaScript/IPC construction paths too.
      assertAuthorizedCwd: undefined as unknown as (cwd: string) => void,
    })).toThrow('assertAuthorizedCwd is required');
  });
});
