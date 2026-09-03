import type { Logger } from '../../interfaces/logger.js';
import type { DshAcpTransport } from './transport.js';

const DEFAULT_MAX_LINE_BYTES = 16 * 1024 * 1024;
const MAX_SESSION_ID_LENGTH = 4 * 1024;
const MAX_PROTOCOL_ID_LENGTH = 4 * 1024;
const MAX_PROTOCOL_METHOD_LENGTH = 256;
const MAX_PROTOCOL_ERROR_MESSAGE_LENGTH = 4 * 1024;
const MAX_QUEUED_NOTIFICATION_DISPATCHES = 64;
const MAX_IN_FLIGHT_SERVER_REQUESTS = 16;
const MAX_UNKNOWN_RESPONSE_WARNINGS = 3;

export class DshAcpRequestError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: number,
    message: string,
    public readonly data: unknown,
  ) {
    super(`DSH ACP ${method} error ${code}: ${message}`);
    this.name = 'DshAcpRequestError';
  }
}

export class DshAcpRequestTimeoutError extends Error {
  constructor(public readonly method: string, public readonly timeoutMs: number) {
    super(`DSH ACP ${method} timed out after ${timeoutMs}ms`);
    this.name = 'DshAcpRequestTimeoutError';
  }
}

export interface DshAcpInitializeResult {
  protocolVersion: number;
  agentInfo: { name: string; version: string };
  agentCapabilities: {
    sessionCapabilities?: Partial<Record<'close' | 'list' | 'resume', object>>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** ACP v1 prompt termination values Cindy can safely project before F4 event translation exists. */
export interface DshAcpPromptResult {
  stopReason: 'end_turn' | 'cancelled';
}

export interface DshAcpClientOptions {
  createTransport: () => DshAcpTransport;
  logger: Logger;
  maxLineBytes?: number;
  onTransportError?: (error: Error) => void;
}

/** The narrow runtime-facing portion a Cindy-owned Main bridge may depend on. */
export interface DshAcpSessionClient {
  start(): void;
  initialize(protocolVersion?: number): Promise<DshAcpInitializeResult>;
  createSession(input: { cwd: string; mcpServers?: readonly unknown[] }): Promise<{ sessionId: string }>;
  listSessions(): Promise<unknown>;
  resumeSession(input: { sessionId: string; cwd: string }): Promise<unknown>;
  prompt(input: { sessionId: string; prompt: readonly unknown[] }): Promise<DshAcpPromptResult>;
  cancel(sessionId: string): Promise<void>;
  closeSession(sessionId: string): Promise<unknown>;
  onNotification(method: string, handler: DshAcpNotificationHandler): void;
  onServerRequest(method: string, handler: DshAcpServerRequestHandler): void;
  onTransportClose(handler: DshAcpTransportCloseHandler): () => void;
  close(reason?: string): Promise<void>;
}

export type DshAcpNotificationHandler = (params: unknown) => void | Promise<void>;
export type DshAcpTransportCloseHandler = (reason: string) => void;
export type DshAcpServerRequestHandler = (
  params: unknown,
  meta: { id: number | string; method: string },
) => Promise<unknown>;

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSafeProtocolString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && ![...value].some((character) => {
      const code = character.codePointAt(0);
      return code === undefined || code <= 0x1f || code === 0x7f;
    });
}

function isAcpId(value: unknown): value is string | number {
  return isSafeProtocolString(value, MAX_PROTOCOL_ID_LENGTH)
    || (typeof value === 'number' && Number.isSafeInteger(value));
}

function isAcpMethod(value: unknown): value is string {
  return isSafeProtocolString(value, MAX_PROTOCOL_METHOD_LENGTH);
}

function isUsableSessionId(value: unknown): value is string {
  return isSafeProtocolString(value, MAX_SESSION_ID_LENGTH);
}

/**
 * ACP v1 client that consumes an already-authorized DshAcpTransport.
 *
 * It intentionally knows no child-process, filesystem, credential, or Desktop IPC details. The
 * host owns those boundaries; this class only gives the host a strict request correlation and a
 * server-request reply path for protocol interactions such as permission requests.
 */
export class DshAcpClient implements DshAcpSessionClient {
  private readonly transportFactory: () => DshAcpTransport;
  private readonly logger: Logger;
  private readonly maxLineBytes: number;
  private readonly onTransportError?: (error: Error) => void;
  private transport: DshAcpTransport | null = null;
  private started = false;
  private closed = false;
  private nextId = 1;
  private readonly pending = new Map<number | string, PendingRequest>();
  private readonly notifications = new Map<string, DshAcpNotificationHandler>();
  private readonly serverRequests = new Map<string, DshAcpServerRequestHandler>();
  private readonly transportCloseHandlers = new Set<DshAcpTransportCloseHandler>();
  private notificationChain: Promise<void> = Promise.resolve();
  private queuedNotificationDispatches = 0;
  private inFlightServerRequests = 0;
  private unknownResponseWarnings = 0;
  private terminalReason: string | null = null;
  /** A protocol failure can start physical transport cleanup before a host asks to close. */
  private closeAttempt: Promise<void> | null = null;

