/**
 * Display-safe state for the optional existing DeepSeek Harness Home.
 *
 * This crosses the Main/preload/Renderer boundary. It intentionally never
 * contains a pathname, security-scoped bookmark, or opaque bookmark reference.
 */
export type DshExistingHomeProjection =
  | Readonly<{ mode: 'cindy-managed'; status: 'default' }>
  | Readonly<{ mode: 'existing-dsh-home'; status: 'configured' | 'unavailable' }>;
