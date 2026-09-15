import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createConsoleLogger } from '@cindy/maker-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  DshProjectionJournal,
} from '../../localDb/dshProjectionJournal.js';
import type {
  DshPromptReceipt,
  DshPromptReceiptStore,
} from '../../localDb/dshPromptReceipts.js';
import type {
  DshSessionBinding,
  DshSessionBindingStore,
} from '../../localDb/dshSessionBindings.js';
import { startMacosSupervisedDshBridge } from '../macos-supervised-bridge.js';

const temporaryRoots: string[] = [];
const RUNTIME_SESSION_ID = 'runtime-supervised-fixture';

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeExecutable(candidate: string, lines: readonly string[]): void {
  writeFileSync(candidate, `${lines.join('\n')}\n`, { mode: 0o700 });
  chmodSync(candidate, 0o700);
}

function writeInfoPlist(candidate: string, identifier: string): void {
  writeFileSync(candidate, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string></dict></plist>\n`);
}

/** A fixture Helper.app whose signed-supervisor position is a deterministic ACP responder. */
function createAcpHelperFixture(): { root: string; resourcesPath: string; homePath: string } {
  const root = mkdtempSync(join(tmpdir(), 'cindy-dsh-supervised-bridge-'));
  temporaryRoots.push(root);
  const appContents = join(root, 'Cindy.app', 'Contents');
  const resourcesPath = join(appContents, 'Resources');
  const helperContents = join(appContents, 'Helpers', 'Cindy DSH Supervisor.app', 'Contents');
  const helperResources = join(helperContents, 'Resources');
  const helperMacOs = join(helperContents, 'MacOS');
  const runtime = join(helperResources, 'dsh-runtime');
  const homePath = join(root, 'home');

  mkdirSync(resourcesPath, { recursive: true });
  mkdirSync(join(runtime, 'node'), { recursive: true });
  mkdirSync(join(helperResources, 'dsh-native-addons', 'node'), { recursive: true });
  mkdirSync(join(helperResources, 'dsh-pkg-native-cache', 'pkg'), { recursive: true });
  mkdirSync(helperMacOs, { recursive: true });
  mkdirSync(join(homePath, 'Library', 'Containers'), { recursive: true, mode: 0o700 });
  writeInfoPlist(join(appContents, 'Info.plist'), 'com.example.cindy');
  writeInfoPlist(join(helperContents, 'Info.plist'), 'com.example.cindy.dsh-supervisor');
  writeExecutable(join(runtime, 'dsh-runtime'), ['#!/bin/sh', 'exit 0']);
  writeExecutable(join(runtime, 'dsh-runtime-rg'), ['#!/bin/sh', 'exit 0']);
  writeFileSync(join(runtime, 'node', 'bootstrap.node'), 'fixture native addon');
  writeFileSync(join(helperResources, 'dsh-native-addons', 'node', 'bootstrap.node'), 'fixture sealed native addon');
  writeFileSync(join(helperResources, 'cindy-dsh-supervised-runtime.json'), `${JSON.stringify({
    formatVersion: 1,
    target: 'darwin-arm64',
    releaseId: 'cindy-dsh-supervised-fixture',
    expectedVersion: '0.1.fixture',
    parentBundleIdentifier: 'com.example.cindy',
    helperBundleIdentifier: 'com.example.cindy.dsh-supervisor',
    supervisorExecutable: 'cindy-dsh-sandbox-supervisor',
    runtimeExecutable: 'dsh-runtime',
    requiredSidecars: ['dsh-runtime-rg'],
    requiredNativeAddons: [{ sourcePath: 'node/bootstrap.node', cachePath: 'node/bootstrap.node' }],
    requiredPkgNativeCache: { sourceDirectory: 'pkg-native-cache', cacheDirectory: 'pkg' },
  })}\n`);
  writeExecutable(join(helperMacOs, 'cindy-dsh-sandbox-supervisor'), [
    `#!${process.execPath}`,
    "'use strict';",
    "const fs = require('node:fs');",
    "const readline = require('node:readline');",
    "const runtimeSessionId = 'runtime-supervised-fixture';",
    "function send(payload) { process.stdout.write(JSON.stringify(payload) + '\\n'); }",
    "function reply(id, result) { if (id !== undefined) send({ jsonrpc: '2.0', id, result }); }",
    'function beginAcp() {',
    "readline.createInterface({ input: process.stdin }).on('line', (line) => {",
    '  let request;',
    '  try { request = JSON.parse(line); } catch { process.exit(2); }',
    "  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') process.exit(2);",
    '  switch (request.method) {',
    "    case 'initialize': reply(request.id, { protocolVersion: 1, agentInfo: { name: 'deepseek-harness-acp', version: '0.1.fixture' }, agentCapabilities: { sessionCapabilities: { close: {}, list: {}, resume: {} } } }); break;",
    "    case 'session/new': reply(request.id, { sessionId: runtimeSessionId }); break;",
    "    case 'session/list': reply(request.id, { sessions: [{ sessionId: runtimeSessionId }] }); break;",
    "    case 'session/resume': reply(request.id, {}); break;",
    "    case 'session/prompt': send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: runtimeSessionId, update: { sessionUpdate: 'agent_message_chunk', messageId: 'native-private-message', content: { type: 'text', text: 'fixture private answer' } } } }); reply(request.id, { stopReason: 'end_turn' }); break;",
    "    case 'session/cancel': break;",
    "    case 'session/close': reply(request.id, {}); break;",
    "    default: if (request.id !== undefined) send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'unsupported method' } });",
    '  }',
    '});',
    '}',
    "if (process.env.DSH_HOME === undefined) {",
    "  const chunks = [];",
    "  const descriptor = fs.createReadStream(null, { fd: 3, autoClose: true });",
    "  descriptor.on('data', (chunk) => chunks.push(chunk));",
    "  descriptor.on('error', () => process.exit(3));",
    "  descriptor.on('end', () => {",
    "    const handoff = Buffer.concat(chunks);",
    "    if (handoff.length < 5 || handoff.readUInt32BE(0) !== handoff.length - 4) process.exit(4);",
    "    beginAcp();",
    "  });",
    '} else {',
    '  beginAcp();',
    '}',
  ]);
  return { root, resourcesPath, homePath };
}

