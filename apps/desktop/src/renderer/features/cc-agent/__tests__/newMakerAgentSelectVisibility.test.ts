import { describe, expect, it } from 'vitest';

import {
  dshRecoverySettingsPath,
  shouldShowNewMakerAgentSelect,
} from '../newMakerAgentSelectVisibility';

describe('shouldShowNewMakerAgentSelect', () => {
  it('shows the dedicated selector when a registered DSH runtime is available', () => {
    expect(
      shouldShowNewMakerAgentSelect({
        unifiedModelPanelActive: true,
        isDshDraft: false,
        dshEntryVisible: true,
      }),
    ).toBe(true);
  });

  it('keeps the local DSH setup entry discoverable before its runtime is ready', () => {
    expect(
      shouldShowNewMakerAgentSelect({
        unifiedModelPanelActive: true,
        isDshDraft: false,
        dshEntryVisible: true,
      }),
    ).toBe(true);
  });

  it('keeps unsupported remote targets free of the local DSH selector', () => {
    expect(
      shouldShowNewMakerAgentSelect({
        unifiedModelPanelActive: true,
        isDshDraft: false,
        dshEntryVisible: false,
      }),
    ).toBe(false);
  });

  it('keeps a selected DSH draft escapable when its runtime becomes unavailable', () => {
    expect(
      shouldShowNewMakerAgentSelect({
        unifiedModelPanelActive: false,
        isDshDraft: true,
        dshEntryVisible: false,
      }),
    ).toBe(true);
  });

  it('preserves the legacy selector when the unified model panel is unavailable', () => {
    expect(
      shouldShowNewMakerAgentSelect({
        unifiedModelPanelActive: false,
        isDshDraft: false,
        dshEntryVisible: false,
      }),
    ).toBe(true);
  });
});

describe('dshRecoverySettingsPath', () => {
  const providers = [
    { id: 'ordinary', dshRuntime: undefined },
    { id: 'deepseek/custom', dshRuntime: {} },
  ];

  it('opens the existing DSH provider for repair', () => {
    expect(dshRecoverySettingsPath({ status: 'ready' }, providers)).toBe(
      '/settings?tab=providers&connect=deepseek%2Fcustom',
    );
    expect(
      dshRecoverySettingsPath(
        { status: 'unavailable', reason: 'missing-api-key' },
        providers,
      ),
    ).toBe('/settings?tab=providers&connect=deepseek%2Fcustom');
  });

  it('opens creation only when no DSH provider exists', () => {
    expect(
      dshRecoverySettingsPath({ status: 'unavailable', reason: 'not-configured' }, providers),
    ).toBe('/settings?tab=providers&wizard=1');
  });

  it('opens the provider list for an ambiguous multi-provider configuration', () => {
    expect(
      dshRecoverySettingsPath(
        { status: 'unavailable', reason: 'multiple-configured' },
        providers,
      ),
    ).toBe('/settings?tab=providers');
  });
});
