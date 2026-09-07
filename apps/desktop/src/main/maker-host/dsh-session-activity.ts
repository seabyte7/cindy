/**
 * Main-owned lifecycle projection for the one Cindy DSH session activity.
 *
 * This is intentionally narrower than the future plan/terminal/job tree. It
 * projects only facts Cindy has already acknowledged through the public ACP
 * lifecycle: a session was created, explicitly closed, or explicitly resumed.
 * It never accepts an ACP update, native session id, prompt text, command,
 * terminal bytes, or a renderer-selected action as activity input.
 */

import { randomUUID } from 'node:crypto';

import {
  createEmptyDshActivitySnapshot,
  reduceDshActivity,
  type DshActivityObject,
  type DshActivitySnapshot,
} from '@cindy/maker-core';

import type {
  DshActivitySnapshotRecord,
  DshActivitySnapshotStore,
} from '../localDb/dshActivitySnapshots.js';

const LIVE_SESSION_ACTIONS = ['observe', 'cancel', 'close'] as const;
const OBSERVE_ONLY = ['observe'] as const;

export interface DshSessionActivityInput {
  cindySessionId: string;
  scopeId: string;
}

/**
 * Synchronous Main-only write admission for Cindy-local DSH plans and todos.
 *
 * SQLite remains the durable source of the activity view, but a carrier EOF
 * reaches Main before its binding/activity writes can finish. This narrowly
 * scoped gate closes that interval: it starts deny-by-default, is opened only
 * after an acknowledged `created`/`resumed` root projection, and is revoked
 * synchronously before a close/restore/disconnect projection awaits storage.
 * It holds neither a native identifier nor a renderer capability.
 */
export interface DshActivityMutationGate {
  allow(input: DshSessionActivityInput): void;
  revoke(input: DshSessionActivityInput): void;
  isAllowed(input: DshSessionActivityInput): boolean;
}

function mutationGateKey(input: DshSessionActivityInput): string {
  return `${input.scopeId}\u0000${input.cindySessionId}`;
}

export function createDshActivityMutationGate(): DshActivityMutationGate {
  const allowed = new Set<string>();
  return Object.freeze({
    allow(input: DshSessionActivityInput): void {
      allowed.add(mutationGateKey(input));
    },
    revoke(input: DshSessionActivityInput): void {
      allowed.delete(mutationGateKey(input));
    },
    isAllowed(input: DshSessionActivityInput): boolean {
      return allowed.has(mutationGateKey(input));
    },
  });
}

/**
 * The local-only DSH activity IPC constructs a short-lived controller per
 * invocation, while the supervised bridge owns the actual carrier. Keep its
 * liveness gate in Main rather than deriving liveness from a delayed Renderer
 * push or a possibly stale SQLite binding row.
 */
export const dshActivityMutationGate = createDshActivityMutationGate();

/**
 * This port is injected into the ACP control plane. It is Main-only: neither
 * activity ids nor the store are a renderer capability.
 */
export interface DshSessionActivityCoordinator {
  created(input: DshSessionActivityInput): Promise<void>;
  resumed(input: DshSessionActivityInput): Promise<void>;
  closed(input: DshSessionActivityInput): Promise<void>;
  restored(input: DshSessionActivityInput): Promise<void>;
  disconnected(input: DshSessionActivityInput): Promise<void>;
  /** Must be callable from a carrier-close callback without awaiting SQLite. */
  revokeMutations(input: DshSessionActivityInput): void;
}

function requireSessionRoot(
  record: DshActivitySnapshotRecord,
  input: DshSessionActivityInput,
): DshActivityObject {
  if (record.cindySessionId !== input.cindySessionId || record.hostScopeId !== input.scopeId) {
    throw new Error('DSH session activity record ownership mismatch');
  }
  const roots = record.snapshot.activities.filter(
    (activity) =>
      activity.kind === 'session' &&
      activity.parentActivityId === null &&
      activity.cindySessionId === input.cindySessionId &&
      activity.scopeId === input.scopeId,
  );
  if (roots.length !== 1) {
    throw new Error('DSH session activity snapshot must have exactly one owned session root');
  }
  return roots[0]!;
}