function createBindingStore(): {
  store: DshSessionBindingStore;
  advanceProjection(cindySessionId: string, sequence: number): {
    cindySessionId: string;
    lifecycleState: 'active';
    lastProjectedSequence: number;
    revision: number;
  };
} {
  const rows = new Map<string, DshSessionBinding>();
  const store: DshSessionBindingStore = {
    async recordCreateReceipt(input) {
      const row: DshSessionBinding = {
        ...input,
        lifecycleState: 'active',
        lastProjectedSequence: 0,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      };
      rows.set(row.cindySessionId, row);
      return row;
    },
    async getByCindySessionId(cindySessionId) { return rows.get(cindySessionId) ?? null; },
    async listByScopeId(scopeId) { return [...rows.values()].filter((row) => row.hostScopeId === scopeId); },
    async markClosed({ cindySessionId, expectedRevision }) {
      const row = rows.get(cindySessionId);
      if (!row || row.revision !== expectedRevision) return null;
      const next = { ...row, lifecycleState: 'closed' as const, revision: row.revision + 1, updatedAt: 2 };
      rows.set(cindySessionId, next);
      return next;
    },
    async markClosedAfterVerifiedRuntimeHistory() { throw new Error('unexpected recovery in fixture'); },
    async markActiveAfterVerifiedRuntimeState() { throw new Error('unexpected recovery in fixture'); },
    async markNeedsReconcile() { throw new Error('unexpected reconciliation in fixture'); },
    async advanceProjectionCursor() { throw new Error('projection is owned by the fixture journal'); },
  };
  return {
    store,
    advanceProjection(cindySessionId, sequence) {
      const row = rows.get(cindySessionId);
      if (!row) throw new Error('fixture projection has no durable binding');
      const next: DshSessionBinding = {
        ...row,
        lastProjectedSequence: sequence,
        revision: row.revision + 1,
        updatedAt: 2,
      };
      rows.set(cindySessionId, next);
      return {
        cindySessionId: next.cindySessionId,
        lifecycleState: 'active',
        lastProjectedSequence: next.lastProjectedSequence,
        revision: next.revision,
      };
    },
  };
}

function createPromptReceiptStore(): DshPromptReceiptStore {
  const rows = new Map<string, DshPromptReceipt>();
  return {
    async recordPending({ receiptId, cindySessionId }) {
      const row: DshPromptReceipt = { receiptId, cindySessionId, state: 'pending', stopReason: null, createdAt: 1, resolvedAt: null };
      rows.set(receiptId, row);
      return row;
    },
    async acknowledge({ receiptId, cindySessionId, stopReason }) {
      const row = rows.get(receiptId);
      if (!row || row.cindySessionId !== cindySessionId || row.state !== 'pending') return null;
      const next: DshPromptReceipt = { ...row, state: 'acknowledged', stopReason, resolvedAt: 2 };
      rows.set(receiptId, next);
      return next;
    },
    async markUncertain({ receiptIds }) {
      for (const receiptId of receiptIds) {
        const row = rows.get(receiptId);
        if (row?.state === 'pending') rows.set(receiptId, { ...row, state: 'uncertain', resolvedAt: 2 });
      }
    },
    async hasUnresolved(cindySessionId) {
      return [...rows.values()].some((row) => row.cindySessionId === cindySessionId && row.state !== 'acknowledged');
    },
  };
}

