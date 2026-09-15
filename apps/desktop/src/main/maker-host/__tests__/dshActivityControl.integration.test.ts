import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import type { DbClient } from '../../localDb/client/DbClient.js';
import { createDshActivitySnapshotStore } from '../../localDb/dshActivitySnapshots.js';
import { createDshSessionBindingStore } from '../../localDb/dshSessionBindings.js';
import * as schema from '../../localDb/schema.js';
import { createDshActivityControlService } from '../dsh-activity-control.js';
import { createDshSessionActivityCoordinator } from '../dsh-session-activity.js';

const owner = { cindySessionId: 'cindy-session-a', scopeId: 'scope-a' };

describe('Cindy-owned DSH activity controller SQLite integration', () => {
  let rawDb: Database.Database | null = null;

  afterEach(() => {
    rawDb?.close();
    rawDb = null;
  });

  it('persists a restart-safe local plan/todo tree without leaking the native binding to its view', async () => {
    const client = createTestDbClient();
    rawDb!.prepare('INSERT INTO sessions (id) VALUES (?)').run(owner.cindySessionId);
    const bindingStore = createDshSessionBindingStore(client, { now: () => 100 });
    await bindingStore.recordCreateReceipt({
      cindySessionId: owner.cindySessionId,
      runtimeSessionId: 'native-session-must-not-reach-activity',
      hostScopeId: owner.scopeId,
      runtimeReleaseId: 'local-macos-dsh',
      runtimeVersion: '0.1.2-alpha.3',
      controllerApiVersion: 1,
      capabilityFingerprint: 'sha256:local-test',
      homeMode: 'cindy-managed',
    });
    const snapshotStore = createDshActivitySnapshotStore(client, { now: () => 101 });
    await createDshSessionActivityCoordinator(snapshotStore, {
      activityId: () => 'session-root',
    }).created(owner);

    let nextActivity = 0;
    const initialControl = createDshActivityControlService({
      bindingStore,
      snapshotStore,
      getSession: async () => ({ agentKind: 'dsh', status: 'active' }),
      isMutationAllowed: () => true,
      activityId: () => `local-activity-${++nextActivity}`,
    });
    const plan = await initialControl.createPlan({
      cindySessionId: owner.cindySessionId,
      label: 'Validate the local signed package',
    });
    const planActivity = plan.snapshot.activities.find((activity) => activity.kind === 'plan');
    expect(planActivity).toBeDefined();
    await initialControl.createTodo({
      cindySessionId: owner.cindySessionId,
      planActivityId: planActivity!.activityId,
      label: 'Run local helper smoke test',
    });

    // A fresh Main controller gets the same local tree from SQLite; this is
    // deliberately not a fake in-memory continuation of the first controller.
    const restartedControl = createDshActivityControlService({
      bindingStore,
      snapshotStore,
      getSession: async () => ({ agentKind: 'dsh', status: 'active' }),
      isMutationAllowed: () => true,
    });
    const restored = await restartedControl.read({ cindySessionId: owner.cindySessionId });
    expect(restored.snapshot).toMatchObject({ sequence: 3 });
    expect(restored.snapshot?.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activityId: planActivity!.activityId,
          label: 'Validate the local signed package',
        }),
        expect.objectContaining({
          kind: 'todo',
          label: 'Run local helper smoke test',
        }),
      ]),
    );
    expect(JSON.stringify(restored)).not.toContain('native-session-must-not-reach-activity');
    expect(JSON.stringify(restored)).not.toContain('hostScopeId');
    expect(JSON.stringify(restored)).not.toContain('cindySessionId');

    const persisted = rawDb!
      .prepare(
        'SELECT activity_json AS activityJson, sequence FROM dsh_activity_snapshots WHERE cindy_session_id = ?',
      )
      .get(owner.cindySessionId) as { activityJson: string; sequence: number };
    expect(persisted.sequence).toBe(3);
    expect(persisted.activityJson).toContain('Validate the local signed package');
    expect(persisted.activityJson).not.toContain('native-session-must-not-reach-activity');
    expect(persisted.activityJson).not.toContain('runtimeSessionId');
  });

  function createTestDbClient(): Pick<DbClient, 'drizzle'> {
    const db = new Database(':memory:');
    rawDb = db;
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
    return { drizzle: drizzle(db, { schema }) } as Pick<DbClient, 'drizzle'>;
  }
});
