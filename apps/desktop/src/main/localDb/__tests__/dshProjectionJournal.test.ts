import { createHash } from 'node:crypto';

import type { AgentEvent } from '@cindy/maker-core';
import { describe, expect, it, vi } from 'vitest';

import {
  createDshProjectionJournal,
  serializeDshProjectionRecord,
} from '../dshProjectionJournal.js';

function event(sequence = 1): AgentEvent {
  return {
    type: 'text',
    data: {
      text: 'display-safe event',
      isFinal: true,
      agentMessageId: 'dsh:message:opaque',
    },
    source: 'dsh',
    agentMeta: { dsh: { projectionSequence: sequence } },
  };
}

describe('DSH projection journal boundary', () => {
  it('serializes only F4 DSH events and sends a canonical digest through the named transaction', async () => {
    const tx = vi.fn().mockResolvedValue({
      kind: 'advanced',
      binding: {
        cindySessionId: 'cindy-session-a',
        lifecycleState: 'active',
        lastProjectedSequence: 1,
        revision: 2,
      },
    });
    const journal = createDshProjectionJournal({ tx } as never, { now: () => 42 });

    await expect(
      journal.commit({
        cindySessionId: 'cindy-session-a',
        expectedBindingRevision: 1,
        sequence: 1,
        record: { version: 1, kind: 'events', events: [event()] },
      }),
    ).resolves.toMatchObject({ kind: 'advanced' });

    const recordJson = serializeDshProjectionRecord(
      { version: 1, kind: 'events', events: [event()] },
      1,
    );
    expect(tx).toHaveBeenCalledWith('dsh.commitProjection', {
      cindySessionId: 'cindy-session-a',
      expectedBindingRevision: 1,
      sequence: 1,
      recordJson,
      recordSha256: createHash('sha256').update(recordJson).digest('hex'),
      createdAt: 42,
    });
  });

  it('rejects an event that was not emitted by the finite DSH translator contract', async () => {
    const tx = vi.fn();
    const journal = createDshProjectionJournal({ tx } as never);
    const notDsh = { ...event(), source: 'codex' } as AgentEvent;

    await expect(
      journal.commit({
        cindySessionId: 'cindy-session-a',
        expectedBindingRevision: 1,
        sequence: 1,
        record: { version: 1, kind: 'events', events: [notDsh] },
      }),
    ).rejects.toThrow('F4 translator contract');
    expect(tx).not.toHaveBeenCalled();
  });

  it('rejects a mismatched sequence before it reaches SQLite', () => {
    expect(() => serializeDshProjectionRecord(
      { version: 1, kind: 'events', events: [event(2)] },
      1,
    )).toThrow('F4 translator contract');
  });

  it('rejects values JSON.stringify would silently coerce or drop', () => {
    expect(() => serializeDshProjectionRecord(
      { version: 1, kind: 'events', events: [{ ...event(), data: { value: Number.NaN } }] },
      1,
    ))
      .toThrow('non-finite number');
    expect(() => serializeDshProjectionRecord(
      { version: 1, kind: 'events', events: [{ ...event(), data: { value: undefined } }] },
      1,
    ))
      .toThrow('contains undefined');
  });

  it('admits a finite ignored record and marks a rejected update without persisting raw data', async () => {
    const tx = vi.fn()
      .mockResolvedValueOnce({ kind: 'advanced' })
      .mockResolvedValueOnce({ kind: 'rejected' });
    const journal = createDshProjectionJournal({ tx } as never, { now: () => 42 });

    await journal.commit({
      cindySessionId: 'cindy-session-a',
      expectedBindingRevision: 1,
      sequence: 1,
      record: { version: 1, kind: 'ignored', reason: 'unsupported-update' },
    });
    await journal.reject({
      cindySessionId: 'cindy-session-a',
      expectedBindingRevision: 2,
      sequence: 2,
      reason: 'invalid-tool-call',
    });

    expect(tx).toHaveBeenNthCalledWith(1, 'dsh.commitProjection', expect.objectContaining({
      recordJson: JSON.stringify({ version: 1, kind: 'ignored', reason: 'unsupported-update' }),
    }));
    expect(tx).toHaveBeenNthCalledWith(2, 'dsh.rejectProjection', {
      cindySessionId: 'cindy-session-a',
      expectedBindingRevision: 2,
      sequence: 2,
      reason: 'invalid-tool-call',
      createdAt: 42,
    });
  });
});
