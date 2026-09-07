import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createEmptyDshActivitySnapshot,
  reduceDshActivity,
  type DshActivitySnapshot,
} from '@cindy/maker-core';

import type { DbClient } from '../client/DbClient.js';
import { createDshActivitySnapshotStore } from '../dshActivitySnapshots.js';
import * as schema from '../schema.js';

function initialSnapshot(
  input: {
    cindySessionId?: string;
    scopeId?: string;
    kind?: 'session' | 'terminal' | 'schedule';
    status?: 'pending' | 'running' | 'unavailable';
    allowedActions?: readonly ('observe' | 'cancel' | 'close' | 'input' | 'signal')[];
  } = {},
): DshActivitySnapshot {
  const snapshot = createEmptyDshActivitySnapshot();
  const result = reduceDshActivity(snapshot, {
    type: 'create',
    expectedSequence: snapshot.sequence,
    activityId: 'activity-root',
    cindySessionId: input.cindySessionId ?? 'cindy-session-a',
    scopeId: input.scopeId ?? 'scope-a',
    kind: input.kind ?? 'session',
    status: input.status ?? 'running',
    allowedActions: input.allowedActions ?? ['observe', 'cancel', 'close'],
    ...(input.status === 'unavailable'
      ? { unavailableReason: 'native-contract-not-admitted' as const }
      : {}),
  });
  if (result.kind !== 'mutated') throw new Error(`fixture activity create failed: ${result.kind}`);
  return result.snapshot;
}

