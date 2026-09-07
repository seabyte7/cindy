import { describe, expect, it } from 'vitest';

import { reduceDshActivity } from '@cindy/maker-core';

import {
  createDshActivityControlService,
} from '../dsh-activity-control.js';
import {
  createDshActivityMutationGate,
  createDshSessionActivityCoordinator,
} from '../dsh-session-activity.js';
import type {
  DshActivitySnapshotRecord,
  DshActivitySnapshotStore,
} from '../../localDb/dshActivitySnapshots.js';
import type { DshSessionBindingStore } from '../../localDb/dshSessionBindings.js';

const owner = { cindySessionId: 'cindy-session-a', scopeId: 'scope-a' };

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
      if (existing) return { kind: 'exists' as const, record: existing };
      const record = {
        cindySessionId,
        hostScopeId,
        snapshot,
        sequence: snapshot.sequence,
        createdAt: 1,
        updatedAt: 1,
      };
      rows.set(rowKey, record);
      return { kind: 'created' as const, record };
    },
    async apply({ cindySessionId, hostScopeId, mutation }) {
      const rowKey = key(cindySessionId, hostScopeId);
      const current = rows.get(rowKey);
      if (!current) return { kind: 'missing' as const };
      const result = reduceDshActivity(current.snapshot, mutation);
      if (result.kind === 'rejected') {
        return { kind: 'rejected' as const, record: current, reason: result.reason };
      }
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

async function createControl(
  options: { agentKind?: string; status?: string; lifecycleState?: string } = {},
) {
  const snapshotStore = createMemoryStore();
  await createDshSessionActivityCoordinator(snapshotStore, {
    activityId: () => 'session-root',
  }).created(owner);
  let activitySequence = 0;
  const bindingStore = {
    getByCindySessionId: async (cindySessionId: string) =>
      cindySessionId === owner.cindySessionId
        ? ({
            cindySessionId,
            hostScopeId: owner.scopeId,
            lifecycleState: options.lifecycleState ?? 'active',
          } as never)
        : null,
  } as unknown as DshSessionBindingStore;
  return createDshActivityControlService({
    bindingStore,
    snapshotStore,
    isMutationAllowed: () => true,
    getSession: async (cindySessionId) =>
      cindySessionId === owner.cindySessionId
        ? { agentKind: options.agentKind ?? 'dsh', status: options.status ?? 'active' }
        : null,
    activityId: () => `local-activity-${++activitySequence}`,
  });
}

describe('Cindy-owned DSH activity controller', () => {
  it('creates, reads, and closes only local plans/todos without exposing bridge identity', async () => {
    const control = await createControl();
    const plan = await control.createPlan({
      cindySessionId: owner.cindySessionId,
      label: 'Verify the local package',
    });
    const planActivity = plan.snapshot.activities.find((activity) => activity.kind === 'plan');
    expect(planActivity).toMatchObject({
      activityId: 'local-activity-1',
      parentActivityId: 'session-root',
      label: 'Verify the local package',
      status: 'pending',
      allowedActions: ['observe', 'complete', 'cancel'],
    });
    expect(planActivity).not.toHaveProperty('scopeId');
    expect(planActivity).not.toHaveProperty('cindySessionId');
    expect(JSON.stringify(plan)).not.toContain('runtimeSessionId');

    const todo = await control.createTodo({
      cindySessionId: owner.cindySessionId,
      planActivityId: planActivity!.activityId,
      label: 'Run the signed Helper smoke test',
    });
    const todoActivity = todo.snapshot.activities.find((activity) => activity.kind === 'todo');
    expect(todoActivity).toMatchObject({
      activityId: 'local-activity-2',
      parentActivityId: planActivity!.activityId,
      label: 'Run the signed Helper smoke test',
    });

    await expect(
      control.complete({
        cindySessionId: owner.cindySessionId,
        activityId: planActivity!.activityId,
      }),
    ).rejects.toMatchObject({
      code: 'precondition-failed',
    });

    const completedTodo = await control.complete({
      cindySessionId: owner.cindySessionId,
      activityId: todoActivity!.activityId,
    });
    expect(completedTodo.snapshot.activities.find((activity) => activity.activityId === todoActivity!.activityId))
      .toMatchObject({ status: 'completed', allowedActions: ['observe'] });

    const completedPlan = await control.complete({
      cindySessionId: owner.cindySessionId,
      activityId: planActivity!.activityId,
    });
    expect(completedPlan.snapshot).toMatchObject({ sequence: 5 });
    expect(completedPlan.snapshot.activities.find((activity) => activity.activityId === planActivity!.activityId))
      .toMatchObject({ status: 'completed', allowedActions: ['observe'] });
  });

  it('rejects cross-kind, non-DSH, stale-root, and unsafe-label writes', async () => {
    const control = await createControl();
    await expect(
      control.createTodo({
        cindySessionId: owner.cindySessionId,
        planActivityId: 'session-root',
        label: 'Not a plan parent',
      }),
    ).rejects.toMatchObject({ code: 'precondition-failed' });
    await expect(
      control.createPlan({ cindySessionId: owner.cindySessionId, label: '  whitespace  ' }),
    ).rejects.toMatchObject({ code: 'invalid' });

    const switched = await createControl({ agentKind: 'codex' });
    await expect(
      switched.createPlan({ cindySessionId: owner.cindySessionId, label: 'Must not write' }),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('is read-only while the lifecycle root has not been projected', async () => {
    const snapshotStore = createMemoryStore();
    const control = createDshActivityControlService({
      bindingStore: {
        getByCindySessionId: async () => (
          { hostScopeId: owner.scopeId, lifecycleState: 'active' } as never
        ),
      } as unknown as DshSessionBindingStore,
      snapshotStore,
      getSession: async () => ({ agentKind: 'dsh', status: 'active' }),
    });
    await expect(control.read({ cindySessionId: owner.cindySessionId })).resolves.toEqual({
      snapshot: null,
    });
    await expect(
      control.createPlan({ cindySessionId: owner.cindySessionId, label: 'Wait for the root' }),
    ).rejects.toMatchObject({ code: 'precondition-failed' });
  });

  it('requires an explicit current-Main admission even when durable state still says active', async () => {
    const snapshotStore = createMemoryStore();
    const gate = createDshActivityMutationGate();
    const coordinator = createDshSessionActivityCoordinator(snapshotStore, {
      activityId: () => 'session-root',
      mutationGate: gate,
    });
    await coordinator.created(owner);
    const control = createDshActivityControlService({
      bindingStore: {
        getByCindySessionId: async () => (
          { hostScopeId: owner.scopeId, lifecycleState: 'active' } as never
        ),
      } as unknown as DshSessionBindingStore,
      snapshotStore,
      getSession: async () => ({ agentKind: 'dsh', status: 'active' }),
      isMutationAllowed: (input) => gate.isAllowed(input),
      activityId: () => 'local-plan',
    });

    await expect(
      control.createPlan({ cindySessionId: owner.cindySessionId, label: 'Allowed before EOF' }),
    ).resolves.toBeDefined();

    // This is the carrier-close ordering boundary: revoke synchronously first;
    // durable binding/activity projection may complete on a later tick.
    coordinator.revokeMutations(owner);

    await expect(control.read({ cindySessionId: owner.cindySessionId })).resolves.toMatchObject({
      snapshot: {
        activities: expect.arrayContaining([
          expect.objectContaining({ activityId: 'session-root', allowedActions: ['observe'] }),
          expect.objectContaining({ activityId: 'local-plan', allowedActions: ['observe'] }),
        ]),
      },
    });
    await expect(
      control.createPlan({ cindySessionId: owner.cindySessionId, label: 'Must not cross EOF' }),
    ).rejects.toMatchObject({ code: 'precondition-failed' });
  });

  it('freezes every local child when Main marks the owning DSH task disconnected', async () => {
    const snapshotStore = createMemoryStore();
    const coordinator = createDshSessionActivityCoordinator(snapshotStore, {
      activityId: () => 'session-root',
    });
    await coordinator.created(owner);
    const bindingStore = {
      getByCindySessionId: async () => (
        { hostScopeId: owner.scopeId, lifecycleState: 'active' } as never
      ),
    } as unknown as DshSessionBindingStore;
    const control = createDshActivityControlService({
      bindingStore,
      snapshotStore,
      getSession: async () => ({ agentKind: 'dsh', status: 'active' }),
      isMutationAllowed: () => true,
      activityId: () => 'local-plan',
    });
    const created = await control.createPlan({
      cindySessionId: owner.cindySessionId,
      label: 'Do not mutate while disconnected',
    });
    const plan = created.snapshot.activities.find((activity) => activity.kind === 'plan');
    expect(plan).toBeDefined();

    await coordinator.disconnected(owner);

    const readOnly = await control.read({ cindySessionId: owner.cindySessionId });
    expect(readOnly.snapshot?.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activityId: 'session-root',
          status: 'disconnected',
          allowedActions: ['observe'],
        }),
        expect.objectContaining({
          activityId: plan!.activityId,
          allowedActions: ['observe'],
        }),
      ]),
    );
    await expect(
      control.createTodo({
        cindySessionId: owner.cindySessionId,
        planActivityId: plan!.activityId,
        label: 'Must wait for verified resume',
      }),
    ).rejects.toMatchObject({ code: 'precondition-failed' });
    await expect(
      control.complete({ cindySessionId: owner.cindySessionId, activityId: plan!.activityId }),
    ).rejects.toMatchObject({ code: 'precondition-failed' });
  });

  it('keeps activity visible but read-only once the durable binding is no longer active', async () => {
    const control = await createControl({ lifecycleState: 'closed' });
    await expect(control.read({ cindySessionId: owner.cindySessionId })).resolves.toMatchObject({
      snapshot: {
        activities: [expect.objectContaining({ allowedActions: ['observe'] })],
      },
    });
    await expect(
      control.createPlan({ cindySessionId: owner.cindySessionId, label: 'Must not write' }),
    ).rejects.toMatchObject({ code: 'precondition-failed' });
  });
});
