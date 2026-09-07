/**
 * Main-only session leases for Cindy-owned DSH Streamable HTTP MCP servers.
 *
 * This is deliberately below every IPC and renderer surface.  A caller can
 * register only a static Main factory; it cannot supply a URL, header, token,
 * command, or account identity.  Each acquired lease creates a fresh
 * in-memory bearer token and exposes it solely in the ACP declaration passed
 * directly to the supervised DSH child.
 */

import { randomBytes } from 'node:crypto';

const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_ID_LENGTH = 256;

export interface DshAcpHttpMcpServer {
  readonly name: string;
  readonly type: 'http';
  readonly url: string;
  readonly headers: readonly Readonly<{ name: string; value: string }>[];
}

export type DshInternalMcpEndpointPolicy =
  | Readonly<{
      kind: 'loopback-http';
      /** The endpoint owns this complete path segment prefix. */
      pathnamePrefix: string;
    }>
  | Readonly<{
      kind: 'https';
      /** A static Main-owned origin, including a non-default port when used. */
      origin: string;
      /** The endpoint owns this complete path segment prefix. */
      pathnamePrefix: string;
    }>;

export interface DshInternalMcpEndpointRegistration {
  /** Main must return a fresh endpoint it controls for this lease only. */
  readonly url: string;
  /** Stops the endpoint and invalidates its token. It must be idempotent. */
  close(): Promise<void> | void;
}

export interface DshInternalMcpEndpoint {
  /** Kept strict so DSH does not apply a surprising upstream name rewrite. */
  readonly name: string;
  readonly policy: DshInternalMcpEndpointPolicy;
  /**
   * This callback is Main-owned. The token never enters persistence, logs,
   * diagnostics, ordinary IPC, or a renderer payload.
   */
  register(input: Readonly<{
    scopeId: string;
    cindySessionId: string;
    sessionInstanceId: string;
    generation: number;
    token: string;
  }>): Promise<DshInternalMcpEndpointRegistration> | DshInternalMcpEndpointRegistration;
}

export interface DshInternalMcpLease {
  /** Only for the immediately following ACP session/new or session/resume request. */
  readonly mcpServers: readonly DshAcpHttpMcpServer[];
  /** Idempotent and generation-safe; a stale lease cannot revoke a later one. */
  release(): Promise<void>;
}

export interface DshInternalMcpLeaseFactory {
  acquire(input: Readonly<{
    scopeId: string;
    cindySessionId: string;
    sessionInstanceId: string;
  }>): Promise<DshInternalMcpLease>;
  /** Account/bridge teardown calls this before it cleans up any outer state. */
  revokeAll(): Promise<void>;
}

interface LeaseRecord {
  readonly key: string;
  readonly generation: number;
  readonly registrations: readonly DshInternalMcpEndpointRegistration[];
  released: boolean;
  release: () => Promise<void>;
}

function assertOpaqueId(value: string, label: string): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_ID_LENGTH ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`DSH internal MCP ${label} is invalid`);
  }
}

function assertPathPrefix(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    value === '/' ||
    !value.startsWith('/') ||
    value.includes('..') ||
    /[\u0000-\u001f\u007f?#]/.test(value)
  ) {
    throw new Error('DSH internal MCP endpoint path policy is invalid');
  }
  return value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value;
}

function assertEndpointDefinition(endpoint: DshInternalMcpEndpoint): void {
  if (!endpoint || typeof endpoint !== 'object' || !SERVER_NAME_RE.test(endpoint.name)) {
    throw new Error('DSH internal MCP endpoint name is invalid');
  }
  if (typeof endpoint.register !== 'function') {
    throw new Error('DSH internal MCP endpoint registration is invalid');
  }
  const policy = endpoint.policy;
  if (!policy || typeof policy !== 'object') {
    throw new Error('DSH internal MCP endpoint policy is invalid');
  }
  assertPathPrefix(policy.pathnamePrefix);
  if (policy.kind === 'loopback-http') return;
  if (policy.kind !== 'https' || typeof policy.origin !== 'string') {
    throw new Error('DSH internal MCP endpoint policy is invalid');
  }
  let origin: URL;
  try {
    origin = new URL(policy.origin);
  } catch {
    throw new Error('DSH internal MCP HTTPS origin is invalid');
  }
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    origin.origin !== policy.origin
  ) {
    throw new Error('DSH internal MCP HTTPS origin is invalid');
  }
}

function pathIsWithinPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function assertRegisteredEndpoint(
  endpoint: DshInternalMcpEndpoint,
  registration: DshInternalMcpEndpointRegistration,
): string {
  if (!registration || typeof registration !== 'object' || typeof registration.url !== 'string' ||
      typeof registration.close !== 'function') {
    throw new Error('DSH internal MCP endpoint registration is invalid');
  }
  let url: URL;
  try {
    url = new URL(registration.url);
  } catch {
    throw new Error('DSH internal MCP endpoint URL is invalid');
  }
  const prefix = assertPathPrefix(endpoint.policy.pathnamePrefix);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !pathIsWithinPrefix(url.pathname, prefix)
  ) {
    throw new Error('DSH internal MCP endpoint URL is invalid');
  }
  if (endpoint.policy.kind === 'loopback-http') {
    if (
      url.protocol !== 'http:' ||
      (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') ||
      !url.port ||
      !Number.isSafeInteger(Number(url.port)) ||
      Number(url.port) < 1 ||
      Number(url.port) > 65535
    ) {
      throw new Error('DSH internal MCP endpoint must be an exact loopback HTTP URL');
    }
  } else if (url.protocol !== 'https:' || url.origin !== endpoint.policy.origin) {
    throw new Error('DSH internal MCP endpoint is outside its HTTPS allowlist');
  }
  return url.toString();
}

async function closeRegistrations(
  registrations: readonly DshInternalMcpEndpointRegistration[],
): Promise<void> {
  const results = await Promise.allSettled(
    [...registrations].reverse().map(async (registration) => registration.close()),
  );
  if (results.some((result) => result.status === 'rejected')) {
    throw new Error('DSH internal MCP lease teardown failed');
  }
}

/**
 * Creates one scope-local factory. A bridge owns this object and calls
 * `revokeAll()` on carrier EOF, account switch, and shutdown. It has no
 * Electron, persistence, configuration, or IPC dependency.
 */
export function createDshInternalMcpLeaseFactory(
  endpoints: readonly DshInternalMcpEndpoint[],
): DshInternalMcpLeaseFactory {
  const names = new Set<string>();
  for (const endpoint of endpoints) {
    assertEndpointDefinition(endpoint);
    if (names.has(endpoint.name)) throw new Error('DSH internal MCP endpoint names must be unique');
    names.add(endpoint.name);
  }

  const active = new Map<string, LeaseRecord>();
  let nextGeneration = 0;

  const releaseRecord = async (record: LeaseRecord): Promise<void> => {
    if (record.released) return;
    record.released = true;
    if (active.get(record.key) === record) active.delete(record.key);
    await closeRegistrations(record.registrations);
  };

  return Object.freeze({
    async acquire(input: Readonly<{
      scopeId: string;
      cindySessionId: string;
      sessionInstanceId: string;
    }>): Promise<DshInternalMcpLease> {
      assertOpaqueId(input.scopeId, 'scope id');
      assertOpaqueId(input.cindySessionId, 'Cindy session id');
      assertOpaqueId(input.sessionInstanceId, 'session instance id');
      const key = `${input.cindySessionId}\u0000${input.sessionInstanceId}`;
      if (active.has(key)) throw new Error('DSH internal MCP lease is already active for this session instance');

      // Reserve the identity before the first async endpoint registration so
      // two concurrent start attempts cannot mount the same session route.
      const generation = ++nextGeneration;
      const registrations: DshInternalMcpEndpointRegistration[] = [];
      const placeholder = {} as LeaseRecord;
      active.set(key, placeholder);
      try {
        const mcpServers: DshAcpHttpMcpServer[] = [];
        for (const endpoint of endpoints) {
          const token = randomBytes(32).toString('base64url');
          const registration = await endpoint.register({ ...input, generation, token });
          registrations.push(registration);
          const url = assertRegisteredEndpoint(endpoint, registration);
          mcpServers.push(Object.freeze({
            name: endpoint.name,
            type: 'http',
            url,
            headers: Object.freeze([Object.freeze({ name: 'authorization', value: `Bearer ${token}` })]),
          }));
        }
        let record!: LeaseRecord;
        const release = async (): Promise<void> => releaseRecord(record);
        record = {
          key,
          generation,
          registrations: Object.freeze(registrations),
          released: false,
          release,
        };
        // A revoke can run while a factory is awaiting registration. It removes
        // the reservation, so do not resurrect a lease after that boundary.
        if (active.get(key) !== placeholder) {
          await closeRegistrations(registrations);
          throw new Error('DSH internal MCP lease was revoked during registration');
        }
        active.set(key, record);
        return Object.freeze({ mcpServers: Object.freeze(mcpServers), release });
      } catch (error) {
        if (active.get(key) === placeholder) active.delete(key);
        await closeRegistrations(registrations).catch(() => undefined);
        throw error;
      }
    },

    async revokeAll(): Promise<void> {
      const records = [...active.values()];
      active.clear();
      // A reserved in-flight registration has no close callback yet. Its
      // acquire continuation observes the missing reservation and tears down
      // every callback it did receive before returning an error.
      const settled = await Promise.allSettled(
        records.filter((record) => record.registrations !== undefined).map((record) => releaseRecord(record)),
      );
      if (settled.some((result) => result.status === 'rejected')) {
        throw new Error('DSH internal MCP lease teardown failed');
      }
    },
  });
}
