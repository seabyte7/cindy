import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import type { DbClient } from '../client/DbClient.js';
import { createDshPromptReceiptStore } from '../dshPromptReceipts.js';
import * as schema from '../schema.js';

describe('DSH prompt receipt ledger', () => {
  let rawDb: Database.Database | null = null;

  afterEach(() => {
    rawDb?.close();
    rawDb = null;
  });

  it('makes a pending native prompt a durable no-replay boundary until acknowledgement', async () => {
    const store = createDshPromptReceiptStore(createTestDbClient(), { now: () => 42 });
    seedBinding('cindy-session-a');

    await expect(
      store.recordPending({ receiptId: 'dsh-receipt-a', cindySessionId: 'cindy-session-a' }),
    ).resolves.toEqual({
      receiptId: 'dsh-receipt-a',
      cindySessionId: 'cindy-session-a',
      state: 'pending',
      stopReason: null,
      createdAt: 42,
      resolvedAt: null,
    });
    await expect(store.hasUnresolved('cindy-session-a')).resolves.toBe(true);

    await expect(
      store.acknowledge({
        receiptId: 'dsh-receipt-a',
        cindySessionId: 'cindy-session-a',
        stopReason: 'end_turn',
      }),
    ).resolves.toMatchObject({ state: 'acknowledged', stopReason: 'end_turn', resolvedAt: 42 });
    await expect(store.hasUnresolved('cindy-session-a')).resolves.toBe(false);
    expect(rawDb!.prepare('PRAGMA table_info(dsh_prompt_receipts)').all()).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ name: 'prompt' }),
        expect.objectContaining({ name: 'content' }),
        expect.objectContaining({ name: 'error' }),
      ]),
    );
  });

  it('settles only proven pending rejections and never unlocks an uncertain receipt', async () => {
    const store = createDshPromptReceiptStore(createTestDbClient(), { now: () => 42 });
    seedBinding('cindy-session-a');
    const input = { receiptId: 'rejected', cindySessionId: 'cindy-session-a' };
    await store.recordPending(input);
    expect(await store.reject({ ...input, cindySessionId: 'other' })).toBeNull();
    expect(await store.reject(input)).toMatchObject({ state: 'rejected', stopReason: null, resolvedAt: 42 });
    expect(await store.hasUnresolved(input.cindySessionId)).toBe(false);
    expect(await store.acknowledge({ ...input, stopReason: 'end_turn' })).toBeNull();
    await store.recordPending({ ...input, receiptId: 'unknown' });
    await store.markUncertain({ cindySessionId: input.cindySessionId, receiptIds: ['unknown'] });
    expect(await store.reject({ ...input, receiptId: 'unknown' })).toBeNull();
    expect(await store.hasUnresolved(input.cindySessionId)).toBe(true);
  });

  it('makes an interrupted receipt uncertain exactly once and never re-acknowledges it', async () => {
    const store = createDshPromptReceiptStore(createTestDbClient(), { now: () => 99 });
    seedBinding('cindy-session-a');
    seedBinding('cindy-session-b');
    await store.recordPending({ receiptId: 'dsh-receipt-a', cindySessionId: 'cindy-session-a' });
    await store.recordPending({ receiptId: 'dsh-receipt-b', cindySessionId: 'cindy-session-b' });

    await store.markUncertain({
      cindySessionId: 'cindy-session-a',
      receiptIds: ['dsh-receipt-a', 'dsh-receipt-a'],
    });
    expect(
      rawDb!
        .prepare('SELECT state, stop_reason AS stopReason, resolved_at AS resolvedAt FROM dsh_prompt_receipts WHERE receipt_id = ?')
        .get('dsh-receipt-a'),
    ).toEqual({ state: 'uncertain', stopReason: null, resolvedAt: 99 });
    await expect(store.hasUnresolved('cindy-session-a')).resolves.toBe(true);
    await expect(
      store.acknowledge({
        receiptId: 'dsh-receipt-a',
        cindySessionId: 'cindy-session-a',
        stopReason: 'cancelled',
      }),
    ).resolves.toBeNull();
    expect(
      rawDb!
        .prepare('SELECT state FROM dsh_prompt_receipts WHERE receipt_id = ?')
        .get('dsh-receipt-b'),
    ).toEqual({ state: 'pending' });
  });

  it('does not treat a rejected receipt with a damaged timestamp as settled', async () => {
    const store = createDshPromptReceiptStore(createTestDbClient(), { now: () => 42 });
    seedBinding('cindy-session-a');
    const input = { receiptId: 'damaged', cindySessionId: 'cindy-session-a' };
    await store.recordPending(input);
    await store.reject(input);
    rawDb!.prepare('UPDATE dsh_prompt_receipts SET resolved_at = 42.5 WHERE receipt_id = ?').run(input.receiptId);
    await expect(store.hasUnresolved(input.cindySessionId)).rejects.toThrow('timestamp');
  });

  it('rejects unsafe identifiers and receipt-state corruption before a recovery path can consume it', async () => {
    const store = createDshPromptReceiptStore(createTestDbClient());
    seedBinding('cindy-session-a');

    await expect(
      store.recordPending({ receiptId: 'receipt\nunsafe', cindySessionId: 'cindy-session-a' }),
    ).rejects.toThrow('receiptId');
    await store.recordPending({ receiptId: 'dsh-receipt-a', cindySessionId: 'cindy-session-a' });
    rawDb!
      .prepare("UPDATE dsh_prompt_receipts SET state = 'corrupt' WHERE receipt_id = ?")
      .run('dsh-receipt-a');

    await expect(store.hasUnresolved('cindy-session-a')).rejects.toThrow('stored state is unsupported');
    await expect(
      store.acknowledge({
        receiptId: 'dsh-receipt-a',
        cindySessionId: 'cindy-session-a',
        stopReason: 'end_turn',
      }),
    ).resolves.toBeNull();
  });

  it('does not treat an acknowledgement with incomplete terminal facts as settled', async () => {
    const store = createDshPromptReceiptStore(createTestDbClient(), { now: () => 123 });
    seedBinding('cindy-session-a');
    await store.recordPending({ receiptId: 'dsh-receipt-a', cindySessionId: 'cindy-session-a' });
    await store.acknowledge({
      receiptId: 'dsh-receipt-a',
      cindySessionId: 'cindy-session-a',
      stopReason: 'end_turn',
    });
    rawDb!
      .prepare('UPDATE dsh_prompt_receipts SET stop_reason = NULL WHERE receipt_id = ?')
      .run('dsh-receipt-a');

    await expect(store.hasUnresolved('cindy-session-a')).rejects.toThrow(
      'stored acknowledgement is inconsistent',
    );
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
    return { drizzle: drizzle(dbHandle, { schema }) } as Pick<DbClient, 'drizzle'>;
  }

  function seedBinding(cindySessionId: string): void {
    rawDb!.prepare('INSERT INTO sessions (id) VALUES (?)').run(cindySessionId);
    rawDb!
      .prepare('INSERT INTO dsh_session_bindings (cindy_session_id) VALUES (?)')
      .run(cindySessionId);
  }
});
