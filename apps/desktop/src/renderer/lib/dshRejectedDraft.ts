import type { AgentInputProjection } from '../../shared/agentInputQueue';
import { captureDraftDiscardToken, plainTextToTiptapDoc, restoreRemoteOptimisticDraft } from './composerDraftStore';
import { DSH_REJECTED_INPUT_REASONS } from '../../shared/dshPromptFailure';

// Keep the last restored input independently of the mutable draft. Discarding
// or replacing a draft clears its merge cursor but must not resurrect an old
// rejection when Main broadcasts that same projection again.
const restoredInputs = new Map<string, string>();

/** Restore only Main-proven rejections; uncertain turns must never become drafts. */
export function restoreDshRejectedDraft(projection: AgentInputProjection): void {
  if (
    !projection.error ||
    !DSH_REJECTED_INPUT_REASONS.has(projection.errorReason ?? '') ||
    projection.recovery?.kind !== 'active-turn'
  )
    return;
  const item = projection.recovery.item;
  const { ownerScopedKey } = captureDraftDiscardToken(projection.sessionId);
  if (restoredInputs.get(ownerScopedKey) === item.clientId) return;
  // Reuse the per-owner merge behavior to preserve text typed during the send.
  restoreRemoteOptimisticDraft(projection.sessionId, {
    clientId: item.clientId,
    text: plainTextToTiptapDoc(item.persistedContent || item.text),
    attachments: item.files ?? [],
    browserComments: [],
  });
  restoredInputs.set(ownerScopedKey, item.clientId);
}
