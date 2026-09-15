/**
 * Main-only coordinator for the finite F4 DSH update translator and the F3
 * projection journal. It receives an already owner-scoped bridge event and
 * never accepts raw renderer input or returns native ids/payloads.
 */

import {
  translateDshFollowEvent,
  type AgentEvent,
} from '@cindy/maker-core';

import type { DshProjectionBindingSnapshot } from '../localDb/client/tx/types.js';
import type {
  DshProjectionIgnoredReason,
  DshProjectionJournal,
} from '../localDb/dshProjectionJournal.js';

export type DshFollowProjectionResult =
  | {
      kind: 'translated';
      events: readonly AgentEvent[];
      binding: DshProjectionBindingSnapshot;
    }
  | {
      kind: 'ignored';
      reason: DshProjectionIgnoredReason;
      binding: DshProjectionBindingSnapshot;
    }
  | {
      kind: 'rejected';
      reason: string;
      binding: DshProjectionBindingSnapshot;
    }
  | { kind: 'failed'; reason: 'commit-conflict' | 'commit-gap' | 'commit-inactive' | 'reject-conflict' | 'reject-inactive' };

/** Main-only raw update input. This is never an adapter or package-root contract. */
export interface DshMainFollowProjectionInput {
  contractVersion: 1;
  cindySessionId: string;
  scopeId: string;
  sequence: number;
  receivedAt: string;
  update: unknown;
}

export interface DshFollowProjectionCoordinator {
  project(input: {
    event: DshMainFollowProjectionInput;
    expectedBindingRevision: number;
  }): Promise<DshFollowProjectionResult>;
}

/**
 * Only an acknowledged `advanced` record can be sent onward. A duplicate,
 * gap, inactive binding or stale writer is never silently re-emitted.
 */
export function createDshFollowProjectionCoordinator(
  journal: DshProjectionJournal,
): DshFollowProjectionCoordinator {
  return {
    async project({ event, expectedBindingRevision }) {
      const translated = translateDshFollowEvent(event);
      if (translated.kind === 'translated') {
        const committed = await journal.commit({
          cindySessionId: event.cindySessionId,
          expectedBindingRevision,
          sequence: event.sequence,
          record: { version: 1, kind: 'events', events: translated.events },
        });
        if (committed.kind !== 'advanced') {
          return { kind: 'failed', reason: commitFailureReason(committed.kind) };
        }
        return { kind: 'translated', events: translated.events, binding: committed.binding };
      }
      if (translated.kind === 'ignored') {
        const committed = await journal.commit({
          cindySessionId: event.cindySessionId,
          expectedBindingRevision,
          sequence: event.sequence,
          record: { version: 1, kind: 'ignored', reason: translated.reason },
        });
        if (committed.kind !== 'advanced') {
          return { kind: 'failed', reason: commitFailureReason(committed.kind) };
        }
        return { kind: 'ignored', reason: translated.reason, binding: committed.binding };
      }
      const rejected = await journal.reject({
        cindySessionId: event.cindySessionId,
        expectedBindingRevision,
        sequence: event.sequence,
        reason: translated.reason,
      });
      if (rejected.kind !== 'rejected') {
        return { kind: 'failed', reason: rejected.kind === 'inactive' ? 'reject-inactive' : 'reject-conflict' };
      }
      return { kind: 'rejected', reason: translated.reason, binding: rejected.binding };
    },
  };
}

function commitFailureReason(
  kind: 'duplicate' | 'gap' | 'inactive' | 'conflict',
): Extract<DshFollowProjectionResult, { kind: 'failed' }>['reason'] {
  switch (kind) {
    case 'gap':
      return 'commit-gap';
    case 'inactive':
      return 'commit-inactive';
    case 'duplicate':
    case 'conflict':
      return 'commit-conflict';
  }
}