  constructor(options: DshAcpClientOptions) {
    this.transportFactory = options.createTransport;
    this.logger = options.logger.child('dsh-acp');
    this.maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
    if (!Number.isSafeInteger(this.maxLineBytes) || this.maxLineBytes <= 0) {
      throw new Error('DshAcpClient: maxLineBytes must be a positive safe integer');
    }
    this.onTransportError = options.onTransportError;
  }

  start(): void {
    if (this.started) throw new Error('DshAcpClient: already started');
    if (this.closed) throw new Error('DshAcpClient: cannot start after close()');
    const transport = this.transportFactory();
    this.transport = transport;
    this.started = true;
    transport.onLine((line) => this.handleLine(line));
    transport.onClose(({ reason }) => this.handleClose(reason));
  }

  async initialize(protocolVersion = 1): Promise<DshAcpInitializeResult> {
    const result = await this.request<unknown>('initialize', {
      protocolVersion,
      clientCapabilities: {},
    });
    if (!isRecord(result)) this.protocolViolation('DSH ACP initialize returned an invalid result');
    const agentInfo = result.agentInfo;
    if (!isRecord(agentInfo) || typeof agentInfo.name !== 'string' || typeof agentInfo.version !== 'string') {
      this.protocolViolation('DSH ACP initialize omitted a valid agentInfo');
    }
    const negotiatedProtocolVersion = result.protocolVersion;
    if (typeof negotiatedProtocolVersion !== 'number' || !Number.isSafeInteger(negotiatedProtocolVersion) || negotiatedProtocolVersion <= 0) {
      this.protocolViolation('DSH ACP initialize omitted a valid protocolVersion');
    }
    const agentCapabilities = result.agentCapabilities;
    if (!isRecord(agentCapabilities)) {
      this.protocolViolation('DSH ACP initialize omitted agentCapabilities');
    }
    return {
      ...result,
      protocolVersion: negotiatedProtocolVersion,
      agentInfo: { name: agentInfo.name, version: agentInfo.version },
      agentCapabilities: agentCapabilities as DshAcpInitializeResult['agentCapabilities'],
    };
  }

  async createSession(input: { cwd: string; mcpServers?: readonly unknown[] }): Promise<{ sessionId: string }> {
    const result = await this.request<unknown>('session/new', {
      cwd: input.cwd,
      mcpServers: input.mcpServers ?? [],
    });
    if (!isRecord(result) || !isUsableSessionId(result.sessionId)) {
      this.protocolViolation('DSH ACP session/new omitted a usable sessionId');
    }
    return { sessionId: result.sessionId };
  }

  listSessions(): Promise<unknown> {
    return this.request('session/list', {});
  }

  resumeSession(input: { sessionId: string; cwd: string }): Promise<unknown> {
    return this.request('session/resume', input);
  }

  async prompt(input: { sessionId: string; prompt: readonly unknown[] }): Promise<DshAcpPromptResult> {
    const result = await this.request<unknown>('session/prompt', input);
    if (!isRecord(result) || (result.stopReason !== 'end_turn' && result.stopReason !== 'cancelled')) {
      this.protocolViolation('DSH ACP session/prompt returned an unsupported stopReason');
    }
    return { stopReason: result.stopReason };
  }

  cancel(sessionId: string): Promise<void> {
    return this.notify('session/cancel', { sessionId });
  }

  closeSession(sessionId: string): Promise<unknown> {
    return this.request('session/close', { sessionId });
  }

  onNotification(method: string, handler: DshAcpNotificationHandler): void {
    if (!isAcpMethod(method)) throw new Error('DshAcpClient.onNotification(): invalid ACP method');
    this.notifications.set(method, handler);
  }

  onTransportClose(handler: DshAcpTransportCloseHandler): () => void {
    if (this.terminalReason !== null) {
      handler(this.terminalReason);
      return () => undefined;
    }
    this.transportCloseHandlers.add(handler);
    return () => this.transportCloseHandlers.delete(handler);
  }

  onServerRequest(method: string, handler: DshAcpServerRequestHandler): void {
    if (!isAcpMethod(method)) throw new Error('DshAcpClient.onServerRequest(): invalid ACP method');
    this.serverRequests.set(method, handler);
  }

