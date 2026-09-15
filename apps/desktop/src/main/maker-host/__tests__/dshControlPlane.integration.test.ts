import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DshAcpClient, DshAgent, createConsoleLogger, type AgentDeps } from '@cindy/maker-core';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DshControlPlane } from '../dsh-control-plane.js';
import { createDshAcpStdioTransport } from '../dsh-acp-stdio-transport.js';
import { createDshFollowProjectionCoordinator } from '../dsh-follow-projection.js';
import type { DbClient } from '../../localDb/client/DbClient.js';
import { createDshProjectionJournal } from '../../localDb/dshProjectionJournal.js';
import { createDshPromptReceiptStore } from '../../localDb/dshPromptReceipts.js';
import { createDshSessionBindingStore } from '../../localDb/dshSessionBindings.js';
import * as schema from '../../localDb/schema.js';
import { tx as runDbTx } from '../../localDb/worker/opHandlers/tx.js';

// CI does not distribute a DSH runtime yet. Release evidence invokes this test with a reviewed
// absolute executable path; ordinary unit runs remain hermetic and skip it rather than falling
// back to PATH or a user-installed dsh.
const binaryPath = process.env.CINDY_DSH_E2E_BINARY;
const describeRuntime = binaryPath ? describe : describe.skip;
const describePromptRuntime = binaryPath && process.env.CINDY_DSH_E2E_PROMPT === '1' ? describe : describe.skip;
// This test intentionally exercises an unsealed source runtime's tool path.
// Keep it out of the signed-package evidence suite, whose capability floor
// must continue to suppress permission requests entirely.
const itRawPermissionRuntime = binaryPath && process.env.CINDY_DSH_E2E_RAW_PERMISSION === '1'
  ? it
  : it.skip;
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface MockProvider {
  baseUrl: string;
  requests: unknown[];
  close(): Promise<void>;
}

interface MockProviderOptions {
  behavior?: 'follow-and-stall' | 'permission-then-complete';
  permissionToolArguments?: Record<string, unknown>;
}

