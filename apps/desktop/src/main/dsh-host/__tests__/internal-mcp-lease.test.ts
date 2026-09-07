import { describe, expect, it, vi } from 'vitest';

import {
  createDshInternalMcpLeaseFactory,
  type DshInternalMcpEndpoint,
} from '../internal-mcp-lease.js';

const leaseInput = Object.freeze({
  scopeId: 'scope-a',
  cindySessionId: 'cindy-session-a',
  sessionInstanceId: 'instance-a',
});

function loopbackEndpoint(overrides: Partial<{
  name: string;
  url: string;
  close: () => Promise<void>;
}> = {}) {
  const close = overrides.close ?? vi.fn(async () => undefined);
  const register = vi.fn(async (_input: Parameters<DshInternalMcpEndpoint['register']>[0]) => ({
    url: overrides.url ?? 'http://127.0.0.1:43123/dsh-mcp/instance-a',
    close,
  }));
  return {
    definition: {
      name: overrides.name ?? 'cindy_dsh',
      policy: { kind: 'loopback-http' as const, pathnamePrefix: '/dsh-mcp' },
      register,
    } satisfies DshInternalMcpEndpoint,
    register,
    close,
  };
}

describe('DSH internal MCP lease factory', () => {
  it('registers Main-owned loopback endpoints before exposing one session-scoped ACP declaration', async () => {
    const endpoint = loopbackEndpoint();
    const factory = createDshInternalMcpLeaseFactory([endpoint.definition]);

    const lease = await factory.acquire(leaseInput);

    expect(endpoint.register).toHaveBeenCalledOnce();
    const registration = endpoint.register.mock.calls[0]![0]!;
    expect(registration).toMatchObject({
      scopeId: 'scope-a',
      cindySessionId: 'cindy-session-a',
      sessionInstanceId: 'instance-a',
      generation: 1,
    });
    expect(registration.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(lease.mcpServers).toEqual([
      {
        name: 'cindy_dsh',
        type: 'http',
        url: 'http://127.0.0.1:43123/dsh-mcp/instance-a',
        headers: [{ name: 'authorization', value: `Bearer ${registration.token}` }],
      },
    ]);
    expect(JSON.stringify({ scopeId: registration.scopeId, sessionInstanceId: registration.sessionInstanceId }))
      .not.toContain(registration.token);

    await lease.release();
    await lease.release();
    expect(endpoint.close).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale release revoke a newer lease with the same session identity', async () => {
    const endpoint = loopbackEndpoint();
    const factory = createDshInternalMcpLeaseFactory([endpoint.definition]);
    const first = await factory.acquire(leaseInput);
    await first.release();
    const second = await factory.acquire(leaseInput);

    await first.release();
    expect(endpoint.close).toHaveBeenCalledTimes(1);
    await second.release();
    expect(endpoint.close).toHaveBeenCalledTimes(2);
  });

  it.each([
    'http://localhost:43123/dsh-mcp/instance-a',
    'http://127.0.0.1/dsh-mcp/instance-a',
    'http://127.0.0.1:43123/not-dsh-mcp/instance-a',
    'http://127.0.0.1:43123/dsh-mcp/instance-a?session=forbidden',
    'http://user:pass@127.0.0.1:43123/dsh-mcp/instance-a',
    'https://127.0.0.1:43123/dsh-mcp/instance-a',
  ])('rejects a registered endpoint outside the narrow loopback policy: %s', async (url) => {
    const endpoint = loopbackEndpoint({ url });
    const factory = createDshInternalMcpLeaseFactory([endpoint.definition]);

    await expect(factory.acquire(leaseInput)).rejects.toThrow(/DSH internal MCP endpoint/);
    expect(endpoint.close).toHaveBeenCalledOnce();
  });

  it('requires an exact static HTTPS origin when Main registers a non-loopback endpoint', async () => {
    const close = vi.fn(async () => undefined);
    const factory = createDshInternalMcpLeaseFactory([{
      name: 'cindy_https',
      policy: { kind: 'https', origin: 'https://mcp.cindy.test:9443', pathnamePrefix: '/dsh' },
      register: async () => ({ url: 'https://other.cindy.test:9443/dsh/instance-a', close }),
    }]);

    await expect(factory.acquire(leaseInput)).rejects.toThrow('outside its HTTPS allowlist');
    expect(close).toHaveBeenCalledOnce();
  });

  it('unwinds already-registered endpoints when a later Main registration fails', async () => {
    const first = loopbackEndpoint();
    const secondClose = vi.fn(async () => undefined);
    const factory = createDshInternalMcpLeaseFactory([
      first.definition,
      {
        name: 'second',
        policy: { kind: 'loopback-http', pathnamePrefix: '/second' },
        register: async () => ({ url: 'http://127.0.0.1:43124/not-second', close: secondClose }),
      },
    ]);

    await expect(factory.acquire(leaseInput)).rejects.toThrow('DSH internal MCP endpoint URL is invalid');
    expect(secondClose).toHaveBeenCalledOnce();
    expect(first.close).toHaveBeenCalledOnce();
  });

  it('revokes every active lease before bridge/account cleanup and makes further stale releases inert', async () => {
    const endpoint = loopbackEndpoint();
    const factory = createDshInternalMcpLeaseFactory([endpoint.definition]);
    const first = await factory.acquire(leaseInput);
    const second = await factory.acquire({ ...leaseInput, sessionInstanceId: 'instance-b' });

    await factory.revokeAll();
    expect(endpoint.close).toHaveBeenCalledTimes(2);
    await first.release();
    await second.release();
    expect(endpoint.close).toHaveBeenCalledTimes(2);
  });
});
