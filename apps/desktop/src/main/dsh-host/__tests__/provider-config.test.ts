import { describe, expect, it, vi } from 'vitest';

import type { CustomProviderConfig } from '@cindy/model-providers';

import {
  projectDshProviderAvailability,
  resolveDshProviderConfiguration,
} from '../provider-config.js';

const configuredDshProvider: CustomProviderConfig = {
  id: 'dsh-adapter',
  name: 'My DSH Adapter',
  runtimes: {
    dsh: { baseUrl: 'https://adapter.example.test/v1/', models: [] },
  },
};

describe('resolveDshProviderConfiguration', () => {
  it('admits one configured HTTPS provider and keeps the key out of the result projection', () => {
    const readKey = vi.fn(() => 'dsh-test-key-not-a-secret');
    const result = resolveDshProviderConfiguration([configuredDshProvider], readKey);

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('expected ready DSH configuration');
    expect(result.route).toMatchObject({
      kind: 'approved-external-https',
      baseUrl: 'https://adapter.example.test/v1',
      origin: 'https://adapter.example.test',
    });
    expect(projectDshProviderAvailability(result)).toEqual({
      available: true,
      providerName: 'My DSH Adapter',
    });
    expect(JSON.stringify(result)).not.toContain('dsh-test-key-not-a-secret');
    expect(result.loadSecrets()).toEqual([
      { name: 'CINDY_DSH_PROVIDER_API_KEY', value: 'dsh-test-key-not-a-secret' },
    ]);
    expect(readKey).toHaveBeenLastCalledWith('dsh-adapter', 'dsh');
  });

  it('upgrades only the legacy official DeepSeek root to the alpha.2 Messages endpoint', () => {
    const result = resolveDshProviderConfiguration(
      [
        {
          ...configuredDshProvider,
          runtimes: { dsh: { baseUrl: 'https://api.deepseek.com', models: [] } },
        },
      ],
      () => 'dsh-test-key-not-a-secret',
    );

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('expected ready DSH configuration');
    expect(result.route.baseUrl).toBe('https://api.deepseek.com/anthropic');
  });

  const unavailableCases: Array<[string, CustomProviderConfig[], string]> = [
    ['not-configured', [], 'not-configured'],
    [
      'multiple-configured',
      [configuredDshProvider, { ...configuredDshProvider, id: 'second' }],
      'multiple-configured',
    ],
    [
      'auth-not-api-key',
      [{ ...configuredDshProvider, auth: { method: 'none' as const } }],
      'auth-not-api-key',
    ],
    [
      'invalid-runtime-shape',
      [
        {
          ...configuredDshProvider,
          runtimes: {
            dsh: {
              baseUrl: 'https://adapter.example.test/v1',
              models: [{ id: 'not-allowed', name: 'Not allowed' }],
            },
          },
        },
      ],
      'invalid-runtime-shape',
    ],
    [
      'invalid-route',
      [
        {
          ...configuredDshProvider,
          runtimes: { dsh: { baseUrl: 'http://adapter.example.test/v1', models: [] } },
        },
      ],
      'invalid-route',
    ],
  ];
  it.each(unavailableCases)('fails closed for %s', (_name, providers, expectedReason) => {
    const result = resolveDshProviderConfiguration(providers, () => 'dsh-test-key-not-a-secret');
    expect(result).toEqual({ status: 'unavailable', reason: expectedReason });
  });

  it('does not advertise a provider without an independently stored DSH key', () => {
    const result = resolveDshProviderConfiguration([configuredDshProvider], () => null);
    expect(result).toEqual({ status: 'unavailable', reason: 'missing-api-key' });
    expect(projectDshProviderAvailability(result)).toEqual({
      available: false,
      reason: 'missing-api-key',
    });
  });

  it('fails launch if the key disappears after the availability check', () => {
    const readKey = vi
      .fn()
      .mockReturnValueOnce('dsh-test-key-not-a-secret')
      .mockReturnValueOnce(null);
    const result = resolveDshProviderConfiguration([configuredDshProvider], readKey);
    if (result.status !== 'ready') throw new Error('expected ready DSH configuration');
    expect(() => result.loadSecrets()).toThrow('DSH provider API key is unavailable at launch');
  });
});
