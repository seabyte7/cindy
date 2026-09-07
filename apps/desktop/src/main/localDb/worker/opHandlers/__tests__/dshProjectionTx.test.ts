import { createHash } from 'node:crypto';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { tx } from '../tx.js';

const databases: Database.Database[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe('DSH projection journal worker transaction', () => {
  it('commits the display-safe event and cursor atomically, then accepts the exact retry once', () => {
    const db = createDb();
    const args = projectionArgs(1);

    expect(run(db, args)).toEqual({
      kind: 'advanced',
      binding: {
        cindySessionId: 'cindy-session-a',
        lifecycleState: 'active',
        lastProjectedSequence: 1,
        revision: 2,
      },
    });
    expect(db.prepare('SELECT sequence, event_sha256 AS recordSha256 FROM dsh_projection_events').all())
      .toEqual([{ sequence: 1, recordSha256: args.recordSha256 }]);
    expect(
      db.prepare('SELECT last_projected_sequence AS cursor, revision FROM dsh_session_bindings').get(),
    ).toEqual({ cursor: 1, revision: 2 });

    expect(run(db, { ...args, expectedBindingRevision: 2 })).toMatchObject({
      kind: 'duplicate',
      binding: { lastProjectedSequence: 1, revision: 2 },
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM dsh_projection_events').get()).toEqual({ count: 1 });
  });

  it('does not advance the cursor when an event is invalid or its journal insert conflicts', () => {
    const db = createDb();
    const malformed = projectionArgs(1);
    malformed.recordJson = JSON.stringify({
      version: 1,
      kind: 'events',
      events: [{
        type: 'text',
        data: { text: 'unsafe source' },
        source: 'dsh',
        agentMeta: { dsh: { projectionSequence: 2 } },
      }],
    });
    malformed.recordSha256 = hash(malformed.recordJson);

    expect(() => run(db, malformed)).toThrow('projection sequence does not match');
    expect(bindingState(db)).toEqual({ cursor: 0, revision: 1, lifecycle: 'active' });
    expect(countJournal(db)).toBe(0);

    const conflict = projectionArgs(1);
    db.prepare(
      `INSERT INTO dsh_projection_events (
        cindy_session_id, sequence, event_json, event_sha256, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      conflict.cindySessionId,
      conflict.sequence,
      conflict.recordJson,
      conflict.recordSha256,
      conflict.createdAt,
    );
    expect(() => run(db, conflict)).toThrow();
    expect(bindingState(db)).toEqual({ cursor: 0, revision: 1, lifecycle: 'active' });
    expect(countJournal(db)).toBe(1);
  });

  it('turns a sequence gap into needs_reconcile without writing a partial event', () => {
    const db = createDb();
    const gap = projectionArgs(2);

    expect(run(db, gap)).toEqual({
      kind: 'gap',
      binding: {
        cindySessionId: 'cindy-session-a',
        lifecycleState: 'needs_reconcile',
        lastProjectedSequence: 0,
        revision: 2,
      },
    });
    expect(bindingState(db)).toEqual({ cursor: 0, revision: 2, lifecycle: 'needs_reconcile' });
    expect(countJournal(db)).toBe(0);
  });

  it('advances a known ignored update, while a rejected update marks needs_reconcile without a journal row', () => {
    const ignoredDb = createDb();
    const ignored = ignoredArgs(1);
    expect(run(ignoredDb, ignored)).toMatchObject({
      kind: 'advanced',
      binding: { lastProjectedSequence: 1, revision: 2 },
    });
    expect(countJournal(ignoredDb)).toBe(1);

    const rejectedDb = createDb();
    expect(tx(rejectedDb, {
      name: 'dsh.rejectProjection',
      args: {
        cindySessionId: 'cindy-session-a',
        expectedBindingRevision: 1,
        sequence: 1,
        reason: 'invalid-tool-call',
        createdAt: 1_700_000_000_000,
      },
    })).toMatchObject({
      kind: 'rejected',
      binding: { lifecycleState: 'needs_reconcile', lastProjectedSequence: 0, revision: 2 },
    });
    expect(countJournal(rejectedDb)).toBe(0);
  });

  function run(db: Database.Database, args: ReturnType<typeof projectionArgs>) {
    return tx(db, { name: 'dsh.commitProjection', args });
  }

  function projectionArgs(sequence: number) {
    const recordJson = JSON.stringify({
      version: 1,
      kind: 'events',
      events: [{
        type: 'text',
        data: {
          text: `display-safe event ${sequence}`,
          isFinal: true,
          agentMessageId: `dsh:message:opaque-${sequence}`,
        },
        source: 'dsh',
        agentMeta: { dsh: { projectionSequence: sequence } },
      }],
    });
    return {
      cindySessionId: 'cindy-session-a',
      expectedBindingRevision: 1,
      sequence,
      recordJson,
      recordSha256: hash(recordJson),
      createdAt: 1_700_000_000_000,
    };
  }

  function ignoredArgs(sequence: number) {
    const recordJson = JSON.stringify({ version: 1, kind: 'ignored', reason: 'unsupported-update' });
    return {
      cindySessionId: 'cindy-session-a',
      expectedBindingRevision: 1,
      sequence,
      recordJson,
      recordSha256: hash(recordJson),
      createdAt: 1_700_000_000_000,
    };
  }
});

function createDb(): Database.Database {
  const db = new Database(':memory:');
  databases.push(db);
  db.exec(`
    CREATE TABLE dsh_session_bindings (
      cindy_session_id TEXT PRIMARY KEY NOT NULL,
      lifecycle_state TEXT NOT NULL DEFAULT 'active',
      last_projected_sequence INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE dsh_projection_events (
      cindy_session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      event_json TEXT NOT NULL,
      event_sha256 TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (cindy_session_id, sequence)
    );
    INSERT INTO dsh_session_bindings (
      cindy_session_id, lifecycle_state, last_projected_sequence, revision, updated_at
    ) VALUES ('cindy-session-a', 'active', 0, 1, 0);
  `);
  return db;
}

function bindingState(db: Database.Database) {
  return db.prepare(
    `SELECT last_projected_sequence AS cursor, revision, lifecycle_state AS lifecycle
       FROM dsh_session_bindings
      WHERE cindy_session_id = 'cindy-session-a'`,
  ).get();
}

function countJournal(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM dsh_projection_events').get() as { count: number }).count;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
