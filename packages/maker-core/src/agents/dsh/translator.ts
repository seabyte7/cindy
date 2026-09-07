/**
 * Closed translation of the small ACP update surface Cindy has locally
 * evidenced for the pinned DSH runtime.
 *
 * This module intentionally does not accept an arbitrary ACP payload as an
 * AgentEvent. Callers must treat `rejected` as a failed projection boundary:
 * raw update data is neither logged here nor allowed across a product IPC
 * boundary. Additional native update kinds require an explicit contract and
 * fixture before they can become visible.
 */

import { createHash } from "node:crypto";

import { redactSensitiveText } from "@cindy/maker-shared/error-redaction";

import type { AgentEvent } from "../../types/events.js";

const MAX_NATIVE_ID_LENGTH = 4 * 1024;
const MAX_TEXT_LENGTH = 1024 * 1024;
const MAX_TOOL_RESULT_BLOCKS = 128;
const MAX_SAFE_JSON_DEPTH = 12;
const MAX_SAFE_JSON_ITEMS = 1_024;
const BLOCKED_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const REDACTED_VALUE = "[REDACTED]";

export type DshFollowTranslation =
  | { kind: "translated"; events: readonly AgentEvent[] }
  | {
      kind: "ignored";
      reason: "empty-content" | "unsupported-content" | "unsupported-update";
    }
  | {
      kind: "rejected";
      reason:
        | "invalid-envelope"
        | "invalid-message-update"
        | "invalid-thought-update"
        | "invalid-tool-call"
        | "invalid-tool-result"
        | "invalid-usage-update";
    };

/**
 * Main-only input to the finite native update translator. Runtime session
 * identifiers deliberately do not appear here: they remain in the Desktop
 * control plane and are not required to produce a safe product projection.
 */
export interface DshNativeFollowEvent {
  contractVersion: 1;
  cindySessionId: string;
  scopeId: string;
  sequence: number;
  receivedAt: string;
  update: unknown;
}

type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeNativeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_NATIVE_ID_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isSafeText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_TEXT_LENGTH &&
    !value.includes("\u0000")
  );
}

function isSensitiveJsonKey(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    normalized === "key" ||
    normalized === "token" ||
    normalized === "secret" ||
    normalized === "password" ||
    normalized === "passwd" ||
    normalized === "authorization" ||
    normalized === "proxyauthorization" ||
    normalized === "cookie" ||
    normalized === "setcookie" ||
    normalized.endsWith("token") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("password") ||
    normalized.endsWith("apikey")
  );
}

function safeNativeText(
  value: unknown,
  parentKey?: string,
): string | undefined {
  if (!isSafeText(value)) return undefined;
  return isSensitiveJsonKey(parentKey)
    ? REDACTED_VALUE
    : redactSensitiveText(value);
}

function isSafeJsonKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_NATIVE_ID_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !BLOCKED_JSON_KEYS.has(value)
  );
}

function sourceMeta(event: DshNativeFollowEvent): Record<string, unknown> {
  return {
    dsh: {
      projectionSequence: event.sequence,
    },
  };
}

function opaqueNativeId(
  event: DshNativeFollowEvent,
  kind: "message" | "tool",
  nativeId: string,
): string {
  const digest = createHash("sha256")
    .update(event.cindySessionId)
    .update("\u0000")
    .update(event.scopeId)
    .update("\u0000")
    .update(kind)
    .update("\u0000")
    .update(nativeId)
    .digest("base64url")
    .slice(0, 32);
  return `dsh:${kind}:${digest}`;
}

function messageBlockId(
  event: DshNativeFollowEvent,
  messageId: string,
): string {
  return opaqueNativeId(event, "message", `${messageId}:${event.sequence}`);
}

function safeJson(
  value: unknown,
  depth = 0,
  state = { items: 0 },
  parentKey?: string,
): JsonValue | undefined {
  if (depth > MAX_SAFE_JSON_DEPTH || state.items++ >= MAX_SAFE_JSON_ITEMS)
    return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return safeNativeText(value, parentKey);
  if (Array.isArray(value)) {
    const values: JsonValue[] = [];
    for (const item of value) {
      const safe = safeJson(item, depth + 1, state, parentKey);
      if (safe === undefined) return undefined;
      values.push(safe);
    }
    return values;
  }
  if (!isRecord(value)) return undefined;
  const record: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isSafeJsonKey(key)) return undefined;
    const safe = safeJson(item, depth + 1, state, key);
    if (safe === undefined) return undefined;
    record[key] = safe;
  }
  return record;
}

function extractTextContent(value: unknown): string | undefined {
  if (!isRecord(value) || value.type !== "text") return undefined;
  return safeNativeText(value.text);
}

function translateMessage(
  event: DshNativeFollowEvent,
  update: Record<string, unknown>,
): DshFollowTranslation {
  const messageId = update.messageId;
  if (!isSafeNativeId(messageId)) {
    return { kind: "rejected", reason: "invalid-message-update" };
  }
  const content = update.content;
  const text = extractTextContent(content);
  if (text === undefined) {
    return isRecord(content) && typeof content.type === "string"
      ? { kind: "ignored", reason: "unsupported-content" }
      : { kind: "rejected", reason: "invalid-message-update" };
  }
  if (text.length === 0) return { kind: "ignored", reason: "empty-content" };
  return {
    kind: "translated",
    events: [
      {
        type: "text",
        data: {
          text,
          isFinal: true,
          agentMessageId: messageBlockId(event, messageId),
        },
        source: "dsh",
        agentMeta: sourceMeta(event),
      },
    ],
  };
}

