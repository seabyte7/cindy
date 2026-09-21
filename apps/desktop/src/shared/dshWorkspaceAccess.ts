/**
 * Display-safe state for persisted DSH workspace access.
 *
 * A pathname and security-scoped bookmark stay inside Desktop Main. Only the
 * number of usable saved grants crosses the preload boundary.
 */
export type DshWorkspaceAccessProjection = Readonly<{
  status: 'default' | 'configured' | 'unavailable';
  count: number;
}>;
