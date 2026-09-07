/**
 * Cindy-owned DSH plan/todo controller.
 *
 * This is deliberately separate from the public ACP control plane. It never
 * receives a native runtime id, ACP update, prompt, command, terminal bytes,
 * provider setting, or a generic reducer mutation from the renderer. Every
 * write is one named local product action over a known DSH task binding.
 */

import { randomUUID } from 'node:crypto';

import type { DshActivityAction, DshActivityObject } from '@cindy/maker-core';

import type {
  DshActivityMutationResult,
  DshActivityReadResult,
  DshActivityViewObject,
  DshActivityViewSnapshot,
} from '../../shared/dshActivity.js';
import type {
  DshActivitySnapshotRecord,
  DshActivitySnapshotStore,
} from '../localDb/dshActivitySnapshots.js';
import type { DshSessionBindingStore } from '../localDb/dshSessionBindings.js';
import type { DshSessionActivityInput } from './dsh-session-activity.js';

const MAX_LOCAL_LABEL_LENGTH = 240;
const LOCAL_OPEN_ACTIONS = ['observe', 'complete', 'cancel'] as const;

type DshActivityControlErrorCode =
  | 'not-found'
  | 'precondition-failed'
  | 'stale'
  | 'invalid';

export class DshActivityControlError extends Error {
  constructor(
    readonly code: DshActivityControlErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DshActivityControlError';
  }
}

export interface DshActivityControlService {
  read(input: { cindySessionId: string }): Promise<DshActivityReadResult>;
  createPlan(input: { cindySessionId: string; label: string }): Promise<DshActivityMutationResult>;
  createTodo(input: {
    cindySessionId: string;
    planActivityId: string;
    label: string;
  }): Promise<DshActivityMutationResult>;
  complete(input: {
    cindySessionId: string;
    activityId: string;
  }): Promise<DshActivityMutationResult>;
  cancel(input: {
    cindySessionId: string;
    activityId: string;
  }): Promise<DshActivityMutationResult>;
}

export interface DshActivityControlDependencies {
  bindingStore: DshSessionBindingStore;
  snapshotStore: DshActivitySnapshotStore;
  /** Current owner-local session row. A switched/deleted/archived task is not writable. */
  getSession(cindySessionId: string): Promise<
    | { agentKind: string; status: string }
    | null
  >;
  /**
   * Main carrier liveness admission. It is deny-by-default: a durable row
   * alone cannot prove that the currently supervised DSH carrier is live.
   */
  isMutationAllowed?(input: DshSessionActivityInput): boolean;
  activityId?: () => string;
}

function fail(code: DshActivityControlErrorCode, message: string): never {
  throw new DshActivityControlError(code, message);
}

function assertSafeIdentifier(value: string, label: string): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    fail('invalid', `DSH ${label} is invalid`);
  }
}

function assertLocalLabel(value: string): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_LOCAL_LABEL_LENGTH ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    fail('invalid', 'DSH local plan and todo labels must be 1..240 normalized characters');
  }
}

function toViewActivity(
  activity: DshActivityObject,
  localMutationsAreAvailable: boolean,
): DshActivityViewObject {
  return {
    activityId: activity.activityId,
    parentActivityId: activity.parentActivityId,
    kind: activity.kind,
    ...(activity.label !== undefined ? { label: activity.label } : {}),
    status: activity.status,
    summary: activity.summary,
    // A Cindy-local child must not remain clickable while its owning DSH task
    // is disconnected or its binding is no longer active. This is a view-time
    // capability reduction, not a rewrite of the durable activity contract:
    // a verified resume can make the already-stored local plan writable again.
    allowedActions: localMutationsAreAvailable
      ? [...activity.allowedActions]
      : activity.allowedActions.filter((action) => action === 'observe'),
    revision: activity.revision,
  };
}

function toView(
  record: DshActivitySnapshotRecord,
  localMutationsAreAvailable: boolean,
): DshActivityViewSnapshot {
  return {
    sequence: record.sequence,
    activities: record.snapshot.activities.map((activity) =>
      toViewActivity(activity, localMutationsAreAvailable),
    ),
  };
}

function isTerminal(activity: DshActivityObject): boolean {
  return (
    activity.status === 'completed' ||
    activity.status === 'failed' ||
    activity.status === 'cancelled' ||
    activity.status === 'unavailable'
  );
}

function requireSessionRoot(record: DshActivitySnapshotRecord): DshActivityObject {
  const roots = record.snapshot.activities.filter(
    (activity) =>
      activity.kind === 'session' &&
      activity.parentActivityId === null &&
      activity.cindySessionId === record.cindySessionId &&
      activity.scopeId === record.hostScopeId,
  );
  if (roots.length !== 1) {
    fail('precondition-failed', 'DSH session activity root is unavailable');
  }
  return roots[0]!;
}

