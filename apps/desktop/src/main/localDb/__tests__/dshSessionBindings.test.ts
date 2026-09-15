import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import type { DbClient } from '../client/DbClient.js';
import {
  createDshSessionBindingStore,
  type DshCreateReceiptBinding,
} from '../dshSessionBindings.js';
import * as schema from '../schema.js';

const BASE_BINDING: DshCreateReceiptBinding = {
  cindySessionId: 'cindy-session-a',
  runtimeSessionId: 'native-session-a',
  hostScopeId: 'scope-a',
  runtimeReleaseId: 'cindy-dsh-0.1.2-alpha.3-build.3-macos-supervised',
  runtimeVersion: '0.1.2-alpha.3',
  controllerApiVersion: 1,
  capabilityFingerprint: 'sha256:capabilities-a',
  homeMode: 'cindy-managed',
};

describe('DSH session binding store', () => {
  let rawDb: Database.Database | null = null;

  afterEach(() => {
    rawDb?.close();
    rawDb = null;
  });

  it('persists only the restart/reconcile ownership tuple after an acknowledged create receipt', async () => {
    const store = createDshSessionBindingStore(createTestDbClient(), {
      now: () => 1_700_000_000_000,
    });
    await seedSession('cindy-session-a');

    const binding = await store.recordCreateReceipt(BASE_BINDING);

    expect(binding).toEqual({
      ...BASE_BINDING,
      lifecycleState: 'active',
      lastProjectedSequence: 0,
      revision: 1,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    expect(Object.keys(binding).sort()).toEqual([
      'capabilityFingerprint',
      'cindySessionId',
      'controllerApiVersion',
      'createdAt',
      'homeMode',
      'hostScopeId',
      'lastProjectedSequence',
      'lifecycleState',
      'revision',
      'runtimeReleaseId',
      'runtimeSessionId',
      'runtimeVersion',
      'updatedAt',
    ]);
    expect(() =>
      rawDb!.prepare('DELETE FROM sessions WHERE id = ?').run('cindy-session-a'),
    ).toThrow('FOREIGN KEY constraint failed');
  });

  it('makes create-receipt ownership immutable and scope-local', async () => {
    const store = createDshSessionBindingStore(createTestDbClient());
    await seedSession('cindy-session-a');
    await seedSession('cindy-session-b');
    await seedSession('cindy-session-c');
    await store.recordCreateReceipt(BASE_BINDING);

    await expect(
      store.recordCreateReceipt({ ...BASE_BINDING, runtimeVersion: 'other' }),
    ).rejects.toThrow();
    await expect(
      store.recordCreateReceipt({
        ...BASE_BINDING,
        cindySessionId: 'cindy-session-b',
      }),
    ).rejects.toThrow();

    await store.recordCreateReceipt({
      ...BASE_BINDING,
      cindySessionId: 'cindy-session-c',
      hostScopeId: 'scope-b',
    });
    expect((await store.listByScopeId('scope-a')).map((row) => row.cindySessionId)).toEqual([
      'cindy-session-a',
    ]);
    expect((await store.listByScopeId('scope-b')).map((row) => row.cindySessionId)).toEqual([
      'cindy-session-c',
    ]);
  });

  it('uses compare-and-set lifecycle transitions and permits reactivation only after verification', async () => {
    const store = createDshSessionBindingStore(createTestDbClient());
    await seedSession('cindy-session-a');
    const created = await store.recordCreateReceipt(BASE_BINDING);

    const closed = await store.markClosed({
      cindySessionId: created.cindySessionId,
      expectedRevision: created.revision,
    });
    expect(closed).toMatchObject({ lifecycleState: 'closed', revision: 2 });
    expect(
      await store.markActiveAfterVerifiedRuntimeState({
        cindySessionId: created.cindySessionId,
        expectedRevision: created.revision,
      }),
    ).toBeNull();
    const active = await store.markActiveAfterVerifiedRuntimeState({
      cindySessionId: created.cindySessionId,
      expectedRevision: closed!.revision,
    });
    expect(active).toMatchObject({ lifecycleState: 'active', revision: 3 });
  });

  it('advances the projection cursor once, rejects stale writers, and fails closed on a gap', async () => {
    const store = createDshSessionBindingStore(createTestDbClient());
    await seedSession('cindy-session-a');
    const created = await store.recordCreateReceipt(BASE_BINDING);

    const first = await store.advanceProjectionCursor({
      cindySessionId: created.cindySessionId,
      expectedRevision: created.revision,
      nextSequence: 1,
    });
    expect(first).toMatchObject({
      kind: 'advanced',
      binding: { lastProjectedSequence: 1, revision: 2 },
    });
    const stale = await store.advanceProjectionCursor({
      cindySessionId: created.cindySessionId,
      expectedRevision: created.revision,
      nextSequence: 2,
    });
    expect(stale).toMatchObject({
      kind: 'conflict',
      binding: { lastProjectedSequence: 1, revision: 2 },
    });
    const duplicate = await store.advanceProjectionCursor({
      cindySessionId: created.cindySessionId,
      expectedRevision: 2,
      nextSequence: 1,
    });
    expect(duplicate).toMatchObject({ kind: 'duplicate', binding: { lifecycleState: 'active' } });
    const gap = await store.advanceProjectionCursor({
      cindySessionId: created.cindySessionId,
      expectedRevision: 2,
      nextSequence: 3,
    });
    expect(gap).toMatchObject({
      kind: 'gap',
      binding: { lifecycleState: 'needs_reconcile', revision: 3 },
    });
  });

  it('rejects malformed opaque identifiers and never accepts a runtime credential field', async () => {
    const store = createDshSessionBindingStore(createTestDbClient());
    await seedSession('cindy-session-a');

    await expect(
      store.recordCreateReceipt({ ...BASE_BINDING, runtimeSessionId: 'native\nrecord' }),
    ).rejects.toThrow('runtimeSessionId');
    await expect(
      store.recordCreateReceipt({ ...BASE_BINDING, capabilityFingerprint: '' }),
    ).rejects.toThrow('capabilityFingerprint');
    expect('token' in BASE_BINDING).toBe(false);
    expect('endpoint' in BASE_BINDING).toBe(false);
    expect('profile' in BASE_BINDING).toBe(false);
  });

  it('fails closed on a corrupt stored row before a native recovery path can consume it', async () => {
    const store = createDshSessionBindingStore(createTestDbClient());
    await seedSession('cindy-session-a');
    await store.recordCreateReceipt(BASE_BINDING);
    rawDb!
      .prepare(
        "UPDATE dsh_session_bindings SET lifecycle_state = 'corrupt' WHERE cindy_session_id = ?",
      )
      .run('cindy-session-a');

    await expect(store.getByCindySessionId('cindy-session-a')).rejects.toThrow(
      'stored lifecycleState is unsupported',
    );
  });

  function createTestDbClient(): Pick<DbClient, 'drizzle'> {
    const dbHandle = new Database(':memory:');
    rawDb = dbHandle;
    dbHandle.pragma('foreign_keys = ON');
    dbHandle.exec(`
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
    `);
    return { drizzle: drizzle(dbHandle, { schema }) } as Pick<DbClient, 'drizzle'>;
  }

  async function seedSession(id: string): Promise<void> {
    rawDb!.prepare('INSERT INTO sessions (id) VALUES (?)').run(id);
  }
});
