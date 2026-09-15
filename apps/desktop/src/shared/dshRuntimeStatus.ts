/**
 * Display-safe status for the local DeepSeek Harness runtime.
 *
 * This deliberately describes only Cindy's configuration and registration
 * boundary. It never reports a provider URL, key/key hash, native session id,
 * filesystem grant, ACP envelope, or an inferred tool success.
 */

export type DshRuntimeConfigurationReason =
  | 'not-configured'
  | 'multiple-configured'
  | 'auth-not-api-key'
  | 'invalid-runtime-shape'
  | 'invalid-route'
  | 'missing-api-key'
  | 'unavailable';

export type DshRuntimeRegistrationStatus =
  | 'not-registered'
  | 'registering'
  | 'task-factory-ready'
  | 'reconfiguration-pending';

export type DshRuntimeEvidenceStatus = 'not-verified-in-this-app';

export interface DshRuntimeStatus {
  /** Main-owned monotonic process revision; opaque outside status comparisons. */
  revision: number;
  configuration:
    | Readonly<{ status: 'ready'; providerName: string }>
    | Readonly<{ status: 'unavailable'; reason: DshRuntimeConfigurationReason }>;
  registration: DshRuntimeRegistrationStatus;
  activeTaskCount: number;
  /**
   * Source/profile wiring is intentionally not treated as device evidence.
   * These fields turn green only after the final signed App test suite, which
   * is outside this no-package source-change phase.
   */
  evidence: Readonly<{
    modelConnection: DshRuntimeEvidenceStatus;
    commands: DshRuntimeEvidenceStatus;
    fileTools: DshRuntimeEvidenceStatus;
    attachments: DshRuntimeEvidenceStatus;
    permissions: DshRuntimeEvidenceStatus;
  }>;
  actions: Readonly<{
    canRetryRegistration: boolean;
    mustCloseActiveTasksBeforeReplacement: boolean;
  }>;
}
