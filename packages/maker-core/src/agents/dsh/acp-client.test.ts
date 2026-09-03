import { describe, expect, it, vi } from 'vitest';

import { DshAcpClient, DshAcpRequestError } from './acp-client.js';
import type { Logger } from '../../interfaces/logger.js';
import type {
  DshAcpCloseHandler,
  DshAcpLineHandler,
  DshAcpTransport,
} from './transport.js';

class FakeDshAcpTransport implements DshAcpTransport {
  readonly writes: string[] = [];
  private readonly lineHandlers = new Set<DshAcpLineHandler>();
  private readonly closeHandlers = new Set<DshAcpCloseHandler>();
  private closeBarrier: Promise<void> | null = null;
  private releaseCloseBarrier: (() => void) | null = null;

  async writeLine(line: string): Promise<void> {
    this.writes.push(line);
  }

  onLine(handler: DshAcpLineHandler): () => void {
    this.lineHandlers.add(handler);
    return () => this.lineHandlers.delete(handler);
  }

  onClose(handler: DshAcpCloseHandler): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  async close(reason = 'test close'): Promise<void> {
    await this.closeBarrier;
    for (const handler of this.closeHandlers) handler({ reason });
  }

  pauseClose(): () => void {
    this.closeBarrier = new Promise<void>((resolve) => { this.releaseCloseBarrier = resolve; });
    return () => {
      this.releaseCloseBarrier?.();
      this.releaseCloseBarrier = null;
      this.closeBarrier = null;
    };
  }

  emit(message: unknown): void {
    const line = typeof message === 'string' ? message : JSON.stringify(message);
    for (const handler of this.lineHandlers) handler(line);
  }
}

const logger: Logger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: () => logger,
};

function sent(transport: FakeDshAcpTransport, index = -1): Record<string, unknown> {
  const line = transport.writes.at(index);
  if (!line) throw new Error('expected a transport write');
  return JSON.parse(line) as Record<string, unknown>;
}

function reply(transport: FakeDshAcpTransport, request: Record<string, unknown>, result: unknown): void {
  transport.emit({ jsonrpc: '2.0', id: request.id, result });
}

