import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DshAcpClient, createConsoleLogger } from '@cindy/maker-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DshControlPlane } from '../dsh-control-plane.js';
import { createDshAcpStdioTransport } from '../dsh-acp-stdio-transport.js';

// CI does not distribute a DSH runtime yet. Release evidence invokes this test with a reviewed
// absolute executable path; ordinary unit runs remain hermetic and skip it rather than falling
// back to PATH or a user-installed dsh.
const binaryPath = process.env.CINDY_DSH_E2E_BINARY;
const describeRuntime = binaryPath ? describe : describe.skip;
const describePromptRuntime = binaryPath && process.env.CINDY_DSH_E2E_PROMPT === '1' ? describe : describe.skip;
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
  const profileDir = join(root, 'profiles', 'acp');
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'cindy-dsh-e2e-acp-profile',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'], patchReload: 'startup' } },
  }, null, 2)}\n`);
  // This patch is a test-only, temporary profile. It selects the runtime's documented public
  // DeepSeek-compatible adapter and references only the loopback mock passed in child env.
  writeFileSync(join(profileDir, 'cordis.patch.yml'), [
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

function hasFollowText(value: unknown, sessionId: string, text: string): boolean {
  return typeof value === 'object'
    && value !== null
    // The only production observer in this test is the Cindy bridge, which
    // replaces ACP's raw `sessionId` with the owned runtimeSessionId.
    && (value as { runtimeSessionId?: unknown }).runtimeSessionId === sessionId
    && typeof (value as { update?: unknown }).update === 'object'
    && (value as { update: { sessionUpdate?: unknown } }).update.sessionUpdate === 'agent_message_chunk'
    && typeof (value as { update: { content?: { text?: unknown } } }).update.content?.text === 'string'
    && (value as { update: { content: { text: string } } }).update.content.text.includes(text);
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

      expect(created).toMatchObject({ operation: 'create', runtimeSessionId: binding.runtimeSessionId });
      expect(firstClosed).toMatchObject({ operation: 'close', runtimeSessionId: binding.runtimeSessionId });
      expect(reconciled).toEqual([binding]);
      expect(resumed).toMatchObject({ operation: 'resume', runtimeSessionId: binding.runtimeSessionId });
      expect(cancelled).toMatchObject({ operation: 'cancel', runtimeSessionId: binding.runtimeSessionId });
      expect(closed).toMatchObject({ operation: 'close', runtimeSessionId: binding.runtimeSessionId });
      await expect(bridge.list({ scopeId: 'e2e-scope' })).resolves.toEqual([binding]);
    } finally {
      await client.close('DSH control-plane e2e complete');
    }
  }, 20_000);
});

describePromptRuntime('DshControlPlane public ACP prompt integration', () => {
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
      bridge.follow(binding, (event) => { updates.push(event); });

      const prompted = await bridge.prompt({ ...binding, text: 'return the deterministic fixture text' });
      expect(prompted).toMatchObject({ operation: 'prompt', runtimeSessionId: binding.runtimeSessionId, stopReason: 'end_turn' });
      await vi.waitFor(() => expect(
        updates.some((update) => hasFollowText(update, binding.runtimeSessionId, 'CINDY_DSH_E2E_FOLLOW')),
      ).toBe(true));

      const runningPrompt = bridge.prompt({ ...binding, text: 'keep this turn open until cancelled' });
      await vi.waitFor(() => expect(provider.requests).toHaveLength(2));
      const cancelled = await bridge.cancel(binding);
      await expect(runningPrompt).resolves.toMatchObject({
        operation: 'prompt',
        runtimeSessionId: binding.runtimeSessionId,
        stopReason: 'cancelled',
      });

      expect(cancelled).toMatchObject({ operation: 'cancel', runtimeSessionId: binding.runtimeSessionId });
      expect(provider.requests).toHaveLength(2);
      await bridge.close(binding);
    } finally {
      await Promise.allSettled([client.close('DSH prompt E2E complete'), provider.close()]);
    }
  }, 30_000);

  it('receives a real runtime permission request and cancels it before an escalated tool can execute', async () => {
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
          // This strictly-wider tool call must take the public ACP approval path.
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

      expect(prompted).toMatchObject({ operation: 'prompt', runtimeSessionId: binding.runtimeSessionId, stopReason: 'end_turn' });
      expect(provider.requests).toHaveLength(2);
      expect(permissionRequests).toEqual([{
        meta: expect.objectContaining({ method: 'session/request_permission' }),
        params: expect.objectContaining({
          sessionId: binding.runtimeSessionId,
          toolCall: { toolCallId: expect.any(String) },
          options: expect.arrayContaining([
            expect.objectContaining({ optionId: 'allow-once', kind: 'allow_once' }),
            expect.objectContaining({ optionId: 'reject-once', kind: 'reject_once' }),
          ]),
        }),
      }]);
      expect(existsSync(writeTarget)).toBe(false);
      await bridge.close(binding);
    } finally {
      await Promise.allSettled([client.close('DSH permission E2E complete'), provider.close()]);
    }
  }, 30_000);
});
