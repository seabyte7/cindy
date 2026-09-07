/**
 * Durable Main-only store for Cindy-owned DSH activity snapshots.
 *
 * A row is a closed, canonical maker-core `cindy-dsh` snapshot for exactly one
 * already-bound Cindy task. It is intentionally not an event or terminal-log
 * bucket: raw ACP data, native identifiers, terminal bytes, prompt text,
 * stderr, stack traces, endpoints, profiles, and credentials are rejected
 * before SQLite sees them.
 */

import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import {
  isDshActivitySnapshot,
  reduceDshActivity,
  type DshActivityMutation,
  type DshActivityObject,
  type DshActivitySnapshot,
  type DshActivityAction,
  type DshActivityRejectionReason,
} from '@cindy/maker-core';

import type { DbClient } from './client/DbClient.js';
import { dshActivitySnapshots } from './schema.js';

const MAX_OPAQUE_ID_LENGTH = 512;
const MAX_SNAPSHOT_BYTES = 512 * 1024;

type DshActivitySnapshotRow = typeof dshActivitySnapshots.$inferSelect;

export interface DshActivitySnapshotRecord {
  cindySessionId: string;
  hostScopeId: string;
  snapshot: DshActivitySnapshot;
  sequence: number;
  createdAt: number;
  updatedAt: number;
}

export type DshActivitySnapshotCreateResult =
  | { kind: 'created'; record: DshActivitySnapshotRecord }
  | { kind: 'exists'; record: DshActivitySnapshotRecord };

export type DshActivitySnapshotApplyResult =
  | {
      kind: 'mutated';
      record: DshActivitySnapshotRecord;
      activity: DshActivityObject;
    }
  | {
      kind: 'action-admitted';
      record: DshActivitySnapshotRecord;
      activity: DshActivityObject;
      action: DshActivityAction;
    }
  | {
      kind: 'rejected';
      record: DshActivitySnapshotRecord;
      reason: DshActivityRejectionReason;
    }
  | { kind: 'missing' }
  | { kind: 'conflict'; record: DshActivitySnapshotRecord | null };

export interface DshActivitySnapshotStore {
  get(input: {
    cindySessionId: string;
    hostScopeId: string;
  }): Promise<DshActivitySnapshotRecord | null>;
  /** An existing snapshot is immutable at creation time; callers must use apply. */
  create(input: {
    cindySessionId: string;
    hostScopeId: string;
    snapshot: DshActivitySnapshot;
  }): Promise<DshActivitySnapshotCreateResult>;
  /**
   * Applies exactly one finite maker-core mutation with a SQLite sequence CAS.
   * `action-admitted` is only an authorization result; this method never
   * executes an ACP, terminal, process, filesystem, or renderer action.
   */
  apply(input: {
    cindySessionId: string;
    hostScopeId: string;
    mutation: DshActivityMutation;
  }): Promise<DshActivitySnapshotApplyResult>;
}

function assertOpaqueId(value: string, label: string): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_OPAQUE_ID_LENGTH ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`DSH activity ${label} is not a safe opaque identifier`);
  }
}

function assertTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('DSH activity timestamp must be a non-negative safe integer');
  }
}

function canonicalSnapshotJson(snapshot: DshActivitySnapshot): string {
  if (
    !isDshActivitySnapshot(snapshot) ||
    snapshot.sequence < 1 ||
    snapshot.activities.length === 0
  ) {
    throw new Error('DSH activity snapshot is not a non-empty closed contract');
  }
  const json = JSON.stringify(snapshot);
  if (Buffer.byteLength(json, 'utf8') > MAX_SNAPSHOT_BYTES) {
    throw new Error('DSH activity snapshot exceeds the byte limit');
  }
  return json;
}

function snapshotDigest(snapshotJson: string): string {
  return createHash('sha256').update(snapshotJson).digest('hex');
}

function assertSnapshotOwnership(
  snapshot: DshActivitySnapshot,
  cindySessionId: string,
  hostScopeId: string,
): void {
  for (const activity of snapshot.activities) {
    if (activity.cindySessionId !== cindySessionId || activity.scopeId !== hostScopeId) {
      throw new Error('DSH activity snapshot contains a cross-owner activity');
    }
  }
}

