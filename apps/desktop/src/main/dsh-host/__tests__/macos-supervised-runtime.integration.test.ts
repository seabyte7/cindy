/**
 * Opt-in release evidence only. CI has no signed DSH Helper.app, so this stays
 * skipped until a local macOS evidence run supplies that exact test App and
 * its owning user's home directory. It never falls back to a PATH runtime.
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createConsoleLogger,
  DshAgent,
  Maker,
  type AgentDeps,
  type SessionMeta,
  type SessionStorage,
} from '@cindy/maker-core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

import type { DbClient } from '../../localDb/client/DbClient.js';
import { createDshActivitySnapshotStore } from '../../localDb/dshActivitySnapshots.js';
import { createDshProjectionJournal } from '../../localDb/dshProjectionJournal.js';
import { createDshPromptReceiptStore } from '../../localDb/dshPromptReceipts.js';
import { createDshSessionBindingStore } from '../../localDb/dshSessionBindings.js';
import type { DshPromptReceiptStore } from '../../localDb/dshPromptReceipts.js';
import type { DshProjectionJournal } from '../../localDb/dshProjectionJournal.js';
import * as schema from '../../localDb/schema.js';
import { tx as runDbTx } from '../../localDb/worker/opHandlers/tx.js';
import { createDshActivityControlService } from '../../maker-host/dsh-activity-control.js';
import { dshActivityMutationGate } from '../../maker-host/dsh-session-activity.js';
import { createDshHostScopeId } from '../scope.js';
import {
  createMacosSupervisedDshHostManager,
  resolveMacosSupervisedDshRuntime,
} from '../macos-supervised-runtime.js';
import { startMacosSupervisedDshBridge } from '../macos-supervised-bridge.js';
import { createLoopbackE2eDshProviderRoute } from '../provider-route.js';
import { createDshInternalMcpLeaseFactory } from '../internal-mcp-lease.js';
import { loadMacosDshMainBookmarkBridge, createDshWorkspaceBookmarkHandoff } from '../main-bookmark-bridge.js';
import { createDshSessionCwdAdmission } from '../session-cwd-admission.js';
import { createDshTaskBridgeRouter } from '../task-bridge-router.js';

const appPath = process.env.CINDY_DSH_E2E_APP;
const homePath = process.env.CINDY_DSH_E2E_HOME;
const releaseId = process.env.CINDY_DSH_E2E_RELEASE_ID;
const runtimeEvidence = appPath && homePath && releaseId ? { appPath, homePath, releaseId } : null;
const describeRuntime = runtimeEvidence ? describe : describe.skip;
const describePromptRuntime =
  runtimeEvidence && process.env.CINDY_DSH_E2E_PROMPT === '1' ? describe : describe.skip;
const LOOPBACK_PROVIDER_API_KEY = 'cindy-dsh-supervised-e2e-fixture';

const unusedPromptReceiptStore: DshPromptReceiptStore = {
  recordPending: async () => {
    throw new Error('unexpected DSH prompt in lifecycle evidence');
  },
  acknowledge: async () => {
    throw new Error('unexpected DSH prompt acknowledgement in lifecycle evidence');
  },
  markUncertain: async () => {
    throw new Error('unexpected DSH prompt uncertainty in lifecycle evidence');
  },
  hasUnresolved: async () => false,
};

const unusedProjectionJournal: DshProjectionJournal = {
  commit: async () => {
    throw new Error('unexpected DSH follow projection in lifecycle evidence');
  },
  reject: async () => {
    throw new Error('unexpected DSH follow rejection in lifecycle evidence');
  },
};

interface LoopbackProvider {
  baseUrl: string;
  acceptedRequestCount(): number;
  /** Counts only fixture outcomes; never exposes route, headers, or request bodies. */
  diagnosticCounts(): Readonly<{
    accepted: number;
    unexpected: number;
    unauthorized: number;
    malformed: number;
    /** Method + pathname only, capped and local-fixture-only. */
    lastUnexpectedShape: string | null;
    /** Sorted top-level JSON field names only; no values leave the fixture. */
    lastUnexpectedBodyKeys: readonly string[];
  }>;
  close(): Promise<void>;
}

interface LoopbackProviderOptions {
  /** Leave only the second completion response open for session/cancel proof. */
  keepSecondResponseOpen?: boolean;
  /**
   * Make the first provider completion invoke one real DSH tool.  The second
   * request is the model's post-tool continuation.  This stays local-only:
   * callers must provide a harmless command and the fixture never records a
   * request body or authorization value.
   */
  toolCall?: Readonly<{
    arguments: Readonly<Record<string, unknown>>;
    finalText: string;
  }>;
}

async function createLoopbackProvider(
  options: LoopbackProviderOptions = {},
): Promise<LoopbackProvider> {
  let acceptedRequests = 0;
  let unexpectedRequests = 0;
  let unauthorizedRequests = 0;
  let malformedRequests = 0;
  let lastUnexpectedShape: string | null = null;
  let lastUnexpectedBodyKeys: readonly string[] = [];
  const openResponses = new Set<import('node:http').ServerResponse>();
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch {
        malformedRequests += 1;
        response.writeHead(400).end();
        return;
      }
      // DSH's sealed alpha3 DeepSeek adapter treats `baseURL` as the API
      // origin and appends its fixed `/chat/completions` operation. Keep this
      // exact path in the fixture: accepting arbitrary suffixes would turn an
      // endpoint-contract regression into a false positive.
      const pathname = new URL(request.url ?? '/', 'http://loopback.invalid').pathname;
      if (request.method !== 'POST' || pathname !== '/chat/completions') {
        unexpectedRequests += 1;
        // This has no host, query, header, or body value. It exists only to
        // diagnose the fixed local fixture's protocol surface.
        lastUnexpectedShape = `${request.method ?? 'UNKNOWN'} ${pathname}`.slice(0, 160);
        lastUnexpectedBodyKeys =
          body && typeof body === 'object' && !Array.isArray(body)
            ? Object.keys(body).sort().slice(0, 32)
            : [];
        response.writeHead(404).end();
        return;
      }
      if (request.headers.authorization !== `Bearer ${LOOPBACK_PROVIDER_API_KEY}`) {
        unauthorizedRequests += 1;
        response.writeHead(401).end();
        return;
      }
      acceptedRequests += 1;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      openResponses.add(response);
      response.once('close', () => {
        openResponses.delete(response);
      });
      if (options.toolCall) {
        if (acceptedRequests === 1) {
          const argumentsText = JSON.stringify(options.toolCall.arguments);
          const midpoint = Math.max(1, Math.floor(argumentsText.length / 2));
          response.end(
            [
              `data: ${JSON.stringify({ choices: [{
                delta: {
                  tool_calls: [{
                    index: 0,
                    id: 'cindy-dsh-supervised-e2e-tool-call',
                    type: 'function',
                    function: { name: 'bash', arguments: argumentsText.slice(0, midpoint) },
                  }],
                },
                index: 0,
                finish_reason: null,
              }] })}`,
              `data: ${JSON.stringify({ choices: [{
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: argumentsText.slice(midpoint) } }],
                },
                index: 0,
                finish_reason: null,
              }] })}`,
              `data: ${JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }] })}`,
              'data: [DONE]',
              '',
            ].join('\n\n'),
          );
          return;
        }
        response.end(
          [
            `data: ${JSON.stringify({ choices: [{
              delta: { role: 'assistant', content: options.toolCall.finalText },
              index: 0,
              finish_reason: null,
            }] })}`,
            `data: ${JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] })}`,
            'data: [DONE]',
            '',
          ].join('\n\n'),
        );
        return;
      }
      if (options.keepSecondResponseOpen && acceptedRequests === 2) {
        // This exact response is completed only by the runtime's public
        // session/cancel path (or the fixture teardown), never by a timeout.
        response.write(
          'data: {"choices":[{"delta":{"role":"assistant","content":"CINDY_DSH_SUPERVISED_E2E_CANCEL_WAIT"},"index":0,"finish_reason":null}]}\n\n',
        );
        return;
      }
      response.end(
        [
          'data: {"choices":[{"delta":{"role":"assistant","content":"CINDY_DSH_SUPERVISED_E2E_FOLLOW"},"index":0,"finish_reason":null}]}',
          'data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}',
          'data: [DONE]',
          '',
        ].join('\n\n'),
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('supervised DSH E2E loopback provider has no TCP port');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    acceptedRequestCount: () => acceptedRequests,
    diagnosticCounts: () => ({
      accepted: acceptedRequests,
      unexpected: unexpectedRequests,
      unauthorized: unauthorizedRequests,
      malformed: malformedRequests,
      lastUnexpectedShape,
      lastUnexpectedBodyKeys,
    }),
    async close(): Promise<void> {
      for (const response of openResponses) response.end();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    },
  };
}

