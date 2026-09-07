import { describe, expect, it } from "vitest";

import {
  DSH_ACTIVITY_CONTRACT_VERSION,
  DSH_ACTIVITY_ORIGIN,
  createEmptyDshActivitySnapshot,
  reduceDshActivity,
  type DshActivityKind,
  type DshActivitySnapshot,
} from "./activity.js";

function createRoot(
  snapshot = createEmptyDshActivitySnapshot(),
  overrides: Partial<{
    kind: DshActivityKind;
    status: "pending" | "running" | "unavailable";
    allowedActions: readonly (
      "observe" | "complete" | "cancel" | "close" | "input" | "signal"
    )[];
  }> = {},
) {
  return reduceDshActivity(snapshot, {
    type: "create",
    expectedSequence: snapshot.sequence,
    activityId: "activity-root",
    cindySessionId: "cindy-task-1",
    scopeId: "scope-1",
    kind: overrides.kind ?? "session",
    status: overrides.status ?? "pending",
    allowedActions: overrides.allowedActions ?? ["observe", "cancel", "close"],
    ...(overrides.status === "unavailable"
      ? { unavailableReason: "native-contract-not-admitted" as const }
      : {}),
  });
}

function mutated(
  result: ReturnType<typeof reduceDshActivity>,
): DshActivitySnapshot {
  expect(result.kind).toBe("mutated");
  if (result.kind !== "mutated") throw new Error("expected mutation");
  return result.snapshot;
}

