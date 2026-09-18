import { describe, expect, it } from 'vitest';

import { shouldShowNewMakerAgentSelect } from '../newMakerAgentSelectVisibility';

describe('shouldShowNewMakerAgentSelect', () => {
  it('shows the dedicated selector when a registered DSH runtime is available', () => {
    expect(
      shouldShowNewMakerAgentSelect({
        unifiedModelPanelActive: true,
        isDshDraft: false,
        dshAvailableForDraft: true,
      }),
    ).toBe(true);
  });

  it('keeps ordinary unified-model drafts free of the redundant selector', () => {
    expect(
      shouldShowNewMakerAgentSelect({
        unifiedModelPanelActive: true,
        isDshDraft: false,
        dshAvailableForDraft: false,
      }),
    ).toBe(false);
  });

  it('keeps a selected DSH draft escapable when its runtime becomes unavailable', () => {
    expect(
      shouldShowNewMakerAgentSelect({
        unifiedModelPanelActive: false,
        isDshDraft: true,
        dshAvailableForDraft: false,
      }),
    ).toBe(true);
  });

  it('preserves the legacy selector when the unified model panel is unavailable', () => {
    expect(
      shouldShowNewMakerAgentSelect({
        unifiedModelPanelActive: false,
        isDshDraft: false,
        dshAvailableForDraft: false,
      }),
    ).toBe(true);
  });
});
