import { describe, expect, it } from "vitest";

import { translateDshFollowEvent, type DshNativeFollowEvent } from "./translator.js";

function follow(update: unknown, sequence = 1): DshNativeFollowEvent {
  return {
    contractVersion: 1,
    cindySessionId: "cindy-session-1",
    scopeId: "scope-1",
    sequence,
    receivedAt: "2026-09-03T00:00:00.000Z",
    update,
  };
}

describe("translateDshFollowEvent", () => {
  it("maps committed text and thought blocks without exposing native ids", () => {
    const text = translateDshFollowEvent(
      follow({
        sessionUpdate: "agent_message_chunk",
        messageId: "message-1",
        content: { type: "text", text: "final answer" },
      }),
    );
    expect(text).toMatchObject({
      kind: "translated",
      events: [
        {
          type: "text",
          data: {
            text: "final answer",
            isFinal: true,
            agentMessageId: expect.stringMatching(
              /^dsh:message:[A-Za-z0-9_-]{32}$/,
            ),
          },
          source: "dsh",
          agentMeta: { dsh: { projectionSequence: 1 } },
        },
      ],
    });
    expect(JSON.stringify(text)).not.toContain("message-1");

    const thought = translateDshFollowEvent(
      follow(
        {
          sessionUpdate: "agent_thought_chunk",
          messageId: "thought-1",
          content: { type: "text", text: "reasoned locally" },
        },
        2,
      ),
    );
    expect(thought).toMatchObject({
      kind: "translated",
      events: [
        {
          type: "thinking",
          data: {
            stage: "final",
            blockId: expect.stringMatching(/^dsh:message:[A-Za-z0-9_-]{32}$/),
            text: "reasoned locally",
          },
          source: "dsh",
          agentMeta: { dsh: { projectionSequence: 2 } },
        },
      ],
    });
    expect(JSON.stringify(thought)).not.toContain("thought-1");
  });

  it("keeps an ordered tool lifecycle while bounding untrusted structured input", () => {
    expect(
      translateDshFollowEvent(
        follow({
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "bash",
          status: "in_progress",
          rawInput: { command: "pwd", nested: [true, 2] },
        }),
      ),
    ).toMatchObject({
      kind: "translated",
      events: [
        {
          type: "tool_use",
          data: {
            toolUseId: expect.stringMatching(/^dsh:tool:[A-Za-z0-9_-]{32}$/),
            toolName: "bash",
            input: { command: "pwd", nested: [true, 2] },
          },
        },
      ],
    });
    expect(
      translateDshFollowEvent(
        follow(
          {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-1",
            status: "completed",
            content: [
              {
                type: "content",
                content: { type: "text", text: "/workspace" },
              },
            ],
          },
          2,
        ),
      ),
    ).toMatchObject({
      kind: "translated",
      events: [
        {
          type: "tool_result_full",
          data: {
            toolUseId: expect.stringMatching(/^dsh:tool:[A-Za-z0-9_-]{32}$/),
            fullText: "/workspace",
            isError: false,
          },
        },
        {
          type: "tool_result",
          data: {
            summary: "completed",
            toolUseIds: [expect.stringMatching(/^dsh:tool:[A-Za-z0-9_-]{32}$/)],
          },
        },
      ],
    });
  });

  it("redacts native text and sensitive tool values before producing an AgentEvent", () => {
    const toolCall = translateDshFollowEvent(
      follow({
        sessionUpdate: "tool_call",
        toolCallId: "tool-secret-1",
        title: "curl",
        status: "in_progress",
        rawInput: {
          authorization: "Bearer dsh-test-secret",
          api_key: "dsh-test-key",
          command: "curl -H 'Authorization: Bearer dsh-test-header'",
        },
      }),
    );
    expect(toolCall).toMatchObject({
      kind: "translated",
      events: [
        {
          data: {
            input: {
              authorization: "[REDACTED]",
              api_key: "[REDACTED]",
            },
          },
        },
      ],
    });
    expect(JSON.stringify(toolCall)).not.toContain("dsh-test-secret");
    expect(JSON.stringify(toolCall)).not.toContain("dsh-test-key");
    expect(JSON.stringify(toolCall)).not.toContain("dsh-test-header");

    const toolResult = translateDshFollowEvent(
      follow({
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-secret-1",
        status: "completed",
        content: [
          {
            type: "content",
            content: { type: "text", text: "access_token=dsh-test-result" },
          },
        ],
      }),
    );
    expect(JSON.stringify(toolResult)).not.toContain("dsh-test-result");
  });

  it("maps context occupancy without inventing a token or cost total", () => {
    expect(
      translateDshFollowEvent(
        follow({ sessionUpdate: "usage_update", used: 2_048, size: 1_024 }),
      ),
    ).toMatchObject({
      kind: "translated",
      events: [
        {
          type: "status",
          data: {
            isRunning: true,
            tokenUsage: 0,
            contextTokens: 2_048,
            contextWindow: 1_024,
            costUsd: 0,
          },
        },
      ],
    });
  });

  it("keeps a tool lifecycle correlated without returning its native id", () => {
    const started = translateDshFollowEvent(
      follow({
        sessionUpdate: "tool_call",
        toolCallId: "native-tool-correlation-1",
        title: "bash",
        status: "in_progress",
        rawInput: { command: "pwd" },
      }),
    );
    const completed = translateDshFollowEvent(
      follow(
        {
          sessionUpdate: "tool_call_update",
          toolCallId: "native-tool-correlation-1",
          status: "completed",
          content: [
            {
              type: "content",
              content: { type: "text", text: "/workspace" },
            },
          ],
        },
        2,
      ),
    );

    expect(started).toMatchObject({ kind: "translated" });
    expect(completed).toMatchObject({ kind: "translated" });
    if (started.kind !== "translated" || completed.kind !== "translated") {
      throw new Error("expected translated tool lifecycle");
    }
    const startedData = started.events[0]?.data as { toolUseId: string };
    const completedData = completed.events[0]?.data as { toolUseId: string };
    expect(startedData.toolUseId).toBe(completedData.toolUseId);
    expect(JSON.stringify({ started, completed })).not.toContain(
      "native-tool-correlation-1",
    );
  });

  it("projects native tool images as bounded summaries without carrying image bytes or private metadata", () => {
    const data = Buffer.from("fixture image bytes").toString("base64");
    const result = translateDshFollowEvent(follow({
      sessionUpdate: "tool_call_update", toolCallId: "tool-image", status: "completed",
      content: [
        { type: "content", content: { type: "text", text: "before" } },
        { type: "content", content: { type: "image", mimeType: "image/png", data, uri: "file:///native-private" } },
        { type: "content", content: { type: "text", text: "after" } },
      ],
    }));
    expect(result).toMatchObject({ kind: "translated", events: [
      { type: "tool_result_full", data: { fullText: "before\n[Image: image/png]\nafter", isError: false } },
      { type: "tool_result" },
    ] });
    expect(JSON.stringify(result)).not.toContain(data);
    expect(JSON.stringify(result)).not.toContain("native-private");
    for (const content of [
      { type: "image", mimeType: "text/html", data },
      { type: "image", mimeType: "image/png", data: "a===" },
      { type: "image", mimeType: "image/png", data: "A".repeat(16 * 1024 * 1024 + 4) },
    ]) {
      expect(translateDshFollowEvent(follow({ sessionUpdate: "tool_call_update", toolCallId: "tool-image", status: "completed",
        content: [{ type: "content", content }] }))).toEqual({ kind: "rejected", reason: "invalid-tool-result" });
    }
  });

  it("rejects malformed updates and never returns raw input as an event", () => {
    expect(
      translateDshFollowEvent({
        ...follow({ sessionUpdate: "usage_update", used: 1, size: 1 }),
        scopeId: " foreign-scope",
      }),
    ).toEqual({ kind: "rejected", reason: "invalid-envelope" });
    expect(
      translateDshFollowEvent(
        follow({
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "bash",
          status: "in_progress",
          rawInput: { huge: "x".repeat(1024 * 1024 + 1) },
        }),
      ),
    ).toEqual({ kind: "rejected", reason: "invalid-tool-call" });
    expect(
      translateDshFollowEvent(
        follow({
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          status: "completed",
          content: [
            {
              type: "content",
              content: { type: "image", data: "abc" },
            },
          ],
        }),
      ),
    ).toEqual({ kind: "rejected", reason: "invalid-tool-result" });
    expect(
      translateDshFollowEvent(
        follow({
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "bash",
          status: "in_progress",
          rawInput: JSON.parse('{"__proto__":{"polluted":true}}'),
        }),
      ),
    ).toEqual({ kind: "rejected", reason: "invalid-tool-call" });
    expect(
      translateDshFollowEvent(
        follow({
          sessionUpdate: "agent_message_chunk",
          messageId: "message-image-1",
          content: { type: "image", data: "abc" },
        }),
      ),
    ).toEqual({ kind: "ignored", reason: "unsupported-content" });
    expect(
      translateDshFollowEvent(
        follow({ sessionUpdate: "future_update", token: "secret" }),
      ),
    ).toEqual({
      kind: "ignored",
      reason: "unsupported-update",
    });
  });

  it("makes repeated native message ids distinct in the Cindy event stream", () => {
    const first = translateDshFollowEvent(
      follow(
        {
          sessionUpdate: "agent_message_chunk",
          messageId: "message-1",
          content: { type: "text", text: "first chunk" },
        },
        10,
      ),
    );
    const second = translateDshFollowEvent(
      follow(
        {
          sessionUpdate: "agent_message_chunk",
          messageId: "message-1",
          content: { type: "text", text: "second chunk" },
        },
        11,
      ),
    );

    expect(first).toMatchObject({
      kind: "translated",
      events: [
        {
          data: {
            agentMessageId: expect.stringMatching(
              /^dsh:message:[A-Za-z0-9_-]{32}$/,
            ),
          },
        },
      ],
    });
    expect(second).toMatchObject({
      kind: "translated",
      events: [
        {
          data: {
            agentMessageId: expect.stringMatching(
              /^dsh:message:[A-Za-z0-9_-]{32}$/,
            ),
          },
        },
      ],
    });
    expect(first).not.toEqual(second);
  });
});
