import { describe, expect, it } from 'vitest';
import type { AgentInputProjection } from '../../../shared/agentInputQueue';
import { clearDraft, getDraft, plainTextToTiptapDoc, saveDraft } from '../composerDraftStore';
import { restoreDshRejectedDraft } from '../dshRejectedDraft';

describe('DSH rejected input recovery', () => {
  it('merges the original text and attachments once without overwriting newer input', () => {
    const sessionId = 'dsh-rejection-merge';
    const file = {
      id: 'image',
      name: 'pixel.png',
      path: '/fixture.png',
      ext: '.png',
      size: 4,
      category: 'image' as const,
      mimeType: 'image/png',
    };
    saveDraft(sessionId, { text: plainTextToTiptapDoc('newer input'), attachments: [] });
    const projection = {
      sessionId,
      error: 'safe refusal',
      errorReason: 'dsh-image-model-unsupported',
      recovery: {
        kind: 'active-turn',
        item: {
          clientId: 'original',
          text: 'original input',
          persistedContent: 'original input',
          files: [file],
        },
      },
    } as AgentInputProjection;
    restoreDshRejectedDraft(projection);
    const restored = structuredClone(getDraft(sessionId));
    expect(JSON.stringify(restored?.text)).toContain('original input');
    expect(JSON.stringify(restored?.text)).toContain('newer input');
    expect(restored?.attachments).toEqual([file]);
    restoreDshRejectedDraft(projection);
    expect(getDraft(sessionId)).toEqual(restored);
    saveDraft(sessionId, { text: plainTextToTiptapDoc('user replaced draft'), attachments: [] });
    restoreDshRejectedDraft(projection);
    expect(JSON.stringify(getDraft(sessionId)?.text)).not.toContain('original input');
    clearDraft(sessionId);
    restoreDshRejectedDraft(projection);
    expect(getDraft(sessionId)).toBeUndefined();
  });

  it.each(['dsh-prompt-unconfirmed', 'dsh-prompt-timeout', 'unknown-error'])(
    'never turns %s into a resendable draft',
    (errorReason) => {
      const sessionId = `dsh-rejection-${errorReason}`;
      restoreDshRejectedDraft({
        sessionId,
        error: 'unknown outcome',
        errorReason,
        recovery: { kind: 'active-turn', item: { clientId: 'unknown', text: 'must not replay' } },
      } as AgentInputProjection);
      expect(getDraft(sessionId)).toBeUndefined();
    },
  );
});
