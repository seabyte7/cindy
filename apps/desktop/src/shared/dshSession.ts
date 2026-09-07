/**
 * DSH has no Cindy-exposed model catalog in the current local Desktop scope.
 * Generic session storage still requires a model value, so the renderer and
 * main process use this opaque marker instead of a provider-selected model.
 */
export const DSH_MANAGED_RUNTIME_MODEL_ID = 'cindy-dsh-managed';
