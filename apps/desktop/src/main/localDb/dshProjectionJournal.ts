/**
 * Main-only persistence boundary for a translated DSH AgentEvent.
 *
 * The native update itself is never accepted here. Callers must first use the
 * maker-core DSH translator, then commit its display-safe AgentEvent with the
 * matching bridge sequence. The worker transaction writes the event and
 * advances the durable binding cursor together.
 */

import { createHash } from 'node:crypto';

import type { AgentEvent } from '@cindy/maker-core';

import type { DbClient } from './client/DbClient.js';
import type {
  DshCommitProjectionResult,
  DshProjectionRejectionReason,
  DshRejectProjectionResult,
} from './client/tx/types.js';

export const DSH_PROJECTION_EVENT_MAX_BYTES = 512 * 1024;
const MAX_DSH_PROJECTION_EVENT_DEPTH = 16;
const MAX_DSH_PROJECTION_EVENT_ITEMS = 2_048;
const BLOCKED_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DSH_PROJECTED_EVENT_TYPES = new Set([
  'text',
  'thinking',
  'tool_use',
  'tool_result',
  'tool_result_full',
  'status',
]);
const DSH_PROJECTION_IGNORED_REASONS = new Set<DshProjectionIgnoredReason>([
  'empty-content',
  'unsupported-content',
  'unsupported-update',
]);
const DSH_PROJECTION_REJECTION_REASONS = new Set<DshProjectionRejectionReason>([
  'invalid-envelope',
  'invalid-message-update',
  'invalid-thought-update',
  'invalid-tool-call',
  'invalid-tool-result',
  'invalid-usage-update',
]);

export type DshProjectionIgnoredReason =
  | 'empty-content'
  | 'unsupported-content'
  | 'unsupported-update';

export type DshProjectionRecord =
  | {
      version: 1;
      kind: 'events';
      events: readonly AgentEvent[];
    }
  | {
      version: 1;
      kind: 'ignored';
      reason: DshProjectionIgnoredReason;
    };

export interface DshProjectionJournalCommit {
  cindySessionId: string;
  expectedBindingRevision: number;
  sequence: number;
  record: Readonly<DshProjectionRecord>;
}

export interface DshProjectionJournalReject {
  cindySessionId: string;
  expectedBindingRevision: number;
  sequence: number;
  reason: DshProjectionRejectionReason;
}

export interface DshProjectionJournal {
  commit(input: DshProjectionJournalCommit): Promise<DshCommitProjectionResult>;
  reject(input: DshProjectionJournalReject): Promise<DshRejectProjectionResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOpaqueId(value: string, label: string): void {
  if (
    value.length === 0
    || value.length > 512
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`DSH projection ${label} is not a safe opaque identifier`);
  }
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`DSH projection ${label} must be a positive safe integer`);
  }
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`DSH projection ${label} must be a non-negative safe integer`);
  }
}

function assertDshProjectionEvent(event: Readonly<AgentEvent>, sequence: number): void {
  if (
    Object.keys(event).length !== 4
    || event.source !== 'dsh'
    || !DSH_PROJECTED_EVENT_TYPES.has(event.type)
    || !isRecord(event.agentMeta)
    || Object.keys(event.agentMeta).length !== 1
    || !isRecord(event.agentMeta.dsh)
    || Object.keys(event.agentMeta.dsh).length !== 1
    || event.agentMeta.dsh.projectionSequence !== sequence
  ) {
    throw new Error('DSH projection event does not match the F4 translator contract');
  }
}