function requireActivity(
  record: DshActivitySnapshotRecord,
  activityId: string,
): DshActivityObject {
  assertSafeIdentifier(activityId, 'activity id');
  const activity = record.snapshot.activities.find((item) => item.activityId === activityId);
  if (!activity) fail('not-found', 'DSH activity was not found');
  return activity;
}

function requirePlan(
  record: DshActivitySnapshotRecord,
  root: DshActivityObject,
  activityId: string,
): DshActivityObject {
  const plan = requireActivity(record, activityId);
  if (plan.kind !== 'plan' || plan.parentActivityId !== root.activityId) {
    fail('precondition-failed', 'DSH todo parent must be a local plan in this task');
  }
  if (isTerminal(plan) || plan.status === 'disconnected') {
    fail('precondition-failed', 'DSH local plan is no longer open for new todos');
  }
  return plan;
}

function assertLocalMutableActivity(
  record: DshActivitySnapshotRecord,
  root: DshActivityObject,
  activityId: string,
): DshActivityObject {
  const activity = requireActivity(record, activityId);
  const parent = activity.parentActivityId
    ? record.snapshot.activities.find((item) => item.activityId === activity.parentActivityId)
    : null;
  const isPlan = activity.kind === 'plan' && activity.parentActivityId === root.activityId;
  const isTodo =
    activity.kind === 'todo' &&
    parent?.kind === 'plan' &&
    parent.parentActivityId === root.activityId;
  if (!isPlan && !isTodo) {
    fail('precondition-failed', 'Only Cindy-owned DSH plans and todos are locally controllable');
  }
  return activity;
}

async function ensureBoundDshTask(
  deps: DshActivityControlDependencies,
  cindySessionId: string,
): Promise<{ scopeId: string; bindingIsActive: boolean }> {
  assertSafeIdentifier(cindySessionId, 'session id');
  const [session, binding] = await Promise.all([
    deps.getSession(cindySessionId),
    deps.bindingStore.getByCindySessionId(cindySessionId),
  ]);
  if (!session || session.agentKind !== 'dsh' || session.status !== 'active') {
    fail('not-found', 'Active DSH task was not found');
  }
  if (!binding) fail('not-found', 'DSH task binding was not found');
  return {
    scopeId: binding.hostScopeId,
    bindingIsActive: binding.lifecycleState === 'active',
  };
}

async function requireRecord(
  deps: DshActivityControlDependencies,
  cindySessionId: string,
  scopeId: string,
): Promise<DshActivitySnapshotRecord> {
  const record = await deps.snapshotStore.get({ cindySessionId, hostScopeId: scopeId });
  if (!record) {
    fail('precondition-failed', 'DSH task activity is not ready yet');
  }
  requireSessionRoot(record);
  return record;
}

function requireWritableSessionRoot(
  record: DshActivitySnapshotRecord,
  bindingIsActive: boolean,
  mutationAllowed: boolean,
): DshActivityObject {
  const root = requireSessionRoot(record);
  if (!bindingIsActive || !mutationAllowed || root.status !== 'running') {
    fail(
      'precondition-failed',
      'DSH local plans are read-only until Main verifies that this task has resumed',
    );
  }
  return root;
}

function hasMainMutationAdmission(
  deps: DshActivityControlDependencies,
  cindySessionId: string,
  scopeId: string,
): boolean {
  return deps.isMutationAllowed?.({ cindySessionId, scopeId }) === true;
}

/**
 * Creates a private, Cindy-authored plan/todo controller for one owner-scoped
 * DB. The two-attempt retry only resolves snapshot CAS conflicts; it never
 * guesses a native outcome or retries an ACP request (none are made here).
 */