  request<Result = unknown>(method: string, params?: unknown, options?: { timeoutMs?: number }): Promise<Result> {
    if (!isAcpMethod(method)) {
      return Promise.reject(new Error('DshAcpClient.request(): invalid ACP method'));
    }
    if (!this.transport || this.closed) {
      return Promise.reject(new Error(`DshAcpClient.request(${method}): transport is unavailable`));
    }
    const timeoutMs = options?.timeoutMs;
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
      return Promise.reject(new Error(`DshAcpClient.request(${method}): timeoutMs must be positive`));
    }
    const id = this.nextId++;
    let payload: string;
    try {
      payload = this.stringifyOutboundFrame({ jsonrpc: '2.0', id, method, params });
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise<Result>((resolve, reject) => {
      const pending: PendingRequest = { method, resolve: resolve as (value: unknown) => void, reject, timeout: null };
      this.pending.set(id, pending);
      if (timeoutMs !== undefined) {
        pending.timeout = setTimeout(() => {
          if (this.pending.get(id) !== pending) return;
          this.pending.delete(id);
          reject(new DshAcpRequestTimeoutError(method, timeoutMs));
        }, timeoutMs);
        pending.timeout.unref?.();
      }
      this.transport?.writeLine(payload).catch((error: Error) => {
        if (this.pending.get(id) !== pending) return;
        this.pending.delete(id);
        if (pending.timeout) clearTimeout(pending.timeout);
        reject(error);
      });
    });
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (!isAcpMethod(method)) throw new Error('DshAcpClient.notify(): invalid ACP method');
    if (!this.transport || this.closed) throw new Error(`DshAcpClient.notify(${method}): transport is unavailable`);
    await this.transport.writeLine(this.stringifyOutboundFrame({ jsonrpc: '2.0', method, params }));
  }

  async close(reason = 'DshAcpClient.close()'): Promise<void> {
    if (this.closeAttempt) return this.closeAttempt;
    if (this.closed) return;
    this.closed = true;
    this.rejectPending(new Error(`DSH ACP transport closed: ${reason}`));
    this.notifyTransportClose(reason);
    await this.beginTransportClose(reason);
  }