describe('DSH activity snapshot store', () => {
  let rawDb: Database.Database | null = null;

  afterEach(() => {
    rawDb?.close();
    rawDb = null;
  });

  it('persists only a canonical closed cindy-dsh snapshot for an already-bound owner', async () => {
    const store = createDshActivitySnapshotStore(createTestDbClient(), {
      now: () => 1_700_000_000_000,
    });
    seedBinding('cindy-session-a', 'scope-a');
    const created = await store.create({
      cindySessionId: 'cindy-session-a',
      hostScopeId: 'scope-a',
      snapshot: initialSnapshot(),
    });
    expect(created).toMatchObject({
      kind: 'created',
      record: {
        cindySessionId: 'cindy-session-a',
        hostScopeId: 'scope-a',
        sequence: 1,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        snapshot: {
          origin: 'cindy-dsh',
          activities: [{ activityId: 'activity-root', status: 'running' }],
        },
      },
    });
    const row = rawDb!
      .prepare(
        'SELECT activity_json, activity_sha256 FROM dsh_activity_snapshots WHERE cindy_session_id = ?',
      )
      .get('cindy-session-a') as { activity_json: string; activity_sha256: string };
    expect(row.activity_json).toBe(JSON.stringify(initialSnapshot()));
    expect(row.activity_json).not.toContain('runtime_session_id');
    expect(row.activity_json).not.toContain('native-session-a');
    expect(row.activity_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps creation immutable and rejects snapshots with another owner', async () => {
    const store = createDshActivitySnapshotStore(createTestDbClient());
    seedBinding('cindy-session-a', 'scope-a');
    await store.create({
      cindySessionId: 'cindy-session-a',
      hostScopeId: 'scope-a',
      snapshot: initialSnapshot(),
    });
    await expect(
      store.create({
        cindySessionId: 'cindy-session-a',
        hostScopeId: 'scope-a',
        snapshot: initialSnapshot({ cindySessionId: 'cindy-session-b' }),
      }),
    ).rejects.toThrow('cross-owner');
    await expect(
      store.create({
        cindySessionId: 'cindy-session-a',
        hostScopeId: 'scope-a',
        snapshot: initialSnapshot(),
      }),
    ).resolves.toMatchObject({ kind: 'exists', record: { sequence: 1 } });
  });

  it('uses snapshot sequence and object revision to reject stale writers without executing an action', async () => {
    const store = createDshActivitySnapshotStore(createTestDbClient(), { now: () => 10 });
    seedBinding('cindy-session-a', 'scope-a');
    await store.create({
      cindySessionId: 'cindy-session-a',
      hostScopeId: 'scope-a',
      snapshot: initialSnapshot(),
    });

    await expect(
      store.apply({
        cindySessionId: 'cindy-session-a',
        hostScopeId: 'scope-a',
        mutation: {
          type: 'transition',
          expectedSequence: 1,
          activityId: 'activity-root',
          expectedRevision: 1,
          status: 'waiting-for-input',
          allowedActions: ['observe', 'input', 'cancel'],
        },
      }),
    ).resolves.toMatchObject({
      kind: 'mutated',
      record: { sequence: 2, updatedAt: 10 },
      activity: { status: 'waiting-for-input', revision: 2 },
    });

    await expect(
      store.apply({
        cindySessionId: 'cindy-session-a',
        hostScopeId: 'scope-a',
        mutation: {
          type: 'request-action',
          expectedSequence: 1,
          activityId: 'activity-root',
          expectedRevision: 1,
          action: 'input',
        },
      }),
    ).resolves.toMatchObject({ kind: 'rejected', reason: 'stale-sequence' });

    const action = await store.apply({
      cindySessionId: 'cindy-session-a',
      hostScopeId: 'scope-a',
      mutation: {
        type: 'request-action',
        expectedSequence: 2,
        activityId: 'activity-root',
        expectedRevision: 2,
        action: 'input',
      },
    });
    expect(action).toMatchObject({
      kind: 'action-admitted',
      action: 'input',
      record: { sequence: 2 },
    });
    expect(
      (await store.get({ cindySessionId: 'cindy-session-a', hostScopeId: 'scope-a' }))?.sequence,
    ).toBe(2);
  });

  it('does not write an update timestamp before the original snapshot if the wall clock regresses', async () => {
    let timestamp = 100;
    const store = createDshActivitySnapshotStore(createTestDbClient(), { now: () => timestamp });
    seedBinding('cindy-session-a', 'scope-a');
    await store.create({
      cindySessionId: 'cindy-session-a',
      hostScopeId: 'scope-a',
      snapshot: initialSnapshot(),
    });

    timestamp = 1;
    await expect(
      store.apply({
        cindySessionId: 'cindy-session-a',
        hostScopeId: 'scope-a',
        mutation: {
          type: 'transition',
          expectedSequence: 1,
          activityId: 'activity-root',
          expectedRevision: 1,
          status: 'waiting-for-input',
          allowedActions: ['observe', 'input'],
        },
      }),
    ).resolves.toMatchObject({ kind: 'mutated', record: { updatedAt: 100 } });

    await expect(
      store.get({ cindySessionId: 'cindy-session-a', hostScopeId: 'scope-a' }),
    ).resolves.toMatchObject({ createdAt: 100, updatedAt: 100 });
  });

  it('keeps a disconnected terminal read-only until a named reconnect mutation is committed', async () => {
    const store = createDshActivitySnapshotStore(createTestDbClient());
    seedBinding('cindy-session-a', 'scope-a');
    await store.create({
      cindySessionId: 'cindy-session-a',
      hostScopeId: 'scope-a',
      snapshot: initialSnapshot({
        kind: 'terminal',
        allowedActions: ['observe', 'input', 'signal', 'close'],
      }),
    });
    const disconnected = await store.apply({
      cindySessionId: 'cindy-session-a',
      hostScopeId: 'scope-a',
      mutation: {
        type: 'transition',
        expectedSequence: 1,
        activityId: 'activity-root',
        expectedRevision: 1,
        status: 'disconnected',
      },
    });
    expect(disconnected).toMatchObject({
      kind: 'mutated',
      activity: { status: 'disconnected', allowedActions: ['observe'], revision: 2 },
    });
    await expect(
      store.apply({
        cindySessionId: 'cindy-session-a',
        hostScopeId: 'scope-a',
        mutation: {
          type: 'request-action',
          expectedSequence: 2,
          activityId: 'activity-root',
          expectedRevision: 2,
          action: 'signal',
        },
      }),
    ).resolves.toMatchObject({ kind: 'rejected', reason: 'action-unavailable' });
    await expect(
      store.apply({
        cindySessionId: 'cindy-session-a',
        hostScopeId: 'scope-a',
        mutation: {
          type: 'reconnect',
          expectedSequence: 2,
          activityId: 'activity-root',
          expectedRevision: 2,
          status: 'running',
          allowedActions: ['observe', 'input'],
        },
      }),
    ).resolves.toMatchObject({
      kind: 'mutated',
      activity: { status: 'running', allowedActions: ['observe', 'input'], revision: 3 },
    });
  });

  it('fails closed on corrupt or non-contract stored JSON even if its digest was recomputed', async () => {
    const store = createDshActivitySnapshotStore(createTestDbClient());
    seedBinding('cindy-session-a', 'scope-a');
    await store.create({
      cindySessionId: 'cindy-session-a',
      hostScopeId: 'scope-a',
      snapshot: initialSnapshot(),
    });
    const unsafeJson = JSON.stringify({
      ...initialSnapshot(),
      extra: { rawAcpPayload: 'must-not-cross' },
    });
    rawDb!
      .prepare(
        'UPDATE dsh_activity_snapshots SET activity_json = ?, activity_sha256 = ? WHERE cindy_session_id = ?',
      )
      .run(unsafeJson, createHash('sha256').update(unsafeJson).digest('hex'), 'cindy-session-a');
    await expect(
      store.get({ cindySessionId: 'cindy-session-a', hostScopeId: 'scope-a' }),
    ).rejects.toThrow('not a closed contract');
  });

  it('does not reveal a row through a different scope even with the same Cindy task id', async () => {
    const store = createDshActivitySnapshotStore(createTestDbClient());
    seedBinding('cindy-session-a', 'scope-a');
    await store.create({
      cindySessionId: 'cindy-session-a',
      hostScopeId: 'scope-a',
      snapshot: initialSnapshot(),
    });
    await expect(
      store.get({ cindySessionId: 'cindy-session-a', hostScopeId: 'scope-b' }),
    ).resolves.toBeNull();
    await expect(
      store.apply({
        cindySessionId: 'cindy-session-a',
        hostScopeId: 'scope-b',
        mutation: {
          type: 'request-action',
          expectedSequence: 1,
          activityId: 'activity-root',
          expectedRevision: 1,
          action: 'cancel',
        },
      }),
    ).resolves.toEqual({ kind: 'missing' });
  });

  function createTestDbClient(): Pick<DbClient, 'drizzle'> {
    const dbHandle = new Database(':memory:');
    rawDb = dbHandle;
    dbHandle.pragma('foreign_keys = ON');
    dbHandle.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY);
      CREATE TABLE dsh_session_bindings (
        cindy_session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT
      );
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
    return { drizzle: drizzle(dbHandle, { schema }) } as Pick<DbClient, 'drizzle'>;
  }

  function seedBinding(cindySessionId: string, _scopeId: string): void {
    rawDb!.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run(cindySessionId);
    rawDb!
      .prepare('INSERT INTO dsh_session_bindings (cindy_session_id) VALUES (?)')
      .run(cindySessionId);
  }
});
