export interface NewMakerAgentSelectVisibility {
  unifiedModelPanelActive: boolean;
  isDshDraft: boolean;
  dshEntryVisible: boolean;
}

/**
 * The unified model panel owns ordinary model-to-Harness selection, but DSH is
 * intentionally absent from that catalog. Keep the dedicated Harness selector
 * reachable on supported local targets even before DSH is ready. The selector
 * marks that row unavailable and routes it to recovery/configuration instead
 * of silently removing the whole working-mode entry. A selected DSH draft also
 * remains escapable if its runtime later becomes unavailable.
 */
export function shouldShowNewMakerAgentSelect({
  unifiedModelPanelActive,
  isDshDraft,
  dshEntryVisible,
}: NewMakerAgentSelectVisibility): boolean {
  return !unifiedModelPanelActive || isDshDraft || dshEntryVisible;
}

export interface DshSettingsProviderProjection {
  readonly id: string;
  readonly dshRuntime?: unknown;
}

/** Choose a useful recovery destination without exposing DSH provider details. */
export function dshRecoverySettingsPath(
  configuration:
    | Readonly<{ status: 'ready' }>
    | Readonly<{ status: 'unavailable'; reason: string }>,
  providers: readonly DshSettingsProviderProjection[],
): string {
  if (configuration.status === 'unavailable' && configuration.reason === 'not-configured') {
    return '/settings?tab=providers&wizard=1';
  }
  if (configuration.status === 'unavailable' && configuration.reason === 'multiple-configured') {
    return '/settings?tab=providers';
  }
  const configuredProvider = providers.find((provider) => provider.dshRuntime);
  return configuredProvider
    ? `/settings?tab=providers&connect=${encodeURIComponent(configuredProvider.id)}`
    : '/settings?tab=providers&wizard=1';
}
