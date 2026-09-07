import { describe, expect, it, vi } from 'vitest';

import type { CustomProviderConfig } from '@cindy/model-providers';

import {
  registerDshAgentForCurrentOwner,
  type DshAgentRegistrationDeps,
  type DshRegistrationOwnerScope,
} from '../agent-registration.js';

const provider: CustomProviderConfig = {
  id: 'dsh-adapter',
  name: 'DSH Adapter',
  runtimes: { dsh: { baseUrl: 'https://adapter.example.test/v1', models: [] } },
};

function stableOwner(): DshRegistrationOwnerScope {
  return { ownerId: 'owner-a', scopeKey: 'local:owner-a:1', boundaryPending: false };
}

function createDeps(input: {
  readonly owner?: { current: DshRegistrationOwnerScope };
  readonly key?: { current: string | null };
  readonly providers?: readonly CustomProviderConfig[];
  readonly registerResult?: boolean;
  readonly onBridgeStart?: () => void;
} = {}): {
  deps: DshAgentRegistrationDeps<{ dispose(): Promise<void> }>;
  bridgeClose: ReturnType<typeof vi.fn>;
  startBridge: ReturnType<typeof vi.fn>;
  registerAgent: ReturnType<typeof vi.fn>;
  agentDispose: ReturnType<typeof vi.fn>;
} {
  const owner = input.owner ?? { current: stableOwner() };
  const key = input.key ?? { current: 'dsh-key-a' };
  const bridgeClose = vi.fn(async (_reason: string) => undefined);
  const agentDispose = vi.fn(async () => bridgeClose('DSH agent discarded'));
  const startBridge = vi.fn(async (start: Parameters<DshAgentRegistrationDeps<{ dispose(): Promise<void> }>['startBridge']>[0]) => {
    // The production bridge reads the wrapped loader while composing the
    // supervised child environment. A fake that does not do this is not a
    // valid registration test double.
    start.configuration.loadSecrets();
    input.onBridgeStart?.();
    return { close: bridgeClose };
  });
  const registerAgent = vi.fn(() => input.registerResult ?? true);
  return {
    deps: {
      readOwnerScope: () => owner.current,
      listProviders: async () => input.providers ?? [provider],
      readProviderKey: () => key.current,
      isAlreadyRegistered: () => false,
      startBridge,
      createAgent: () => ({ dispose: agentDispose }),
      registerAgent,
    },
    bridgeClose,
    startBridge,
    registerAgent,
    agentDispose,
  };
}

describe('registerDshAgentForCurrentOwner', () => {
  it('registers only after the owner, route, and launch-time key are revalidated', async () => {
    const { deps, startBridge, registerAgent, bridgeClose } = createDeps();

    await expect(registerDshAgentForCurrentOwner(deps)).resolves.toEqual({ status: 'registered' });
    expect(startBridge).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'owner-a',
      configuration: expect.objectContaining({
        provider: { id: 'dsh-adapter', name: 'DSH Adapter' },
        route: expect.objectContaining({ baseUrl: 'https://adapter.example.test/v1' }),
      }),
    }));
    expect(registerAgent).toHaveBeenCalledTimes(1);
    expect(bridgeClose).not.toHaveBeenCalled();
  });

  it('closes a just-started bridge when the account boundary changes', async () => {
    const owner = { current: stableOwner() };
    const { deps, bridgeClose, registerAgent } = createDeps({
      owner,
      onBridgeStart: () => {
        owner.current = { ownerId: 'owner-b', scopeKey: 'local:owner-b:2', boundaryPending: false };
      },
    });

    await expect(registerDshAgentForCurrentOwner(deps)).resolves.toEqual({ status: 'owner-changed' });
    expect(bridgeClose).toHaveBeenCalledWith('DSH owner changed during bridge startup');
    expect(registerAgent).not.toHaveBeenCalled();
  });

  it('closes a bridge when its launch-time API key changes before registration', async () => {
    const key = { current: 'dsh-key-a' as string | null };
    const { deps, bridgeClose, registerAgent } = createDeps({
      key,
      onBridgeStart: () => {
        key.current = 'dsh-key-b';
      },
    });

    await expect(registerDshAgentForCurrentOwner(deps)).resolves.toEqual({
      status: 'configuration-changed-during-start',
    });
    expect(bridgeClose).toHaveBeenCalledWith('DSH provider configuration changed during bridge startup');
    expect(registerAgent).not.toHaveBeenCalled();
  });

  it('disposes the constructed agent when Maker rejects a registration race', async () => {
    const { deps, bridgeClose, agentDispose } = createDeps({ registerResult: false });

    await expect(registerDshAgentForCurrentOwner(deps)).resolves.toEqual({ status: 'registration-rejected' });
    expect(agentDispose).toHaveBeenCalledTimes(1);
    expect(bridgeClose).toHaveBeenCalledWith('DSH agent discarded');
  });

  it('does not start a runtime when there is no configured DSH provider', async () => {
    const { deps, startBridge } = createDeps({ providers: [] });

    await expect(registerDshAgentForCurrentOwner(deps)).resolves.toEqual({
      status: 'configuration-unavailable',
      reason: 'not-configured',
    });
    expect(startBridge).not.toHaveBeenCalled();
  });
});
