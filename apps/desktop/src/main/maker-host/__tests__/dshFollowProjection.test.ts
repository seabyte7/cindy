import { describe, expect, it, vi } from 'vitest';

import {
  createDshFollowProjectionCoordinator,
  type DshMainFollowProjectionInput,
} from '../dsh-follow-projection.js';

function follow(update: unknown, sequence = 1): DshMainFollowProjectionInput {
  return {
    contractVersion: 1,
    cindySessionId: 'cindy-session-a',
    scopeId: 'scope-a',
    sequence,
    receivedAt: '2026-09-03T00:00:00.000Z',
    update,
  };
}

const advanced = {
  kind: 'advanced' as const,
  binding: {
    cindySessionId: 'cindy-session-a',
    lifecycleState: 'active' as const,
    lastProjectedSequence: 1,
    revision: 2,
  },
};

describe('DSH follow projection coordinator', () => {
  it('persists a translated event before returning it to a later product subscriber', async () => {
    const journal = {
      commit: vi.fn().mockResolvedValue(advanced),
      reject: vi.fn(),
    };
    const coordinator = createDshFollowProjectionCoordinator(journal as never);
    const event = follow({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'native-message-a',
      content: { type: 'text', text: 'display-safe message' },
    });

    await expect(coordinator.project({ event, expectedBindingRevision: 1 })).resolves.toMatchObject({
      kind: 'translated',
      events: [expect.objectContaining({ type: 'text', source: 'dsh' })],
      binding: { revision: 2 },
    });
    expect(journal.commit).toHaveBeenCalledWith(expect.objectContaining({
      cindySessionId: event.cindySessionId,
      expectedBindingRevision: 1,
      sequence: 1,
      record: expect.objectContaining({ version: 1, kind: 'events' }),
    }));
    expect(journal.reject).not.toHaveBeenCalled();
  });

  it('journals a known ignored update and moves a malformed update to reconciliation without raw storage', async () => {
    const journal = {
      commit: vi.fn().mockResolvedValue(advanced),
      reject: vi.fn().mockResolvedValue({
        kind: 'rejected',
        binding: { ...advanced.binding, lifecycleState: 'needs_reconcile', revision: 2 },
      }),
    };
    const coordinator = createDshFollowProjectionCoordinator(journal as never);

    await expect(coordinator.project({
      event: follow({ sessionUpdate: 'future_native_update' }),
      expectedBindingRevision: 1,
    })).resolves.toMatchObject({ kind: 'ignored', reason: 'unsupported-update' });
    expect(journal.commit).toHaveBeenCalledWith(expect.objectContaining({
      record: { version: 1, kind: 'ignored', reason: 'unsupported-update' },
    }));

    await expect(coordinator.project({
      event: follow({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'missing id' } }),
      expectedBindingRevision: 1,
    })).resolves.toMatchObject({ kind: 'rejected', reason: 'invalid-message-update' });
    expect(journal.reject).toHaveBeenCalledWith({
      cindySessionId: 'cindy-session-a',
      expectedBindingRevision: 1,
      sequence: 1,
      reason: 'invalid-message-update',
    });
  });

  it('does not emit an unacknowledged record after a stale commit result', async () => {
    const journal = {
      commit: vi.fn().mockResolvedValue({ kind: 'conflict', binding: advanced.binding }),
      reject: vi.fn(),
    };
    const coordinator = createDshFollowProjectionCoordinator(journal as never);

    await expect(coordinator.project({
      event: follow({
        sessionUpdate: 'agent_message_chunk',
        messageId: 'native-message-a',
        content: { type: 'text', text: 'must not emit' },
      }),
      expectedBindingRevision: 1,
    })).resolves.toEqual({ kind: 'failed', reason: 'commit-conflict' });
  });
});