  private handleLine(line: string): void {
    const lineBytes = Buffer.byteLength(line, 'utf8');
    if (lineBytes > this.maxLineBytes) {
      this.fail(new Error(`DSH ACP NDJSON line exceeds maxLineBytes (${lineBytes} > ${this.maxLineBytes})`));
      return;
    }
    let message: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) throw new Error('message is not an object');
      message = parsed;
    } catch {
      // Child stdout is an untrusted protocol carrier. A malformed frame is
      // not a recoverable log line: retaining the carrier would permit an
      // ambiguous runtime state, while logging its contents risks exposing
      // provider/user data.
      this.fail(new Error('DSH ACP stdout contained invalid JSON-RPC'));
      return;
    }
    if (message.jsonrpc !== '2.0') {
      this.fail(new Error('DSH ACP message omitted the required jsonrpc 2.0 version'));
      return;
    }
    const hasId = Object.hasOwn(message, 'id');
    const hasMethod = Object.hasOwn(message, 'method');
    const hasResult = Object.hasOwn(message, 'result');
    const hasError = Object.hasOwn(message, 'error');
    let id: string | number | undefined;
    if (hasId) {
      if (!isAcpId(message.id)) {
        this.fail(new Error('DSH ACP message has an invalid JSON-RPC id'));
        return;
      }
      id = message.id;
    }
    if (hasMethod) {
      const method = message.method;
      if (!isAcpMethod(method) || hasResult || hasError) {
        this.fail(new Error('DSH ACP stdout contained an invalid JSON-RPC request or notification'));
        return;
      }
      if (id !== undefined) {
        if (this.inFlightServerRequests >= MAX_IN_FLIGHT_SERVER_REQUESTS) {
          this.fail(new Error(`DSH ACP exceeded ${MAX_IN_FLIGHT_SERVER_REQUESTS} in-flight server requests`));
          return;
        }
        this.inFlightServerRequests += 1;
        void this.dispatchServerRequest(id, method, message.params).finally(() => {
          this.inFlightServerRequests -= 1;
        });
        return;
      }
      // Runtime updates must retain wire order through the Main bridge. Queue
      // notifications rather than launching independent async handlers.
      if (this.queuedNotificationDispatches >= MAX_QUEUED_NOTIFICATION_DISPATCHES) {
        this.fail(new Error(`DSH ACP exceeded ${MAX_QUEUED_NOTIFICATION_DISPATCHES} queued notifications`));
        return;
      }
      this.queuedNotificationDispatches += 1;
      this.notificationChain = this.notificationChain
        .then(() => this.dispatchNotification(method, message.params))
        .finally(() => { this.queuedNotificationDispatches -= 1; });
      return;
    }
    if (id === undefined || hasResult === hasError) {
      this.fail(new Error('DSH ACP stdout contained an unrecognized JSON-RPC message'));
      return;
    }
    if (hasError) {
      const error = message.error;
      if (!isRecord(error) || !Number.isSafeInteger(error.code) || !isSafeProtocolString(error.message, MAX_PROTOCOL_ERROR_MESSAGE_LENGTH)) {
        this.fail(new Error('DSH ACP response contained an invalid JSON-RPC error'));
        return;
      }
      this.dispatchResponse(id, undefined, error);
      return;
    }
    this.dispatchResponse(id, message.result, null);
  }

  private dispatchResponse(id: number | string, result: unknown, error: Record<string, unknown> | null): void {
    const pending = this.pending.get(id);
    if (!pending) {
      if (this.unknownResponseWarnings < MAX_UNKNOWN_RESPONSE_WARNINGS) {
        this.unknownResponseWarnings += 1;
        this.logger.warn('response for unknown ACP request id');
      } else if (this.unknownResponseWarnings === MAX_UNKNOWN_RESPONSE_WARNINGS) {
        this.unknownResponseWarnings += 1;
        this.logger.warn('unknown ACP response logging suppressed after three responses');
      }
      return;
    }
    this.pending.delete(id);
    if (pending.timeout) clearTimeout(pending.timeout);
    if (error) {
      const code = typeof error.code === 'number' ? error.code : -32603;
      pending.reject(new DshAcpRequestError(pending.method, code, typeof error.message === 'string' ? error.message : 'unknown error', error.data));
      return;
    }
    pending.resolve(result);
  }

  private async dispatchNotification(method: string, params: unknown): Promise<void> {
    const handler = this.notifications.get(method);
    if (!handler) return;
    try {
      await handler(params);
    } catch (error) {
      this.logger.error('ACP notification handler failed', { method, message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async dispatchServerRequest(id: number | string, method: string, params: unknown): Promise<void> {
    const handler = this.serverRequests.get(method);
    if (!handler) {
      await this.respondError(id, -32601, 'no DSH ACP handler for requested method');
      return;
    }
    try {
      await this.respondResult(id, await handler(params, { id, method }));
    } catch {
      await this.respondError(id, -32603, 'DSH ACP server request failed');
    }
  }

  private respondResult(id: number | string, result: unknown): Promise<void> {
    return this.writeResponse({ jsonrpc: '2.0', id, result: result ?? {} });
  }

  private respondError(id: number | string, code: number, message: string): Promise<void> {
    return this.writeResponse({ jsonrpc: '2.0', id, error: { code, message } });
  }

  private async writeResponse(payload: Record<string, unknown>): Promise<void> {
    if (!this.transport || this.closed) return;
    try {
      await this.transport.writeLine(this.stringifyOutboundFrame(payload));
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleClose(reason: string): void {
    if (this.closed) return;
    this.fail(new Error(`DSH ACP transport closed: ${reason}`));
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectPending(error);
    this.notifyTransportClose(error.message);
    // Protocol failure must not leave a privileged host carrier alive. Calling close is safe:
    // the resulting onClose callback sees closed=true and becomes a no-op.
    void this.beginTransportClose(`protocol failure: ${error.message}`).catch((closeError: unknown) => {
      this.logger.warn('DSH ACP transport close after protocol failure failed', {
        message: closeError instanceof Error ? closeError.message : String(closeError),
      });
    });
    try {
      this.onTransportError?.(error);
    } catch (callbackError) {
      this.logger.error('DSH ACP transport error handler failed', { message: callbackError instanceof Error ? callbackError.message : String(callbackError) });
    }
  }

  private protocolViolation(message: string): never {
    const error = new Error(message);
    this.fail(error);
    throw error;
  }

  private beginTransportClose(reason: string): Promise<void> {
    if (!this.closeAttempt) {
      this.closeAttempt = this.transport ? this.transport.close(reason) : Promise.resolve();
    }
    return this.closeAttempt;
  }

  private stringifyOutboundFrame(payload: Record<string, unknown>): string {
    const line = JSON.stringify(payload);
    const bytes = Buffer.byteLength(line, 'utf8');
    if (bytes > this.maxLineBytes) {
      throw new Error(`DSH ACP outbound NDJSON line exceeds maxLineBytes (${bytes} > ${this.maxLineBytes})`);
    }
    // JSON.stringify escapes literal CR/LF in string fields. Retain an
    // explicit final guard so a future serializer change cannot create two
    // protocol records through one writeLine call.
    if (line.includes('\n') || line.includes('\r')) {
      throw new Error('DSH ACP outbound NDJSON line contains a record delimiter');
    }
    return line;
  }

  private notifyTransportClose(reason: string): void {
    if (this.terminalReason !== null) return;
    this.terminalReason = reason;
    for (const handler of this.transportCloseHandlers) {
      try {
        handler(reason);
      } catch (error) {
        this.logger.error('DSH ACP transport close handler failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
