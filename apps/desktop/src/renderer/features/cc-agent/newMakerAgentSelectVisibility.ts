export interface NewMakerAgentSelectVisibility {
  unifiedModelPanelActive: boolean;
  isDshDraft: boolean;
  dshAvailableForDraft: boolean;
}

/**
 * The unified model panel owns ordinary model-to-Harness selection, but DSH is
 * intentionally absent from that catalog. Keep the dedicated Harness selector
 * reachable when DSH can be started, and while a DSH draft is selected so the
 * user can switch away if its runtime later becomes unavailable.
 */
export function shouldShowNewMakerAgentSelect({
  unifiedModelPanelActive,
  isDshDraft,
  dshAvailableForDraft,
}: NewMakerAgentSelectVisibility): boolean {
  return !unifiedModelPanelActive || isDshDraft || dshAvailableForDraft;
}
