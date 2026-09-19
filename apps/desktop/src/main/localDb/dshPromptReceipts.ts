/**
 * Main-only durable outcome ledger for DSH prompt attempts.
 *
 * This is not a transcript and deliberately admits no prompt text, content
 * hash, runtime error, endpoint, credential or Home path. A pending or
 * uncertain entry is a no-replay boundary: later product recovery must prove
 * history before another prompt can be sent for the same Cindy session.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { DshBridgePromptStopReason } from '@cindy/maker-core';

import { hasDshAsciiControlCharacter } from '../../shared/dshSession.js';
import type { DbClient } from './client/DbClient.js';
import { dshPromptReceipts } from './schema.js';

export type DshPromptReceiptState = 'pending' | 'acknowledged' | 'rejected' | 'uncertain';

export interface DshPromptReceipt {
  receiptId: string;
  cindySessionId: string;
  state: DshPromptReceiptState;
  stopReason: DshBridgePromptStopReason | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface DshPromptReceiptStore {
  recordPending(input: { receiptId: string; cindySessionId: string }): Promise<DshPromptReceipt>;
  acknowledge(input: {
    receiptId: string;
    cindySessionId: string;
    stopReason: DshBridgePromptStopReason;
  }): Promise<DshPromptReceipt | null>;
  markUncertain(input: {
    cindySessionId: string;
    receiptIds: readonly string[];
  }): Promise<void>;
  hasUnresolved(cindySessionId: string): Promise<boolean>;
  reject(input: { receiptId: string; cindySessionId: string }): Promise<DshPromptReceipt | null>;
}

const MAX_OPAQUE_ID_LENGTH = 512;

type DshPromptReceiptRow = typeof dshPromptReceipts.$inferSelect;

function assertOpaqueId(value: string, label: string): void {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_OPAQUE_ID_LENGTH
    || value.trim() !== value
    || hasDshAsciiControlCharacter(value)
  ) {
    throw new Error(`DSH prompt receipt ${label} is not a safe opaque identifier`);
  }
}

function assertTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('DSH prompt receipt timestamp must be a non-negative safe integer');
  }
}

function toReceipt(row: DshPromptReceiptRow): DshPromptReceipt {
  assertOpaqueId(row.receiptId, 'stored receiptId');
  assertOpaqueId(row.cindySessionId, 'stored cindySessionId');
  if (
    row.state !== 'pending'
    && row.state !== 'acknowledged'
    && row.state !== 'uncertain'
    && row.state !== 'rejected'
  ) {
    throw new Error('DSH prompt receipt stored state is unsupported');
  }
  if (row.stopReason !== null && row.stopReason !== 'end_turn' && row.stopReason !== 'cancelled') {
    throw new Error('DSH prompt receipt stored stopReason is unsupported');
  }
  if ((row.state === 'acknowledged') !== (row.stopReason !== null)) {
    throw new Error('DSH prompt receipt stored acknowledgement is inconsistent');
  }
  if ((row.state === 'pending') !== (row.resolvedAt === null)) {
    throw new Error('DSH prompt receipt stored resolution is inconsistent');
  }
  assertTimestamp(row.createdAt);
  if (row.resolvedAt !== null) {
    assertTimestamp(row.resolvedAt);
    if (row.resolvedAt < row.createdAt) {
      throw new Error('DSH prompt receipt stored resolution predates creation');
    }
  }
  return {
    receiptId: row.receiptId,
    cindySessionId: row.cindySessionId,
    state: row.state,
    stopReason: row.stopReason,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  };
}

/**
 * All writes are one-way: pending becomes acknowledged, rejected or uncertain, never
 * returns to pending. This lets a disconnect survive process loss as a
 * durable no-replay fact rather than a guess based on local memory.
 */