function assertCanonicalJsonInput(
  value: unknown,
  depth = 0,
  state = { items: 0 },
): void {
  if (depth > MAX_DSH_PROJECTION_EVENT_DEPTH || state.items++ >= MAX_DSH_PROJECTION_EVENT_ITEMS) {
    throw new Error('DSH projection event exceeds structural limits');
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('DSH projection event contains a non-finite number');
    return;
  }
  if (Array.isArray(value)) {
    for (const nested of value) assertCanonicalJsonInput(nested, depth + 1, state);
    return;
  }
  if (!isRecord(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error('DSH projection event contains a non-JSON object');
  }
  for (const [key, nested] of Object.entries(value)) {
    if (
      key.length === 0
      || key.length > 4 * 1024
      || /[\u0000-\u001f\u007f]/.test(key)
      || BLOCKED_JSON_KEYS.has(key)
    ) {
      throw new Error('DSH projection event contains an unsafe JSON key');
    }
    if (nested === undefined) throw new Error('DSH projection event contains undefined');
    assertCanonicalJsonInput(nested, depth + 1, state);
  }
}

/**
 * Construct the journal with a narrow worker-transaction capability, keeping
 * raw DB/Drizzle access out of the DSH bridge path.
 */
export function createDshProjectionJournal(
  client: Pick<DbClient, 'tx'>,
  options: { now?: () => number } = {},
): DshProjectionJournal {
  const now = options.now ?? Date.now;
  return {
    async commit(input) {
      assertOpaqueId(input.cindySessionId, 'cindySessionId');
      assertPositiveSafeInteger(input.expectedBindingRevision, 'expectedBindingRevision');
      assertPositiveSafeInteger(input.sequence, 'sequence');
      const recordJson = serializeDshProjectionRecord(input.record, input.sequence);
      const createdAt = now();
      assertNonNegativeSafeInteger(createdAt, 'createdAt');
      return client.tx('dsh.commitProjection', {
        cindySessionId: input.cindySessionId,
        expectedBindingRevision: input.expectedBindingRevision,
        sequence: input.sequence,
        recordJson,
        recordSha256: createHash('sha256').update(recordJson).digest('hex'),
        createdAt,
      });
    },
    async reject(input) {
      assertOpaqueId(input.cindySessionId, 'cindySessionId');
      assertPositiveSafeInteger(input.expectedBindingRevision, 'expectedBindingRevision');
      assertPositiveSafeInteger(input.sequence, 'sequence');
      if (!DSH_PROJECTION_REJECTION_REASONS.has(input.reason)) {
        throw new Error('DSH projection rejection reason is unsupported');
      }
      const createdAt = now();
      assertNonNegativeSafeInteger(createdAt, 'createdAt');
      return client.tx('dsh.rejectProjection', {
        ...input,
        createdAt,
      });
    },
  };
}

/**
 * This boundary permits only the finite F4 translator output. It checks the
 * DSH source and exact sequence metadata before crossing into SQLite; worker
 * code repeats these checks because the journal is not a renderer API.
 */
export function serializeDshProjectionRecord(
  record: Readonly<DshProjectionRecord>,
  sequence: number,
): string {
  assertPositiveSafeInteger(sequence, 'sequence');
  if (record.version !== 1 || (record.kind !== 'events' && record.kind !== 'ignored')) {
    throw new Error('DSH projection record has an unsupported version or kind');
  }
  if (record.kind === 'events') {
    if (record.events.length === 0 || record.events.length > 16) {
      throw new Error('DSH projection event record must contain a bounded non-empty event list');
    }
    for (const event of record.events) assertDshProjectionEvent(event, sequence);
  } else if (!DSH_PROJECTION_IGNORED_REASONS.has(record.reason)) {
    throw new Error('DSH projection ignored reason is unsupported');
  }
  assertCanonicalJsonInput(record);
  const recordJson = JSON.stringify(record);
  if (typeof recordJson !== 'string' || Buffer.byteLength(recordJson, 'utf8') > DSH_PROJECTION_EVENT_MAX_BYTES) {
    throw new Error(`DSH projection event exceeds ${DSH_PROJECTION_EVENT_MAX_BYTES} UTF-8 bytes`);
  }
  // Reparse rather than handing a potentially exotic object to the worker.
  // Recursive input validation already rejected undefined, bigint, NaN and
  // function-valued fields before JSON.stringify could coerce or drop them.
  let parsed: unknown;
  try {
    parsed = JSON.parse(recordJson) as unknown;
  } catch {
    throw new Error('DSH projection event cannot be serialized as JSON');
  }
  if (JSON.stringify(parsed) !== recordJson) {
    throw new Error('DSH projection event is not canonical JSON');
  }
  return recordJson;
}
