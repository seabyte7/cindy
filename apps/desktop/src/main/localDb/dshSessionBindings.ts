/**
 * Durable, Main-process-only ownership records for DSH ACP sessions.
 *
 * This module is deliberately not an IPC surface. It persists the minimum
 * restart/reconcile cursor only: opaque runtime session ids and release
 * identity. Credentials, endpoints, profile bodies, Home paths, prompts, and
 * raw ACP events are intentionally neither accepted nor stored here.
 */

import { and, asc, eq, or } from 'drizzle-orm';

import { hasDshAsciiControlCharacter } from '../../shared/dshSession.js';
import type { DbClient } from './client/DbClient.js';
import { dshSessionBindings } from './schema.js';

export type DshBindingHomeMode = 'cindy-managed' | 'existing-dsh-home';
export type DshBindingLifecycleState = 'active' | 'closed' | 'needs_reconcile';

export interface DshSessionBinding {
  cindySessionId: string;
  runtimeSessionId: string;
  hostScopeId: string;
  runtimeReleaseId: string;
  runtimeVersion: string;
  controllerApiVersion: number;
  capabilityFingerprint: string;
  homeMode: DshBindingHomeMode;
  lifecycleState: DshBindingLifecycleState;
  lastProjectedSequence: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

/** Data that must already be known after an acknowledged ACP create receipt. */
export interface DshCreateReceiptBinding {
  cindySessionId: string;
  runtimeSessionId: string;
  hostScopeId: string;
  runtimeReleaseId: string;
  runtimeVersion: string;
  controllerApiVersion: number;
  capabilityFingerprint: string;
  homeMode: DshBindingHomeMode;
}

export type DshProjectionAdvanceResult =
  | { kind: 'advanced'; binding: DshSessionBinding }
  | { kind: 'duplicate'; binding: DshSessionBinding }
  | { kind: 'gap'; binding: DshSessionBinding }
  | { kind: 'inactive'; binding: DshSessionBinding }
  | { kind: 'conflict'; binding: DshSessionBinding | null };

export interface DshSessionBindingStore {
  /** Never replaces an existing row: a create receipt has exactly one owner. */
  recordCreateReceipt(input: DshCreateReceiptBinding): Promise<DshSessionBinding>;
  getByCindySessionId(cindySessionId: string): Promise<DshSessionBinding | null>;
  listByScopeId(hostScopeId: string): Promise<readonly DshSessionBinding[]>;
  markClosed(input: {
    cindySessionId: string;
    expectedRevision: number;
  }): Promise<DshSessionBinding | null>;
  /**
   * A fresh runtime `session/list` proved the session is resumable but not
   * live on this new Cindy carrier. This is the only restart recovery that
   * may normalize a previously active binding to closed. A binding already
   * marked needs_reconcile remains fail-closed until history reconciliation.
   */
  markClosedAfterVerifiedRuntimeHistory(input: {
    cindySessionId: string;
    expectedRevision: number;
  }): Promise<DshSessionBinding | null>;
  /**
   * Only the owner that has freshly verified runtime state may reactivate a
   * closed/reconcile-needed binding. Callers must never infer this from a
   * local process being alive.
   */
  markActiveAfterVerifiedRuntimeState(input: {
    cindySessionId: string;
    expectedRevision: number;
    capabilityUpgrade?: { previous: string; next: string };
    releaseUpgrade?: { previous: string; next: string };
  }): Promise<DshSessionBinding | null>;
  markNeedsReconcile(input: {
    cindySessionId: string;
    expectedRevision: number;
  }): Promise<DshSessionBinding | null>;
  /**
   * Commits a projected event exactly once. A sequence gap moves the binding
   * into needs_reconcile; a stale writer cannot overwrite a newer revision.
   */
  advanceProjectionCursor(input: {
    cindySessionId: string;
    expectedRevision: number;
    nextSequence: number;
  }): Promise<DshProjectionAdvanceResult>;
}

const MAX_OPAQUE_ID_LENGTH = 512;
const MAX_RUNTIME_VERSION_LENGTH = 128;
const MAX_CAPABILITY_FINGERPRINT_LENGTH = 256;

type DshBindingRow = typeof dshSessionBindings.$inferSelect;

function assertSafeText(value: string, label: string, maxLength = MAX_OPAQUE_ID_LENGTH): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(
      `DSH binding ${label} must be a non-empty string of at most ${maxLength} characters`,
    );
  }
  if (value.trim() !== value || hasDshAsciiControlCharacter(value)) {
    throw new Error(`DSH binding ${label} contains unsupported whitespace or control characters`);
  }
}

function assertPositiveSafeInteger(value: number, label: string, minimum = 1): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(
      `DSH binding ${label} must be a safe integer greater than or equal to ${minimum}`,
    );
  }
}