function configureMockProviderProfile(root: string): void {
  // The public acp profile creates its template at first boot. Cindy's
  // controlled layer must therefore be the DSH_HOME-level patch applied after
  // that template, not a hand-built profile directory.
  writeFileSync(join(root, 'cordis.patch.yml'), [
    '- id: llm-deepseek',
    "  name: '@deepseek-ai/dsh-llm-deepseek'",
    '  config:',
    '    apiKeyEnv: CINDY_DSH_E2E_MOCK_KEY',
    '    baseURL: !!js process.env.CINDY_DSH_E2E_MOCK_BASE_URL',
    '    thinking: disabled',
    '',
  ].join('\n'));
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}`;
}

async function createMockProvider(options: MockProviderOptions = {}): Promise<MockProvider> {
  const behavior = options.behavior ?? 'follow-and-stall';
  const requests: unknown[] = [];
  const openResponses = new Set<import('node:http').ServerResponse>();
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => { chunks.push(chunk); });
    request.on('end', () => {
      if (request.method !== 'POST' || request.url !== '/chat/completions') {
        response.writeHead(404).end();
        return;
      }
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      openResponses.add(response);
      response.once('close', () => { openResponses.delete(response); });
      if (behavior === 'permission-then-complete') {
        if (requests.length === 1) {
          const argumentsText = JSON.stringify(options.permissionToolArguments);
          const midpoint = Math.max(1, Math.floor(argumentsText.length / 2));
          response.end([
            sse({ choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: 'cindy-dsh-e2e-permission-tool-call',
                  type: 'function',
                  function: { name: 'bash', arguments: argumentsText.slice(0, midpoint) },
                }],
              },
              index: 0,
              finish_reason: null,
            }] }),
            sse({ choices: [{
              delta: { tool_calls: [{ index: 0, function: { arguments: argumentsText.slice(midpoint) } }] },
              index: 0,
              finish_reason: null,
            }] }),
            sse({ choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }] }),
            'data: [DONE]',
            '',
          ].join('\n\n'));
          return;
        }
        response.end([
          sse({ choices: [{
            delta: { role: 'assistant', content: 'CINDY_DSH_E2E_PERMISSION_REJECTED' },
            index: 0,
            finish_reason: null,
          }] }),
          sse({ choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] }),
          'data: [DONE]',
          '',
        ].join('\n\n'));
        return;
      }
      if (requests.length === 1) {
        response.end([
          'data: {"choices":[{"delta":{"role":"assistant","content":"CINDY_DSH_E2E_FOLLOW"},"index":0,"finish_reason":null}]}',
          'data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}',
          'data: [DONE]',
          '',
        ].join('\n\n'));
        return;
      }
      // Leave the second streamed turn open until the real runtime processes session/cancel.
      response.write('data: {"choices":[{"delta":{"role":"assistant","content":"CINDY_DSH_E2E_CANCEL_WAIT"},"index":0,"finish_reason":null}]}\n\n');
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
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('Cindy DSH E2E mock provider has no TCP port');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    async close(): Promise<void> {
      for (const response of openResponses) response.end();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
      });
    },
  };
}

function hasFollowText(value: unknown, text: string): boolean {
  return typeof value === 'object'
    && value !== null
    // Main-only raw follow keeps the Cindy owner tuple but never carries the
    // native ACP session id. Product adapters receive an even narrower,
    // committed projection through followCommitted.
    && typeof (value as { cindySessionId?: unknown }).cindySessionId === 'string'
    && typeof (value as { update?: unknown }).update === 'object'
    && (value as { update: { sessionUpdate?: unknown } }).update.sessionUpdate === 'agent_message_chunk'
    && typeof (value as { update: { content?: { text?: unknown } } }).update.content?.text === 'string'
    && (value as { update: { content: { text: string } } }).update.content.text.includes(text);
}

/**
 * The local E2E does not depend on an application database or a worker
 * process. It still exercises the real SQLite schema shape and the exact
 * named worker transaction that production Main calls through DbClient.
 */
function createProjectionPersistence(cindySessionId: string): {
  rawDb: Database.Database;
  bindingStore: ReturnType<typeof createDshSessionBindingStore>;
  promptReceiptStore: ReturnType<typeof createDshPromptReceiptStore>;
  projectionCoordinator: ReturnType<typeof createDshFollowProjectionCoordinator>;
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
  rawDb.prepare('INSERT INTO sessions (id) VALUES (?)').run(cindySessionId);
  const client = {
    drizzle: drizzle(rawDb, { schema }),
    tx: async (name: string, args: unknown) => runDbTx(rawDb, { name, args }),
  } as unknown as Pick<DbClient, 'drizzle' | 'tx'>;
  const bindingStore = createDshSessionBindingStore(client);
  const promptReceiptStore = createDshPromptReceiptStore(client);
  const projectionCoordinator = createDshFollowProjectionCoordinator(
    createDshProjectionJournal(client),
  );
  return { rawDb, bindingStore, promptReceiptStore, projectionCoordinator };
}

function dshAgentDeps(): AgentDeps {
  return {
    binaryPath: '/managed/local-dsh-runtime',
    logger: createConsoleLogger('dsh-agent-e2e'),
    runtimeConfig: {},
    auth: {
      getState: async () => ({ authenticated: false }),
      triggerLogin: async () => ({ authenticated: false }),
      logout: async () => undefined,
      getAuthEnv: async () => ({}),
    },
  };
}

describeRuntime('DshControlPlane public ACP runtime integration', () => {
  it('creates, reconciles, resumes, cancels and closes a runtime session through the Cindy bridge', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cindy-dsh-control-plane-e2e-'));
    temporaryRoots.push(root);
    const client = new DshAcpClient({
      logger: createConsoleLogger('dsh-control-plane-e2e'),
      createTransport: () => createDshAcpStdioTransport({
        binaryPath: binaryPath!,
        launcherCwd: root,
        // Do not inherit provider credentials into a lifecycle-only evidence test.
        env: { DSH_HOME: root, HOME: root, PATH: process.env.PATH },
        forceKillGraceMs: 1_000,
      }),
    });
    const bridge = new DshControlPlane({
      scopeId: 'e2e-scope',
      client,
      assertAuthorizedCwd: (cwd) => {
        if (cwd !== root) throw new Error(`unexpected E2E workdir: ${cwd}`);
      },
    });

    try {
      await bridge.initialize();
      const created = await bridge.create({ cindySessionId: 'e2e-cindy-session', cwd: root });
      const binding = (await bridge.list({ scopeId: 'e2e-scope' }))[0]!;
      // The runtime only makes a session appear in public session/list after its active handle is
      // closed. Reconcile therefore follows carrier close, never probes a live session as absent.
      const firstClosed = await bridge.close(binding);
      const reconciled = await bridge.reconcile({ scopeId: 'e2e-scope' });
      const resumed = await bridge.resume({ ...binding, cwd: root });
      const cancelled = await bridge.cancel(binding);
      const closed = await bridge.close(binding);

      expect(created).toMatchObject({
        operation: 'create', cindySessionId: 'e2e-cindy-session', scopeId: 'e2e-scope', bridgeSessionKey: expect.any(String),
      });
      expect(JSON.stringify(created)).not.toContain(binding.runtimeSessionId);
      expect(firstClosed).toMatchObject({ operation: 'close' });
      expect(reconciled).toEqual([binding]);
      expect(resumed).toMatchObject({ operation: 'resume' });
      expect(JSON.stringify(resumed)).not.toContain(binding.runtimeSessionId);
      expect(cancelled).toMatchObject({ operation: 'cancel' });
      expect(closed).toMatchObject({ operation: 'close' });
      await expect(bridge.list({ scopeId: 'e2e-scope' })).resolves.toEqual([binding]);
    } finally {
      await client.close('DSH control-plane e2e complete');
    }
  }, 20_000);
});

describePromptRuntime('DshControlPlane public ACP prompt integration', () => {
  it('runs the unregistered DshAgent through the real local runtime, committed projection, and no-replay receipt ledger', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cindy-dsh-agent-e2e-'));
    temporaryRoots.push(root);
    const cindySessionId = 'e2e-dsh-agent-cindy-session';
    const persistence = createProjectionPersistence(cindySessionId);
    configureMockProviderProfile(root);
    const provider = await createMockProvider();
    const client = new DshAcpClient({
      logger: createConsoleLogger('dsh-agent-e2e-client'),
      createTransport: () => createDshAcpStdioTransport({
        binaryPath: binaryPath!,
        launcherCwd: root,
        env: {
          DSH_HOME: root,
          HOME: root,
          PATH: process.env.PATH,
          DSH_TELEMETRY_DISABLED: '1',
          CINDY_DSH_E2E_MOCK_BASE_URL: provider.baseUrl,
          CINDY_DSH_E2E_MOCK_KEY: 'cindy-dsh-e2e-fixture',
        },
        forceKillGraceMs: 1_000,
      }),
    });
    const scopeId = 'e2e-dsh-agent-scope';
    const bridge = new DshControlPlane({
      scopeId,
      client,
      assertAuthorizedCwd: (cwd) => {
        if (cwd !== root) throw new Error(`unexpected E2E workdir: ${cwd}`);
      },
      projectionCoordinator: persistence.projectionCoordinator,
    });

    try {
      await bridge.initialize();
      const snapshot = bridge.getCapabilitySnapshot();
      expect(snapshot).not.toBeNull();
      bridge.configureDurableBinding({
        store: persistence.bindingStore,
        promptReceiptStore: persistence.promptReceiptStore,
        runtimeIdentity: {
          runtimeReleaseId: 'local-dsh-agent-e2e-runtime',
          runtimeVersion: snapshot!.agentVersion,
          controllerApiVersion: snapshot!.protocolVersion,
          capabilityFingerprint: 'sha256:local-dsh-agent-e2e',
          homeMode: 'cindy-managed',
        },
      });
      const handle = await new DshAgent(dshAgentDeps(), {
        bridge,
        scopeId,
        admission: { committedFollowProjection: true, promptReceiptLedger: true },
      }).startSession({
        sessionId: cindySessionId,
        workingDir: root,
        model: 'native-dsh',
      });
      const iterator = handle.events()[Symbol.asyncIterator]();
      await handle.send({ type: 'user', content: 'return the deterministic fixture text' });
      const events = [] as unknown[];
      for (let count = 0; count < 8; count += 1) {
        const next = await iterator.next();
        if (next.done) break;
        events.push(next.value);
        if (next.value.type === 'done') break;
      }

      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'status', source: 'dsh' }),
        expect.objectContaining({ type: 'text', data: expect.objectContaining({ text: 'CINDY_DSH_E2E_FOLLOW' }) }),
        expect.objectContaining({ type: 'done', data: { stopReason: 'end_turn' } }),
      ]));
      expect(JSON.stringify(events)).not.toContain('runtime-');
      expect(JSON.stringify(events)).not.toContain('cindy-dsh-e2e-fixture');
      expect(handle.id).not.toContain('runtime-');
      expect(
        persistence.rawDb.prepare(
          `SELECT state, stop_reason AS stopReason
             FROM dsh_prompt_receipts
            WHERE cindy_session_id = ?`,
        ).all(cindySessionId),
      ).toEqual([{ state: 'acknowledged', stopReason: 'end_turn' }]);
      expect(
        persistence.rawDb.prepare(
          'SELECT event_json AS eventJson FROM dsh_projection_events WHERE cindy_session_id = ?',
        ).all(cindySessionId),
      ).toEqual(expect.arrayContaining([
        expect.objectContaining({ eventJson: expect.stringContaining('CINDY_DSH_E2E_FOLLOW') }),
      ]));

      await handle.close();
    } finally {
      await Promise.allSettled([client.close('DSH Agent E2E complete'), provider.close()]);
      persistence.rawDb.close();
    }
  }, 30_000);

  it('drives prompt, follows the public event stream, and cancels a running turn through the Cindy bridge', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cindy-dsh-control-plane-prompt-e2e-'));
    temporaryRoots.push(root);
    configureMockProviderProfile(root);
    const provider = await createMockProvider();
    const updates: unknown[] = [];
    const client = new DshAcpClient({
      logger: createConsoleLogger('dsh-control-plane-prompt-e2e'),
      createTransport: () => createDshAcpStdioTransport({
        binaryPath: binaryPath!,
        launcherCwd: root,
        env: {
          DSH_HOME: root,
          HOME: root,
          PATH: process.env.PATH,
          DSH_TELEMETRY_DISABLED: '1',
          CINDY_DSH_E2E_MOCK_BASE_URL: provider.baseUrl,
          // A deliberately fake fixture value; no user credential is read or persisted.
          CINDY_DSH_E2E_MOCK_KEY: 'cindy-dsh-e2e-fixture',
        },
        forceKillGraceMs: 1_000,
      }),
    });
    const bridge = new DshControlPlane({
      scopeId: 'e2e-prompt-scope',
      client,
      assertAuthorizedCwd: (cwd) => {
        if (cwd !== root) throw new Error(`unexpected E2E workdir: ${cwd}`);
      },
    });

    try {
      await bridge.initialize();
      await bridge.create({ cindySessionId: 'e2e-prompt-cindy-session', cwd: root });
      const binding = (await bridge.list({ scopeId: 'e2e-prompt-scope' }))[0]!;
      bridge.followRawForMain(binding, (event) => { updates.push(event); });

      const prompted = await bridge.prompt({ ...binding, text: 'return the deterministic fixture text' });
      expect(prompted).toMatchObject({ operation: 'prompt', stopReason: 'end_turn' });
      expect(JSON.stringify(prompted)).not.toContain(binding.runtimeSessionId);
      await vi.waitFor(() => expect(
        updates.some((update) => hasFollowText(update, 'CINDY_DSH_E2E_FOLLOW')),
      ).toBe(true));

      const runningPrompt = bridge.prompt({ ...binding, text: 'keep this turn open until cancelled' });
      await vi.waitFor(() => expect(provider.requests).toHaveLength(2));
      const cancelled = await bridge.cancel(binding);
      await expect(runningPrompt).resolves.toMatchObject({
        operation: 'prompt',
        stopReason: 'cancelled',
      });

      expect(cancelled).toMatchObject({ operation: 'cancel' });
      expect(provider.requests).toHaveLength(2);
      await bridge.close(binding);
    } finally {
      await Promise.allSettled([client.close('DSH prompt E2E complete'), provider.close()]);
    }
  }, 30_000);

  it('projects a real local runtime update through the safe journal before exposing its follow callback', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cindy-dsh-control-plane-projection-e2e-'));
    temporaryRoots.push(root);
    const cindySessionId = 'e2e-projection-cindy-session';
    const persistence = createProjectionPersistence(cindySessionId);
    configureMockProviderProfile(root);
    const provider = await createMockProvider();
    const updates: unknown[] = [];
    const client = new DshAcpClient({
      logger: createConsoleLogger('dsh-control-plane-projection-e2e'),
      createTransport: () => createDshAcpStdioTransport({
        binaryPath: binaryPath!,
        launcherCwd: root,
        env: {
          DSH_HOME: root,
          HOME: root,
          PATH: process.env.PATH,
          DSH_TELEMETRY_DISABLED: '1',
          CINDY_DSH_E2E_MOCK_BASE_URL: provider.baseUrl,
          CINDY_DSH_E2E_MOCK_KEY: 'cindy-dsh-e2e-fixture',
        },
        forceKillGraceMs: 1_000,
      }),
    });
    const bridge = new DshControlPlane({
      scopeId: 'e2e-projection-scope',
      client,
      assertAuthorizedCwd: (cwd) => {
        if (cwd !== root) throw new Error(`unexpected E2E workdir: ${cwd}`);
      },
      projectionCoordinator: persistence.projectionCoordinator,
    });

    try {
      await bridge.initialize();
      const snapshot = bridge.getCapabilitySnapshot();
      expect(snapshot).not.toBeNull();
      bridge.configureDurableBinding({
        store: persistence.bindingStore,
        promptReceiptStore: persistence.promptReceiptStore,
        runtimeIdentity: {
          runtimeReleaseId: 'local-dsh-e2e-runtime',
          runtimeVersion: snapshot!.agentVersion,
          controllerApiVersion: snapshot!.protocolVersion,
          capabilityFingerprint: 'sha256:local-dsh-projection-e2e',
          homeMode: 'cindy-managed',
        },
      });
      await bridge.create({ cindySessionId, cwd: root });
      const binding = (await bridge.list({ scopeId: 'e2e-projection-scope' }))[0]!;
      bridge.followRawForMain(binding, (event) => updates.push(event));

      const prompted = await bridge.prompt({
        ...binding,
        text: 'return the deterministic fixture text',
      });
      await vi.waitFor(() => {
        const rows = persistence.rawDb
          .prepare(
            `SELECT sequence, event_json AS recordJson, event_sha256 AS recordSha256
               FROM dsh_projection_events
              WHERE cindy_session_id = ?
              ORDER BY sequence ASC`,
          )
          .all(cindySessionId) as Array<{ sequence: number; recordJson: string; recordSha256: string }>;
        expect(rows.length).toBeGreaterThan(0);
      });
      await vi.waitFor(() => expect(
        updates.some((update) => hasFollowText(update, 'CINDY_DSH_E2E_FOLLOW')),
      ).toBe(true));

      expect(JSON.stringify(updates)).not.toContain(binding.runtimeSessionId);

      const records = persistence.rawDb
        .prepare(
          `SELECT sequence, event_json AS recordJson, event_sha256 AS recordSha256
             FROM dsh_projection_events
            WHERE cindy_session_id = ?
            ORDER BY sequence ASC`,
        )
        .all(cindySessionId) as Array<{ sequence: number; recordJson: string; recordSha256: string }>;
      const projectedEvents = records.flatMap(({ recordJson }) => {
        const record = JSON.parse(recordJson) as { kind: string; events?: Array<Record<string, unknown>> };
        return record.kind === 'events' ? record.events ?? [] : [];
      });
      expect(projectedEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          source: 'dsh',
          agentMeta: { dsh: { projectionSequence: expect.any(Number) } },
        }),
      ]));
      expect(JSON.stringify(records)).not.toContain(binding.runtimeSessionId);
      expect(JSON.stringify(records)).not.toContain('cindy-dsh-e2e-fixture');
      expect(
        persistence.rawDb
          .prepare(
            `SELECT state, stop_reason AS stopReason, resolved_at AS resolvedAt
               FROM dsh_prompt_receipts
              WHERE receipt_id = ?`,
          )
          .get(prompted.receiptId),
      ).toEqual({ state: 'acknowledged', stopReason: 'end_turn', resolvedAt: expect.any(Number) });
      expect(
        persistence.rawDb
          .prepare('PRAGMA table_info(dsh_prompt_receipts)')
          .all(),
      ).toEqual(
        expect.not.arrayContaining([
          expect.objectContaining({ name: 'prompt' }),
          expect.objectContaining({ name: 'content' }),
          expect.objectContaining({ name: 'error' }),
        ]),
      );

      await bridge.close(binding);
    } finally {
      await Promise.allSettled([client.close('DSH projection E2E complete'), provider.close()]);
      persistence.rawDb.close();
    }
  }, 30_000);

  it('does not expose a permission escalation while the ACP MVP capability floor disables tools', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cindy-dsh-control-plane-permission-e2e-'));
    temporaryRoots.push(root);
    const writeTarget = join(root, 'must-not-be-written');
    configureMockProviderProfile(root);
    const provider = await createMockProvider({
      behavior: 'permission-then-complete',
      permissionToolArguments: {
        command: `printf %s CINDY_DSH_E2E_PERMISSION > ${JSON.stringify(writeTarget)}`,
        description: 'Attempt a fixture write that requires approval',
        sandbox_permissions: 'workspace-write',
        justification: 'The fixture asks to write one file in the authorized workspace.',
      },
    });
    const permissionRequests: Array<{ params: unknown; meta: unknown }> = [];
    const client = new DshAcpClient({
      logger: createConsoleLogger('dsh-control-plane-permission-e2e'),
      createTransport: () => createDshAcpStdioTransport({
        binaryPath: binaryPath!,
        launcherCwd: root,
        env: {
          DSH_HOME: root,
          HOME: root,
          PATH: process.env.PATH,
          DSH_TELEMETRY_DISABLED: '1',
          // The fixture asks for an escalated tool. The sealed ACP MVP profile
          // must suppress it before a public permission interaction exists.
          DSH_PERMISSION_MODE: 'read-only',
          CINDY_DSH_E2E_MOCK_BASE_URL: provider.baseUrl,
          CINDY_DSH_E2E_MOCK_KEY: 'cindy-dsh-e2e-fixture',
        },
        forceKillGraceMs: 1_000,
      }),
    });
    const installServerRequestHandler = client.onServerRequest.bind(client);
    vi.spyOn(client, 'onServerRequest').mockImplementation((method, handler) => {
      installServerRequestHandler(method, async (params, meta) => {
        if (method === 'session/request_permission') permissionRequests.push({ params, meta });
        return handler(params, meta);
      });
    });
    const bridge = new DshControlPlane({
      scopeId: 'e2e-permission-scope',
      client,
      assertAuthorizedCwd: (cwd) => {
        if (cwd !== root) throw new Error(`unexpected E2E workdir: ${cwd}`);
      },
    });

    try {
      await bridge.initialize();
      await bridge.create({ cindySessionId: 'e2e-permission-cindy-session', cwd: root });
      const binding = (await bridge.list({ scopeId: 'e2e-permission-scope' }))[0]!;
      const prompted = await bridge.prompt({ ...binding, text: 'run the supplied bash tool once' });

      expect(prompted).toMatchObject({ operation: 'prompt', stopReason: 'end_turn' });
      expect(JSON.stringify(prompted)).not.toContain(binding.runtimeSessionId);
      expect(provider.requests).toHaveLength(2);
      expect(permissionRequests).toEqual([]);
      expect(existsSync(writeTarget)).toBe(false);
      await bridge.close(binding);
    } finally {
      await Promise.allSettled([client.close('DSH permission E2E complete'), provider.close()]);
    }
  }, 30_000);

  itRawPermissionRuntime('routes a real raw-runtime permission through the adapter as a one-shot rejection', async () => {
    // This fixture is intentionally invoked only against the local, unsealed
    // darwin-arm64 runtime. The signed package retains its capability floor;
    // this proves the Cindy control path without widening shipped authority.
    const root = mkdtempSync(join(tmpdir(), 'cindy-dsh-permission-bridge-e2e-'));
    temporaryRoots.push(root);
    const cindySessionId = 'e2e-dsh-permission-bridge-session';
    const persistence = createProjectionPersistence(cindySessionId);
    const writeTarget = join(root, 'must-not-be-written');
    configureMockProviderProfile(root);
    const provider = await createMockProvider({
      behavior: 'permission-then-complete',
      permissionToolArguments: {
        command: `printf %s CINDY_DSH_E2E_PERMISSION > ${JSON.stringify(writeTarget)}`,
        description: 'Attempt a fixture write that requires approval',
        sandbox_permissions: 'workspace-write',
        justification: 'The fixture asks to write one file in the authorized workspace.',
      },
    });
    const client = new DshAcpClient({
      logger: createConsoleLogger('dsh-permission-bridge-e2e'),
      createTransport: () => createDshAcpStdioTransport({
        binaryPath: binaryPath!,
        launcherCwd: root,
        env: {
          DSH_HOME: root,
          HOME: root,
          PATH: process.env.PATH,
          DSH_TELEMETRY_DISABLED: '1',
          // The raw runtime presents its ACP one-shot request only in this
          // explicit restrictive mode. The fixture's Cindy decision remains
          // deny, so no tool execution is authorized.
          DSH_PERMISSION_MODE: 'read-only',
          CINDY_DSH_E2E_MOCK_BASE_URL: provider.baseUrl,
          CINDY_DSH_E2E_MOCK_KEY: 'cindy-dsh-e2e-fixture',
        },
        forceKillGraceMs: 1_000,
      }),
    });
    const nativePermissionRequests: unknown[] = [];
    const nativePermissionResponses: unknown[] = [];
    const installServerRequestHandler = client.onServerRequest.bind(client);
    vi.spyOn(client, 'onServerRequest').mockImplementation((method, handler) => {
      installServerRequestHandler(method, async (params, meta) => {
        if (method === 'session/request_permission') nativePermissionRequests.push({ params, meta });
        const response = await handler(params, meta);
        if (method === 'session/request_permission') nativePermissionResponses.push(response);
        return response;
      });
    });
    const scopeId = 'e2e-dsh-permission-bridge-scope';
    const bridge = new DshControlPlane({
      scopeId,
      client,
      assertAuthorizedCwd: (cwd) => {
        if (cwd !== root) throw new Error(`unexpected E2E workdir: ${cwd}`);
      },
      projectionCoordinator: persistence.projectionCoordinator,
    });

    try {
      await bridge.initialize();
      const snapshot = bridge.getCapabilitySnapshot();
      expect(snapshot).not.toBeNull();
      bridge.configureDurableBinding({
        store: persistence.bindingStore,
        promptReceiptStore: persistence.promptReceiptStore,
        runtimeIdentity: {
          runtimeReleaseId: 'local-dsh-permission-bridge-e2e-runtime',
          runtimeVersion: snapshot!.agentVersion,
          controllerApiVersion: snapshot!.protocolVersion,
          capabilityFingerprint: 'sha256:local-dsh-permission-bridge-e2e',
          homeMode: 'cindy-managed',
        },
      });
      const handle = await new DshAgent(dshAgentDeps(), {
        bridge,
        scopeId,
        admission: { committedFollowProjection: true, promptReceiptLedger: true },
      }).startSession({
        sessionId: cindySessionId,
        workingDir: root,
        model: 'native-dsh',
      });
      const interactions: unknown[] = [];
      const rawUpdates: unknown[] = [];
      const binding = (await bridge.list({ scopeId }))[0]!;
      bridge.followRawForMain(binding, (update) => rawUpdates.push(update));
      handle.setInteractionResolver(async (request) => {
        interactions.push(request);
        return { kind: 'permission', behavior: 'deny', reason: 'fixture-default-deny' };
      });

      const iterator = handle.events()[Symbol.asyncIterator]();
      await handle.send({ type: 'user', content: 'run the supplied bash tool once' });
      const events: unknown[] = [];
      for (let count = 0; count < 12; count += 1) {
        const next = await iterator.next();
        if (next.done) break;
        events.push(next.value);
        if (next.value.type === 'done') break;
      }

      expect(nativePermissionRequests).toHaveLength(1);
      expect(nativePermissionResponses).toEqual([
        { outcome: { outcome: 'selected', optionId: 'reject-once' } },
      ]);
      expect(rawUpdates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            toolCallId: 'cindy-dsh-e2e-permission-tool-call',
          }),
        }),
      ]));
      expect(interactions).toEqual([
        expect.objectContaining({
          kind: 'permission',
          requestId: expect.stringMatching(/^dsh:permission:/),
          toolUseId: expect.stringMatching(/^dsh:tool:/),
          toolName: 'bash',
          input: expect.objectContaining({
            command: expect.stringContaining('CINDY_DSH_E2E_PERMISSION'),
          }),
          metadata: { dsh: { approvalScope: 'once', toolKind: 'other' } },
        }),
      ]);
      expect(JSON.stringify(interactions)).not.toContain('cindy-dsh-e2e-permission-tool-call');
      expect(JSON.stringify(interactions)).not.toContain('cindy-dsh-e2e-fixture');
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'done', data: { stopReason: 'end_turn' } }),
        expect.objectContaining({
          type: 'text', data: expect.objectContaining({ text: 'CINDY_DSH_E2E_PERMISSION_REJECTED' }),
        }),
      ]));
      expect(provider.requests).toHaveLength(2);
      expect(existsSync(writeTarget)).toBe(false);
      await handle.close();
    } finally {
      await Promise.allSettled([client.close('DSH permission bridge E2E complete'), provider.close()]);
      persistence.rawDb.close();
    }
  }, 30_000);
});
