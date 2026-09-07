/**
 * Display-safe projection of DSH's live, Main-owned runtime configuration.
 * Values are opaque Main-issued capabilities; ACP values and provider routing
 * never cross this contract.
 */

export type DshRuntimeConfigurationId = 'model' | 'reasoning_effort';

export interface DshRuntimeConfigurationChoice {
  id: string;
  label: string;
}

export interface DshRuntimeConfigurationControl {
  id: DshRuntimeConfigurationId;
  currentChoiceId: string;
  choices: readonly DshRuntimeConfigurationChoice[];
}

export interface DshRuntimeConfigurationSnapshot {
  controls: readonly DshRuntimeConfigurationControl[];
}
