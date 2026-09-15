/**
 * Cindy-owned DSH activity contract.
 *
 * This is deliberately not an ACP or DSH-native object model. It is the
 * closed, display-safe state machine used when Cindy creates an activity such
 * as a plan, terminal, job, or interaction around a DSH task. Native payloads,
 * terminal bytes, prompt text, stderr, stack traces, and runtime identifiers
 * do not belong in this contract.
 *
 * Desktop Main persists and executes an admitted action; renderer and other
 * consumers may only use this module to validate a versioned snapshot and to
 * decide whether an action is currently admissible. An admitted action is not
 * evidence that a corresponding native API exists.
 */

export const DSH_ACTIVITY_CONTRACT_VERSION = 1 as const;
export const DSH_ACTIVITY_ORIGIN = "cindy-dsh" as const;

const MAX_ACTIVITIES_PER_SNAPSHOT = 512;
const MAX_OPAQUE_ID_LENGTH = 512;
const MAX_ACTIVITY_LABEL_LENGTH = 240;

export type DshActivityKind =
  | "session"
  | "plan"
  | "todo"
  | "command"
  | "elicitation"
  | "terminal"
  | "task"
  | "job"
  | "workflow"
  | "schedule";

export type DshActivityStatus =
  | "pending"
  | "running"
  | "waiting-for-input"
  | "waiting-for-decision"
  | "completed"
  | "failed"
  | "cancelled"
  | "disconnected"
  | "unavailable";

/** Named actions only; their request payloads have separate Main-side schemas. */
export type DshActivityAction =
  | "observe"
  | "approve"
  | "reject"
  /** A Cindy-owned plan/todo reached its locally recorded terminal outcome. */
  | "complete"
  | "cancel"
  | "attach"
  | "input"
  | "signal"
  | "close";

/** Stable i18n keys; no model- or runtime-provided display text is admitted. */
export type DshActivitySummaryCode =
  | "pending"
  | "running"
  | "waiting-for-input"
  | "waiting-for-decision"
  | "completed"
  | "failed"
  | "cancelled"
  | "disconnected"
  | "unavailable";

/**
 * A finite explanation for a feature which is visible but not actionable.
 * The renderer maps this code to localized copy; it must not render an
 * arbitrary error, ACP update, or native capability response as Markdown.
 */
export type DshActivityUnavailableReason =
  | "capability-not-advertised"
  | "native-contract-not-admitted"
  | "local-scope-only"
  | "host-restart-reconcile-required"
  | "action-not-supported";

export interface DshActivityObject {
  contractVersion: typeof DSH_ACTIVITY_CONTRACT_VERSION;
  origin: typeof DSH_ACTIVITY_ORIGIN;
  /** Cindy-generated opaque identity, never a DSH runtime id. */
  activityId: string;
  /** Product task identity; this is the ownership boundary for every action. */
  cindySessionId: string;
  /** Main-owned DSH host scope identity. */
  scopeId: string;
  parentActivityId: string | null;
  kind: DshActivityKind;
  /**
   * Optional Cindy-authored display label. It never comes from an ACP update
   * or native runtime payload. It is optional solely so v1 lifecycle roots
   * written before the local plan/todo slice remain readable.
   */
  label?: string;
  status: DshActivityStatus;
  summary: DshActivitySummaryCode;
  /** Always contains observe; non-observe actions are enabled only by Main. */
  allowedActions: readonly DshActivityAction[];
  /** Present exactly when status is unavailable. */
  unavailableReason?: DshActivityUnavailableReason;
  /** Per-object compare-and-set revision. */
  revision: number;
}

/** A scope-local, monotonically versioned collection of Cindy-owned activities. */
export interface DshActivitySnapshot {
  contractVersion: typeof DSH_ACTIVITY_CONTRACT_VERSION;
  origin: typeof DSH_ACTIVITY_ORIGIN;
  /** Increments once for every accepted mutation, including reconnect. */
  sequence: number;
  activities: readonly DshActivityObject[];
}