export function createDshPromptReceiptStore(
  client: Pick<DbClient, 'drizzle'>,
  options: { now?: () => number } = {},
): DshPromptReceiptStore {
  const db = client.drizzle;
  const now = options.now ?? Date.now;

  return {
    async recordPending(input) {
      assertOpaqueId(input.receiptId, 'receiptId');
      assertOpaqueId(input.cindySessionId, 'cindySessionId');
      const timestamp = now();
      assertTimestamp(timestamp);
      const [created] = await db
        .insert(dshPromptReceipts)
        .values({
          receiptId: input.receiptId,
          cindySessionId: input.cindySessionId,
          state: 'pending',
          createdAt: timestamp,
          resolvedAt: null,
          stopReason: null,
        })
        .returning();
      if (!created) throw new Error('DSH prompt receipt insert did not return a row');
      return toReceipt(created);
    },

    async acknowledge(input) {
      assertOpaqueId(input.receiptId, 'receiptId');
      assertOpaqueId(input.cindySessionId, 'cindySessionId');
      if (input.stopReason !== 'end_turn' && input.stopReason !== 'cancelled') {
        throw new Error('DSH prompt receipt stopReason is unsupported');
      }
      const timestamp = now();
      assertTimestamp(timestamp);
      const [updated] = await db
        .update(dshPromptReceipts)
        .set({ state: 'acknowledged', stopReason: input.stopReason, resolvedAt: timestamp })
        .where(
          and(
            eq(dshPromptReceipts.receiptId, input.receiptId),
            eq(dshPromptReceipts.cindySessionId, input.cindySessionId),
            eq(dshPromptReceipts.state, 'pending'),
          ),
        )
        .returning();
      return updated ? toReceipt(updated) : null;
    },

    async reject(input) {
      assertOpaqueId(input.receiptId, 'receiptId');
      assertOpaqueId(input.cindySessionId, 'cindySessionId');
      const timestamp = now();
      assertTimestamp(timestamp);
      const [updated] = await db.update(dshPromptReceipts)
        .set({ state: 'rejected', stopReason: null, resolvedAt: timestamp })
        .where(and(
          eq(dshPromptReceipts.receiptId, input.receiptId),
          eq(dshPromptReceipts.cindySessionId, input.cindySessionId),
          eq(dshPromptReceipts.state, 'pending'),
        )).returning();
      return updated ? toReceipt(updated) : null;
    },

    async markUncertain(input) {
      assertOpaqueId(input.cindySessionId, 'cindySessionId');
      if (input.receiptIds.length === 0) return;
      const uniqueReceiptIds = [...new Set(input.receiptIds)];
      if (uniqueReceiptIds.length > 16) {
        throw new Error('DSH prompt receipt uncertain update exceeds the bounded receipt count');
      }
      for (const receiptId of uniqueReceiptIds) assertOpaqueId(receiptId, 'receiptId');
      const timestamp = now();
      assertTimestamp(timestamp);
      await db
        .update(dshPromptReceipts)
        .set({ state: 'uncertain', stopReason: null, resolvedAt: timestamp })
        .where(
          and(
            eq(dshPromptReceipts.cindySessionId, input.cindySessionId),
            eq(dshPromptReceipts.state, 'pending'),
            inArray(dshPromptReceipts.receiptId, uniqueReceiptIds),
          ),
        );
    },

    async hasUnresolved(cindySessionId) {
      assertOpaqueId(cindySessionId, 'cindySessionId');
      const [row] = await db
        .select()
        .from(dshPromptReceipts)
        .where(
          and(
            eq(dshPromptReceipts.cindySessionId, cindySessionId),
            // SQL NULL has three-valued logic: use CASE so a damaged
            // acknowledged row (for example, a missing stop_reason) remains
            // visible and `toReceipt` can fail closed instead of treating it
            // as safely settled.
            sql`CASE
              WHEN ${dshPromptReceipts.state} = 'acknowledged'
               AND ${dshPromptReceipts.stopReason} IN ('end_turn', 'cancelled')
               AND ${dshPromptReceipts.resolvedAt} IS NOT NULL
              THEN 0
              WHEN ${dshPromptReceipts.state} = 'rejected'
               AND ${dshPromptReceipts.stopReason} IS NULL
               AND typeof(${dshPromptReceipts.createdAt}) = 'integer'
               AND typeof(${dshPromptReceipts.resolvedAt}) = 'integer'
               AND ${dshPromptReceipts.resolvedAt} >= ${dshPromptReceipts.createdAt}
               AND ${dshPromptReceipts.createdAt} >= 0
               AND ${dshPromptReceipts.resolvedAt} <= 9007199254740991
              THEN 0
              ELSE 1
            END = 1`,
          ),
        )
        .orderBy(asc(dshPromptReceipts.createdAt), asc(dshPromptReceipts.receiptId))
        .limit(1);
      if (!row) return false;
      const receipt = toReceipt(row);
      return receipt.state !== 'acknowledged' && receipt.state !== 'rejected';
    },
  };
}
