/**
 * Lifecycle owner for a single Main-owned DSH host scope.
 *
 * It has no default spawn implementation: production wiring must inject a
 * macOS containment-proven launcher before it can create a transport. This
 * keeps F2's scope, Home, credential and teardown contracts testable without
 * treating the F0 process-group evidence as product containment.
 */

import type { DshAcpInitializeResult, DshAcpSessionClient } from '@cindy/maker-core';

import {
  buildDshChildEnvironment,
  cleanupDshHostScopePaths,
  createDshHostScopeId,
  createDshHostScopePaths,
  type DshChildSecret,
  type DshHostScopeInput,
  type DshHostScopePaths,
} from './scope.js';
import type { VerifiedDshRuntime } from './local-runtime.js';

export interface DshHostCapabilitySnapshot {
  readonly scopeId: string;
  readonly releaseId: string;
  readonly expectedVersion: string;
  readonly protocolVersion: number;
  readonly agentName: string;
  readonly agentVersion: string;
  readonly sessionCapabilities: Readonly<Record<string, boolean>>;
}

export interface DshHostLaunch {
  readonly scopeId: string;
  readonly runtime: VerifiedDshRuntime;
  readonly paths: DshHostScopePaths;
  /** Memory-only allowlisted values. Do not persist, return, or log this object. */
  readonly env: NodeJS.ProcessEnv;
}

export interface DshHostManagerDependencies {
  resolveRuntime(): VerifiedDshRuntime;
  createScopePaths(input: DshHostScopeInput): DshHostScopePaths;
  buildChildEnvironment(input: { paths: DshHostScopePaths; secrets?: readonly DshChildSecret[] }): NodeJS.ProcessEnv;
  /** Must create a launch-time containment-proven Main-owned ACP client. */
  createContainedClient(launch: DshHostLaunch): DshAcpSessionClient;
  loadSecrets(input: DshHostScopeInput): readonly DshChildSecret[];
  cleanupPaths(paths: DshHostScopePaths): void;
}

interface LiveDshHost {
  input: DshHostScopeInput;
  accountScopeId: string;
  client: DshAcpSessionClient;
  paths: DshHostScopePaths;
  snapshot: DshHostCapabilitySnapshot;
}

function snapshotFromInitialize(input: {
  scopeId: string;
  runtime: VerifiedDshRuntime;
  initialize: DshAcpInitializeResult;
}): DshHostCapabilitySnapshot {
  const capabilities = input.initialize.agentCapabilities?.sessionCapabilities;
  if (!capabilities || typeof capabilities !== 'object') {
    throw new Error('DSH host initialize response omitted session capabilities');
  }
  const declaredCapabilities = capabilities as Readonly<Record<string, unknown>>;
  const supportedCapabilityNames = new Set(['close', 'list', 'resume']);
  for (const capability of Object.keys(capabilities)) {
    if (!supportedCapabilityNames.has(capability)) {
      throw new Error(`DSH host initialize response advertised an unsupported session capability: ${capability}`);
    }
  }
  const sessionCapabilities = Object.freeze(Object.fromEntries(
    [...supportedCapabilityNames]
      .filter((capability) => declaredCapabilities[capability] !== undefined)
      .map((capability) => [capability, true]),
  ));
  return Object.freeze({
    scopeId: input.scopeId,
    releaseId: input.runtime.releaseId,
    expectedVersion: input.runtime.expectedVersion,
    protocolVersion: input.initialize.protocolVersion,
    agentName: input.initialize.agentInfo.name,
    agentVersion: input.initialize.agentInfo.version,
    sessionCapabilities,
  });
}

/** Main-owned lazy scope registry. Failed starts remove only their own temporary launcher. */
export class DshHostManager {
  private readonly live = new Map<string, LiveDshHost>();
  private readonly starting = new Map<string, Promise<DshHostCapabilitySnapshot>>();

  constructor(private readonly deps: DshHostManagerDependencies) {}