export function createDshActivityControlService(
  deps: DshActivityControlDependencies,
): DshActivityControlService {
  const nextActivityId = deps.activityId ?? randomUUID;

  async function read(input: { cindySessionId: string }): Promise<DshActivityReadResult> {
    const { scopeId, bindingIsActive } = await ensureBoundDshTask(deps, input.cindySessionId);
    const record = await deps.snapshotStore.get({
      cindySessionId: input.cindySessionId,
      hostScopeId: scopeId,
    });
    if (!record) return { snapshot: null };
    const root = requireSessionRoot(record);
    return {
      snapshot: toView(
        record,
        bindingIsActive &&
          root.status === 'running' &&
          hasMainMutationAdmission(deps, input.cindySessionId, scopeId),
      ),
    };
  }

  async function createPlan(input: {
    cindySessionId: string;
    label: string;
  }): Promise<DshActivityMutationResult> {
    assertLocalLabel(input.label);
    const { scopeId, bindingIsActive } = await ensureBoundDshTask(deps, input.cindySessionId);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const record = await requireRecord(deps, input.cindySessionId, scopeId);
      const root = requireWritableSessionRoot(
        record,
        bindingIsActive,
        hasMainMutationAdmission(deps, input.cindySessionId, scopeId),
      );
      const result = await deps.snapshotStore.apply({
        cindySessionId: input.cindySessionId,
        hostScopeId: scopeId,
        mutation: {
          type: 'create',
          expectedSequence: record.sequence,
          activityId: nextActivityId(),
          cindySessionId: input.cindySessionId,
          scopeId,
          parentActivityId: root.activityId,
          kind: 'plan',
          label: input.label,
          status: 'pending',
          allowedActions: LOCAL_OPEN_ACTIONS,
        },
      });
      if (result.kind === 'mutated') return { snapshot: toView(result.record, true) };
      if (result.kind === 'conflict') continue;
      fail('precondition-failed', 'DSH local plan creation was rejected');
    }
    fail('stale', 'DSH local plan changed concurrently; refresh and try again');
  }

  async function createTodo(input: {
    cindySessionId: string;
    planActivityId: string;
    label: string;
  }): Promise<DshActivityMutationResult> {
    assertLocalLabel(input.label);
    const { scopeId, bindingIsActive } = await ensureBoundDshTask(deps, input.cindySessionId);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const record = await requireRecord(deps, input.cindySessionId, scopeId);
      const root = requireWritableSessionRoot(
        record,
        bindingIsActive,
        hasMainMutationAdmission(deps, input.cindySessionId, scopeId),
      );
      const plan = requirePlan(record, root, input.planActivityId);
      const result = await deps.snapshotStore.apply({
        cindySessionId: input.cindySessionId,
        hostScopeId: scopeId,
        mutation: {
          type: 'create',
          expectedSequence: record.sequence,
          activityId: nextActivityId(),
          cindySessionId: input.cindySessionId,
          scopeId,
          parentActivityId: plan.activityId,
          kind: 'todo',
          label: input.label,
          status: 'pending',
          allowedActions: LOCAL_OPEN_ACTIONS,
        },
      });
      if (result.kind === 'mutated') return { snapshot: toView(result.record, true) };
      if (result.kind === 'conflict') continue;
      fail('precondition-failed', 'DSH local todo creation was rejected');
    }
    fail('stale', 'DSH local plan changed concurrently; refresh and try again');
  }

  async function transitionLocalActivity(
    input: { cindySessionId: string; activityId: string },
    action: Extract<DshActivityAction, 'complete' | 'cancel'>,
  ): Promise<DshActivityMutationResult> {
    const { scopeId, bindingIsActive } = await ensureBoundDshTask(deps, input.cindySessionId);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const record = await requireRecord(deps, input.cindySessionId, scopeId);
      const root = requireWritableSessionRoot(
        record,
        bindingIsActive,
        hasMainMutationAdmission(deps, input.cindySessionId, scopeId),
      );
      const activity = assertLocalMutableActivity(record, root, input.activityId);
      const targetStatus = action === 'complete' ? 'completed' : 'cancelled';
      if (activity.status === targetStatus) return { snapshot: toView(record, true) };
      if (isTerminal(activity) || activity.status === 'disconnected') {
        fail('precondition-failed', 'DSH local activity is already closed');
      }
      if (activity.kind === 'plan') {
        const openTodos = record.snapshot.activities.some(
          (item) =>
            item.kind === 'todo' &&
            item.parentActivityId === activity.activityId &&
            !isTerminal(item) &&
            item.status !== 'disconnected',
        );
        if (openTodos) {
          fail('precondition-failed', 'Finish or cancel every local todo before closing its plan');
        }
      }
      const admitted = await deps.snapshotStore.apply({
        cindySessionId: input.cindySessionId,
        hostScopeId: scopeId,
        mutation: {
          type: 'request-action',
          expectedSequence: record.sequence,
          activityId: activity.activityId,
          expectedRevision: activity.revision,
          action,
        },
      });
      if (admitted.kind === 'conflict') continue;
      if (admitted.kind !== 'action-admitted') {
        fail('precondition-failed', 'DSH local activity action is unavailable');
      }
      const transitioned = await deps.snapshotStore.apply({
        cindySessionId: input.cindySessionId,
        hostScopeId: scopeId,
        mutation: {
          type: 'transition',
          expectedSequence: admitted.record.sequence,
          activityId: admitted.activity.activityId,
          expectedRevision: admitted.activity.revision,
          status: targetStatus,
        },
      });
      if (transitioned.kind === 'mutated') return { snapshot: toView(transitioned.record, true) };
      if (transitioned.kind === 'conflict') continue;
      fail('precondition-failed', 'DSH local activity transition was rejected');
    }
    fail('stale', 'DSH local plan changed concurrently; refresh and try again');
  }

  return Object.freeze({
    read,
    createPlan,
    createTodo,
    complete: (input: { cindySessionId: string; activityId: string }) =>
      transitionLocalActivity(input, 'complete'),
    cancel: (input: { cindySessionId: string; activityId: string }) =>
      transitionLocalActivity(input, 'cancel'),
  });
}