function translateThought(
  event: DshNativeFollowEvent,
  update: Record<string, unknown>,
): DshFollowTranslation {
  const messageId = update.messageId;
  if (!isSafeNativeId(messageId))
    return { kind: "rejected", reason: "invalid-thought-update" };
  const text = extractTextContent(update.content);
  if (text === undefined)
    return { kind: "rejected", reason: "invalid-thought-update" };
  if (text.length === 0) return { kind: "ignored", reason: "empty-content" };
  return {
    kind: "translated",
    events: [
      {
        type: "thinking",
        data: {
          stage: "final",
          blockId: messageBlockId(event, messageId),
          text,
        },
        source: "dsh",
        agentMeta: sourceMeta(event),
      },
    ],
  };
}

function translateToolCall(
  event: DshNativeFollowEvent,
  update: Record<string, unknown>,
): DshFollowTranslation {
  if (
    !isSafeNativeId(update.toolCallId) ||
    !isSafeNativeId(update.title) ||
    update.status !== "in_progress"
  ) {
    return { kind: "rejected", reason: "invalid-tool-call" };
  }
  const input = safeJson(update.rawInput);
  const toolName = safeNativeText(update.title);
  if (input === undefined || toolName === undefined)
    return { kind: "rejected", reason: "invalid-tool-call" };
  return {
    kind: "translated",
    events: [
      {
        type: "tool_use",
        data: {
          toolUseId: opaqueNativeId(event, "tool", update.toolCallId),
          toolName,
          input,
        },
        source: "dsh",
        agentMeta: sourceMeta(event),
      },
    ],
  };
}

function textFromToolResultContent(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length > MAX_TOOL_RESULT_BLOCKS)
    return undefined;
  const text: string[] = [];
  for (const item of value) {
    if (!isRecord(item) || item.type !== "content") return undefined;
    const part = extractTextContent(item.content);
    if (part === undefined) return undefined;
    text.push(part);
  }
  return text.join("\n");
}

function translateToolResult(
  event: DshNativeFollowEvent,
  update: Record<string, unknown>,
): DshFollowTranslation {
  if (
    !isSafeNativeId(update.toolCallId) ||
    (update.status !== "completed" && update.status !== "failed")
  ) {
    return { kind: "rejected", reason: "invalid-tool-result" };
  }
  const fullText = textFromToolResultContent(update.content);
  if (fullText === undefined)
    return { kind: "rejected", reason: "invalid-tool-result" };
  const isError = update.status === "failed";
  const toolUseId = opaqueNativeId(event, "tool", update.toolCallId);
  return {
    kind: "translated",
    events: [
      {
        type: "tool_result_full",
        data: { toolUseId, fullText, isError },
        source: "dsh",
        agentMeta: sourceMeta(event),
      },
      {
        type: "tool_result",
        data: {
          summary: isError ? "failed" : "completed",
          toolUseIds: [toolUseId],
        },
        source: "dsh",
        agentMeta: sourceMeta(event),
      },
    ],
  };
}

function translateUsage(
  event: DshNativeFollowEvent,
  update: Record<string, unknown>,
): DshFollowTranslation {
  const used = update.used;
  const size = update.size;
  if (
    typeof used !== "number" ||
    typeof size !== "number" ||
    !Number.isSafeInteger(used) ||
    !Number.isSafeInteger(size) ||
    used < 0 ||
    size <= 0
  ) {
    return { kind: "rejected", reason: "invalid-usage-update" };
  }
  return {
    kind: "translated",
    events: [
      {
        type: "status",
        // ACP's `used` is current context occupancy, not per-turn token or
        // price accounting. Preserve only the facts it actually provides.
        data: {
          status: "Running",
          isRunning: true,
          tokenUsage: 0,
          contextTokens: used,
          contextWindow: size,
          costUsd: 0,
        },
        source: "dsh",
        agentMeta: sourceMeta(event),
      },
    ],
  };
}

/**
 * Translate one owner-scoped F0 follow notification into product-neutral
 * events. The caller must not emit any event when this returns `ignored` or
 * `rejected`; a later projection owner decides its lifecycle policy.
 */
export function translateDshFollowEvent(
  event: DshNativeFollowEvent,
): DshFollowTranslation {
  if (
    event.contractVersion !== 1 ||
    !isSafeNativeId(event.cindySessionId) ||
    !isSafeNativeId(event.scopeId) ||
    !Number.isSafeInteger(event.sequence) ||
    event.sequence <= 0 ||
    !isRecord(event.update) ||
    typeof event.update.sessionUpdate !== "string"
  ) {
    return { kind: "rejected", reason: "invalid-envelope" };
  }
  switch (event.update.sessionUpdate) {
    case "agent_message_chunk":
      return translateMessage(event, event.update);
    case "agent_thought_chunk":
      return translateThought(event, event.update);
    case "tool_call":
      return translateToolCall(event, event.update);
    case "tool_call_update":
      return translateToolResult(event, event.update);
    case "usage_update":
      return translateUsage(event, event.update);
    default:
      return { kind: "ignored", reason: "unsupported-update" };
  }
}