export interface DshActivityCreateInput {
  type: "create";
  expectedSequence: number;
  activityId: string;
  cindySessionId: string;
  scopeId: string;
  parentActivityId?: string | null;
  kind: DshActivityKind;
  /** A bounded local label for a Cindy-authored plan or todo. */
  label?: string;
  status: Exclude<DshActivityStatus, "disconnected">;
  allowedActions?: readonly DshActivityAction[];
  unavailableReason?: DshActivityUnavailableReason;
}

export interface DshActivityTransitionInput {
  type: "transition";
  expectedSequence: number;
  activityId: string;
  expectedRevision: number;
  status: DshActivityStatus;
  allowedActions?: readonly DshActivityAction[];
  unavailableReason?: DshActivityUnavailableReason;
}

/**
 * A disconnect never guesses that a native operation has finished. Reconnect
 * may resolve to a terminal state only after the owning Main bridge has
 * independently reconciled that outcome.
 */
export interface DshActivityReconnectInput {
  type: "reconnect";
  expectedSequence: number;
  activityId: string;
  expectedRevision: number;
  status: Exclude<DshActivityStatus, "disconnected">;
  allowedActions?: readonly DshActivityAction[];
  unavailableReason?: DshActivityUnavailableReason;
}

/** This validates eligibility only. Main performs the actual named action. */
export interface DshActivityActionRequest {
  type: "request-action";
  expectedSequence: number;
  activityId: string;
  expectedRevision: number;
  action: DshActivityAction;
}

export type DshActivityMutation =
  | DshActivityCreateInput
  | DshActivityTransitionInput
  | DshActivityReconnectInput
  | DshActivityActionRequest;

export type DshActivityRejectionReason =
  | "invalid-snapshot"
  | "stale-sequence"
  | "invalid-mutation"
  | "duplicate-activity"
  | "unknown-activity"
  | "stale-revision"
  | "invalid-transition"
  | "action-unavailable";

export type DshActivityReduceResult =
  | {
      kind: "mutated";
      snapshot: DshActivitySnapshot;
      activity: DshActivityObject;
    }
  | {
      kind: "action-admitted";
      snapshot: DshActivitySnapshot;
      activity: DshActivityObject;
      action: DshActivityAction;
    }
  | {
      kind: "rejected";
      snapshot: DshActivitySnapshot;
      reason: DshActivityRejectionReason;
    };

const KINDS = new Set<DshActivityKind>([
  "session",
  "plan",
  "todo",
  "command",
  "elicitation",
  "terminal",
  "task",
  "job",
  "workflow",
  "schedule",
]);
const STATUSES = new Set<DshActivityStatus>([
  "pending",
  "running",
  "waiting-for-input",
  "waiting-for-decision",
  "completed",
  "failed",
  "cancelled",
  "disconnected",
  "unavailable",
]);
const ACTIONS = new Set<DshActivityAction>([
  "observe",
  "approve",
  "reject",
  "complete",
  "cancel",
  "attach",
  "input",
  "signal",
  "close",
]);
const UNAVAILABLE_REASONS = new Set<DshActivityUnavailableReason>([
  "capability-not-advertised",
  "native-contract-not-admitted",
  "local-scope-only",
  "host-restart-reconcile-required",
  "action-not-supported",
]);
const TERMINAL_STATUSES = new Set<DshActivityStatus>([
  "completed",
  "failed",
  "cancelled",
  "unavailable",
]);
const DISCONNECT_ACTIONS: readonly DshActivityAction[] = ["observe"];

const TRANSITIONS: Readonly<
  Record<
    Exclude<DshActivityStatus, "disconnected">,
    ReadonlySet<DshActivityStatus>
  >
