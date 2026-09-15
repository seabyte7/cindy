import type { ModelProviderAgentKind } from '@cindy/model-providers';

/** Shared engine colors for model settings and the compact picker. */
export const MODEL_HARNESS_COLOR: Readonly<Record<ModelProviderAgentKind, string>> = {
  'claude-code': 'var(--engine-badge-cc)',
  codex: 'var(--engine-badge-codex)',
  pi: 'var(--engine-badge-pi)',
};
