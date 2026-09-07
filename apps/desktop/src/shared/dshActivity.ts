/**
 * Renderer-safe projection of Cindy-owned DSH activity state.
 *
 * It intentionally excludes DSH runtime ids, host scopes, ACP updates,
 * prompts, terminal data, provider routes, and every mutation primitive. The
 * corresponding IPC surface has only narrow local plan/todo operations.
 */

import type {
  DshActivityAction,
  DshActivityKind,
  DshActivityStatus,
  DshActivitySummaryCode,
} from '@cindy/maker-core';

export interface DshActivityViewObject {
  activityId: string;
  parentActivityId: string | null;
  kind: DshActivityKind;
  /** Cindy-authored local label; absent for older session-root snapshots. */
  label?: string;
  status: DshActivityStatus;
  summary: DshActivitySummaryCode;
  allowedActions: readonly DshActivityAction[];
  revision: number;
}

export interface DshActivityViewSnapshot {
  sequence: number;
  activities: readonly DshActivityViewObject[];
}

export interface DshActivityReadResult {
  /** Null means the currently-bound DSH task has not projected its root yet. */
  snapshot: DshActivityViewSnapshot | null;
}

export interface DshActivityMutationResult {
  snapshot: DshActivityViewSnapshot;
}