> = {
  pending: new Set([
    "running",
    "waiting-for-input",
    "waiting-for-decision",
    "completed",
    "failed",
    "cancelled",
    "disconnected",
    "unavailable",
  ]),
  running: new Set([
    "waiting-for-input",
    "waiting-for-decision",
    "completed",
    "failed",
    "cancelled",
    "disconnected",
    "unavailable",
  ]),
  "waiting-for-input": new Set([
    "running",
    "completed",
    "failed",
    "cancelled",
    "disconnected",
    "unavailable",
  ]),
  "waiting-for-decision": new Set([
    "running",
    "completed",
    "failed",
    "cancelled",
    "disconnected",
    "unavailable",
  ]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  unavailable: new Set(),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isSafeOpaqueId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_OPAQUE_ID_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isSafeActivityLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ACTIVITY_LABEL_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTerminal(status: DshActivityStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

function summaryFor(status: DshActivityStatus): DshActivitySummaryCode {
  return status;
}

function normalizeActions(
  status: DshActivityStatus,
  actions: readonly DshActivityAction[] | undefined,
): readonly DshActivityAction[] | null {
  if (status === "disconnected" || isTerminal(status)) {
    if (
      actions !== undefined &&
      (actions.length !== 1 || actions[0] !== "observe")
    )
      return null;
    return DISCONNECT_ACTIONS;
  }
  const normalized = actions ?? DISCONNECT_ACTIONS;
  if (normalized.length === 0 || normalized.length > ACTIONS.size) return null;
  const unique = new Set<DshActivityAction>();
  for (const action of normalized) {
    if (!ACTIONS.has(action) || unique.has(action)) return null;
    unique.add(action);
  }
  if (!unique.has("observe")) return null;
  return [...unique];
}

function hasValidUnavailableReason(
  status: DshActivityStatus,
  value: unknown,
): value is DshActivityUnavailableReason | undefined {
  if (status === "unavailable") {
    return (
      typeof value === "string" &&
      UNAVAILABLE_REASONS.has(value as DshActivityUnavailableReason)
    );
  }
  return value === undefined;
}

function isActivityObject(value: unknown): value is DshActivityObject {
  if (!isRecord(value)) return false;
  if (
    !hasOnlyKeys(
      value,
      new Set([
        "contractVersion",
        "origin",
        "activityId",
        "cindySessionId",
        "scopeId",
        "parentActivityId",
        "kind",
        "label",
        "status",
        "summary",
        "allowedActions",
        "unavailableReason",
        "revision",
      ]),
    )
  ) {
    return false;
  }
  if (
    value.contractVersion !== DSH_ACTIVITY_CONTRACT_VERSION ||
    value.origin !== DSH_ACTIVITY_ORIGIN ||
    !isSafeOpaqueId(value.activityId) ||
    !isSafeOpaqueId(value.cindySessionId) ||
    !isSafeOpaqueId(value.scopeId) ||
    (value.parentActivityId !== null &&
      !isSafeOpaqueId(value.parentActivityId)) ||
    typeof value.kind !== "string" ||
    !KINDS.has(value.kind as DshActivityKind) ||
    (value.label !== undefined && !isSafeActivityLabel(value.label)) ||
    typeof value.status !== "string" ||
    !STATUSES.has(value.status as DshActivityStatus) ||
    value.summary !== value.status ||
    !Array.isArray(value.allowedActions) ||
    !isPositiveSafeInteger(value.revision)
  ) {
    return false;
  }
  const status = value.status as DshActivityStatus;
  if (!hasValidUnavailableReason(status, value.unavailableReason)) return false;
  return (
    normalizeActions(status, value.allowedActions as DshActivityAction[]) !==
    null
  );
}

function isClosedMutation(value: Record<string, unknown>): boolean {
  switch (value.type) {
    case "create":
      return hasOnlyKeys(
        value,
        new Set([
          "type",
          "expectedSequence",
          "activityId",
          "cindySessionId",
          "scopeId",
          "parentActivityId",
          "kind",
          "label",
          "status",
          "allowedActions",
          "unavailableReason",
        ]),
      );
    case "transition":
    case "reconnect":
      return hasOnlyKeys(
        value,
        new Set([
          "type",
          "expectedSequence",
          "activityId",
          "expectedRevision",
          "status",
          "allowedActions",
          "unavailableReason",
        ]),
      );
    case "request-action":
      return hasOnlyKeys(
        value,
        new Set([
          "type",
          "expectedSequence",
          "activityId",
          "expectedRevision",
          "action",
        ]),
      );
    default:
      return false;
  }
}

function hasCycle(byId: ReadonlyMap<string, DshActivityObject>): boolean {
  for (const activity of byId.values()) {
    const visited = new Set<string>();
    let current: DshActivityObject | undefined = activity;
    while (current?.parentActivityId) {
      if (visited.has(current.activityId)) return true;
      visited.add(current.activityId);
      current = byId.get(current.parentActivityId);
    }
  }
  return false;
}

export function isDshActivitySnapshot(
  value: unknown,
): value is DshActivitySnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(
      value,
      new Set(["contractVersion", "origin", "sequence", "activities"]),
    ) ||
    value.contractVersion !== DSH_ACTIVITY_CONTRACT_VERSION ||
    value.origin !== DSH_ACTIVITY_ORIGIN ||
    !isNonNegativeSafeInteger(value.sequence) ||
    !Array.isArray(value.activities) ||
    value.activities.length > MAX_ACTIVITIES_PER_SNAPSHOT
  ) {
    return false;
  }
  const byId = new Map<string, DshActivityObject>();
  for (const activity of value.activities) {
    if (!isActivityObject(activity) || byId.has(activity.activityId))
      return false;
    byId.set(activity.activityId, activity);
  }
  for (const activity of byId.values()) {
    if (!activity.parentActivityId) continue;
    const parent = byId.get(activity.parentActivityId);
    if (
      !parent ||
      parent.cindySessionId !== activity.cindySessionId ||
      parent.scopeId !== activity.scopeId
    ) {
      return false;
    }
  }
  return !hasCycle(byId);
}

function invalid(
  snapshot: DshActivitySnapshot,
  reason: DshActivityRejectionReason,
): DshActivityReduceResult {
  return { kind: "rejected", snapshot, reason };
}

function mutate(
  snapshot: DshActivitySnapshot,
  activity: DshActivityObject,
): DshActivityReduceResult {
  const activities = snapshot.activities.map((current) =>
    current.activityId === activity.activityId ? activity : current,
  );
  return {
    kind: "mutated",
    snapshot: {
      contractVersion: DSH_ACTIVITY_CONTRACT_VERSION,
      origin: DSH_ACTIVITY_ORIGIN,
      sequence: snapshot.sequence + 1,
      activities,
    },
    activity,
  };
}

function resolveActivity(
  snapshot: DshActivitySnapshot,
  activityId: unknown,
  expectedRevision: unknown,
): { activity: DshActivityObject } | { reason: DshActivityRejectionReason } {
  if (!isSafeOpaqueId(activityId) || !isPositiveSafeInteger(expectedRevision)) {
    return { reason: "invalid-mutation" };
  }
  const activity = snapshot.activities.find(
    (item) => item.activityId === activityId,
  );
  if (!activity) return { reason: "unknown-activity" };
  if (activity.revision !== expectedRevision)
    return { reason: "stale-revision" };
  return { activity };
}

function activityAfterStatus(
  activity: DshActivityObject,
  status: DshActivityStatus,
  actions: readonly DshActivityAction[] | undefined,
  unavailableReason: unknown,
): DshActivityObject | null {
  const allowedActions = normalizeActions(status, actions);
  if (!allowedActions || !hasValidUnavailableReason(status, unavailableReason))
    return null;
  return {
    ...activity,
    status,
    summary: summaryFor(status),
    allowedActions,
    ...(status === "unavailable" ? { unavailableReason } : {}),
    revision: activity.revision + 1,
  };
}

/** Start with an empty snapshot; it is safe to persist as canonical JSON. */
export function createEmptyDshActivitySnapshot(): DshActivitySnapshot {
  return {
    contractVersion: DSH_ACTIVITY_CONTRACT_VERSION,
    origin: DSH_ACTIVITY_ORIGIN,
    sequence: 0,
    activities: [],
  };
}

/**
 * Reduces one versioned Cindy-owned mutation. Invalid or stale input preserves
 * the old snapshot; callers must not infer any native-side outcome from a
 * rejection. Request-action only checks the object gate and never executes an
 * operation itself.
 */
export function reduceDshActivity(
  snapshot: DshActivitySnapshot,
  mutation: DshActivityMutation,
): DshActivityReduceResult {
  if (!isDshActivitySnapshot(snapshot)) {
    return {
      kind: "rejected",
      snapshot: createEmptyDshActivitySnapshot(),
      reason: "invalid-snapshot",
    };
  }
  if (
    !isRecord(mutation) ||
    !isClosedMutation(mutation) ||
    !isNonNegativeSafeInteger(mutation.expectedSequence)
  ) {
    return invalid(snapshot, "invalid-mutation");
  }
  if (mutation.expectedSequence !== snapshot.sequence)
    return invalid(snapshot, "stale-sequence");

  if (mutation.type === "create") {
    if (
      !isSafeOpaqueId(mutation.activityId) ||
      !isSafeOpaqueId(mutation.cindySessionId) ||
      !isSafeOpaqueId(mutation.scopeId) ||
      (mutation.parentActivityId !== undefined &&
        mutation.parentActivityId !== null &&
        !isSafeOpaqueId(mutation.parentActivityId)) ||
      !KINDS.has(mutation.kind) ||
      (mutation.label !== undefined && !isSafeActivityLabel(mutation.label)) ||
      !STATUSES.has(mutation.status)
    ) {
      return invalid(snapshot, "invalid-mutation");
    }
    if (
      snapshot.activities.some(
        (activity) => activity.activityId === mutation.activityId,
      )
    ) {
      return invalid(snapshot, "duplicate-activity");
    }
    const parentActivityId = mutation.parentActivityId ?? null;
    if (parentActivityId) {
      const parent = snapshot.activities.find(
        (activity) => activity.activityId === parentActivityId,
      );
      if (
        !parent ||
        parent.cindySessionId !== mutation.cindySessionId ||
        parent.scopeId !== mutation.scopeId
      ) {
        return invalid(snapshot, "invalid-mutation");
      }
    }
    const allowedActions = normalizeActions(
      mutation.status,
      mutation.allowedActions,
    );
    if (
      !allowedActions ||
      !hasValidUnavailableReason(mutation.status, mutation.unavailableReason)
    ) {
      return invalid(snapshot, "invalid-mutation");
    }
    const activity: DshActivityObject = {
      contractVersion: DSH_ACTIVITY_CONTRACT_VERSION,
      origin: DSH_ACTIVITY_ORIGIN,
      activityId: mutation.activityId,
      cindySessionId: mutation.cindySessionId,
      scopeId: mutation.scopeId,
      parentActivityId,
      kind: mutation.kind,
      ...(mutation.label !== undefined ? { label: mutation.label } : {}),
      status: mutation.status,
      summary: summaryFor(mutation.status),
      allowedActions,
      ...(mutation.status === "unavailable"
        ? { unavailableReason: mutation.unavailableReason }
        : {}),
      revision: 1,
    };
    return {
      kind: "mutated",
      snapshot: {
        contractVersion: DSH_ACTIVITY_CONTRACT_VERSION,
        origin: DSH_ACTIVITY_ORIGIN,
        sequence: snapshot.sequence + 1,
        activities: [...snapshot.activities, activity],
      },
      activity,
    };
  }

  const resolved = resolveActivity(
    snapshot,
    mutation.activityId,
    mutation.expectedRevision,
  );
  if ("reason" in resolved) return invalid(snapshot, resolved.reason);
  const activity = resolved.activity;

  if (mutation.type === "request-action") {
    if (
      !ACTIONS.has(mutation.action) ||
      !activity.allowedActions.includes(mutation.action)
    ) {
      return invalid(snapshot, "action-unavailable");
    }
    return {
      kind: "action-admitted",
      snapshot,
      activity,
      action: mutation.action,
    };
  }

  if (!STATUSES.has(mutation.status))
    return invalid(snapshot, "invalid-mutation");
  if (mutation.type === "reconnect") {
    if (activity.status !== "disconnected") {
      return invalid(snapshot, "invalid-transition");
    }
    const next = activityAfterStatus(
      activity,
      mutation.status,
      mutation.allowedActions,
      mutation.unavailableReason,
    );
    return next
      ? mutate(snapshot, next)
      : invalid(snapshot, "invalid-mutation");
  }

  if (
    activity.status === "disconnected"
      ? mutation.status !== "unavailable"
      : !TRANSITIONS[activity.status].has(mutation.status)
  ) {
    return invalid(snapshot, "invalid-transition");
  }
  const next = activityAfterStatus(
    activity,
    mutation.status,
    mutation.allowedActions,
    mutation.unavailableReason,
  );
  return next ? mutate(snapshot, next) : invalid(snapshot, "invalid-mutation");
}
