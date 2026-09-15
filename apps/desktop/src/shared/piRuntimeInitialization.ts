import type {
  AgentKind,
  ModelProviderAgentKind,
  ProviderPreset,
  ProviderPresetRuntime,
  ProviderRuntimeModelConfig,
} from '@cindy/model-providers';
import { isModelProviderAgentKind } from '@cindy/model-providers';

/** Remote presets may predate explicit Pi protocol metadata. Such a runtime is not saveable. */
export function isConfiguredPresetRuntime(
  agent: ModelProviderAgentKind,
  runtime: ProviderPresetRuntime | undefined,
): runtime is ProviderPresetRuntime {
  return runtime !== undefined && (agent !== 'pi' || runtime.wireProtocol !== undefined);
}

export function configuredPresetAgents(preset: ProviderPreset): ModelProviderAgentKind[] {
  return (Object.keys(preset.runtimes) as AgentKind[]).filter(
    (agent): agent is ModelProviderAgentKind =>
      isModelProviderAgentKind(agent) && isConfiguredPresetRuntime(agent, preset.runtimes[agent]),
  );
}

export function savedCustomProviderModelShape(
  model: ProviderRuntimeModelConfig,
  includePiCapabilities: boolean,
): ProviderRuntimeModelConfig {
  return {
    id: model.id.trim(),
    name: model.name.trim(),
    ...(includePiCapabilities && model.piApi ? { piApi: model.piApi } : {}),
    ...(model.route ? { route: { ...model.route } } : {}),
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.defaultEnabled === false ? { defaultEnabled: false } : {}),
    ...(includePiCapabilities && model.supportsImageInput === true
      ? { supportsImageInput: true }
      : {}),
    ...(includePiCapabilities && model.reasoning === true && model.reasoningEfforts?.length
      ? {
          reasoning: true,
          reasoningEfforts: [...model.reasoningEfforts],
          ...(model.reasoningDefaultEffort
            ? { reasoningDefaultEffort: model.reasoningDefaultEffort }
            : {}),
        }
      : {}),
  };
}
