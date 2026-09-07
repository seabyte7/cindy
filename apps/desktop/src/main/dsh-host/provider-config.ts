/**
 * Resolve the one configured DSH provider entirely inside Main.
 *
 * DSH does not participate in the generic model-provider catalog. Its adapter
 * has a fixed ACP profile and may receive exactly one API key in its child
 * environment. This module therefore turns the persisted `runtimes.dsh`
 * record into a Main-only launch capability, rather than exposing an endpoint
 * or credential through IPC.
 */

import type { CustomProviderConfig } from '@cindy/model-providers';

import type { DshChildSecret } from './scope.js';
import { createApprovedExternalDshProviderRoute, type DshProviderRoute } from './provider-route.js';

export type DshProviderUnavailableReason =
  | 'not-configured'
  | 'multiple-configured'
  | 'auth-not-api-key'
  | 'invalid-runtime-shape'
  | 'invalid-route'
  | 'missing-api-key';

export type DshProviderConfigurationResult =
  | {
      readonly status: 'unavailable';
      readonly reason: DshProviderUnavailableReason;
    }
  | {
      readonly status: 'ready';
      /** Display metadata only; endpoint and secrets remain Main-only. */
      readonly provider: Readonly<{ id: string; name: string }>;
      readonly route: DshProviderRoute;
      /**
       * Reads the key only at child-launch time. Do not project this function
       * or its enclosing object into IPC, logging, telemetry, or SQLite.
       */
      readonly loadSecrets: () => readonly DshChildSecret[];
    };

export type DshProviderAvailability =
  | { readonly available: false; readonly reason: DshProviderUnavailableReason }
  | { readonly available: true; readonly providerName: string };

export type ReadDshProviderKey = (providerId: string, agent: 'dsh') => string | null;

function hasClosedDshRuntimeShape(
  runtime: NonNullable<CustomProviderConfig['runtimes']['dsh']>,
): boolean {
  return (
    Array.isArray(runtime.models) &&
    runtime.models.length === 0 &&
    runtime.wireProtocol === undefined &&
    runtime.requestPath === undefined &&
    runtime.headers === undefined &&
    runtime.modelsUrl === undefined &&
    runtime.piCatalogProviderId === undefined
  );
}

/**
 * Select exactly one DSH-configured provider. Multiple configurations are an
 * explicit unavailable state: choosing one by order would make a secret-bearing
 * external route change silently when the user edits a different provider.
 */
export function resolveDshProviderConfiguration(
  providers: readonly CustomProviderConfig[],
  readKey: ReadDshProviderKey,
): DshProviderConfigurationResult {
  const candidates = providers.filter((provider) => provider.runtimes.dsh);
  if (candidates.length === 0) return { status: 'unavailable', reason: 'not-configured' };
  if (candidates.length !== 1) return { status: 'unavailable', reason: 'multiple-configured' };

  const provider = candidates[0]!;
  const runtime = provider.runtimes.dsh!;
  if (provider.auth?.method && provider.auth.method !== 'apiKey') {
    return { status: 'unavailable', reason: 'auth-not-api-key' };
  }
  if (!hasClosedDshRuntimeShape(runtime)) {
    return { status: 'unavailable', reason: 'invalid-runtime-shape' };
  }

  let route: DshProviderRoute;
  try {
    // The persisted runtime is Main-owned configuration. The only admitted
    // destination is its exact HTTPS origin; a Renderer never supplies this
    // allowlist or a route object.
    const origin = new URL(runtime.baseUrl).origin;
    route = createApprovedExternalDshProviderRoute({
      baseUrl: runtime.baseUrl,
      approvedOrigins: [origin],
    });
  } catch {
    return { status: 'unavailable', reason: 'invalid-route' };
  }

  const initiallyReadKey = readKey(provider.id, 'dsh')?.trim() ?? '';
  if (!initiallyReadKey) return { status: 'unavailable', reason: 'missing-api-key' };

  return {
    status: 'ready',
    provider: Object.freeze({ id: provider.id, name: provider.name }),
    route,
    loadSecrets: () => {
      const apiKey = readKey(provider.id, 'dsh')?.trim() ?? '';
      if (!apiKey) throw new Error('DSH provider API key is unavailable at launch');
      return Object.freeze([{ name: 'CINDY_DSH_PROVIDER_API_KEY', value: apiKey }] as const);
    },
  };
}

/** Safe, endpoint-free projection for Settings/agent availability UI. */
export function projectDshProviderAvailability(
  result: DshProviderConfigurationResult,
): DshProviderAvailability {
  return result.status === 'ready'
    ? { available: true, providerName: result.provider.name }
    : { available: false, reason: result.reason };
}