describe("cindy-dsh activity reducer", () => {
  it("creates only Cindy-owned, scope-bound parent and child objects", () => {
    const root = mutated(createRoot());
    const child = reduceDshActivity(root, {
      type: "create",
      expectedSequence: root.sequence,
      activityId: "activity-child",
      cindySessionId: "cindy-task-1",
      scopeId: "scope-1",
      parentActivityId: "activity-root",
      kind: "todo",
      status: "pending",
      allowedActions: ["observe"],
    });
    expect(child).toMatchObject({
      kind: "mutated",
      activity: {
        contractVersion: DSH_ACTIVITY_CONTRACT_VERSION,
        origin: DSH_ACTIVITY_ORIGIN,
        parentActivityId: "activity-root",
        summary: "pending",
        revision: 1,
      },
    });

    const mismatch = reduceDshActivity(root, {
      type: "create",
      expectedSequence: root.sequence,
      activityId: "cross-session-child",
      cindySessionId: "cindy-task-2",
      scopeId: "scope-1",
      parentActivityId: "activity-root",
      kind: "todo",
      status: "pending",
      allowedActions: ["observe"],
    });
    expect(mismatch).toMatchObject({
      kind: "rejected",
      reason: "invalid-mutation",
      snapshot: root,
    });
  });

  it("admits only bounded Cindy-authored labels and keeps legacy roots readable", () => {
    const labeled = reduceDshActivity(createEmptyDshActivitySnapshot(), {
      type: "create",
      expectedSequence: 0,
      activityId: "activity-plan",
      cindySessionId: "cindy-task-1",
      scopeId: "scope-1",
      kind: "plan",
      label: "Prepare local macOS validation",
      status: "pending",
      allowedActions: ["observe", "complete", "cancel"],
    });
    expect(labeled).toMatchObject({
      kind: "mutated",
      activity: { label: "Prepare local macOS validation" },
    });

    const invalid = reduceDshActivity(createEmptyDshActivitySnapshot(), {
      type: "create",
      expectedSequence: 0,
      activityId: "activity-invalid-label",
      cindySessionId: "cindy-task-1",
      scopeId: "scope-1",
      kind: "plan",
      label: "  not normalized  ",
      status: "pending",
      allowedActions: ["observe"],
    });
    expect(invalid).toMatchObject({ kind: "rejected", reason: "invalid-mutation" });

    const legacy = mutated(createRoot());
    expect(legacy.activities[0]).not.toHaveProperty("label");
  });

  it.each<DshActivityKind>([
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
  ])("has finite create, running, and terminal transitions for %s", (kind) => {
    const created = mutated(
      createRoot(undefined, {
        kind,
        status: "pending",
        allowedActions: ["observe"],
      }),
    );
    const running = mutated(
      reduceDshActivity(created, {
        type: "transition",
        expectedSequence: created.sequence,
        activityId: "activity-root",
        expectedRevision: 1,
        status: "running",
        allowedActions: ["observe"],
      }),
    );
    const completed = reduceDshActivity(running, {
      type: "transition",
      expectedSequence: running.sequence,
      activityId: "activity-root",
      expectedRevision: 2,
      status: "completed",
    });
    expect(completed).toMatchObject({
      kind: "mutated",
      activity: {
        kind,
        status: "completed",
        summary: "completed",
        allowedActions: ["observe"],
      },
    });
  });

  it.each(["failed", "cancelled"] as const)(
    "has a finite terminal transition for %s without leaving control actions live",
    (status) => {
      const created = mutated(createRoot());
      const terminal = reduceDshActivity(created, {
        type: "transition",
        expectedSequence: created.sequence,
        activityId: "activity-root",
        expectedRevision: 1,
        status,
      });
      expect(terminal).toMatchObject({
        kind: "mutated",
        activity: {
          status,
          summary: status,
          allowedActions: ["observe"],
          revision: 2,
        },
      });
    },
  );

  it("fails closed for stale sequence/revision and actions that are not admitted", () => {
    const root = mutated(createRoot());
    expect(
      reduceDshActivity(root, {
        type: "transition",
        expectedSequence: 0,
        activityId: "activity-root",
        expectedRevision: 1,
        status: "running",
      }),
    ).toMatchObject({ kind: "rejected", reason: "stale-sequence" });

    expect(
      reduceDshActivity(root, {
        type: "transition",
        expectedSequence: root.sequence,
        activityId: "activity-root",
        expectedRevision: 8,
        status: "running",
      }),
    ).toMatchObject({ kind: "rejected", reason: "stale-revision" });

    expect(
      reduceDshActivity(root, {
        type: "request-action",
        expectedSequence: root.sequence,
        activityId: "activity-root",
        expectedRevision: 1,
        action: "signal",
      }),
    ).toMatchObject({ kind: "rejected", reason: "action-unavailable" });
  });

  it("admits only a named currently enabled action and never mutates for the request itself", () => {
    const root = mutated(createRoot());
    const action = reduceDshActivity(root, {
      type: "request-action",
      expectedSequence: root.sequence,
      activityId: "activity-root",
      expectedRevision: 1,
      action: "cancel",
    });
    expect(action).toMatchObject({
      kind: "action-admitted",
      action: "cancel",
      snapshot: root,
      activity: { activityId: "activity-root", revision: 1 },
    });
  });

  it("makes disconnect read-only and requires an explicit reconcile before reconnecting", () => {
    const root = mutated(
      createRoot(undefined, {
        kind: "terminal",
        status: "running",
        allowedActions: ["observe", "input", "signal", "close"],
      }),
    );
    const disconnected = mutated(
      reduceDshActivity(root, {
        type: "transition",
        expectedSequence: root.sequence,
        activityId: "activity-root",
        expectedRevision: 1,
        status: "disconnected",
      }),
    );
    expect(disconnected.activities[0]).toMatchObject({
      status: "disconnected",
      allowedActions: ["observe"],
      revision: 2,
    });
    expect(
      reduceDshActivity(disconnected, {
        type: "request-action",
        expectedSequence: disconnected.sequence,
        activityId: "activity-root",
        expectedRevision: 2,
        action: "input",
      }),
    ).toMatchObject({ kind: "rejected", reason: "action-unavailable" });
    expect(
      reduceDshActivity(disconnected, {
        type: "transition",
        expectedSequence: disconnected.sequence,
        activityId: "activity-root",
        expectedRevision: 2,
        status: "running",
        allowedActions: ["observe", "input"],
      }),
    ).toMatchObject({ kind: "rejected", reason: "invalid-transition" });

    expect(
      reduceDshActivity(disconnected, {
        type: "reconnect",
        expectedSequence: disconnected.sequence,
        activityId: "activity-root",
        expectedRevision: 2,
        status: "running",
        allowedActions: ["observe", "input"],
      }),
    ).toMatchObject({
      kind: "mutated",
      activity: {
        status: "running",
        allowedActions: ["observe", "input"],
        revision: 3,
      },
    });
  });

  it("keeps unsupported activities discoverable without fabricating a control action", () => {
    const unavailable = mutated(
      createRoot(undefined, {
        kind: "schedule",
        status: "unavailable",
        allowedActions: ["observe"],
      }),
    );
    expect(unavailable.activities[0]).toMatchObject({
      status: "unavailable",
      unavailableReason: "native-contract-not-admitted",
      allowedActions: ["observe"],
    });
    expect(
      reduceDshActivity(unavailable, {
        type: "request-action",
        expectedSequence: unavailable.sequence,
        activityId: "activity-root",
        expectedRevision: 1,
        action: "cancel",
      }),
    ).toMatchObject({ kind: "rejected", reason: "action-unavailable" });
  });

  it("rejects unknown schema fields rather than preserving arbitrary raw payload", () => {
    const unsafe = {
      contractVersion: DSH_ACTIVITY_CONTRACT_VERSION,
      origin: DSH_ACTIVITY_ORIGIN,
      sequence: 0,
      activities: [
        {
          contractVersion: DSH_ACTIVITY_CONTRACT_VERSION,
          origin: DSH_ACTIVITY_ORIGIN,
          activityId: "raw-activity",
          cindySessionId: "cindy-task-1",
          scopeId: "scope-1",
          parentActivityId: null,
          kind: "terminal",
          status: "running",
          summary: "running",
          allowedActions: ["observe"],
          revision: 1,
          rawAcpPayload: { stderr: "must-not-cross" },
        },
      ],
    } as unknown as DshActivitySnapshot;
    expect(
      reduceDshActivity(unsafe, {
        type: "create",
        expectedSequence: 0,
        activityId: "new-activity",
        cindySessionId: "cindy-task-1",
        scopeId: "scope-1",
        kind: "plan",
        status: "pending",
        allowedActions: ["observe"],
      }),
    ).toMatchObject({ kind: "rejected", reason: "invalid-snapshot" });

    expect(
      reduceDshActivity(createEmptyDshActivitySnapshot(), {
        type: "create",
        expectedSequence: 0,
        activityId: "new-activity",
        cindySessionId: "cindy-task-1",
        scopeId: "scope-1",
        kind: "plan",
        status: "pending",
        allowedActions: ["observe"],
        rawAcpPayload: { stderr: "must-not-cross" },
      } as never),
    ).toMatchObject({ kind: "rejected", reason: "invalid-mutation" });
  });
});