function createSessionSnapshot(
  input: DshSessionActivityInput,
  activityId: string,
): DshActivitySnapshot {
  const reduced = reduceDshActivity(createEmptyDshActivitySnapshot(), {
    type: 'create',
    expectedSequence: 0,
    activityId,
    cindySessionId: input.cindySessionId,
    scopeId: input.scopeId,
    kind: 'session',
    status: 'running',
    allowedActions: LIVE_SESSION_ACTIONS,
  });
  if (reduced.kind !== 'mutated') {
    throw new Error(`DSH session activity root creation was rejected: ${reduced.kind}`);
  }
  return reduced.snapshot;
}

/**
 * Creates and maintains the root activity for a known DSH bridge binding.
 *
 * A fresh Main bridge cannot claim that an old carrier is still active. Its
 * `restored` path therefore changes the root to disconnected even if the old
 * record said running; only a verified ACP resume can make it running again.
 */
export function createDshSessionActivityCoordinator(
  store: DshActivitySnapshotStore,
  options: {
    activityId?: () => string;
    mutationGate?: DshActivityMutationGate;
  } = {},
): DshSessionActivityCoordinator {
  const nextActivityId = options.activityId ?? randomUUID;
  const mutationGate = options.mutationGate;

  async function ensure(input: DshSessionActivityInput): Promise<DshActivitySnapshotRecord> {
    const existing = await store.get({
      cindySessionId: input.cindySessionId,
      hostScopeId: input.scopeId,
    });
    if (existing) {
      requireSessionRoot(existing, input);
      return existing;
    }
    const created = await store.create({
      cindySessionId: input.cindySessionId,
      hostScopeId: input.scopeId,
      snapshot: createSessionSnapshot(input, nextActivityId()),
    });
    requireSessionRoot(created.record, input);
    return created.record;
  }

  async function transition(
    input: DshSessionActivityInput,
    target: 'running' | 'disconnected',
  ): Promise<void> {
    // Lifecycle operations are serialized by DshControlPlane. A bounded retry
    // still handles a concurrent transport-close projection without turning a
    // stale sequence conflict into an inferred native outcome.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const record = await ensure(input);
      const root = requireSessionRoot(record, input);
      if (root.status === target) return;
      const mutation =
        target === 'running'
          ? {
              type: 'reconnect' as const,
              expectedSequence: record.sequence,
              activityId: root.activityId,
              expectedRevision: root.revision,
              status: 'running' as const,
              allowedActions: LIVE_SESSION_ACTIONS,
            }
          : {
              type: 'transition' as const,
              expectedSequence: record.sequence,
              activityId: root.activityId,
              expectedRevision: root.revision,
              status: 'disconnected' as const,
              allowedActions: OBSERVE_ONLY,
            };
      const result = await store.apply({
        cindySessionId: input.cindySessionId,
        hostScopeId: input.scopeId,
        mutation,
      });
      if (result.kind === 'mutated') return;
      if (result.kind === 'conflict') continue;
      throw new Error(
        `DSH session activity ${target} projection was rejected: ${
          result.kind === 'rejected' ? result.reason : result.kind
        }`,
      );
    }
    throw new Error(`DSH session activity ${target} projection conflicted twice`);
  }

  const coordinator: DshSessionActivityCoordinator = {
    async created(input: DshSessionActivityInput) {
      await transition(input, 'running');
      mutationGate?.allow(input);
    },
    async resumed(input: DshSessionActivityInput) {
      await transition(input, 'running');
      mutationGate?.allow(input);
    },
    async closed(input: DshSessionActivityInput) {
      mutationGate?.revoke(input);
      await transition(input, 'disconnected');
    },
    async restored(input: DshSessionActivityInput) {
      mutationGate?.revoke(input);
      await transition(input, 'disconnected');
    },
    async disconnected(input: DshSessionActivityInput) {
      mutationGate?.revoke(input);
      await transition(input, 'disconnected');
    },
    revokeMutations(input: DshSessionActivityInput) {
      mutationGate?.revoke(input);
    },
  };
  return Object.freeze(coordinator);
}