interface InternalMcpFixture {
  readonly factory: ReturnType<typeof createDshInternalMcpLeaseFactory>;
  initializedRequestCount(): number;
  toolsListRequestCount(): number;
  activeEndpointCount(): number;
  registrationCloseCount(): number;
  diagnosticCounts(): Readonly<{ unexpected: number; unauthorized: number; malformed: number }>;
  close(): Promise<void>;
}

async function readMcpRequestBody(request: import('node:http').IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * A local-only, Main-injected Streamable HTTP service. It exposes no route,
 * token, request body, or tool output to test diagnostics. The exact bearer
 * token remains only in the factory closure and the supervised DSH child.
 */
async function createInternalMcpFixture(): Promise<InternalMcpFixture> {
  let initializedRequests = 0;
  let toolsListRequests = 0;
  let unexpectedRequests = 0;
  let unauthorizedRequests = 0;
  let malformedRequests = 0;
  let registrationCloses = 0;
  const endpoints = new Map<string, { token: string }>();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const endpoint = endpoints.get(url.pathname);
    if (!endpoint) {
      unexpectedRequests += 1;
      response.writeHead(404).end();
      return;
    }
    if (request.headers.authorization !== `Bearer ${endpoint.token}`) {
      unauthorizedRequests += 1;
      response.writeHead(401).end();
      return;
    }
    let body: unknown;
    try {
      const source = await readMcpRequestBody(request);
      body = source ? JSON.parse(source) : undefined;
    } catch {
      malformedRequests += 1;
      response.writeHead(400).end();
      return;
    }
    const method = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { method?: unknown }).method
      : undefined;
    if (method === 'initialize') initializedRequests += 1;
    if (method === 'tools/list') toolsListRequests += 1;

    const mcp = new McpServer({ name: 'cindy_dsh_fixture', version: '0.0.0' });
    mcp.registerTool(
      'cindy_dsh_fixture_status',
      { description: 'Local DSH MCP fixture health check' },
      async () => ({ content: [{ type: 'text', text: 'READY' }] }),
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.once('close', () => {
      void transport.close();
      void mcp.close();
    });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('internal DSH MCP fixture has no loopback TCP port');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const factory = createDshInternalMcpLeaseFactory([{
    name: 'cindy_dsh_fixture',
    policy: { kind: 'loopback-http', pathnamePrefix: '/dsh-mcp' },
    register: async ({ sessionInstanceId, token }) => {
      const pathname = `/dsh-mcp/${encodeURIComponent(sessionInstanceId)}`;
      if (endpoints.has(pathname)) throw new Error('internal DSH MCP fixture lease collision');
      endpoints.set(pathname, { token });
      return {
        url: `${baseUrl}${pathname}`,
        close: async () => {
          endpoints.delete(pathname);
          registrationCloses += 1;
        },
      };
    },
  }]);
  return {
    factory,
    initializedRequestCount: () => initializedRequests,
    toolsListRequestCount: () => toolsListRequests,
    activeEndpointCount: () => endpoints.size,
    registrationCloseCount: () => registrationCloses,
    diagnosticCounts: () => ({
      unexpected: unexpectedRequests,
      unauthorized: unauthorizedRequests,
      malformed: malformedRequests,
    }),
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    },
  };
}

