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

/** Reject ASCII controls in DSH identifiers and persistence-bound strings. */
export function hasDshAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
