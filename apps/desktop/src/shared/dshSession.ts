/**
 * DSH has no Cindy-exposed model catalog in the current local Desktop scope.
 * Generic session storage still requires a model value, so the renderer and
 * main process use this opaque marker instead of a provider-selected model.
 */
export const DSH_MANAGED_RUNTIME_MODEL_ID = 'cindy-dsh-managed';

/**
 * The DSH model value is an internal identity marker, not a selectable model
 * from Cindy's provider catalog.  Keep this predicate narrow so only a
 * validated DSH session can bypass the generic model-route guard.
 */
export function isManagedDshRuntimeRoute(
  agentKind: string,
  model: string | null | undefined,
): boolean {
  return agentKind === 'dsh' && model === DSH_MANAGED_RUNTIME_MODEL_ID;
}
