/** Main-only projection from provider admission and lifecycle state to Settings. */

import type {
  DshRuntimeConfigurationReason,
  DshRuntimeRegistrationStatus,
  DshRuntimeStatus,
} from '../../shared/dshRuntimeStatus.js';
import type { DshProviderAvailability, DshProviderUnavailableReason } from './provider-config.js';

function reason(reason: DshProviderUnavailableReason | 'unavailable'): DshRuntimeConfigurationReason {
  return reason;
}

/**
 * Keep this function pure so status cannot accidentally acquire side effects
 * such as starting a child process or reading a Home bookmark.
 */
export function projectDshRuntimeStatus(input: {
  revision: number;
  provider: DshProviderAvailability | Readonly<{ available: false; reason: 'unavailable' }>;
  registration: DshRuntimeRegistrationStatus;
  activeTaskCount: number;
}): DshRuntimeStatus {
  const pending = input.registration === 'reconfiguration-pending';
  return Object.freeze({
    revision: input.revision,
    configuration: input.provider.available
      ? Object.freeze({ status: 'ready' as const, providerName: input.provider.providerName })
      : Object.freeze({ status: 'unavailable' as const, reason: reason(input.provider.reason) }),
    registration: input.registration,
    activeTaskCount: input.activeTaskCount,
    evidence: Object.freeze({
      modelConnection: 'not-verified-in-this-app' as const,
      commands: 'not-verified-in-this-app' as const,
      fileTools: 'not-verified-in-this-app' as const,
      attachments: 'not-verified-in-this-app' as const,
      permissions: 'not-verified-in-this-app' as const,
    }),
    actions: Object.freeze({
      canRetryRegistration: input.registration !== 'registering',
      mustCloseActiveTasksBeforeReplacement: pending && input.activeTaskCount > 0,
    }),
  });
}