function createPromptPersistence(cindySessionId: string, options: { seedParent?: boolean } = {}): {
  rawDb: Database.Database;
  activitySnapshotStore: ReturnType<typeof createDshActivitySnapshotStore>;
  bindingStore: ReturnType<typeof createDshSessionBindingStore>;
  promptReceiptStore: ReturnType<typeof createDshPromptReceiptStore>;
  projectionJournal: ReturnType<typeof createDshProjectionJournal>;
} {
  const rawDb = new Database(':memory:');
  rawDb.pragma('foreign_keys = ON');
  rawDb.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY);
    CREATE TABLE dsh_session_bindings (
      cindy_session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
      runtime_session_id TEXT NOT NULL,
      host_scope_id TEXT NOT NULL,
      runtime_release_id TEXT NOT NULL,
      runtime_version TEXT NOT NULL,
      controller_api_version INTEGER NOT NULL,
      capability_fingerprint TEXT NOT NULL,
      home_mode TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL DEFAULT 'active',
      last_projected_sequence INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX uniq_dsh_bindings_scope_runtime
      ON dsh_session_bindings (host_scope_id, runtime_session_id);
    CREATE INDEX idx_dsh_bindings_scope_lifecycle
      ON dsh_session_bindings (host_scope_id, lifecycle_state);
    CREATE TABLE dsh_activity_snapshots (
      cindy_session_id TEXT PRIMARY KEY NOT NULL REFERENCES dsh_session_bindings(cindy_session_id) ON DELETE RESTRICT,
      host_scope_id TEXT NOT NULL,
      activity_json TEXT NOT NULL,
      activity_sha256 TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_dsh_activity_snapshots_scope_sequence
      ON dsh_activity_snapshots (host_scope_id, sequence);
    CREATE TABLE dsh_projection_events (
      cindy_session_id TEXT NOT NULL REFERENCES dsh_session_bindings(cindy_session_id) ON DELETE RESTRICT,
      sequence INTEGER NOT NULL,
      event_json TEXT NOT NULL,
      event_sha256 TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (cindy_session_id, sequence)
    );
    CREATE TABLE dsh_prompt_receipts (
      receipt_id TEXT PRIMARY KEY NOT NULL,
      cindy_session_id TEXT NOT NULL REFERENCES dsh_session_bindings(cindy_session_id) ON DELETE RESTRICT,
      state TEXT NOT NULL DEFAULT 'pending',
      stop_reason TEXT,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    );
    CREATE INDEX idx_dsh_prompt_receipts_session_state_created
      ON dsh_prompt_receipts (cindy_session_id, state, created_at);
  `);
  if (options.seedParent !== false) {
    rawDb.prepare('INSERT INTO sessions (id) VALUES (?)').run(cindySessionId);
  }
  const client = {
    drizzle: drizzle(rawDb, { schema }),
    tx: async (name: string, args: unknown) => runDbTx(rawDb, { name, args }),
  } as unknown as Pick<DbClient, 'drizzle' | 'tx'>;
  return {
    rawDb,
    activitySnapshotStore: createDshActivitySnapshotStore(client),
    bindingStore: createDshSessionBindingStore(client),
    promptReceiptStore: createDshPromptReceiptStore(client),
    projectionJournal: createDshProjectionJournal(client),
  };
}

/**
 * Most direct bridge fixtures pre-create only the foreign-key parent. Product
 * Maker evidence can opt out and exercise the production reservation ordering
 * instead; this storage is deliberately memory-only and contains no native
 * identity.
 */
function createMakerSessionStorage(): SessionStorage {
  const rows = new Map<string, SessionMeta>();
  return {
    async create(meta) {
      const now = Date.now();
      const row = { ...meta, createdAt: now, updatedAt: now };
      rows.set(row.id, row);
      return row;
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async update(id, patch) {
      const current = rows.get(id);
      if (!current) throw new Error(`missing Maker E2E session ${id}`);
      const next = { ...current, ...patch, updatedAt: Date.now() };
      rows.set(id, next);
      return next;
    },
    async compareAndClearSdkSessionId(id, expectedSdkSessionId) {
      const current = rows.get(id);
      if (!current || current.sdkSessionId !== expectedSdkSessionId) return false;
      rows.set(id, { ...current, sdkSessionId: undefined, updatedAt: Date.now() });
      return true;
    },
    async delete(id) {
      rows.delete(id);
    },
  };
}

function dshAgentDeps(binaryPath: string): AgentDeps {
  return {
    binaryPath,
    logger: createConsoleLogger('dsh-macos-supervised-maker-e2e'),
    runtimeConfig: {},
    auth: {
      getState: async () => ({ authenticated: false }),
      triggerLogin: async () => ({ authenticated: false }),
      logout: async () => undefined,
      getAuthEnv: async () => ({}),
    },
  };
}

describeRuntime('packaged macOS supervised DSH host integration', () => {
  it('routes an actual Main-issued workspace bookmark through admission and fd 4 on create and resume', async () => {
    const evidence = runtimeEvidence!;
    const resourcesPath = join(evidence.appPath, 'Contents', 'Resources');
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'cindy-dsh-external-workspace-')));
    const cindySessionId = `workspace-e2e-${process.pid}-${Date.now()}`;
    const scopeInput = {
      accountId: cindySessionId, releaseId: evidence.releaseId,
      homeMode: 'cindy-managed' as const, taskScopeId: cindySessionId,
    };
    const layout = resolveMacosSupervisedDshRuntime({ resourcesPath, homePath: evidence.homePath });
    const managedScopeRoot = join(layout.helperContainerDataPath, 'dsh-agent-home', createDshHostScopeId(scopeInput).scopeId);
    const persistence = createPromptPersistence(cindySessionId);
    const native = loadMacosDshMainBookmarkBridge({ resourcesPath });
    const admission = createDshSessionCwdAdmission();
    const router = createDshTaskBridgeRouter({
      claimWorkspaceBookmark: admission.consumeWorkspaceBookmark,
      startTaskBridge: async ({ cindySessionId: requestedTask, cwd: requestedCwd, workspaceBookmark }) => {
        expect({ cindySessionId: requestedTask, cwd: requestedCwd }).toEqual({ cindySessionId, cwd });
        return await startMacosSupervisedDshBridge({
          resourcesPath, homePath: evidence.homePath,
          logger: createConsoleLogger('dsh-workspace-router-e2e'),
          loadSecrets: () => [],
          assertAuthorizedCwd: (actualCwd, actualTask) => {
            expect({ cwd: actualCwd, cindySessionId: actualTask }).toEqual({ cwd, cindySessionId });
          },
          bindingStore: persistence.bindingStore,
          promptReceiptStore: persistence.promptReceiptStore,
          projectionJournal: persistence.projectionJournal,
          workspaceBookmark,
        }, scopeInput);
      },
    });
    try {
      for (const operation of ['create', 'resumeForAdapter'] as const) {
        // Only a newly created fixture directory is granted; no picker, real
        // project, user credential or production endpoint participates here.
        const persistentBookmark = native.createPersistentBookmarkForPath!(cwd);
        admission.reserve(cindySessionId, cwd, createDshWorkspaceBookmarkHandoff({ persistentBookmark, bridge: native }));
        const receipt = await router[operation]({ cindySessionId, cwd });
        expect(receipt.operation).toBe(operation === 'create' ? 'create' : 'resume');
        expect(() => admission.consumeWorkspaceBookmark({ cindySessionId, cwd })).toThrow('not authorized');
        await router.close(receipt);
      }
    } finally {
      await router.closeAll('workspace handoff fixture complete');
      persistence.rawDb.close();
      rmSync(cwd, { recursive: true, force: true });
      if (existsSync(managedScopeRoot)) rmSync(managedScopeRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it('starts and tears down ACP through the fixed Helper.app while keeping all scope state in its sandbox container', async () => {
    const evidence = runtimeEvidence!;
    const resourcesPath = join(evidence.appPath, 'Contents', 'Resources');
    const accountId = `factory-e2e-${process.pid}-${Date.now()}`;
    const input = { accountId, releaseId: evidence.releaseId, homeMode: 'cindy-managed' as const };
    const layout = resolveMacosSupervisedDshRuntime({ resourcesPath, homePath: evidence.homePath });
    const scope = createDshHostScopeId(input);
    const managedScopeRoot = join(layout.helperContainerDataPath, 'dsh-agent-home', scope.scopeId);
    const manager = createMacosSupervisedDshHostManager({
      resourcesPath,
      homePath: evidence.homePath,
      logger: createConsoleLogger('dsh-macos-supervised-e2e'),
      loadSecrets: () => [],
    });

    try {
      const snapshot = await manager.start(input);
      expect(snapshot).toMatchObject({
        scopeId: scope.scopeId,
        releaseId: evidence.releaseId,
        expectedVersion: layout.runtime.expectedVersion,
        protocolVersion: 1,
        agentName: 'deepseek-harness-acp',
      });
      expect(existsSync(join(managedScopeRoot, 'process-home'))).toBe(true);
      expect(existsSync(join(managedScopeRoot, 'dsh-home'))).toBe(true);
      await manager.stop(input, 'macOS supervised DSH factory evidence complete');
    } finally {
      // This exact random account scope is created by this test only. Do not
      // remove the Helper.app container or any other persisted DSH Home.
      if (existsSync(managedScopeRoot)) rmSync(managedScopeRoot, { recursive: true, force: true });
    }
  }, 20_000);

  it('runs an F3 create/close lifecycle through the fixed Helper.app and persists only the opaque binding tuple', async () => {
    const evidence = runtimeEvidence!;
    const resourcesPath = join(evidence.appPath, 'Contents', 'Resources');
    const accountId = `bridge-e2e-${process.pid}-${Date.now()}`;
    const cindySessionId = `bridge-cindy-${process.pid}-${Date.now()}`;
    const input = { accountId, releaseId: evidence.releaseId, homeMode: 'cindy-managed' as const };
    const scope = createDshHostScopeId(input);
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY);
      CREATE TABLE dsh_session_bindings (
        cindy_session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
        runtime_session_id TEXT NOT NULL,
        host_scope_id TEXT NOT NULL,
        runtime_release_id TEXT NOT NULL,
        runtime_version TEXT NOT NULL,
        controller_api_version INTEGER NOT NULL,
        capability_fingerprint TEXT NOT NULL,
        home_mode TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL DEFAULT 'active',
        last_projected_sequence INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX uniq_dsh_bindings_scope_runtime
        ON dsh_session_bindings (host_scope_id, runtime_session_id);
      CREATE INDEX idx_dsh_bindings_scope_lifecycle
        ON dsh_session_bindings (host_scope_id, lifecycle_state);
      CREATE TABLE dsh_activity_snapshots (
        cindy_session_id TEXT PRIMARY KEY NOT NULL REFERENCES dsh_session_bindings(cindy_session_id) ON DELETE RESTRICT,
        host_scope_id TEXT NOT NULL,
        activity_json TEXT NOT NULL,
        activity_sha256 TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_dsh_activity_snapshots_scope_sequence
        ON dsh_activity_snapshots (host_scope_id, sequence);
    `);
    db.prepare('INSERT INTO sessions (id) VALUES (?)').run(cindySessionId);
    const dbClient = { drizzle: drizzle(db, { schema }) };
    const store = createDshSessionBindingStore(dbClient);
    const activitySnapshotStore = createDshActivitySnapshotStore(dbClient);
    const bridgeHost = await startMacosSupervisedDshBridge(
      {
        resourcesPath,
        homePath: evidence.homePath,
        logger: createConsoleLogger('dsh-macos-supervised-bridge-e2e'),
        loadSecrets: () => [],
        bindingStore: store,
        activitySnapshotStore,
        promptReceiptStore: unusedPromptReceiptStore,
        projectionJournal: unusedProjectionJournal,
        assertAuthorizedCwd: (cwd) => {
          if (cwd !== process.cwd()) throw new Error(`unexpected E2E workdir: ${cwd}`);
        },
      },
      input,
    );

    try {
      const created = await bridgeHost.bridge.create({ cindySessionId, cwd: process.cwd() });
      const [binding] = await bridgeHost.bridge.list({ scopeId: bridgeHost.scopeId });
      await bridgeHost.bridge.close(binding!);

      expect(created).toMatchObject({
        operation: 'create',
      });
      expect(JSON.stringify(created)).not.toContain(binding?.runtimeSessionId ?? 'not-present');
      expect(bridgeHost.adapterAdmission).toEqual({
        committedFollowProjection: true,
        promptReceiptLedger: true,
      });
      expect(await store.getByCindySessionId(cindySessionId)).toMatchObject({
        cindySessionId,
        runtimeSessionId: binding?.runtimeSessionId,
        hostScopeId: scope.scopeId,
        lifecycleState: 'closed',
        lastProjectedSequence: 0,
      });
      const activity = await activitySnapshotStore.get({
        cindySessionId,
        hostScopeId: scope.scopeId,
      });
      expect(activity).toMatchObject({
        sequence: 2,
        snapshot: {
          origin: 'cindy-dsh',
          activities: [{ kind: 'session', status: 'disconnected', allowedActions: ['observe'] }],
        },
      });
      expect(JSON.stringify(activity)).not.toContain(binding?.runtimeSessionId ?? 'not-present');
    } finally {
      await bridgeHost.close('macOS supervised DSH F3 bridge evidence complete');
      db.close();
    }
  }, 25_000);

  it('mounts a Main-owned per-session MCP lease through the fixed Helper.app on create and verified resume', async () => {
    const evidence = runtimeEvidence!;
    const resourcesPath = join(evidence.appPath, 'Contents', 'Resources');
    const accountId = `mcp-e2e-${process.pid}-${Date.now()}`;
    const cindySessionId = `mcp-cindy-${process.pid}-${Date.now()}`;
    const input = { accountId, releaseId: evidence.releaseId, homeMode: 'cindy-managed' as const };
    const scope = createDshHostScopeId(input);
    const layout = resolveMacosSupervisedDshRuntime({ resourcesPath, homePath: evidence.homePath });
    const managedScopeRoot = join(layout.helperContainerDataPath, 'dsh-agent-home', scope.scopeId);
    const persistence = createPromptPersistence(cindySessionId);
    let fixture: InternalMcpFixture | null = null;
    let bridgeHost: Awaited<ReturnType<typeof startMacosSupervisedDshBridge>> | null = null;

    try {
      fixture = await createInternalMcpFixture();
      bridgeHost = await startMacosSupervisedDshBridge(
        {
          resourcesPath,
          homePath: evidence.homePath,
          logger: createConsoleLogger('dsh-macos-supervised-mcp-e2e'),
          loadSecrets: () => [],
          bindingStore: persistence.bindingStore,
          activitySnapshotStore: persistence.activitySnapshotStore,
          promptReceiptStore: persistence.promptReceiptStore,
          projectionJournal: persistence.projectionJournal,
          internalMcpLeaseFactory: fixture.factory,
          assertAuthorizedCwd: (cwd) => {
            if (cwd !== process.cwd()) throw new Error('unexpected internal MCP E2E workdir');
          },
        },
        input,
      );
      const created = await bridgeHost.bridge.create({
        cindySessionId,
        cwd: process.cwd(),
        sessionInstanceId: `mcp-instance-${process.pid}-${Date.now()}`,
      });
      await vi.waitFor(() => {
        expect(fixture!.initializedRequestCount()).toBeGreaterThan(0);
        expect(fixture!.toolsListRequestCount()).toBeGreaterThan(0);
      }, { timeout: 10_000 });
      expect(fixture.diagnosticCounts()).toEqual({ unexpected: 0, unauthorized: 0, malformed: 0 });
      expect(fixture.activeEndpointCount()).toBe(1);
      const initializedAfterCreate = fixture.initializedRequestCount();
      const toolsListedAfterCreate = fixture.toolsListRequestCount();

      await bridgeHost.bridge.close(created);
      await vi.waitFor(() => expect(fixture!.registrationCloseCount()).toBe(1));
      expect(fixture.activeEndpointCount()).toBe(0);

      const [closedBinding] = await bridgeHost.bridge.list({ scopeId: bridgeHost.scopeId });
      const resumed = await bridgeHost.bridge.resume({
        ...closedBinding!,
        cwd: process.cwd(),
        sessionInstanceId: `mcp-resume-${process.pid}-${Date.now()}`,
      });
      void resumed;
      await vi.waitFor(() => {
        expect(fixture!.initializedRequestCount()).toBeGreaterThan(initializedAfterCreate);
        expect(fixture!.toolsListRequestCount()).toBeGreaterThan(toolsListedAfterCreate);
      }, { timeout: 10_000 });
      expect(fixture.diagnosticCounts()).toEqual({ unexpected: 0, unauthorized: 0, malformed: 0 });
      expect(fixture.activeEndpointCount()).toBe(1);

      const [resumedBinding] = await bridgeHost.bridge.list({ scopeId: bridgeHost.scopeId });
      expect(resumedBinding).toBeDefined();
      await bridgeHost.bridge.close(resumedBinding!);
      await vi.waitFor(() => expect(fixture!.registrationCloseCount()).toBe(2));
      expect(fixture.activeEndpointCount()).toBe(0);
    } finally {
      await bridgeHost?.close('macOS supervised internal MCP E2E cleanup');
      await fixture?.close();
      persistence.rawDb.close();
      if (existsSync(managedScopeRoot)) rmSync(managedScopeRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it('persists Cindy-owned local plan/todo activity through the fixed Helper.app and revokes every write after close', async () => {
    const evidence = runtimeEvidence!;
    const resourcesPath = join(evidence.appPath, 'Contents', 'Resources');
    const accountId = `activity-e2e-${process.pid}-${Date.now()}`;
    const cindySessionId = `activity-cindy-${process.pid}-${Date.now()}`;
    const input = { accountId, releaseId: evidence.releaseId, homeMode: 'cindy-managed' as const };
    const scope = createDshHostScopeId(input);
    const layout = resolveMacosSupervisedDshRuntime({ resourcesPath, homePath: evidence.homePath });
    const managedScopeRoot = join(layout.helperContainerDataPath, 'dsh-agent-home', scope.scopeId);
    const persistence = createPromptPersistence(cindySessionId);
    let bridgeHost: Awaited<ReturnType<typeof startMacosSupervisedDshBridge>> | null = null;
    let activityNumber = 0;

    try {
      bridgeHost = await startMacosSupervisedDshBridge(
        {
          resourcesPath,
          homePath: evidence.homePath,
          logger: createConsoleLogger('dsh-macos-supervised-activity-e2e'),
          loadSecrets: () => [],
          bindingStore: persistence.bindingStore,
          activitySnapshotStore: persistence.activitySnapshotStore,
          promptReceiptStore: unusedPromptReceiptStore,
          projectionJournal: unusedProjectionJournal,
          assertAuthorizedCwd: (cwd) => {
            if (cwd !== process.cwd()) throw new Error(`unexpected activity E2E workdir: ${cwd}`);
          },
        },
        input,
      );
      await bridgeHost.bridge.create({ cindySessionId, cwd: process.cwd() });

      const control = createDshActivityControlService({
        bindingStore: persistence.bindingStore,
        snapshotStore: persistence.activitySnapshotStore,
        getSession: async () => ({ agentKind: 'dsh', status: 'active' }),
        isMutationAllowed: (owner) => dshActivityMutationGate.isAllowed(owner),
        activityId: () => `cindy-local-activity-${++activityNumber}`,
      });
      const plan = await control.createPlan({
        cindySessionId,
        label: 'Verify the signed local DSH package',
      });
      const planActivity = plan.snapshot.activities.find((activity) => activity.kind === 'plan');
      expect(planActivity).toBeDefined();
      const todo = await control.createTodo({
        cindySessionId,
        planActivityId: planActivity!.activityId,
        label: 'Complete the Main-owned activity round trip',
      });
      const todoActivity = todo.snapshot.activities.find((activity) => activity.kind === 'todo');
      expect(todoActivity).toBeDefined();
      await control.complete({ cindySessionId, activityId: todoActivity!.activityId });
      const completed = await control.complete({ cindySessionId, activityId: planActivity!.activityId });
      // Action admission is deliberately not persisted as a separate snapshot
      // mutation. The root, plan, todo and the two terminal transitions are
      // the five durable state changes in this local round trip.
      expect(completed.snapshot).toMatchObject({ sequence: 5 });
      expect(completed.snapshot.activities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            activityId: planActivity!.activityId,
            kind: 'plan',
            status: 'completed',
            allowedActions: ['observe'],
          }),
          expect.objectContaining({
            activityId: todoActivity!.activityId,
            kind: 'todo',
            status: 'completed',
            allowedActions: ['observe'],
          }),
        ]),
      );

      // Exercise the separately exposed cancel path with its own open tree:
      // closing a plan remains contingent on its todo becoming terminal.
      const cancellablePlan = await control.createPlan({
        cindySessionId,
        label: 'Verify cancellation remains local to Cindy',
      });
      const cancellablePlanActivity = cancellablePlan.snapshot.activities.find(
        (activity) =>
          activity.kind === 'plan' && activity.label === 'Verify cancellation remains local to Cindy',
      );
      expect(cancellablePlanActivity).toBeDefined();
      const cancellableTodo = await control.createTodo({
        cindySessionId,
        planActivityId: cancellablePlanActivity!.activityId,
        label: 'Cancel the local activity round trip',
      });
      const cancellableTodoActivity = cancellableTodo.snapshot.activities.find(
        (activity) =>
          activity.kind === 'todo' && activity.label === 'Cancel the local activity round trip',
      );
      expect(cancellableTodoActivity).toBeDefined();
      await control.cancel({ cindySessionId, activityId: cancellableTodoActivity!.activityId });
      const finalized = await control.cancel({
        cindySessionId,
        activityId: cancellablePlanActivity!.activityId,
      });
      expect(finalized.snapshot).toMatchObject({ sequence: 9 });
      expect(finalized.snapshot.activities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            activityId: cancellablePlanActivity!.activityId,
            kind: 'plan',
            status: 'cancelled',
            allowedActions: ['observe'],
          }),
          expect.objectContaining({
            activityId: cancellableTodoActivity!.activityId,
            kind: 'todo',
            status: 'cancelled',
            allowedActions: ['observe'],
          }),
        ]),
      );

      const binding = await persistence.bindingStore.getByCindySessionId(cindySessionId);
      expect(binding?.lifecycleState).toBe('active');
      expect(JSON.stringify(finalized)).not.toContain(binding?.runtimeSessionId ?? 'not-present');
      const persisted = persistence.rawDb
        .prepare(
          'SELECT activity_json AS activityJson, sequence FROM dsh_activity_snapshots WHERE cindy_session_id = ?',
        )
        .get(cindySessionId) as { activityJson: string; sequence: number };
      expect(persisted).toMatchObject({ sequence: 9 });
      expect(persisted.activityJson).not.toContain(binding?.runtimeSessionId ?? 'not-present');

      // The durable binding deliberately has no bridge `scopeId` field. Fetch
      // the current Main-owned bridge session through its scoped public list
      // operation instead of accidentally treating a DB row as a carrier
      // capability.
      const [bridgeSession] = await bridgeHost.bridge.list({ scopeId: bridgeHost.scopeId });
      await bridgeHost.bridge.close(bridgeSession!);
      await expect(
        control.createPlan({ cindySessionId, label: 'Must stay read-only after close' }),
      ).rejects.toMatchObject({ code: 'precondition-failed' });
      await expect(control.read({ cindySessionId })).resolves.toMatchObject({
        snapshot: {
          activities: expect.arrayContaining([
            expect.objectContaining({ kind: 'session', status: 'disconnected', allowedActions: ['observe'] }),
            expect.objectContaining({ kind: 'plan', allowedActions: ['observe'] }),
            expect.objectContaining({ kind: 'todo', allowedActions: ['observe'] }),
          ]),
        },
      });
    } finally {
      await bridgeHost?.close('macOS supervised DSH activity E2E cleanup');
      persistence.rawDb.close();
      if (existsSync(managedScopeRoot)) rmSync(managedScopeRoot, { recursive: true, force: true });
    }
  }, 40_000);
});