function parseStoredSnapshot(row: DshActivitySnapshotRow): DshActivitySnapshotRecord {
  assertOpaqueId(row.cindySessionId, 'stored cindySessionId');
  assertOpaqueId(row.hostScopeId, 'stored hostScopeId');
  assertTimestamp(row.createdAt);
  assertTimestamp(row.updatedAt);
  if (row.updatedAt < row.createdAt) {
    throw new Error('DSH activity stored update predates creation');
  }
  if (!Number.isSafeInteger(row.sequence) || row.sequence < 1) {
    throw new Error('DSH activity stored sequence is invalid');
  }
  if (!/^[a-f0-9]{64}$/.test(row.activitySha256)) {
    throw new Error('DSH activity stored snapshot digest is invalid');
  }
  if (Buffer.byteLength(row.activityJson, 'utf8') > MAX_SNAPSHOT_BYTES) {
    throw new Error('DSH activity stored snapshot exceeds the byte limit');
  }
  if (snapshotDigest(row.activityJson) !== row.activitySha256) {
    throw new Error('DSH activity stored snapshot digest does not match');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.activityJson) as unknown;
  } catch {
    throw new Error('DSH activity stored snapshot is not JSON');
  }
  if (!isDshActivitySnapshot(parsed)) {
    throw new Error('DSH activity stored snapshot is not a closed contract');
  }
  if (parsed.sequence !== row.sequence || JSON.stringify(parsed) !== row.activityJson) {
    throw new Error('DSH activity stored snapshot is not canonical');
  }
  assertSnapshotOwnership(parsed, row.cindySessionId, row.hostScopeId);
  return {
    cindySessionId: row.cindySessionId,
    hostScopeId: row.hostScopeId,
    snapshot: parsed,
    sequence: row.sequence,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The explicit `hostScopeId` lookup makes a stale scope or account carrier
 * unable to observe or mutate another DSH activity tree, even if it happens
 * to know a Cindy task id.
 */
export function createDshActivitySnapshotStore(
  client: Pick<DbClient, 'drizzle'>,
  options: { now?: () => number } = {},
): DshActivitySnapshotStore {
  const db = client.drizzle;
  const now = options.now ?? Date.now;

  async function get(input: {
    cindySessionId: string;
    hostScopeId: string;
  }): Promise<DshActivitySnapshotRecord | null> {
    assertOpaqueId(input.cindySessionId, 'cindySessionId');
    assertOpaqueId(input.hostScopeId, 'hostScopeId');
    const [row] = await db
      .select()
      .from(dshActivitySnapshots)
      .where(
        and(
          eq(dshActivitySnapshots.cindySessionId, input.cindySessionId),
          eq(dshActivitySnapshots.hostScopeId, input.hostScopeId),
        ),
      )
      .limit(1);
    return row ? parseStoredSnapshot(row) : null;
  }

  return {
    get,

    async create(input) {
      assertOpaqueId(input.cindySessionId, 'cindySessionId');
      assertOpaqueId(input.hostScopeId, 'hostScopeId');
      const activityJson = canonicalSnapshotJson(input.snapshot);
      assertSnapshotOwnership(input.snapshot, input.cindySessionId, input.hostScopeId);
      const timestamp = now();
      assertTimestamp(timestamp);
      const [created] = await db
        .insert(dshActivitySnapshots)
        .values({
          cindySessionId: input.cindySessionId,
          hostScopeId: input.hostScopeId,
          activityJson,
          activitySha256: snapshotDigest(activityJson),
          sequence: input.snapshot.sequence,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .onConflictDoNothing()
        .returning();
      if (created) return { kind: 'created', record: parseStoredSnapshot(created) };
      const existing = await get(input);
      if (!existing) throw new Error('DSH activity snapshot create conflict could not be read');
      return { kind: 'exists', record: existing };
    },

    async apply(input) {
      const current = await get(input);
      if (!current) return { kind: 'missing' };
      const reduced = reduceDshActivity(current.snapshot, input.mutation);
      if (reduced.kind === 'rejected') {
        return { kind: 'rejected', record: current, reason: reduced.reason };
      }
      if (reduced.kind === 'action-admitted') {
        return {
          kind: 'action-admitted',
          record: current,
          activity: reduced.activity,
          action: reduced.action,
        };
      }

      const activityJson = canonicalSnapshotJson(reduced.snapshot);
      assertSnapshotOwnership(reduced.snapshot, input.cindySessionId, input.hostScopeId);
      // Wall clocks may move backwards while Cindy is running. Preserve the
      // durable ordering invariant enforced by the read-side corruption check.
      const timestamp = Math.max(now(), current.updatedAt);
      assertTimestamp(timestamp);
      const [updated] = await db
        .update(dshActivitySnapshots)
        .set({
          activityJson,
          activitySha256: snapshotDigest(activityJson),
          sequence: reduced.snapshot.sequence,
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(dshActivitySnapshots.cindySessionId, input.cindySessionId),
            eq(dshActivitySnapshots.hostScopeId, input.hostScopeId),
            eq(dshActivitySnapshots.sequence, current.sequence),
          ),
        )
        .returning();
      if (!updated) return { kind: 'conflict', record: await get(input) };
      return {
        kind: 'mutated',
        record: parseStoredSnapshot(updated),
        activity: reduced.activity,
      };
    },
  };
}