describe('DshAcpClient', () => {
  it('uses only public ACP lifecycle methods with deterministic request correlation', async () => {
    const transport = new FakeDshAcpTransport();
    const client = new DshAcpClient({ createTransport: () => transport, logger });
    client.start();

    const initializing = client.initialize();
    const initialize = sent(transport);
    expect(initialize).toMatchObject({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } });
    reply(transport, initialize, {
      protocolVersion: 1,
      agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' },
      agentCapabilities: { sessionCapabilities: { close: {}, list: {}, resume: {} } },
    });
    await expect(initializing).resolves.toMatchObject({ agentInfo: { name: 'deepseek-harness-acp' } });

    const creating = client.createSession({ cwd: '/safe/project' });
    const create = sent(transport);
    expect(create).toMatchObject({ method: 'session/new', params: { cwd: '/safe/project', mcpServers: [] } });
    reply(transport, create, { sessionId: 'runtime-session-1' });
    await expect(creating).resolves.toEqual({ sessionId: 'runtime-session-1' });

    const closing = client.closeSession('runtime-session-1');
    const close = sent(transport);
    expect(close).toMatchObject({ method: 'session/close', params: { sessionId: 'runtime-session-1' } });
    reply(transport, close, {});
    await expect(closing).resolves.toEqual({});

    await client.cancel('runtime-session-1');
    expect(sent(transport)).toMatchObject({ method: 'session/cancel', params: { sessionId: 'runtime-session-1' } });
  });

  it('answers an ACP permission request through the registered interaction boundary', async () => {
    const transport = new FakeDshAcpTransport();
    const client = new DshAcpClient({ createTransport: () => transport, logger });
    client.onServerRequest('session/request_permission', async (params, meta) => {
      expect(meta).toEqual({ id: 'permission-1', method: 'session/request_permission' });
      expect(params).toEqual({ sessionId: 'runtime-session-1', toolCallId: 'tool-1' });
      return { outcome: { outcome: 'selected', optionId: 'reject-once' } };
    });
    client.start();

    transport.emit({
      jsonrpc: '2.0',
      id: 'permission-1',
      method: 'session/request_permission',
      params: { sessionId: 'runtime-session-1', toolCallId: 'tool-1' },
    });
    await vi.waitFor(() => expect(transport.writes).toHaveLength(1));
    expect(sent(transport)).toEqual({
      jsonrpc: '2.0',
      id: 'permission-1',
      result: { outcome: { outcome: 'selected', optionId: 'reject-once' } },
    });
  });

  it('surfaces structured ACP errors and rejects outstanding work on carrier close', async () => {
    const transport = new FakeDshAcpTransport();
    const transportErrors: Error[] = [];
    const client = new DshAcpClient({
      createTransport: () => transport,
      logger,
      onTransportError: (error) => transportErrors.push(error),
    });
    client.start();

    const listed = client.listSessions();
    const list = sent(transport);
    transport.emit({ jsonrpc: '2.0', id: list.id, error: { code: -32001, message: 'not ready', data: { retryable: true } } });
    await expect(listed).rejects.toMatchObject({
      name: 'DshAcpRequestError',
      method: 'session/list',
      code: -32001,
    } satisfies Partial<DshAcpRequestError>);

    const pending = client.prompt({ sessionId: 'runtime-session-1', prompt: [] });
    await transport.close('unexpected EOF');
    await expect(pending).rejects.toThrow('unexpected EOF');
    expect(transportErrors).toHaveLength(1);
  });

  it('fails closed when a prompt response has an unknown terminal reason', async () => {
    const transport = new FakeDshAcpTransport();
    const client = new DshAcpClient({ createTransport: () => transport, logger });
    client.start();

    const prompt = client.prompt({ sessionId: 'runtime-session-1', prompt: [{ type: 'text', text: 'hello' }] });
    const request = sent(transport);
    reply(transport, request, { stopReason: 'future_unreviewed_reason' });

    await expect(prompt).rejects.toThrow('unsupported stopReason');
  });

  it('fails initialize when the runtime omits a valid protocol version', async () => {
    const transport = new FakeDshAcpTransport();
    const client = new DshAcpClient({ createTransport: () => transport, logger });
    client.start();

    const initializing = client.initialize();
    const initialize = sent(transport);
    reply(transport, initialize, {
      protocolVersion: '1',
      agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' },
      agentCapabilities: {},
    });

    await expect(initializing).rejects.toThrow('omitted a valid protocolVersion');
    await expect(client.listSessions()).rejects.toThrow('transport is unavailable');
  });

  it('keeps protocol-failure transport cleanup awaitable after the client becomes closed', async () => {
    const transport = new FakeDshAcpTransport();
    const releaseClose = transport.pauseClose();
    const client = new DshAcpClient({ createTransport: () => transport, logger });
    client.start();

    const initializing = client.initialize();
    reply(transport, sent(transport), {
      protocolVersion: 'invalid',
      agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' },
      agentCapabilities: {},
    });
    await expect(initializing).rejects.toThrow('omitted a valid protocolVersion');

    let closeSettled = false;
    const closing = client.close('host waits for protocol cleanup').then(() => { closeSettled = true; });
    await Promise.resolve();
    expect(closeSettled).toBe(false);
    releaseClose();
    await expect(closing).resolves.toBeUndefined();
    expect(closeSettled).toBe(true);
  });

  it('fails closed for malformed JSON-RPC envelopes and unusable runtime session ids', async () => {
    const envelopeTransport = new FakeDshAcpTransport();
    const envelopeClient = new DshAcpClient({ createTransport: () => envelopeTransport, logger });
    envelopeClient.start();
    const pendingEnvelope = envelopeClient.listSessions();
    envelopeTransport.emit({ method: 'session/update', params: {} });
    await expect(pendingEnvelope).rejects.toThrow('required jsonrpc 2.0 version');
    await expect(envelopeClient.listSessions()).rejects.toThrow('transport is unavailable');

    const sessionTransport = new FakeDshAcpTransport();
    const sessionClient = new DshAcpClient({ createTransport: () => sessionTransport, logger });
    sessionClient.start();
    const creating = sessionClient.createSession({ cwd: '/safe/project' });
    reply(sessionTransport, sent(sessionTransport), { sessionId: 'runtime\nidentifier' });
    await expect(creating).rejects.toThrow('omitted a usable sessionId');
    await expect(sessionClient.listSessions()).rejects.toThrow('transport is unavailable');
  });

  it('fails closed before logging runtime-controlled JSON-RPC ids, methods, or error text with unsafe bounds', async () => {
    vi.clearAllMocks();
    const unsafeIdTransport = new FakeDshAcpTransport();
    const unsafeIdClient = new DshAcpClient({ createTransport: () => unsafeIdTransport, logger });
    unsafeIdClient.start();
    const pendingId = unsafeIdClient.listSessions();
    unsafeIdTransport.emit({ jsonrpc: '2.0', id: `unsafe\n${'x'.repeat(4_096)}`, result: {} });
    await expect(pendingId).rejects.toThrow('invalid JSON-RPC id');
    expect(logger.warn).not.toHaveBeenCalled();

    const unsafeMethodTransport = new FakeDshAcpTransport();
    const unsafeMethodClient = new DshAcpClient({ createTransport: () => unsafeMethodTransport, logger });
    unsafeMethodClient.start();
    const pendingMethod = unsafeMethodClient.listSessions();
    unsafeMethodTransport.emit({ jsonrpc: '2.0', method: 'session/update\r', params: {} });
    await expect(pendingMethod).rejects.toThrow('invalid JSON-RPC request or notification');
    expect(logger.error).not.toHaveBeenCalled();

    const unsafeErrorTransport = new FakeDshAcpTransport();
    const unsafeErrorClient = new DshAcpClient({ createTransport: () => unsafeErrorTransport, logger });
    unsafeErrorClient.start();
    const pendingError = unsafeErrorClient.listSessions();
    unsafeErrorTransport.emit({
      jsonrpc: '2.0',
      id: sent(unsafeErrorTransport).id,
      error: { code: -32000, message: `runtime\n${'x'.repeat(4_096)}` },
    });
    await expect(pendingError).rejects.toThrow('invalid JSON-RPC error');
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('fails closed without logging a malformed or unrecognized stdout frame', async () => {
    vi.clearAllMocks();
    const malformedTransport = new FakeDshAcpTransport();
    const malformedErrors: Error[] = [];
    const malformedClient = new DshAcpClient({
      createTransport: () => malformedTransport,
      logger,
      onTransportError: (error) => malformedErrors.push(error),
    });
    malformedClient.start();
    const malformedPending = malformedClient.listSessions();
    malformedTransport.emit('this is not JSON and must never be logged as runtime output');
    await expect(malformedPending).rejects.toThrow('stdout contained invalid JSON-RPC');
    expect(malformedErrors.map((error) => error.message)).toEqual(['DSH ACP stdout contained invalid JSON-RPC']);
    await expect(malformedClient.listSessions()).rejects.toThrow('transport is unavailable');

    const unknownTransport = new FakeDshAcpTransport();
    const unknownClient = new DshAcpClient({ createTransport: () => unknownTransport, logger });
    unknownClient.start();
    unknownTransport.emit({ jsonrpc: '2.0', unexpected: 'runtime content must not become a log preview' });
    await expect(unknownClient.listSessions()).rejects.toThrow('transport is unavailable');
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('serializes notification delivery, measures line limits in bytes, and exposes terminal carrier state', async () => {
    const transport = new FakeDshAcpTransport();
    const transportErrors: Error[] = [];
    const client = new DshAcpClient({
      createTransport: () => transport,
      logger,
      maxLineBytes: 256,
      onTransportError: (error) => transportErrors.push(error),
    });
    const delivery: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstDelivered = new Promise<void>((resolve) => { releaseFirst = resolve; });
    client.onNotification('session/update', async (params) => {
      delivery.push(`start:${(params as { ordinal: number }).ordinal}`);
      if ((params as { ordinal: number }).ordinal === 1) await firstDelivered;
      delivery.push(`end:${(params as { ordinal: number }).ordinal}`);
    });
    client.start();
    transport.emit({ jsonrpc: '2.0', method: 'session/update', params: { ordinal: 1 } });
    transport.emit({ jsonrpc: '2.0', method: 'session/update', params: { ordinal: 2 } });
    await vi.waitFor(() => expect(delivery).toEqual(['start:1']));
    releaseFirst?.();
    await vi.waitFor(() => expect(delivery).toEqual(['start:1', 'end:1', 'start:2', 'end:2']));

    const terminal: string[] = [];
    client.onTransportClose((reason) => terminal.push(reason));
    // Each non-ASCII character takes two bytes in UTF-8: this must trip the
    // byte guard even though the JavaScript string has only 129 code units.
    transport.emit('é'.repeat(129));
    await vi.waitFor(() => expect(terminal).toHaveLength(1));
    expect(terminal[0]).toContain('maxLineBytes');
    expect(transportErrors).toHaveLength(1);
  });

  it('bounds queued runtime notifications and in-flight server requests', async () => {
    const transport = new FakeDshAcpTransport();
    const client = new DshAcpClient({ createTransport: () => transport, logger });
    let releaseNotification: (() => void) | undefined;
    const notificationBarrier = new Promise<void>((resolve) => { releaseNotification = resolve; });
    client.onNotification('session/update', async () => notificationBarrier);
    client.start();

    for (let ordinal = 0; ordinal <= 64; ordinal += 1) {
      transport.emit({ jsonrpc: '2.0', method: 'session/update', params: { ordinal } });
    }
    await expect(client.listSessions()).rejects.toThrow('transport is unavailable');
    releaseNotification?.();

    const requestTransport = new FakeDshAcpTransport();
    const requestClient = new DshAcpClient({ createTransport: () => requestTransport, logger });
    const requestBarrier = new Promise<never>(() => undefined);
    requestClient.onServerRequest('session/request_permission', async () => requestBarrier);
    requestClient.start();
    for (let id = 0; id <= 16; id += 1) {
      requestTransport.emit({ jsonrpc: '2.0', id, method: 'session/request_permission', params: {} });
    }
    await expect(requestClient.listSessions()).rejects.toThrow('transport is unavailable');
  });

  it('rejects oversized outbound ACP frames and suppresses repeated unknown-response logs', async () => {
    vi.clearAllMocks();
    const transport = new FakeDshAcpTransport();
    const client = new DshAcpClient({ createTransport: () => transport, logger, maxLineBytes: 64 });
    client.start();
    await expect(client.request('session/list', { payload: 'é'.repeat(64) }))
      .rejects.toThrow('outbound NDJSON line exceeds maxLineBytes');
    expect(transport.writes).toEqual([]);

    for (let id = 0; id < 5; id += 1) {
      transport.emit({ jsonrpc: '2.0', id, result: {} });
    }
    expect(logger.warn).toHaveBeenCalledTimes(4);
    expect(logger.warn).toHaveBeenLastCalledWith('unknown ACP response logging suppressed after three responses');
  });
});