describePromptRuntime('packaged macOS supervised DSH prompt integration', () => {
  it('executes a signed Helper bash tool after one Main-owned approval without leaking provider credentials', async () => {
    const evidence = runtimeEvidence!;
    const resourcesPath = join(evidence.appPath, 'Contents', 'Resources');
    const accountId = `supervised-tool-e2e-${process.pid}-${Date.now()}`;
    const cindySessionId = `supervised-tool-cindy-${process.pid}-${Date.now()}`;
    const input = { accountId, releaseId: evidence.releaseId, homeMode: 'cindy-managed' as const };
    const scope = createDshHostScopeId(input);
    const layout = resolveMacosSupervisedDshRuntime({ resourcesPath, homePath: evidence.homePath });
    // This is a test-only workspace inside the Helper's own container.  A
    // user workspace additionally requires the production Main picker/bookmark
    // handoff; this test must not manufacture a user bookmark or touch a
    // project directory merely to prove a sealed native tool can execute.
    const workspace = mkdtempSync(join(layout.helperContainerDataPath, 'dsh-tool-e2e-workspace-'));
    const managedScopeRoot = join(layout.helperContainerDataPath, 'dsh-agent-home', scope.scopeId);
    const persistence = createPromptPersistence(cindySessionId);
    let provider: LoopbackProvider | null = null;
    let bridgeHost: Awaited<ReturnType<typeof startMacosSupervisedDshBridge>> | null = null;

    try {
      provider = await createLoopbackProvider({
        toolCall: {
          // The `test` builtins verify the upstream source adaptation removed
          // Main-only provider variables before invoking bash.  The command
          // prints only the test workspace and makes no filesystem mutation.
          arguments: {
            command: 'printf %s "$PWD"; test -z "${CINDY_DSH_PROVIDER_API_KEY:-}"; test -z "${CINDY_DSH_PROVIDER_BASE_URL:-}"',
            description: 'Print the sealed test workspace',
            run_in_background: false,
            // The normal profile starts at workspace-write.  Requesting this
            // wider mode forces the real ACP/Main one-shot approval path, but
            // the command itself remains read-only and confined to this test.
            sandbox_permissions: 'danger-full-access',
            justification: 'Verify one signed read-only DSH tool execution.',
          },
          finalText: 'CINDY_DSH_SUPERVISED_E2E_TOOL_COMPLETE',
        },
      });
      bridgeHost = await startMacosSupervisedDshBridge(
        {
          resourcesPath,
          homePath: evidence.homePath,
          logger: createConsoleLogger('dsh-macos-supervised-tool-e2e'),
          providerRoute: createLoopbackE2eDshProviderRoute(provider.baseUrl),
          loadSecrets: () => [
            { name: 'CINDY_DSH_PROVIDER_API_KEY', value: LOOPBACK_PROVIDER_API_KEY },
          ],
          assertAuthorizedCwd: (cwd) => {
            if (cwd !== workspace) throw new Error(`unexpected supervised tool E2E workdir: ${cwd}`);
          },
          bindingStore: persistence.bindingStore,
          activitySnapshotStore: persistence.activitySnapshotStore,
          promptReceiptStore: persistence.promptReceiptStore,
          projectionJournal: persistence.projectionJournal,
          toolPath: '/usr/bin:/bin',
        },
        input,
      );
      const agent = new DshAgent(dshAgentDeps(bridgeHost.binaryPath), {
        bridge: bridgeHost.bridge,
        scopeId: bridgeHost.scopeId,
        admission: bridgeHost.adapterAdmission,
        onDispose: () => bridgeHost!.close('macOS supervised tool E2E complete'),
      });
      const maker = new Maker({
        agents: { dsh: agent },
        storage: createMakerSessionStorage(),
        logger: createConsoleLogger('dsh-macos-supervised-tool-maker-e2e'),
      });
      const session = await maker.createSession({
        id: cindySessionId,
        agentKind: 'dsh',
        workingDir: workspace,
        model: 'cindy-dsh-managed',
        permissionMode: 'auto',
      });
      const interactions: unknown[] = [];
      session.setInteractionListener(async (request) => {
        interactions.push(request);
        return { kind: 'permission' as const, behavior: 'allow' as const };
      });
      const events: unknown[] = [];
      session.onEvent((event) => events.push(event));

      await expect(session.send('run the signed tool fixture')).resolves.toMatchObject({ accepted: true });
      await vi.waitFor(
        () =>
          expect(events).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                type: 'tool_use',
                data: expect.objectContaining({ toolName: 'bash' }),
                source: 'dsh',
              }),
              expect.objectContaining({
                type: 'tool_result_full',
                data: expect.objectContaining({ fullText: expect.stringContaining(workspace), isError: false }),
                source: 'dsh',
              }),
              expect.objectContaining({
                type: 'text',
                data: expect.objectContaining({ text: 'CINDY_DSH_SUPERVISED_E2E_TOOL_COMPLETE' }),
                source: 'dsh',
              }),
              expect.objectContaining({ type: 'done', data: { stopReason: 'end_turn' } }),
            ]),
          ),
        { timeout: 15_000 },
      );
      expect(interactions).toEqual([
        expect.objectContaining({
          kind: 'permission',
          requestId: expect.stringMatching(/^dsh:permission:/),
          toolUseId: expect.stringMatching(/^dsh:tool:/),
          toolName: 'bash',
          metadata: { dsh: { approvalScope: 'once', toolKind: 'other' } },
        }),
      ]);
      expect(provider.acceptedRequestCount()).toBe(2);
      expect(provider.diagnosticCounts()).toMatchObject({ unexpected: 0, unauthorized: 0, malformed: 0 });
      expect(JSON.stringify(events)).not.toContain(LOOPBACK_PROVIDER_API_KEY);
      expect(JSON.stringify(events)).not.toContain('cindy-dsh-supervised-e2e-tool-call');

      await maker.closeSession(cindySessionId);
      await maker.shutdown({ reason: 'app-quit' });
    } finally {
      await bridgeHost?.close('macOS supervised tool E2E cleanup');
      await provider?.close();
      persistence.rawDb.close();
      rmSync(workspace, { recursive: true, force: true });
      if (existsSync(managedScopeRoot)) rmSync(managedScopeRoot, { recursive: true, force: true });
    }
  }, 50_000);

  it('continues the same Maker task through a fresh supervised bridge without exposing its native session id', async () => {
    const evidence = runtimeEvidence!;
    const resourcesPath = join(evidence.appPath, 'Contents', 'Resources');
    const accountId = `supervised-restart-e2e-${process.pid}-${Date.now()}`;
    const cindySessionId = `supervised-restart-cindy-${process.pid}-${Date.now()}`;
    const input = { accountId, releaseId: evidence.releaseId, homeMode: 'cindy-managed' as const };
    const scope = createDshHostScopeId(input);
    const layout = resolveMacosSupervisedDshRuntime({ resourcesPath, homePath: evidence.homePath });
    const managedScopeRoot = join(layout.helperContainerDataPath, 'dsh-agent-home', scope.scopeId);
    const workspace = mkdtempSync(join(tmpdir(), 'cindy-dsh-supervised-restart-workspace-'));
    const persistence = createPromptPersistence(cindySessionId);
    const storage = createMakerSessionStorage();
    let provider: LoopbackProvider | null = null;
    let firstBridge: Awaited<ReturnType<typeof startMacosSupervisedDshBridge>> | null = null;
    let secondBridge: Awaited<ReturnType<typeof startMacosSupervisedDshBridge>> | null = null;

    const startBridge = async () =>
      startMacosSupervisedDshBridge(
        {
          resourcesPath,
          homePath: evidence.homePath,
          logger: createConsoleLogger('dsh-macos-supervised-restart-e2e'),
          providerRoute: createLoopbackE2eDshProviderRoute(provider!.baseUrl),
          loadSecrets: () => [
            { name: 'CINDY_DSH_PROVIDER_API_KEY', value: LOOPBACK_PROVIDER_API_KEY },
          ],
          assertAuthorizedCwd: (cwd) => {
            if (cwd !== workspace)
              throw new Error(`unexpected supervised restart E2E workdir: ${cwd}`);
          },
          bindingStore: persistence.bindingStore,
          activitySnapshotStore: persistence.activitySnapshotStore,
          promptReceiptStore: persistence.promptReceiptStore,
          projectionJournal: persistence.projectionJournal,
        },
        input,
      );

    try {
      provider = await createLoopbackProvider();
      firstBridge = await startBridge();
      const firstAgent = new DshAgent(dshAgentDeps(firstBridge.binaryPath), {
        bridge: firstBridge.bridge,
        scopeId: firstBridge.scopeId,
        admission: firstBridge.adapterAdmission,
        onDispose: () => firstBridge!.close('macOS supervised restart first bridge closed'),
      });
      const firstMaker = new Maker({
        agents: { dsh: firstAgent },
        storage,
        logger: createConsoleLogger('dsh-macos-supervised-restart-first-maker'),
      });
      const firstSession = await firstMaker.createSession({
        id: cindySessionId,
        agentKind: 'dsh',
        workingDir: workspace,
        model: 'cindy-dsh-managed',
        permissionMode: 'auto',
      });
      const firstEvents: unknown[] = [];
      firstSession.onEvent((event) => firstEvents.push(event));
      await firstSession.send('complete the first supervised restart turn');
      await vi.waitFor(
        () =>
          expect(firstEvents).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                type: 'text',
                data: expect.objectContaining({ text: 'CINDY_DSH_SUPERVISED_E2E_FOLLOW' }),
                source: 'dsh',
              }),
              expect.objectContaining({ type: 'done', data: { stopReason: 'end_turn' } }),
            ]),
          ),
        { timeout: 10_000 },
      );

      const firstMeta = await storage.get(cindySessionId);
      const opaqueResumeHandle = firstMeta?.sdkSessionId;
      expect(opaqueResumeHandle).toMatch(/^dsh:[A-Za-z0-9_-]{32}$/);
      const firstBinding = await persistence.bindingStore.getByCindySessionId(cindySessionId);
      expect(firstBinding?.lifecycleState).toBe('active');
      expect(opaqueResumeHandle).not.toBe(firstBinding?.runtimeSessionId);

      await firstMaker.closeSession(cindySessionId);
      await firstMaker.shutdown({ reason: 'app-quit' });
      expect(
        (await persistence.bindingStore.getByCindySessionId(cindySessionId))?.lifecycleState,
      ).toBe('closed');

      // This creates a new ACP carrier through the same fixed Helper.app.
      // startMacosSupervisedDshBridge may rehydrate only from session/list plus
      // a settled receipt ledger; it never receives an adapter-supplied native id.
      secondBridge = await startBridge();
      const secondAgent = new DshAgent(dshAgentDeps(secondBridge.binaryPath), {
        bridge: secondBridge.bridge,
        scopeId: secondBridge.scopeId,
        admission: secondBridge.adapterAdmission,
        onDispose: () => secondBridge!.close('macOS supervised restart second bridge closed'),
      });
      const secondMaker = new Maker({
        agents: { dsh: secondAgent },
        storage,
        logger: createConsoleLogger('dsh-macos-supervised-restart-second-maker'),
      });
      const resumedSession = await secondMaker.createSession({
        id: cindySessionId,
        agentKind: 'dsh',
        workingDir: workspace,
        model: 'cindy-dsh-managed',
        permissionMode: 'auto',
        resumeSessionId: opaqueResumeHandle,
      });
      const resumedEvents: unknown[] = [];
      resumedSession.onEvent((event) => resumedEvents.push(event));
      await resumedSession.send('complete the second supervised restart turn');
      await vi.waitFor(
        () =>
          expect(resumedEvents).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                type: 'text',
                data: expect.objectContaining({ text: 'CINDY_DSH_SUPERVISED_E2E_FOLLOW' }),
                source: 'dsh',
              }),
              expect.objectContaining({ type: 'done', data: { stopReason: 'end_turn' } }),
            ]),
          ),
        { timeout: 10_000 },
      );

      const resumedMeta = await storage.get(cindySessionId);
      const resumedBinding = await persistence.bindingStore.getByCindySessionId(cindySessionId);
      expect(resumedMeta?.sdkSessionId).toBe(opaqueResumeHandle);
      expect(resumedBinding).toMatchObject({
        cindySessionId,
        runtimeSessionId: firstBinding?.runtimeSessionId,
        hostScopeId: scope.scopeId,
        lifecycleState: 'active',
      });
      expect(JSON.stringify(resumedEvents)).not.toContain(
        firstBinding?.runtimeSessionId ?? 'not-present',
      );
      expect(JSON.stringify(resumedEvents)).not.toContain(LOOPBACK_PROVIDER_API_KEY);
      expect(provider.acceptedRequestCount()).toBe(2);
      await expect(
        persistence.activitySnapshotStore.get({ cindySessionId, hostScopeId: scope.scopeId }),
      ).resolves.toMatchObject({
        snapshot: {
          activities: [
            { kind: 'session', status: 'running', allowedActions: ['observe', 'cancel', 'close'] },
          ],
        },
      });

      await secondMaker.closeSession(cindySessionId);
      await secondMaker.shutdown({ reason: 'app-quit' });
    } finally {
      await secondBridge?.close('macOS supervised restart second bridge cleanup');
      await firstBridge?.close('macOS supervised restart first bridge cleanup');
      await provider?.close();
      persistence.rawDb.close();
      rmSync(workspace, { recursive: true, force: true });
      if (existsSync(managedScopeRoot)) rmSync(managedScopeRoot, { recursive: true, force: true });
    }
  }, 50_000);

  it('runs a registered Maker DSH session through the fixed Helper.app, committed projection, cancel, and close', async () => {
    const evidence = runtimeEvidence!;
    const resourcesPath = join(evidence.appPath, 'Contents', 'Resources');
    const accountId = `supervised-maker-e2e-${process.pid}-${Date.now()}`;
    const cindySessionId = `supervised-maker-cindy-${process.pid}-${Date.now()}`;
    const input = { accountId, releaseId: evidence.releaseId, homeMode: 'cindy-managed' as const };
    const scope = createDshHostScopeId(input);
    const layout = resolveMacosSupervisedDshRuntime({ resourcesPath, homePath: evidence.homePath });
    const managedScopeRoot = join(layout.helperContainerDataPath, 'dsh-agent-home', scope.scopeId);
    const workspace = mkdtempSync(join(tmpdir(), 'cindy-dsh-supervised-maker-workspace-'));
    const persistence = createPromptPersistence(cindySessionId, { seedParent: false });
    let provider: LoopbackProvider | null = null;
    let bridgeHost: Awaited<ReturnType<typeof startMacosSupervisedDshBridge>> | null = null;

    try {
      provider = await createLoopbackProvider({ keepSecondResponseOpen: true });
      bridgeHost = await startMacosSupervisedDshBridge(
        {
          resourcesPath,
          homePath: evidence.homePath,
          logger: createConsoleLogger('dsh-macos-supervised-maker-bridge-e2e'),
          providerRoute: createLoopbackE2eDshProviderRoute(provider.baseUrl),
          loadSecrets: () => [
            { name: 'CINDY_DSH_PROVIDER_API_KEY', value: LOOPBACK_PROVIDER_API_KEY },
          ],
          assertAuthorizedCwd: (cwd) => {
            if (cwd !== workspace)
              throw new Error(`unexpected supervised Maker E2E workdir: ${cwd}`);
          },
          bindingStore: persistence.bindingStore,
          activitySnapshotStore: persistence.activitySnapshotStore,
          promptReceiptStore: persistence.promptReceiptStore,
          projectionJournal: persistence.projectionJournal,
        },
        input,
      );

      const agent = new DshAgent(dshAgentDeps(bridgeHost.binaryPath), {
        bridge: bridgeHost.bridge,
        scopeId: bridgeHost.scopeId,
        admission: bridgeHost.adapterAdmission,
        onDispose: () => bridgeHost!.close('macOS supervised Maker E2E complete'),
      });
      const maker = new Maker({
        agents: {},
        storage: createMakerSessionStorage(),
        logger: createConsoleLogger('dsh-macos-supervised-maker-e2e'),
        lifecycleHooks: {
          reserveSessionMetadata: async (meta) => {
            if (meta.agentKind !== 'dsh') return null;
            expect(persistence.rawDb.prepare('SELECT id FROM sessions WHERE id = ?').get(meta.id)).toBeUndefined();
            persistence.rawDb.prepare('INSERT INTO sessions (id) VALUES (?)').run(meta.id);
            let settled = false;
            return {
              commit: async (sdkSessionId) => {
                if (settled) throw new Error('fixture reservation settled twice');
                settled = true;
                return {
                  ...meta,
                  ...(sdkSessionId === undefined ? {} : { sdkSessionId }),
                  createdAt: 1,
                  updatedAt: 1,
                };
              },
              rollback: async () => {
                if (settled) return;
                persistence.rawDb.prepare('DELETE FROM sessions WHERE id = ?').run(meta.id);
                settled = true;
              },
            };
          },
        },
      });
      expect(maker.registerAgent('dsh', agent)).toBe(true);
      expect(maker.listAvailableAgents()).toContain('dsh');

      const session = await maker.createSession({
        id: cindySessionId,
        agentKind: 'dsh',
        workingDir: workspace,
        model: 'cindy-dsh-managed',
        effort: 'medium',
        permissionMode: 'auto',
      });
      const [binding] = await bridgeHost.bridge.list({ scopeId: bridgeHost.scopeId });
      if (!binding) throw new Error('expected the supervised DSH bridge binding');
      const modelControl = bridgeHost.bridge
        .getConfigurationOptionsForMain(binding)
        .find((option) => option.id === 'model');
      if (!modelControl) {
        throw new Error('signed DSH runtime did not advertise a model configuration control');
      }
      expect(modelControl.allowedValues).toContain(modelControl.currentValue);
      const acknowledgedControls = await bridgeHost.bridge.setConfigurationOptionForMain({
        ...binding,
        configId: 'model',
        value: modelControl.currentValue,
      });
      expect(acknowledgedControls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'model',
            currentValue: modelControl.currentValue,
          }),
        ]),
      );
      expect(JSON.stringify(acknowledgedControls)).not.toContain(LOOPBACK_PROVIDER_API_KEY);
      const events: unknown[] = [];
      session.onEvent((event) => events.push(event));

      await expect(session.send('return the supervised Maker fixture text')).resolves.toMatchObject(
        {
          accepted: true,
        },
      );
      await vi.waitFor(
        () =>
          expect(events).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                type: 'text',
                data: expect.objectContaining({ text: 'CINDY_DSH_SUPERVISED_E2E_FOLLOW' }),
                source: 'dsh',
              }),
              expect.objectContaining({ type: 'done', data: { stopReason: 'end_turn' } }),
            ]),
          ),
        { timeout: 10_000 },
      );
      expect(JSON.stringify(events)).not.toContain(LOOPBACK_PROVIDER_API_KEY);

      const runningSend = session.send('leave the Maker fixture completion open until cancelled');
      await vi.waitFor(() => expect(provider!.acceptedRequestCount()).toBe(2), { timeout: 10_000 });
      await session.abort();
      await expect(runningSend).resolves.toMatchObject({ accepted: true });
      await vi.waitFor(
        () =>
          expect(events).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ type: 'done', data: { stopReason: 'cancelled' } }),
            ]),
          ),
        { timeout: 10_000 },
      );

      await maker.closeSession(cindySessionId);
      await maker.shutdown({ reason: 'app-quit' });
      expect(provider.acceptedRequestCount()).toBe(2);
      expect(
        persistence.rawDb
          .prepare(
            `SELECT state, stop_reason AS stopReason
             FROM dsh_prompt_receipts
            WHERE cindy_session_id = ?
            ORDER BY created_at, receipt_id`,
          )
          .all(cindySessionId),
      ).toEqual([
        { state: 'acknowledged', stopReason: 'end_turn' },
        { state: 'acknowledged', stopReason: 'cancelled' },
      ]);
    } finally {
      await bridgeHost?.close('macOS supervised Maker E2E cleanup');
      await provider?.close();
      persistence.rawDb.close();
      rmSync(workspace, { recursive: true, force: true });
      if (existsSync(managedScopeRoot)) rmSync(managedScopeRoot, { recursive: true, force: true });
    }
  }, 40_000);

  it('uses only the fixed Helper.app, loopback provider and Main-owned persistence for a committed follow projection', async () => {
    const evidence = runtimeEvidence!;
    const resourcesPath = join(evidence.appPath, 'Contents', 'Resources');
    const accountId = `supervised-prompt-e2e-${process.pid}-${Date.now()}`;
    const cindySessionId = `supervised-prompt-cindy-${process.pid}-${Date.now()}`;
    const input = { accountId, releaseId: evidence.releaseId, homeMode: 'cindy-managed' as const };
    const scope = createDshHostScopeId(input);
    const layout = resolveMacosSupervisedDshRuntime({ resourcesPath, homePath: evidence.homePath });
    const managedScopeRoot = join(layout.helperContainerDataPath, 'dsh-agent-home', scope.scopeId);
    const workspace = mkdtempSync(join(tmpdir(), 'cindy-dsh-supervised-prompt-workspace-'));
    const persistence = createPromptPersistence(cindySessionId);
    let provider: LoopbackProvider | null = null;
    let bridgeHost: Awaited<ReturnType<typeof startMacosSupervisedDshBridge>> | null = null;

    try {
      provider = await createLoopbackProvider({ keepSecondResponseOpen: true });
      const loopbackProvider = provider;
      bridgeHost = await startMacosSupervisedDshBridge(
        {
          resourcesPath,
          homePath: evidence.homePath,
          logger: createConsoleLogger('dsh-macos-supervised-prompt-e2e'),
          providerRoute: createLoopbackE2eDshProviderRoute(loopbackProvider.baseUrl),
          loadSecrets: () => [
            { name: 'CINDY_DSH_PROVIDER_API_KEY', value: LOOPBACK_PROVIDER_API_KEY },
          ],
          assertAuthorizedCwd: (cwd) => {
            if (cwd !== workspace) throw new Error(`unexpected supervised E2E workdir: ${cwd}`);
          },
          bindingStore: persistence.bindingStore,
          activitySnapshotStore: persistence.activitySnapshotStore,
          promptReceiptStore: persistence.promptReceiptStore,
          projectionJournal: persistence.projectionJournal,
        },
        input,
      );

      // The fixed, non-secret Home patch must exist before the first ACP
      // launch. The public ACP template remains upstream-owned. Do not assert
      // or print endpoint/key values.
      const providerPatch = readFileSync(
        join(managedScopeRoot, 'dsh-home', 'cordis.patch.yml'),
        'utf8',
      );
      expect(providerPatch).toContain('apiKeyEnv: CINDY_DSH_PROVIDER_API_KEY');
      expect(providerPatch).toContain('baseURL: !!js process.env.CINDY_DSH_PROVIDER_BASE_URL');
      expect(providerPatch).not.toContain(loopbackProvider.baseUrl);
      expect(providerPatch).not.toContain(LOOPBACK_PROVIDER_API_KEY);

      const created = await bridgeHost.bridge.create({ cindySessionId, cwd: workspace });
      const observed: unknown[] = [];
      bridgeHost.bridge.followCommitted(created, (event) => observed.push(event));
      try {
        await expect(
          bridgeHost.bridge.prompt({ ...created, text: 'return the supervised fixture text' }),
        ).resolves.toMatchObject({
          operation: 'prompt',
          stopReason: 'end_turn',
        });
      } catch {
        const counts = loopbackProvider.diagnosticCounts();
        throw new Error(
          `supervised DSH prompt failed before a valid loopback completion ` +
            `(accepted=${counts.accepted}, unexpected=${counts.unexpected}, ` +
            `unauthorized=${counts.unauthorized}, malformed=${counts.malformed}, ` +
            `lastUnexpected=${counts.lastUnexpectedShape ?? 'none'}, ` +
            `lastUnexpectedBodyKeys=${counts.lastUnexpectedBodyKeys.join('|') || 'none'})`,
        );
      }
      // A completed public turn can legitimately yield more than one safe
      // projection (for example, its text chunk and a later usage update).
      // The boundary proof is that the committed text arrives before the
      // next prompt, not that the runtime emits exactly one update.
      await vi.waitFor(
        () =>
          expect(observed).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                cindySessionId,
                scopeId: bridgeHost!.scopeId,
                events: [
                  expect.objectContaining({
                    type: 'text',
                    data: expect.objectContaining({ text: 'CINDY_DSH_SUPERVISED_E2E_FOLLOW' }),
                  }),
                ],
              }),
            ]),
          ),
        { timeout: 10_000 },
      );
      expect(loopbackProvider.acceptedRequestCount()).toBe(1);

      const runningPrompt = bridgeHost.bridge.prompt({
        ...created,
        text: 'leave this supervised fixture completion open until cancelled',
      });
      await vi.waitFor(() => expect(loopbackProvider.acceptedRequestCount()).toBe(2), {
        timeout: 10_000,
      });
      const cancelled = await bridgeHost.bridge.cancel(created);
      await expect(runningPrompt).resolves.toMatchObject({
        operation: 'prompt',
        stopReason: 'cancelled',
      });
      expect(cancelled).toMatchObject({ operation: 'cancel' });

      expect(observed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            cindySessionId,
            scopeId: bridgeHost.scopeId,
            events: [
              expect.objectContaining({
                type: 'text',
                data: expect.objectContaining({ text: 'CINDY_DSH_SUPERVISED_E2E_FOLLOW' }),
              }),
            ],
          }),
        ]),
      );
      const [, binding] = await Promise.all([
        bridgeHost.bridge.close(created),
        persistence.bindingStore.getByCindySessionId(cindySessionId),
      ]);
      expect(JSON.stringify(observed)).not.toContain(binding?.runtimeSessionId ?? 'not-present');
      expect(JSON.stringify(observed)).not.toContain(LOOPBACK_PROVIDER_API_KEY);
      expect(
        persistence.rawDb
          .prepare(
            `SELECT state, stop_reason AS stopReason
             FROM dsh_prompt_receipts
            WHERE cindy_session_id = ?
            ORDER BY created_at, receipt_id`,
          )
          .all(cindySessionId),
      ).toEqual([
        { state: 'acknowledged', stopReason: 'end_turn' },
        { state: 'acknowledged', stopReason: 'cancelled' },
      ]);
      expect(
        persistence.rawDb
          .prepare(
            'SELECT event_json AS eventJson FROM dsh_projection_events WHERE cindy_session_id = ?',
          )
          .all(cindySessionId),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventJson: expect.stringContaining('CINDY_DSH_SUPERVISED_E2E_FOLLOW'),
          }),
        ]),
      );
    } finally {
      await bridgeHost?.close('macOS supervised DSH prompt E2E complete');
      await provider?.close();
      persistence.rawDb.close();
      rmSync(workspace, { recursive: true, force: true });
      // This exact random scope is created only for the evidence test; no
      // existing DSH home or Helper.app container is removed.
      if (existsSync(managedScopeRoot)) rmSync(managedScopeRoot, { recursive: true, force: true });
    }
  }, 35_000);
});
