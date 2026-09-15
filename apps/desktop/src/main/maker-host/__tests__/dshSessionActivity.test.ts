import { describe, expect, it } from 'vitest';

import { createEmptyDshActivitySnapshot, reduceDshActivity } from '@cindy/maker-core';

import { createDshSessionActivityCoordinator } from '../dsh-session-activity.js';
import type {
  DshActivitySnapshotRecord,
  DshActivitySnapshotStore,
} from '../../localDb/dshActivitySnapshots.js';

function createMemoryStore(): DshActivitySnapshotStore {
  const rows = new Map<string, DshActivitySnapshotRecord>();
  const key = (cindySessionId: string, hostScopeId: string) => `${cindySessionId}:${hostScopeId}`;
  return {
    async get({ cindySessionId, hostScopeId }) {
      return rows.get(key(cindySessionId, hostScopeId)) ?? null;
    },
    async create({ cindySessionId, hostScopeId, snapshot }) {
      const rowKey = key(cindySessionId, hostScopeId);
      const existing = rows.get(rowKey);
      if (existing) return { kind: 'exists', record: existing };
      const record = {
        cindySessionId,
        hostScopeId,
        snapshot,
        sequence: snapshot.sequence,
        createdAt: 1,
        updatedAt: 1,
      };
      rows.set(rowKey, record);
      return { kind: 'created', record };
    },
    async apply({ cindySessionId, hostScopeId, mutation }) {
      const rowKey = key(cindySessionId, hostScopeId);
      const current = rows.get(rowKey);
      if (!current) return { kind: 'missing' as const };
      const result = reduceDshActivity(current.snapshot, mutation);
      if (result.kind === 'rejected')
        return { kind: 'rejected' as const, record: current, reason: result.reason };
      if (result.kind === 'action-admitted') {
        return {
          kind: 'action-admitted' as const,
          record: current,
          activity: result.activity,
          action: result.action,
        };
      }
      const record = {
        ...current,
        snapshot: result.snapshot,
        sequence: result.snapshot.sequence,
        updatedAt: current.updatedAt + 1,
      };
      rows.set(rowKey, record);
      return { kind: 'mutated' as const, record, activity: result.activity };
    },
  };
}

const owner = { cindySessionId: 'cindy-session-a', scopeId: 'scope-a' };

describe('DSH session activity coordinator', () => {
  it('creates the only Cindy-owned session root without a native session id', async () => {
    const store = createMemoryStore();
    const coordinator = createDshSessionActivityCoordinator(store, {
      activityId: () => 'activity-root',
    });

    await coordinator.created(owner);

    await expect(
      store.get({ cindySessionId: owner.cindySessionId, hostScopeId: owner.scopeId }),
    ).resolves.toMatchObject({
      sequence: 1,
      snapshot: {
        activities: [
          {
            activityId: 'activity-root',
            kind: 'session',
            status: 'running',
            allowedActions: ['observe', 'cancel', 'close'],
          },
        ],
      },
    });
  });

  it('makes an explicit close observe-only and only a verified resume can reconnect it', async () => {
    const store = createMemoryStore();
    const coordinator = createDshSessionActivityCoordinator(store, {
      activityId: () => 'activity-root',
    });
    await coordinator.created(owner);
    await coordinator.closed(owner);

    await expect(
      store.get({ cindySessionId: owner.cindySessionId, hostScopeId: owner.scopeId }),
    ).resolves.toMatchObject({
      sequence: 2,
      snapshot: { activities: [{ status: 'disconnected', allowedActions: ['observe'] }] },
    });

    await coordinator.resumed(owner);

    await expect(
      store.get({ cindySessionId: owner.cindySessionId, hostScopeId: owner.scopeId }),
    ).resolves.toMatchObject({
      sequence: 3,
      snapshot: {
        activities: [{ status: 'running', allowedActions: ['observe', 'cancel', 'close'] }],
      },
    });
  });

  it('marks an old in-memory activity disconnected during fresh-bridge restoration', async () => {
    const store = createMemoryStore();
    const coordinator = createDshSessionActivityCoordinator(store, {
      activityId: () => 'activity-root',
    });
    await coordinator.created(owner);

    await coordinator.restored(owner);

    await expect(
      store.get({ cindySessionId: owner.cindySessionId, hostScopeId: owner.scopeId }),
    ).resolves.toMatchObject({
      snapshot: { activities: [{ status: 'disconnected', allowedActions: ['observe'] }] },
    });
  });

  it('fails closed when an existing snapshot has no uniquely owned session root', async () => {
    const store = createMemoryStore();
    const poisoned = createEmptyDshActivitySnapshot();
    const created = reduceDshActivity(poisoned, {
      type: 'create',
      expectedSequence: 0,
      activityId: 'not-the-session-root',
      cindySessionId: owner.cindySessionId,
      scopeId: owner.scopeId,
      kind: 'plan',
      status: 'running',
      allowedActions: ['observe'],
    });
    if (created.kind !== 'mutated') throw new Error('fixture was rejected');
    await store.create({
      cindySessionId: owner.cindySessionId,
      hostScopeId: owner.scopeId,
      snapshot: created.snapshot,
    });
    const coordinator = createDshSessionActivityCoordinator(store);

    await expect(coordinator.created(owner)).rejects.toThrow('exactly one owned session root');
  });
});
