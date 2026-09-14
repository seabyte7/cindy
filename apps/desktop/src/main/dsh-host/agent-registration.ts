/**
 * Main-only admission for the optional Desktop DSH agent.
 *
 * DSH is deliberately not constructed with the ordinary Maker agents. Its
 * bridge carries a provider route and API key for one owner generation, so we
 * prove the owner and exact configuration both before and after the async ACP
 * handshake. A stale bridge is torn down instead of being registered with a
 * new account or edited provider configuration.
 */

import type { CustomProviderConfig } from '@cindy/model-providers';

import {
  resolveDshProviderConfiguration,
  type DshProviderConfigurationResult,
  type ReadDshProviderKey,
} from './provider-config.js';
import type { DshChildSecret } from './scope.js';

export interface DshRegistrationOwnerScope {
  readonly ownerId: string | null;
  readonly scopeKey: string;
  readonly boundaryPending: boolean;
}

export interface DshRegisteredAgent {
  dispose(): Promise<void>;
}

export interface DshStartedBridge {
  /** Release the supervised process and its scope paths without logging inputs. */
  close(reason: string): Promise<void>;
}

export interface DshAgentRegistrationDeps<
  TAgent extends DshRegisteredAgent,
  TBridge extends DshStartedBridge = DshStartedBridge,
> {
  readOwnerScope(): DshRegistrationOwnerScope;
  listProviders(): Promise<readonly CustomProviderConfig[]>;
  readProviderKey: ReadDshProviderKey;
  isAlreadyRegistered(): boolean;
  startBridge(input: {
    readonly ownerId: string;
    readonly configuration: Extract<DshProviderConfigurationResult, { status: 'ready' }>;
  }): Promise<TBridge>;
  createAgent(input: TBridge): TAgent;
  registerAgent(agent: TAgent): boolean;
}

export type DshAgentRegistrationResult =
  | { readonly status: 'registered' }
  | { readonly status: 'already-registered' }
  | { readonly status: 'owner-unavailable' }
  | { readonly status: 'owner-changed' }
  | { readonly status: 'configuration-unavailable'; readonly reason: string }
  | { readonly status: 'configuration-changed-during-start' }
  | { readonly status: 'bridge-start-failed' }
  | { readonly status: 'registration-rejected' };

function isStableOwner(scope: DshRegistrationOwnerScope): scope is DshRegistrationOwnerScope & {
  readonly ownerId: string;
} {
  return !scope.boundaryPending && typeof scope.ownerId === 'string' && scope.ownerId.length > 0;
}

function isSameOwner(
  expected: DshRegistrationOwnerScope & { readonly ownerId: string },
  actual: DshRegistrationOwnerScope,
): boolean {
  return isStableOwner(actual) && actual.ownerId === expected.ownerId && actual.scopeKey === expected.scopeKey;
}

/** Compare in Main only; neither route nor key identity is ever projected. */
function isSameConfiguration(
  expected: Extract<DshProviderConfigurationResult, { status: 'ready' }>,
  current: DshProviderConfigurationResult,
  launchedSecret: Readonly<{ name: string; value: string }> | null,
): boolean {
  if (current.status !== 'ready' || !launchedSecret) return false;
  if (
    current.provider.id !== expected.provider.id ||
    current.route.baseUrl !== expected.route.baseUrl ||
    current.route.origin !== expected.route.origin
  ) {
    return false;
  }
  try {
    const currentSecrets = current.loadSecrets();
    return (
      currentSecrets.length === 1 &&
      currentSecrets[0]?.name === launchedSecret.name &&
      currentSecrets[0]?.value === launchedSecret.value
    );
  } catch {
    return false;
  }
}

async function closeDiscardedBridge(bridge: DshStartedBridge, reason: string): Promise<void> {
  try {
    await bridge.close(reason);
  } catch {
    // The caller deliberately reports only a generic unavailable state. Raw
    // native errors may include provider implementation details.
  }
}

/**
 * Admit one DSH agent for the current Desktop owner, if and only if its bridge
 * starts against a still-current provider configuration. This function is
 * serialised by its owner (the maker host); callers must not invoke it in
 * parallel for the same Maker instance.
 */
export async function registerDshAgentForCurrentOwner<
  TAgent extends DshRegisteredAgent,
  TBridge extends DshStartedBridge,
>(
  deps: DshAgentRegistrationDeps<TAgent, TBridge>,
): Promise<DshAgentRegistrationResult> {
  if (deps.isAlreadyRegistered()) return { status: 'already-registered' };

  const owner = deps.readOwnerScope();
  if (!isStableOwner(owner)) return { status: 'owner-unavailable' };

  const providers = await deps.listProviders();
  if (!isSameOwner(owner, deps.readOwnerScope())) return { status: 'owner-changed' };

  const configuration = resolveDshProviderConfiguration(providers, deps.readProviderKey);
  if (configuration.status !== 'ready') {
    return { status: 'configuration-unavailable', reason: configuration.reason };
  }

  // A task-scoped bridge deliberately does not start its supervised child at
  // agent-registration time.  Capture the exact current secret here instead:
  // otherwise the old "bridge startup must read the key" invariant would mark
  // every lazy task factory as stale before it can be registered.  The sealed
  // loader is Main-only and lets every later task prove that its configuration
  // still equals this registration generation before launch or prompt.
  let launchedSecret: Readonly<DshChildSecret>;
  try {
    const secrets = configuration.loadSecrets();
    if (secrets.length !== 1 || !secrets[0]) {
      return { status: 'configuration-unavailable', reason: 'missing-api-key' };
    }
    launchedSecret = Object.freeze({ name: secrets[0].name, value: secrets[0].value });
  } catch {
    return { status: 'configuration-unavailable', reason: 'missing-api-key' };
  }
  const launchConfiguration = Object.freeze({
    ...configuration,
    loadSecrets: () => Object.freeze([launchedSecret] as const),
  });

  let bridge: TBridge;
  try {
    bridge = await deps.startBridge({ ownerId: owner.ownerId, configuration: launchConfiguration });
  } catch {
    return { status: 'bridge-start-failed' };
  }

  if (!isSameOwner(owner, deps.readOwnerScope())) {
    await closeDiscardedBridge(bridge, 'DSH owner changed during bridge startup');
    return { status: 'owner-changed' };
  }

  let currentConfiguration: DshProviderConfigurationResult;
  try {
    currentConfiguration = resolveDshProviderConfiguration(
      await deps.listProviders(),
      deps.readProviderKey,
    );
  } catch {
    await closeDiscardedBridge(bridge, 'DSH provider configuration could not be revalidated');
    return { status: 'configuration-changed-during-start' };
  }
  if (!isSameConfiguration(configuration, currentConfiguration, launchedSecret)) {
    await closeDiscardedBridge(bridge, 'DSH provider configuration changed during bridge startup');
    return { status: 'configuration-changed-during-start' };
  }
  if (!isSameOwner(owner, deps.readOwnerScope())) {
    await closeDiscardedBridge(bridge, 'DSH owner changed before registration');
    return { status: 'owner-changed' };
  }

  const agent = deps.createAgent(bridge);
  if (!deps.registerAgent(agent)) {
    try {
      await agent.dispose();
    } catch {
      // A raced Maker shutdown has already refused the agent. Its disposer is
      // still the only owner allowed to close the supervised bridge.
    }
    return { status: 'registration-rejected' };
  }
  return { status: 'registered' };
}