  async start(input: DshHostScopeInput): Promise<DshHostCapabilitySnapshot> {
    if (input.homeMode === 'existing-dsh-home') {
      // An existing Home may contain executable profile/extension state. F2
      // can retain its non-secret override shape but must not run it until F7
      // has delivered the explicit native-extension safety and recovery UX.
      throw new Error('DSH existing home is unavailable until the F7 native-extension gate is complete');
    }
    const identity = createDshHostScopeId(input);
    const existing = this.live.get(identity.scopeId);
    if (existing) return existing.snapshot;
    const inFlight = this.starting.get(identity.scopeId);
    if (inFlight) return inFlight;
    const start = this.startFresh(input, identity.accountScopeId);
    this.starting.set(identity.scopeId, start);
    try {
      return await start;
    } finally {
      this.starting.delete(identity.scopeId);
    }
  }

  private async startFresh(input: DshHostScopeInput, accountScopeId: string): Promise<DshHostCapabilitySnapshot> {
    let paths: DshHostScopePaths | null = null;
    let client: DshAcpSessionClient | null = null;
    try {
      // resolveRuntime() is the pre-spawn full tree recheck, not a cached marker lookup.
      const runtime = this.deps.resolveRuntime();
      paths = this.deps.createScopePaths(input);
      const expectedIdentity = createDshHostScopeId(input);
      if (paths.scopeId !== expectedIdentity.scopeId || paths.accountScopeId !== accountScopeId) {
        throw new Error('DSH host scope path resolver returned an identity-mismatched scope');
      }
      const env = this.deps.buildChildEnvironment({ paths, secrets: this.deps.loadSecrets(input) });
      client = this.deps.createContainedClient({ scopeId: paths.scopeId, runtime, paths, env });
      const initialize = await client.initialize();
      const snapshot = snapshotFromInitialize({ scopeId: paths.scopeId, runtime, initialize });
      this.live.set(paths.scopeId, { input, accountScopeId, client, paths, snapshot });
      return snapshot;
    } catch (error) {
      try {
        await client?.close('DSH host startup failed');
      } finally {
        if (paths) this.deps.cleanupPaths(paths);
      }
      throw error;
    }
  }

  getSnapshot(input: DshHostScopeInput): DshHostCapabilitySnapshot | null {
    return this.live.get(createDshHostScopeId(input).scopeId)?.snapshot ?? null;
  }

  async stop(input: DshHostScopeInput, reason = 'DSH host scope stopped'): Promise<void> {
    const scopeId = createDshHostScopeId(input).scopeId;
    const host = this.live.get(scopeId);
    if (!host) return;
    this.live.delete(scopeId);
    try {
      await host.client.close(reason);
    } finally {
      this.deps.cleanupPaths(host.paths);
    }
  }

  async stopAccount(accountId: string, reason = 'DSH account scope stopped'): Promise<void> {
    const accountScopeId = createDshHostScopeId({
      accountId,
      releaseId: 'account-scope-probe',
      homeMode: 'cindy-managed',
    }).accountScopeId;
    const hosts = [...this.live.values()].filter((host) => host.accountScopeId === accountScopeId);
    await Promise.all(hosts.map((host) => this.stop(host.input, reason)));
  }

  async shutdown(reason = 'DSH host manager shutdown'): Promise<void> {
    await Promise.all([...this.live.values()].map((host) => this.stop(host.input, reason)));
  }
}

/** Standard Desktop Main composition; tests can inject paths without Electron. */
export function createDshHostManager(input: Omit<DshHostManagerDependencies, 'createScopePaths' | 'buildChildEnvironment' | 'cleanupPaths'> & {
  userDataPath: string;
  tempPath: string;
}): DshHostManager {
  return new DshHostManager({
    ...input,
    createScopePaths: (scope) => createDshHostScopePaths({ ...scope, userDataPath: input.userDataPath, tempPath: input.tempPath }),
    buildChildEnvironment: buildDshChildEnvironment,
    cleanupPaths: cleanupDshHostScopePaths,
  });
}