function assertCreateReceiptBinding(input: DshCreateReceiptBinding): void {
  assertSafeText(input.cindySessionId, 'cindySessionId');
  assertSafeText(input.runtimeSessionId, 'runtimeSessionId');
  assertSafeText(input.hostScopeId, 'hostScopeId');
  assertSafeText(input.runtimeReleaseId, 'runtimeReleaseId');
  assertSafeText(input.runtimeVersion, 'runtimeVersion', MAX_RUNTIME_VERSION_LENGTH);
  assertPositiveSafeInteger(input.controllerApiVersion, 'controllerApiVersion');
  assertSafeText(
    input.capabilityFingerprint,
    'capabilityFingerprint',
    MAX_CAPABILITY_FINGERPRINT_LENGTH,
  );
  if (input.homeMode !== 'cindy-managed' && input.homeMode !== 'existing-dsh-home') {
    throw new Error('DSH binding homeMode is unsupported');
  }
}

function assertRevision(value: number): void {
  assertPositiveSafeInteger(value, 'expectedRevision');
}

function toBinding(row: DshBindingRow): DshSessionBinding {
  // SQLite does not enforce Drizzle's TypeScript enums. Treat a malformed or
  // hand-corrupted row as unavailable instead of handing it to a native
  // resume/create path with a guessed lifecycle or identity.
  assertSafeText(row.cindySessionId, 'stored cindySessionId');
  assertSafeText(row.runtimeSessionId, 'stored runtimeSessionId');
  assertSafeText(row.hostScopeId, 'stored hostScopeId');
  assertSafeText(row.runtimeReleaseId, 'stored runtimeReleaseId');
  assertSafeText(row.runtimeVersion, 'stored runtimeVersion', MAX_RUNTIME_VERSION_LENGTH);
  assertPositiveSafeInteger(row.controllerApiVersion, 'stored controllerApiVersion');
  assertSafeText(
    row.capabilityFingerprint,
    'stored capabilityFingerprint',
    MAX_CAPABILITY_FINGERPRINT_LENGTH,
  );
  if (row.homeMode !== 'cindy-managed' && row.homeMode !== 'existing-dsh-home') {
    throw new Error('DSH binding stored homeMode is unsupported');
  }
  if (
    row.lifecycleState !== 'active' &&
    row.lifecycleState !== 'closed' &&
    row.lifecycleState !== 'needs_reconcile'
  ) {
    throw new Error('DSH binding stored lifecycleState is unsupported');
  }
  assertPositiveSafeInteger(row.lastProjectedSequence, 'stored lastProjectedSequence', 0);
  assertPositiveSafeInteger(row.revision, 'stored revision');
  assertPositiveSafeInteger(row.createdAt, 'stored createdAt', 0);
  assertPositiveSafeInteger(row.updatedAt, 'stored updatedAt', 0);
  return {
    cindySessionId: row.cindySessionId,
    runtimeSessionId: row.runtimeSessionId,
    hostScopeId: row.hostScopeId,
    runtimeReleaseId: row.runtimeReleaseId,
    runtimeVersion: row.runtimeVersion,
    controllerApiVersion: row.controllerApiVersion,
    capabilityFingerprint: row.capabilityFingerprint,
    homeMode: row.homeMode,
    lifecycleState: row.lifecycleState,
    lastProjectedSequence: row.lastProjectedSequence,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDshSessionBindingStore(
  client: Pick<DbClient, 'drizzle'>,
  options: { now?: () => number } = {},
): DshSessionBindingStore {
  const now = options.now ?? Date.now;
  const db = client.drizzle;

  async function getByCindySessionId(cindySessionId: string): Promise<DshSessionBinding | null> {
    assertSafeText(cindySessionId, 'cindySessionId');
    const [row] = await db
      .select()
      .from(dshSessionBindings)
      .where(eq(dshSessionBindings.cindySessionId, cindySessionId))
      .limit(1);
    return row ? toBinding(row) : null;
  }

  async function transition(
    cindySessionId: string,
    expectedRevision: number,
    expectedStates: readonly DshBindingLifecycleState[],
    lifecycleState: DshBindingLifecycleState,
    capabilityUpgrade?: { previous: string; next: string },
    releaseUpgrade?: { previous: string; next: string },
  ): Promise<DshSessionBinding | null> {
    assertSafeText(cindySessionId, 'cindySessionId');
    assertRevision(expectedRevision);
    if (capabilityUpgrade) {
      assertSafeText(capabilityUpgrade.previous, 'previous capability fingerprint');
      assertSafeText(capabilityUpgrade.next, 'next capability fingerprint');
    }
    if (releaseUpgrade && (releaseUpgrade.previous !== 'cindy-dsh-0.1.6-alpha.2-build.1-macos-supervised' ||
        releaseUpgrade.next !== 'cindy-dsh-0.1.6-alpha.2-build.2-macos-supervised')) {
      throw new Error('DSH release compatibility upgrade is unsupported');
    }
    const [updated] = await db
      .update(dshSessionBindings)
      .set({
        lifecycleState,
        revision: expectedRevision + 1,
        updatedAt: now(),
        ...(capabilityUpgrade ? { capabilityFingerprint: capabilityUpgrade.next } : {}),
        ...(releaseUpgrade ? { runtimeReleaseId: releaseUpgrade.next } : {}),
      })
      .where(
        and(
          eq(dshSessionBindings.cindySessionId, cindySessionId),
          eq(dshSessionBindings.revision, expectedRevision),
          ...(capabilityUpgrade ? [eq(dshSessionBindings.capabilityFingerprint, capabilityUpgrade.previous)] : []),
          ...(releaseUpgrade ? [eq(dshSessionBindings.runtimeReleaseId, releaseUpgrade.previous), eq(dshSessionBindings.runtimeVersion, '0.1.6-alpha.2'), eq(dshSessionBindings.homeMode, 'cindy-managed')] : []),
          or(...expectedStates.map((state) => eq(dshSessionBindings.lifecycleState, state))),
        ),
      )
      .returning();
    return updated ? toBinding(updated) : null;
  }

  return {
    async recordCreateReceipt(input) {
      assertCreateReceiptBinding(input);
      const timestamp = now();
      assertPositiveSafeInteger(timestamp, 'timestamp', 0);
      const [created] = await db
        .insert(dshSessionBindings)
        .values({
          ...input,
          lifecycleState: 'active',
          lastProjectedSequence: 0,
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();
      if (!created) throw new Error('DSH binding insert did not return a row');
      return toBinding(created);
    },

    getByCindySessionId,

    async listByScopeId(hostScopeId) {
      assertSafeText(hostScopeId, 'hostScopeId');
      const rows = await db
        .select()
        .from(dshSessionBindings)
        .where(eq(dshSessionBindings.hostScopeId, hostScopeId))
        .orderBy(asc(dshSessionBindings.createdAt), asc(dshSessionBindings.cindySessionId));
      return rows.map(toBinding);
    },

    markClosed: ({ cindySessionId, expectedRevision }) =>
      transition(cindySessionId, expectedRevision, ['active'], 'closed'),

    markClosedAfterVerifiedRuntimeHistory: ({ cindySessionId, expectedRevision }) =>
      transition(cindySessionId, expectedRevision, ['active'], 'closed'),

    markActiveAfterVerifiedRuntimeState: ({ cindySessionId, expectedRevision, capabilityUpgrade, releaseUpgrade }) =>
      transition(cindySessionId, expectedRevision, capabilityUpgrade || releaseUpgrade ? ['closed'] : ['closed', 'needs_reconcile'], 'active', capabilityUpgrade, releaseUpgrade),

    markNeedsReconcile: ({ cindySessionId, expectedRevision }) =>
      transition(
        cindySessionId,
        expectedRevision,
        ['active', 'closed', 'needs_reconcile'],
        'needs_reconcile',
      ),

    async advanceProjectionCursor({ cindySessionId, expectedRevision, nextSequence }) {
      assertSafeText(cindySessionId, 'cindySessionId');
      assertRevision(expectedRevision);
      assertPositiveSafeInteger(nextSequence, 'nextSequence');

      const current = await getByCindySessionId(cindySessionId);
      if (!current) return { kind: 'conflict', binding: null };
      if (current.revision !== expectedRevision) return { kind: 'conflict', binding: current };
      if (current.lifecycleState !== 'active') return { kind: 'inactive', binding: current };
      if (nextSequence <= current.lastProjectedSequence)
        return { kind: 'duplicate', binding: current };

      if (nextSequence !== current.lastProjectedSequence + 1) {
        const binding = await transition(
          cindySessionId,
          expectedRevision,
          ['active'],
          'needs_reconcile',
        );
        return binding
          ? { kind: 'gap', binding }
          : { kind: 'conflict', binding: await getByCindySessionId(cindySessionId) };
      }

      const [updated] = await db
        .update(dshSessionBindings)
        .set({
          lastProjectedSequence: nextSequence,
          revision: expectedRevision + 1,
          updatedAt: now(),
        })
        .where(
          and(
            eq(dshSessionBindings.cindySessionId, cindySessionId),
            eq(dshSessionBindings.revision, expectedRevision),
            eq(dshSessionBindings.lifecycleState, 'active'),
            eq(dshSessionBindings.lastProjectedSequence, current.lastProjectedSequence),
          ),
        )
        .returning();
      return updated
        ? { kind: 'advanced', binding: toBinding(updated) }
        : { kind: 'conflict', binding: await getByCindySessionId(cindySessionId) };
    },
  };
}