describe.runIf(process.platform === 'darwin' && process.arch === 'arm64')('packaged macOS supervised DSH bridge composition', () => {
  it('requires all F3/F4 stores and emits a committed, redacted projection through the fixed Helper.app path', async () => {
    const fixture = createAcpHelperFixture();
    const bindingStore = createBindingStore();
    const journal: DshProjectionJournal = {
      commit: vi.fn(async (input) => ({
        kind: 'advanced' as const,
        binding: bindingStore.advanceProjection(input.cindySessionId, input.sequence),
      })),
      reject: vi.fn(async () => { throw new Error('fixture update should translate'); }),
    };
    const bridgeHost = await startMacosSupervisedDshBridge({
      resourcesPath: fixture.resourcesPath,
      homePath: fixture.homePath,
      platform: 'darwin',
      arch: 'arm64',
      logger: createConsoleLogger('dsh-supervised-bridge-fixture'),
      loadSecrets: () => [],
      assertAuthorizedCwd: (cwd) => {
        if (cwd !== fixture.root) throw new Error(`unexpected fixture cwd: ${cwd}`);
      },
      bindingStore: bindingStore.store,
      promptReceiptStore: createPromptReceiptStore(),
      projectionJournal: journal,
    }, {
      accountId: 'fixture-account',
      releaseId: 'cindy-dsh-supervised-fixture',
      homeMode: 'cindy-managed',
    });

    try {
      expect(bridgeHost.adapterAdmission).toEqual({
        committedFollowProjection: true,
        promptReceiptLedger: true,
      });
      const created = await bridgeHost.bridge.create({ cindySessionId: 'fixture-cindy-session', cwd: fixture.root });
      const received: unknown[] = [];
      bridgeHost.bridge.followCommitted(created, (event) => received.push(event));
      await expect(bridgeHost.bridge.prompt({ ...created, text: 'fixture prompt' })).resolves.toMatchObject({
        operation: 'prompt',
        stopReason: 'end_turn',
      });
      await vi.waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]).toMatchObject({
        cindySessionId: 'fixture-cindy-session',
        events: [expect.objectContaining({
          type: 'text',
          data: expect.objectContaining({ text: 'fixture private answer' }),
        })],
      });
      expect(JSON.stringify(received[0])).not.toContain(RUNTIME_SESSION_ID);
      expect(JSON.stringify(received[0])).not.toContain('native-private-message');
      expect(journal.commit).toHaveBeenCalledWith(expect.objectContaining({
        cindySessionId: 'fixture-cindy-session',
        sequence: 1,
      }));
      await bridgeHost.bridge.close(created);
    } finally {
      await bridgeHost.close('supervised bridge fixture complete');
    }
  }, 10_000);

  it('uses the existing-Home path only with the fd-3 handoff and never an environment Home', async () => {
    const fixture = createAcpHelperFixture();
    const bindingStore = createBindingStore();
    const journal: DshProjectionJournal = {
      commit: vi.fn(async (input) => ({
        kind: 'advanced' as const,
        binding: bindingStore.advanceProjection(input.cindySessionId, input.sequence),
      })),
      reject: vi.fn(async () => { throw new Error('fixture update should translate'); }),
    };
    const bridgeHost = await startMacosSupervisedDshBridge({
      resourcesPath: fixture.resourcesPath,
      homePath: fixture.homePath,
      platform: 'darwin',
      arch: 'arm64',
      logger: createConsoleLogger('dsh-supervised-existing-home-fixture'),
      loadSecrets: () => [],
      assertAuthorizedCwd: (cwd) => {
        if (cwd !== fixture.root) throw new Error('unexpected fixture cwd');
      },
      bindingStore: bindingStore.store,
      promptReceiptStore: createPromptReceiptStore(),
      projectionJournal: journal,
      implicitHomeBookmark: {
        kind: 'dsh-existing-home-implicit-bookmark',
        bookmark: Buffer.from('implicit-existing-home-fixture').toString('base64'),
      },
    }, {
      accountId: 'fixture-account',
      releaseId: 'cindy-dsh-supervised-fixture',
      homeMode: 'existing-dsh-home',
    });

    try {
      expect(bridgeHost.runtimeIdentity.homeMode).toBe('existing-dsh-home');
      const created = await bridgeHost.bridge.create({
        cindySessionId: 'fixture-existing-home-session',
        cwd: fixture.root,
      });
      await expect(bridgeHost.bridge.close(created)).resolves.toMatchObject({
        operation: 'close',
        cindySessionId: 'fixture-existing-home-session',
      });
    } finally {
      await bridgeHost.close('existing Home fixture complete');
    }
  }, 10_000);
});
