/**
 * Cindy-owned DSH control plane for one Main-owned scope.
 *
 * The runtime remains authoritative for its ACP session/history. This class is authoritative only
 * for the live bridge ownership relation and operation receipts. It deliberately has no renderer
 * inputs, filesystem access, credential access, or DSH private-state access.
 */

import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

import {
  DSH_BRIDGE_CONTRACT_VERSION,
  translateDshFollowEvent,
  type DshAcpSessionClient,
  type DshBridgeAgentReceipt,
  type DshBridgeAgentResumeReceipt,
  type DshBridgeAgentSessionReceipt,
  type DshBridgeAgentSessionRef,
  type DshBridgeCommittedFollowEvent,
  type DshBridgeCommittedFollowHandler,
  type DshBridgePermissionDecision,
  type DshBridgePermissionRequest,
  type DshBridgePermissionResolver,
  type DshBridgePort,
  type DshBridgePromptReceipt,
  type DshBridgePromptStopReason,
  type DshBridgeReceiptId,
} from '@cindy/maker-core';

import type {
  DshBindingHomeMode,
  DshSessionBinding,
  DshSessionBindingStore,
} from '../localDb/dshSessionBindings.js';
import type { DshPromptReceiptStore } from '../localDb/dshPromptReceipts.js';
import type { DshFollowProjectionCoordinator } from './dsh-follow-projection.js';
import type { DshSessionActivityCoordinator } from './dsh-session-activity.js';
import type {
  DshInternalMcpLease,
  DshInternalMcpLeaseFactory,
} from '../dsh-host/internal-mcp-lease.js';
import type {
  DshRuntimeConfigurationChoice,
  DshRuntimeConfigurationControl,
  DshRuntimeConfigurationSnapshot,
} from '../../shared/dshRuntimeConfiguration.js';

/** Native runtime binding. This type is Main-only and must not enter maker-core. */
export interface DshMainSessionRef {
  cindySessionId: string;
  runtimeSessionId: string;
  scopeId: string;
}

/**
 * The only two ACP configuration controls Cindy recognizes. Their values are
 * opaque runtime selections, held in Main memory and never sent to Renderer.
 */
export type DshMainConfigurationId = 'model' | 'reasoning_effort';

/**
 * Main-only, display-free configuration state for a live native session.
 * This deliberately excludes upstream labels/descriptions and raw option
 * objects; a later product projection must define its own reviewed schema.
 */
export interface DshMainConfigurationOption {
  id: DshMainConfigurationId;
  currentValue: string;
  allowedValues: readonly string[];
}

/** Raw ACP follow is Main-internal; product adapters use DshBridgePort.followCommitted only. */
interface DshMainFollowEvent {
  contractVersion: typeof DSH_BRIDGE_CONTRACT_VERSION;
  cindySessionId: string;
  scopeId: string;
  sequence: number;
  receivedAt: string;
  update: unknown;
}

interface DshMainReceipt {
  contractVersion: typeof DSH_BRIDGE_CONTRACT_VERSION;
  operation: 'resume';
  receiptId: DshBridgeReceiptId;
  acceptedAt: string;
}

type DshBridgeRawFollowHandler = (event: DshMainFollowEvent) => void;
type DshControlPlaneSessionRef = DshMainSessionRef | DshBridgeAgentSessionRef;

/**
 * Non-secret runtime identity pinned by Main before a create receipt may be
 * persisted. This never contains an endpoint, credential, profile, path, or
 * raw ACP event.
 */
export interface DshDurableRuntimeIdentity {
  runtimeReleaseId: string;
  runtimeVersion: string;
  controllerApiVersion: number;
  capabilityFingerprint: string;
  homeMode: DshBindingHomeMode;
}

export interface DshDurableBindingOptions {
  store: DshSessionBindingStore;
  runtimeIdentity: DshDurableRuntimeIdentity;
  /**
   * Optional until the complete F3 recovery service is wired by its owning
   * Main factory. When present, every prompt is ledgered before ACP send and
   * a pending/uncertain receipt is a no-replay boundary.
   */
  promptReceiptStore?: DshPromptReceiptStore;
}

/** Display-safe context for exactly one ACP `session/request_permission`. */
export interface DshPermissionRequest extends DshBridgePermissionRequest {
  cindySessionId: string;
}

/** DSH has only per-request allow-once and reject-once choices. */
export type DshPermissionDecision = DshBridgePermissionDecision;
export type DshPermissionResolver = (
  request: Readonly<DshPermissionRequest>,
) => Promise<DshPermissionDecision>;

/** Non-secret ACP facts admitted during this bridge's initialize handshake. */
export interface DshAcpCapabilitySnapshot {
  protocolVersion: 1;
  agentName: string;
  agentVersion: string;
  sessionCapabilities: Readonly<Record<'close' | 'list' | 'resume', true>>;
}

export interface DshControlPlaneOptions {
  scopeId: string;
  client: DshAcpSessionClient;
  /**
   * Main-owned workdir authorization. An absolute path alone is not a grant
   * to execute DSH there; the production bridge must inject the same policy
   * that authorized the Cindy task/workspace.
   */
  /**
   * Main verifies the exact Cindy session that reserved this cwd immediately
   * before the native `session/new` request. A pathname alone is not an
   * authorization capability because concurrent tasks can share a worktree.
   */
  assertAuthorizedCwd: (cwd: string, cindySessionId: string) => void;
  now?: () => Date;
  receiptId?: () => string;
  /**
   * Bound every operation that can have reached the runtime. A timeout is an
   * ambiguous native outcome, so this control plane closes its carrier and
   * requires a fresh, durable F3 bridge to reconcile rather than retrying.
   */
  operationTimeoutMs?: number;
  permissionTimeoutMs?: number;
  /**
   * F3/F4 Main-only event persistence. When configured, no raw follow update
   * is offered to observers until the coordinator has durably acknowledged a
   * translated or explicitly ignored projection record.
   */
  projectionCoordinator?: DshFollowProjectionCoordinator;
  /**
   * Main-only projection for the Cindy-owned session activity root. It is
   * deliberately optional while F6 ships incrementally; a configured
   * coordinator must fail closed rather than leave a lifecycle receipt with a
   * contradictory activity record.
   */
  sessionActivity?: DshSessionActivityCoordinator;
  /**
   * Optional Main-only F7 endpoint factory. When configured, create/resume
   * require the fresh Maker instance nonce and mount its lease before ACP.
   */
  internalMcpLeaseFactory?: DshInternalMcpLeaseFactory;
}

interface LiveBindingState {
  binding: DshMainSessionRef;
  /** Ephemeral capability passed only to the one adapter created for this binding. */
  adapterSessionKey: string;
  /** An ACP session may be closed yet remain resumable in the runtime history. */
  active: boolean;
  followHandlers: Set<DshBridgeRawFollowHandler>;
  /** Product adapters receive only durable, finite translated events. */
  committedFollowHandlers: Set<DshBridgeCommittedFollowHandler>;
  /** Raw native ids stay Main-only and are consumed by one permission request. */
  pendingPermissionTools: Map<string, DshPermissionRequest>;
  /** Bound only by the Main-issued adapter capability; revoked on teardown. */
  permissionResolver?: DshPermissionResolver;
  /** Main-generated prompt receipts that reached no terminal ACP acknowledgement yet. */
  pendingPromptReceiptIds: Set<string>;
  /** A native prompt must finish before a live option can affect a later turn. */
  promptInFlight: boolean;
  /** Sequence is owner-local so one DSH session cannot create another's gap. */
  nextFollowSequence: number;
  /** Serializes durable projection for this owner without delaying ACP notifications. */
  projectionTail: Promise<void>;
  /** Revision from the durable row; undefined for the deliberately F0-only bridge. */
  durableRevision?: number;
  /** Main-only capability material; never persisted or exposed through the bridge port. */
  mcpLease?: DshInternalMcpLease;
  /**
   * Per-session ACP configuration allowlist. Values are opaque to Cindy and
   * remain in Main memory; a resume replaces this complete snapshot.
   */
  configuration: ReadonlyMap<DshMainConfigurationId, DshMainConfigurationOption>;
  /** Validated upstream display names keyed by the still-Main-only ACP value. */
  configurationLabels: ReadonlyMap<DshMainConfigurationId, ReadonlyMap<string, string>>;
  /** Per-session, Main-issued opaque choice capabilities. Never persisted. */
  configurationTokens: Map<DshMainConfigurationId, Map<string, string>>;
  /** Prevent a second selection, prompt, cancel, or close racing an ACP selection acknowledgement. */
  configurationMutationInFlight: boolean;
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`DSH bridge ${label} is required`);
}

function hasAsciiControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return code !== undefined && (code <= 0x1f || code === 0x7f);
  });
}

function assertCapabilityIdentityText(value: string, label: string): string {
  if (
    value.length === 0 ||
    value.length > 256 ||
    value.trim() !== value ||
    hasAsciiControlCharacter(value)
  ) {
    throw new Error(`DSH ACP ${label} is invalid`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const DSH_MAIN_CONFIGURATION_IDS = new Set<DshMainConfigurationId>([
  'model',
  'reasoning_effort',
]);
const MAX_DSH_CONFIGURATION_OPTIONS = 2;
const MAX_DSH_CONFIGURATION_VALUES = 512;
const MAX_DSH_CONFIGURATION_VALUE_LENGTH = 16 * 1024;
const MAX_DSH_CONFIGURATION_LABEL_LENGTH = 256;

function isDshConfigurationValue(value: unknown, allowEmpty: boolean): value is string {
  return (
    typeof value === 'string' &&
    (allowEmpty || value.length > 0) &&
    value.length <= MAX_DSH_CONFIGURATION_VALUE_LENGTH &&
    !hasAsciiControlCharacter(value)
  );
}

function isDshConfigurationLabel(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_DSH_CONFIGURATION_LABEL_LENGTH &&
    value.trim() === value &&
    !hasAsciiControlCharacter(value)
  );
}

function isDshMainConfigurationId(value: unknown): value is DshMainConfigurationId {
  return typeof value === 'string' && DSH_MAIN_CONFIGURATION_IDS.has(value as DshMainConfigurationId);
}

/**
 * ACP select controls can be flat (reasoning) or one group deep (models).
 * Accept only that exact bounded shape and discard every other upstream
 * control. The saved selection must be one of the advertised values.
 */
interface ParsedDshMainConfiguration {
  readonly options: ReadonlyMap<DshMainConfigurationId, DshMainConfigurationOption>;
  readonly labels: ReadonlyMap<DshMainConfigurationId, ReadonlyMap<string, string>>;
}

function parseDshMainConfigurationOptions(value: unknown): ParsedDshMainConfiguration {
  if (!Array.isArray(value) || value.length > MAX_DSH_CONFIGURATION_OPTIONS + 32) {
    return { options: new Map(), labels: new Map() };
  }
  const parsed = new Map<DshMainConfigurationId, DshMainConfigurationOption>();
  const labels = new Map<DshMainConfigurationId, ReadonlyMap<string, string>>();
  const rejected = new Set<DshMainConfigurationId>();
  for (const entry of value) {
    if (!isRecord(entry) || !isDshMainConfigurationId(entry.id)) continue;
    const id = entry.id;
    if (rejected.has(id) || parsed.has(id) || entry.type !== 'select' || !Array.isArray(entry.options)) {
      parsed.delete(id);
      rejected.add(id);
      continue;
    }
    const allowEmpty = id === 'reasoning_effort';
    if (!isDshConfigurationValue(entry.currentValue, allowEmpty)) {
      rejected.add(id);
      continue;
    }
    const allowedValues: string[] = [];
    const labelsByValue = new Map<string, string>();
    const seen = new Set<string>();
    let malformed = false;
    for (const optionOrGroup of entry.options) {
      const candidates = isRecord(optionOrGroup) && Array.isArray(optionOrGroup.options)
        ? optionOrGroup.options
        : [optionOrGroup];
      for (const option of candidates) {
        if (
          !isRecord(option) ||
          !isDshConfigurationValue(option.value, allowEmpty) ||
          !isDshConfigurationLabel(option.name)
        ) {
          malformed = true;
          break;
        }
        if (!seen.has(option.value)) {
          seen.add(option.value);
          allowedValues.push(option.value);
          labelsByValue.set(option.value, option.name);
          if (allowedValues.length > MAX_DSH_CONFIGURATION_VALUES) {
            malformed = true;
            break;
          }
        }
      }
      if (malformed) break;
    }
    if (malformed || allowedValues.length === 0 || !seen.has(entry.currentValue)) {
      rejected.add(id);
      continue;
    }
    parsed.set(
      id,
      Object.freeze({ id, currentValue: entry.currentValue, allowedValues: Object.freeze(allowedValues) }),
    );
    labels.set(id, labelsByValue);
  }
  return { options: parsed, labels };
}

const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;
const DEFAULT_PERMISSION_TIMEOUT_MS = 60_000;
const MAX_PENDING_PERMISSION_TOOLS = 256;
/** Bound user-originated prompt allocation before it becomes an ACP JSON frame. */
export const DSH_BRIDGE_MAX_PROMPT_BYTES = 4 * 1024 * 1024;

function parseListedSessionIds(value: unknown): ReadonlySet<string> {
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as { sessions?: unknown }).sessions)
  ) {
    throw new Error('DSH ACP session/list returned an invalid response');
  }
  const ids = new Set<string>();
  for (const entry of (value as { sessions: unknown[] }).sessions) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { sessionId?: unknown }).sessionId === 'string'
    ) {
      ids.add((entry as { sessionId: string }).sessionId);
    }
  }
  return ids;
}

function firstUnprojectedSequence(lastProjectedSequence: number): number {
  if (
    !Number.isSafeInteger(lastProjectedSequence) ||
    lastProjectedSequence < 0 ||
    lastProjectedSequence >= Number.MAX_SAFE_INTEGER
  ) {
    throw new Error('DSH bridge durable projection sequence cannot continue safely');
  }
  return lastProjectedSequence + 1;
}

interface NativePermissionRequest {
  runtimeSessionId: string;
  nativeToolCallId: string;
  offeredOptions: ReadonlySet<DshPermissionDecision>;
}

function isSafeNativeIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4 * 1024 &&
    value.trim() === value &&
    !hasAsciiControlCharacter(value)
  );
}

function parseNativePermissionRequest(value: unknown): NativePermissionRequest | null {
  if (!isRecord(value) || !isSafeNativeIdentifier(value.sessionId) || !isRecord(value.toolCall)) {
    return null;
  }
  if (
    !isSafeNativeIdentifier(value.toolCall.toolCallId) ||
    !Array.isArray(value.options) ||
    value.options.length === 0 ||
    value.options.length > 8
  ) {
    return null;
  }
  const offeredOptions = new Set<DshPermissionDecision>();
  for (const option of value.options) {
    if (!isRecord(option) || !isSafeNativeIdentifier(option.optionId)) return null;
    if (option.optionId !== 'allow-once' && option.optionId !== 'reject-once') return null;
    offeredOptions.add(option.optionId);
  }
  return offeredOptions.size === 0
    ? null
    : {
        runtimeSessionId: value.sessionId,
        nativeToolCallId: value.toolCall.toolCallId,
        offeredOptions,
      };
}

export class DshControlPlane implements DshBridgePort {
  private readonly scopeId: string;
  private readonly client: DshAcpSessionClient;
  private readonly assertAuthorizedCwd: (cwd: string, cindySessionId: string) => void;
  private readonly now: () => Date;
  private readonly newReceiptId: () => string;
  private readonly operationTimeoutMs: number;
  private readonly permissionTimeoutMs: number;
  private readonly projectionCoordinator: DshFollowProjectionCoordinator | undefined;
  private readonly sessionActivity: DshSessionActivityCoordinator | undefined;
  private readonly internalMcpLeaseFactory: DshInternalMcpLeaseFactory | undefined;
  private durableBinding: DshDurableBindingOptions | null;
  private readonly byCindySession = new Map<string, LiveBindingState>();
  /**
   * Native lifecycle calls mutate a binding only after an ACP reply. Keep one
   * transition in flight per Cindy session so two callers cannot both pass an
   * old state check and create/orphan or double-transition a runtime session.
   * Prompt and cancel deliberately remain independently available: cancelling
   * a running prompt is a normal ACP operation, not a lifecycle transition.
   */
  private readonly lifecycleOperations = new Map<string, 'create' | 'resume' | 'close'>();
  private initialized = false;
  private capabilitySnapshot: DshAcpCapabilitySnapshot | null = null;
  private needsReconcileReason: string | null = null;

  constructor(options: DshControlPlaneOptions) {
    assertNonEmpty(options.scopeId, 'scopeId');
    if (typeof options.assertAuthorizedCwd !== 'function') {
      throw new Error('DSH bridge assertAuthorizedCwd is required');
    }
    this.scopeId = options.scopeId;
    this.client = options.client;
    this.assertAuthorizedCwd = options.assertAuthorizedCwd;
    this.now = options.now ?? (() => new Date());
    this.newReceiptId = options.receiptId ?? randomUUID;
    this.operationTimeoutMs = options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
    this.permissionTimeoutMs = options.permissionTimeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS;
    this.projectionCoordinator = options.projectionCoordinator;
    this.sessionActivity = options.sessionActivity;
    this.internalMcpLeaseFactory = options.internalMcpLeaseFactory;
    this.durableBinding = null;
    if (!Number.isSafeInteger(this.operationTimeoutMs) || this.operationTimeoutMs <= 0) {
      throw new Error('DSH bridge operationTimeoutMs must be a positive safe integer');
    }
    if (!Number.isSafeInteger(this.permissionTimeoutMs) || this.permissionTimeoutMs <= 0) {
      throw new Error('DSH bridge permissionTimeoutMs must be a positive safe integer');
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.needsReconcileReason !== null) this.throwNeedsReconcile();
    let closeReason = 'DSH ACP initialization failed';
    try {
      this.client.onNotification('session/update', (params) => this.handleSessionUpdate(params));
      // This must be registered before transport start so a fast runtime
      // cannot observe an unhandled request. Without a configured F4 resolver
      // (the current product state), every request remains cancelled.
      this.client.onServerRequest('session/request_permission', async (params) =>
        this.resolvePermissionRequest(params),
      );
      this.client.onTransportClose(() => {
        // A prompt may already have reached the runtime when EOF/exit wins. Do
        // not retry it or incorrectly mark the native session closed. F3 will
        // persist this ambiguity and reconcile through a fresh bridge.
        this.needsReconcileReason ??= 'ACP carrier closed';
        // Revoke before async durable work. A bridge cannot safely reuse a
        // token after EOF, even if persistence below is delayed or fails.
        void this.internalMcpLeaseFactory?.revokeAll().catch(() => undefined);
        for (const state of this.byCindySession.values()) {
          state.mcpLease = undefined;
          state.pendingPermissionTools.clear();
          state.permissionResolver = undefined;
          // Revocation is deliberately synchronous. Durable binding and
          // activity projections below await SQLite, but no local plan/todo
          // write may slip through after this carrier has become ambiguous.
          this.sessionActivity?.revokeMutations({
            cindySessionId: state.binding.cindySessionId,
            scopeId: state.binding.scopeId,
          });
        }
        void this.persistAllBindingsNeedReconcile();
        void this.markAllPendingPromptReceiptsUncertain();
        void this.disconnectAllSessionActivities();
      });
      this.client.start();
      const initialized = await this.withOperationTimeout('initialize', this.client.initialize());
      if (initialized.protocolVersion !== 1) {
        closeReason = `DSH ACP protocol version ${initialized.protocolVersion} is unsupported; expected 1`;
        throw new Error(closeReason);
      }
      const sessionCapabilities = initialized.agentCapabilities.sessionCapabilities;
      for (const capability of ['close', 'list', 'resume'] as const) {
        if (!isRecord(sessionCapabilities?.[capability])) {
          closeReason = `ACP omitted required session capability: ${capability}`;
          throw new Error(`DSH ACP does not advertise session/${capability}`);
        }
      }
      this.capabilitySnapshot = Object.freeze({
        protocolVersion: 1,
        agentName: assertCapabilityIdentityText(initialized.agentInfo.name, 'agent name'),
        agentVersion: assertCapabilityIdentityText(initialized.agentInfo.version, 'agent version'),
        sessionCapabilities: Object.freeze({ close: true, list: true, resume: true }),
      });
      this.initialized = true;
    } catch (error) {
      // No request has a usable receipt until initialization succeeds. The
      // carrier cannot be reused after any negotiation or capability failure.
      this.needsReconcileReason ??= closeReason;
      await this.client.close(closeReason).catch(() => undefined);
      throw error;
    }
  }

  /**
   * F3 factories may derive a capability fingerprint only after the ACP
   * handshake. Attaching it is legal exactly once and strictly before create;
   * this keeps a pre-binding handshake from becoming a process-only grant.
   */
  configureDurableBinding(options: DshDurableBindingOptions): void {
    if (!this.initialized)
      throw new Error('DSH bridge must initialize before durable binding is configured');
    if (this.byCindySession.size !== 0) {
      throw new Error('DSH bridge cannot configure durable binding after session creation');
    }
    if (this.durableBinding) throw new Error('DSH bridge durable binding is already configured');
    this.assertDurableBindingOptions(options);
    this.durableBinding = options;
  }

  getCapabilitySnapshot(): DshAcpCapabilitySnapshot | null {
    return this.capabilitySnapshot;
  }

  async create(input: {
    cindySessionId: string;
    cwd: string;
    sessionInstanceId?: string;
  }): Promise<DshBridgeAgentSessionReceipt> {
    this.assertReady();
    assertNonEmpty(input.cindySessionId, 'cindySessionId');
    this.assertCwd(input.cwd, input.cindySessionId);
    return this.withLifecycleOperation(input.cindySessionId, 'create', async () => {
      if (this.projectionCoordinator && !this.durableBinding) {
        throw new Error('DSH follow projection requires durable binding before session creation');
      }
      if (this.sessionActivity && !this.durableBinding) {
        throw new Error('DSH session activity requires durable binding before session creation');
      }
      if (this.byCindySession.has(input.cindySessionId)) {
        throw new Error(`DSH bridge already owns Cindy session ${input.cindySessionId}`);
      }
      if (
        this.durableBinding &&
        (await this.durableBinding.store.getByCindySessionId(input.cindySessionId))
      ) {
        throw new Error(
          `DSH bridge already has a durable binding for Cindy session ${input.cindySessionId}`,
        );
      }
      let mcpLease: DshInternalMcpLease | undefined;
      try {
        mcpLease = await this.acquireInternalMcpLease({
          cindySessionId: input.cindySessionId,
          sessionInstanceId: input.sessionInstanceId,
        });
        const created = await this.withOperationTimeout(
          'create',
          this.client.createSession({ cwd: input.cwd, mcpServers: mcpLease?.mcpServers ?? [] }),
        );
        this.assertReady();
        const configuration = parseDshMainConfigurationOptions(created.configOptions);
        const state: LiveBindingState = {
          binding: {
            cindySessionId: input.cindySessionId,
            runtimeSessionId: created.sessionId,
            scopeId: this.scopeId,
          },
          adapterSessionKey: randomUUID(),
          active: true,
          followHandlers: new Set(),
          committedFollowHandlers: new Set(),
          pendingPermissionTools: new Map(),
          pendingPromptReceiptIds: new Set(),
          promptInFlight: false,
          nextFollowSequence: 1,
          projectionTail: Promise.resolve(),
          mcpLease,
          configuration: configuration.options,
          configurationLabels: configuration.labels,
          configurationTokens: new Map(),
          configurationMutationInFlight: false,
        };
        this.byCindySession.set(input.cindySessionId, state);
        if (this.durableBinding) {
          try {
            const persisted = await this.durableBinding.store.recordCreateReceipt({
              cindySessionId: state.binding.cindySessionId,
              runtimeSessionId: state.binding.runtimeSessionId,
              hostScopeId: state.binding.scopeId,
              ...this.durableBinding.runtimeIdentity,
            });
            state.durableRevision = persisted.revision;
          } catch {
            this.byCindySession.delete(input.cindySessionId);
            await this.blockAfterDurableFailure(
              `could not persist acknowledged create receipt for Cindy session ${input.cindySessionId}`,
            );
          }
        }
        await this.projectSessionActivity(state, 'created');
        return this.agentReceipt('create', state);
      } catch (error) {
        await mcpLease?.release().catch(() => undefined);
        throw error;
      }
    });
  }

  async list(input: { scopeId: string }): Promise<readonly DshMainSessionRef[]> {
    this.assertReady();
    this.assertScope(input.scopeId);
    return [...this.byCindySession.values()].map(({ binding }) => binding);
  }

  async resume(
    input: DshMainSessionRef & { cwd: string; sessionInstanceId?: string },
  ): Promise<DshMainReceipt> {
    this.assertReady();
    this.assertCwd(input.cwd, input.cindySessionId);
    return this.withLifecycleOperation(input.cindySessionId, 'resume', async () => {
      const state = this.requireBinding(input);
      if (state.active) throw new Error('DSH bridge cannot resume an active runtime session');
      await this.assertNoUnresolvedPromptReceipt(state);
      if (state.mcpLease) throw new Error('DSH bridge has an unexpected active internal MCP lease');
      let mcpLease: DshInternalMcpLease | undefined;
      try {
        mcpLease = await this.acquireInternalMcpLease({
          cindySessionId: input.cindySessionId,
          sessionInstanceId: input.sessionInstanceId,
        });
        const resumed = await this.withOperationTimeout(
          'resume',
          this.client.resumeSession({
            sessionId: input.runtimeSessionId,
            cwd: input.cwd,
            ...(mcpLease ? { mcpServers: mcpLease.mcpServers } : {}),
          }),
        );
        this.assertReady();
        const configuration = parseDshMainConfigurationOptions(resumed.configOptions);
        state.configuration = configuration.options;
        state.configurationLabels = configuration.labels;
        state.configurationTokens.clear();
        state.mcpLease = mcpLease;
        await this.persistResume(state);
        await this.projectSessionActivity(state, 'resumed');
        state.active = true;
        return this.receipt('resume');
      } catch (error) {
        if (state.mcpLease === mcpLease) state.mcpLease = undefined;
        await mcpLease?.release().catch(() => undefined);
        throw error;
      }
    });
  }

  /**
   * Resume only an inactive binding which this fresh Main bridge has already
   * restored from its own durable, owner-scoped store. Deliberately do not
   * accept a runtime session id here: maker-core and every caller above it
   * only know the Cindy task id and a freshly admitted workspace.
   */
  async resumeForAdapter(input: {
    cindySessionId: string;
    cwd: string;
    sessionInstanceId?: string;
  }): Promise<DshBridgeAgentResumeReceipt> {
    this.assertReady();
    assertNonEmpty(input.cindySessionId, 'cindySessionId');
    const state = this.byCindySession.get(input.cindySessionId);
    if (!state) {
      throw new Error('DSH bridge has no verified durable binding for this Cindy session');
    }
    await this.resume({
      ...state.binding,
      cwd: input.cwd,
      ...(input.sessionInstanceId === undefined
        ? {}
        : { sessionInstanceId: input.sessionInstanceId }),
    });
    return this.agentReceipt('resume', state);
  }

  /**
   * Main-only inspection point for the complete live ACP selection allowlist.
   * It never returns raw ACP option objects or enters the Maker bridge port.
   */
  getConfigurationOptionsForMain(
    input: DshMainSessionRef,
  ): readonly DshMainConfigurationOption[] {
    this.assertReady();
    const state = this.requireBinding(input);
    if (!state.active) throw new Error('DSH bridge cannot inspect an inactive runtime session');
    return [...state.configuration.values()].map((option) =>
      Object.freeze({ ...option, allowedValues: Object.freeze([...option.allowedValues]) }),
    );
  }

  /**
   * Main-only ACP configuration mutation. The caller may select exactly one
   * value from this live session's admitted allowlist; it cannot name a model
   * or inject a provider route. A missing or contradictory response is an
   * ambiguous runtime state, so the carrier is closed for reconciliation.
   */
  async setConfigurationOptionForMain(input: DshMainSessionRef & {
    configId: DshMainConfigurationId;
    value: string;
  }): Promise<readonly DshMainConfigurationOption[]> {
    this.assertReady();
    const state = this.requireBinding(input);
    if (!state.active) throw new Error('DSH bridge cannot configure an inactive runtime session');
    if (state.promptInFlight || state.pendingPromptReceiptIds.size !== 0) {
      throw new Error('DSH bridge cannot configure while a prompt outcome is pending');
    }
    if (state.configurationMutationInFlight) {
      throw new Error('DSH bridge configuration mutation is already in progress');
    }
    const current = state.configuration.get(input.configId);
    if (!current || !current.allowedValues.includes(input.value)) {
      throw new Error('DSH bridge configuration selection is not advertised for this runtime session');
    }
    try {
      state.configurationMutationInFlight = true;
      let updated: { configOptions?: unknown };
      try {
        updated = await this.withOperationTimeout(
          'set-config-option',
          this.client.setSessionConfigOption({
            sessionId: state.binding.runtimeSessionId,
            configId: input.configId,
            value: input.value,
          }),
        );
      } catch {
        return await this.blockAfterConfigurationOutcomeUncertain();
      }
      this.assertReady();
      const configuration = parseDshMainConfigurationOptions(updated.configOptions);
      const acknowledged = configuration.options.get(input.configId);
      if (!acknowledged || acknowledged.currentValue !== input.value) {
        return await this.blockAfterConfigurationOutcomeUncertain();
      }
      state.configuration = configuration.options;
      state.configurationLabels = configuration.labels;
      state.configurationTokens.clear();
      return this.getConfigurationOptionsForMain(state.binding);
    } finally {
      state.configurationMutationInFlight = false;
    }
  }

  /**
   * Product-safe configuration read. The renderer receives only Main-issued
   * one-session choice capabilities and bounded labels; ACP values remain in
   * this control plane.
   */
  getRuntimeConfigurationForProduct(cindySessionId: string): DshRuntimeConfigurationSnapshot {
    this.assertReady();
    assertNonEmpty(cindySessionId, 'cindySessionId');
    const state = this.byCindySession.get(cindySessionId);
    if (!state || !state.active) {
      return Object.freeze({ controls: Object.freeze([]) });
    }
    const controls: DshRuntimeConfigurationControl[] = [];
    for (const configuration of state.configuration.values()) {
      const labels = state.configurationLabels.get(configuration.id);
      if (!labels) continue;
      const choices: DshRuntimeConfigurationChoice[] = [];
      let hasCompletePresentation = true;
      for (const value of configuration.allowedValues) {
        const label = labels.get(value);
        if (!label) {
          hasCompletePresentation = false;
          break;
        }
        choices.push(
          Object.freeze({
            id: this.getOrCreateConfigurationToken(state, configuration.id, value),
            label,
          }),
        );
      }
      if (!hasCompletePresentation) continue;
      const currentChoiceId = this.getOrCreateConfigurationToken(
        state,
        configuration.id,
        configuration.currentValue,
      );
      controls.push(
        Object.freeze({
          id: configuration.id,
          currentChoiceId,
          choices: Object.freeze(choices),
        }),
      );
    }
    return Object.freeze({ controls: Object.freeze(controls) });
  }

  /**
   * Product-safe configuration mutation. The caller can present only the
   * opaque id issued by the preceding product snapshot; it cannot name or
   * persist an ACP selection, provider, or runtime session id.
   */
  async setRuntimeConfigurationForProduct(input: {
    cindySessionId: string;
    configId: DshMainConfigurationId;
    choiceId: string;
  }): Promise<DshRuntimeConfigurationSnapshot> {
    this.assertReady();
    assertNonEmpty(input.cindySessionId, 'cindySessionId');
    if (!isDshMainConfigurationId(input.configId)) {
      throw new Error('DSH product configuration id is invalid');
    }
    if (
      typeof input.choiceId !== 'string' ||
      input.choiceId.length === 0 ||
      input.choiceId.length > 256 ||
      input.choiceId.trim() !== input.choiceId ||
      hasAsciiControlCharacter(input.choiceId)
    ) {
      throw new Error('DSH product configuration choice is invalid');
    }
    const state = this.byCindySession.get(input.cindySessionId);
    if (!state || !state.active) throw new Error('DSH runtime configuration is unavailable');
    const tokens = state.configurationTokens.get(input.configId);
    const value = tokens && [...tokens.entries()].find(([, token]) => token === input.choiceId)?.[0];
    if (!value) throw new Error('DSH product configuration choice is unavailable');
    await this.setConfigurationOptionForMain({
      ...state.binding,
      configId: input.configId,
      value,
    });
    return this.getRuntimeConfigurationForProduct(input.cindySessionId);
  }

  followRawForMain(input: DshMainSessionRef, handler: DshBridgeRawFollowHandler): () => void {
    this.assertReady();
    const state = this.requireBinding(input);
    if (!state.active) throw new Error('DSH bridge cannot follow an inactive runtime session');
    state.followHandlers.add(handler);
    return () => state.followHandlers.delete(handler);
  }

  followCommitted(
    input: DshControlPlaneSessionRef,
    handler: DshBridgeCommittedFollowHandler,
  ): () => void {
    this.assertReady();
    const state = this.requireBridgeSession(input);
    if (!state.active) throw new Error('DSH bridge cannot follow an inactive runtime session');
    if (
      !this.projectionCoordinator ||
      !this.durableBinding ||
      state.durableRevision === undefined
    ) {
      throw new Error(
        'DSH bridge committed follow requires durable projection before adapter subscription',
      );
    }
    state.committedFollowHandlers.add(handler);
    return () => state.committedFollowHandlers.delete(handler);
  }

  bindPermissionResolver(
    input: DshBridgeAgentSessionRef,
    resolver: DshBridgePermissionResolver,
  ): () => void {
    this.assertReady();
    if (typeof resolver !== 'function') {
      throw new Error('DSH bridge permission resolver must be a function');
    }
    const state = this.requireAgentBinding(input);
    if (!state.active) throw new Error('DSH bridge cannot bind permission resolver to an inactive runtime session');
    if (state.permissionResolver) {
      throw new Error('DSH bridge permission resolver is already bound for this adapter session');
    }
    const bound: DshPermissionResolver = async (request) => await resolver({
      toolUseId: request.toolUseId,
      toolName: request.toolName,
      input: request.input,
      kind: request.kind,
    });
    state.permissionResolver = bound;
    return () => {
      if (state.permissionResolver === bound) state.permissionResolver = undefined;
    };
  }

  async prompt(
    input: DshControlPlaneSessionRef & { text: string },
  ): Promise<DshBridgePromptReceipt> {
    this.assertReady();
    const state = this.requireBridgeSession(input);
    if (!state.active) throw new Error('DSH bridge cannot prompt an inactive runtime session');
    if (state.configurationMutationInFlight) {
      throw new Error('DSH bridge cannot prompt while runtime configuration is changing');
    }
    if (state.promptInFlight) throw new Error('DSH bridge already has a prompt in flight');
    assertNonEmpty(input.text, 'prompt text');
    if (Buffer.byteLength(input.text, 'utf8') > DSH_BRIDGE_MAX_PROMPT_BYTES) {
      throw new Error(`DSH bridge prompt text exceeds ${DSH_BRIDGE_MAX_PROMPT_BYTES} UTF-8 bytes`);
    }
    try {
      state.promptInFlight = true;
      const receiptId = this.newReceiptId();
      assertNonEmpty(receiptId, 'prompt receiptId');
      const acceptedAt = this.now().toISOString();
      await this.recordPendingPromptReceipt(state, receiptId);
      let result: { stopReason: DshBridgePromptStopReason };
      try {
        result = await this.withOperationTimeout(
          'prompt',
          this.client.prompt({
            sessionId: state.binding.runtimeSessionId,
            prompt: [{ type: 'text', text: input.text }],
          }),
        );
      } catch {
        await this.markPromptReceiptUncertain(state, receiptId);
        return await this.blockAfterPromptReceiptUncertain();
      }
      this.assertReady();
      await this.acknowledgePromptReceipt(state, receiptId, result.stopReason);
      return {
        contractVersion: DSH_BRIDGE_CONTRACT_VERSION,
        operation: 'prompt',
        receiptId,
        acceptedAt,
        stopReason: result.stopReason,
      };
    } finally {
      state.promptInFlight = false;
    }
  }

  async cancel(input: DshControlPlaneSessionRef): Promise<DshBridgeAgentReceipt<'cancel'>> {
    this.assertReady();
    const state = this.requireBridgeSession(input);
    if (!state.active) throw new Error('DSH bridge cannot cancel an inactive runtime session');
    if (state.configurationMutationInFlight) {
      throw new Error('DSH bridge cannot cancel while runtime configuration is changing');
    }
    await this.withOperationTimeout('cancel', this.client.cancel(state.binding.runtimeSessionId));
    return this.agentReceipt('cancel', state);
  }

  async close(input: DshControlPlaneSessionRef): Promise<DshBridgeAgentReceipt<'close'>> {
    this.assertReady();
    return this.withLifecycleOperation(input.cindySessionId, 'close', async () => {
      const state = this.requireBridgeSession(input);
      if (!state.active) throw new Error('DSH bridge runtime session is already inactive');
      if (state.promptInFlight || state.pendingPromptReceiptIds.size !== 0) {
        throw new Error('DSH bridge cannot close while a prompt outcome is pending');
      }
      if (state.configurationMutationInFlight) {
        throw new Error('DSH bridge cannot close while runtime configuration is changing');
      }
      await state.projectionTail;
      this.assertReady();
      await this.withOperationTimeout(
        'close',
        this.client.closeSession(state.binding.runtimeSessionId),
      );
      // ACP may flush an update after Main sends session/close but before the
      // close receipt. It still belongs to this active binding, so wait again
      // before changing lifecycle state or returning a close receipt.
      await state.projectionTail;
      this.assertReady();
      try {
        await this.releaseInternalMcpLease(state);
      } catch {
        // The native close already succeeded but its bearer endpoint cannot
        // be proven torn down. Close this carrier rather than leave a
        // partially-authorized scope reusable.
        await this.blockAfterDurableFailure(
          `could not release DSH internal MCP lease for Cindy session ${state.binding.cindySessionId}`,
        );
      }
      await this.persistClose(state);
      await this.projectSessionActivity(state, 'closed');
      // ACP close releases the live carrier but does not delete runtime history. Preserve the
      // Cindy binding so a later explicit resume is ownership-checked rather than becoming a new
      // unrelated session. F3 persists this lifecycle state in the append-only binding store.
      state.active = false;
      state.pendingPermissionTools.clear();
      state.permissionResolver = undefined;
      return this.agentReceipt('close', state);
    });
  }

  async reconcile(input: { scopeId: string }): Promise<readonly DshMainSessionRef[]> {
    this.assertReady();
    this.assertScope(input.scopeId);
    const listed = parseListedSessionIds(
      await this.withOperationTimeout('reconcile', this.client.listSessions()),
    );
    const reconciled: DshMainSessionRef[] = [];
    for (const state of this.byCindySession.values()) {
      // F0 evidence proves that an active native session is intentionally
      // absent from public session/list. It is still owned by this live
      // carrier, so list absence cannot become a reconciliation verdict.
      if (state.active) {
        if (listed.has(state.binding.runtimeSessionId)) reconciled.push(state.binding);
        continue;
      }
      if (listed.has(state.binding.runtimeSessionId)) {
        reconciled.push(state.binding);
      } else {
        await this.persistNeedsReconcile(state);
      }
    }
    return reconciled;
  }

  /**
   * Rehydrate a freshly created bridge only from its own durable bindings and
   * a fresh ACP `session/list` response. This never treats an old PID or an
   * in-memory map as restart evidence, and it never resumes a prompt.
   */
  async restoreVerifiedBindings(): Promise<readonly DshMainSessionRef[]> {
    this.assertReady();
    if (!this.durableBinding) {
      throw new Error('DSH bridge durable binding is not configured');
    }
    const persisted = await this.durableBinding.store.listByScopeId(this.scopeId);
    const listed = parseListedSessionIds(
      await this.withOperationTimeout('restore', this.client.listSessions()),
    );
    const restored: DshMainSessionRef[] = [];
    for (const binding of persisted) {
      if (this.byCindySession.has(binding.cindySessionId)) continue;
      // `needs_reconcile` records an already-observed ambiguity (for example
      // an uncertain prompt outcome or a projection gap). A matching
      // session/list response proves only that native history exists, not that
      // Cindy's projection is complete. Do not erase this fail-closed state
      // until a dedicated history reconciler can prove the missing boundary.
      if (binding.lifecycleState === 'needs_reconcile') continue;
      if (!this.matchesDurableRuntimeIdentity(binding)) {
        await this.markStoredBindingNeedsReconcile(binding);
        continue;
      }
      const promptReceiptStore = this.durableBinding.promptReceiptStore;
      if (promptReceiptStore) {
        let unresolved: boolean;
        try {
          unresolved = await promptReceiptStore.hasUnresolved(binding.cindySessionId);
        } catch {
          return this.blockAfterDurableFailure(
            `could not read DSH prompt receipt ledger while restoring ${binding.cindySessionId}`,
          );
        }
        // A native prompt may have reached the runtime before Cindy crashed.
        // The binding cannot be advertised as resumable until a future history
        // reconciler proves the outcome; never normalize it simply because
        // session/list still contains a native id.
        if (unresolved) {
          await this.markStoredBindingNeedsReconcile(binding);
          continue;
        }
      }
      if (!listed.has(binding.runtimeSessionId)) {
        await this.markStoredBindingNeedsReconcile(binding);
        continue;
      }
      const normalized =
        binding.lifecycleState === 'closed'
          ? binding
          : await this.durableBinding.store.markClosedAfterVerifiedRuntimeHistory({
              cindySessionId: binding.cindySessionId,
              expectedRevision: binding.revision,
            });
      if (!normalized) {
        // A concurrent controller won the CAS. Do not guess whose native
        // session it owns; the next reconciliation uses its newer revision.
        continue;
      }
      const state: LiveBindingState = {
        binding: {
          cindySessionId: normalized.cindySessionId,
          runtimeSessionId: normalized.runtimeSessionId,
          scopeId: normalized.hostScopeId,
        },
        adapterSessionKey: randomUUID(),
        active: false,
        followHandlers: new Set(),
        committedFollowHandlers: new Set(),
        pendingPermissionTools: new Map(),
        pendingPromptReceiptIds: new Set(),
        promptInFlight: false,
        nextFollowSequence: firstUnprojectedSequence(normalized.lastProjectedSequence),
        projectionTail: Promise.resolve(),
        durableRevision: normalized.revision,
        // A fresh carrier has only session/list evidence at this point. ACP
        // returns the live configuration allowlist only after session/resume.
        configuration: new Map(),
        configurationLabels: new Map(),
        configurationTokens: new Map(),
        configurationMutationInFlight: false,
      };
      this.byCindySession.set(normalized.cindySessionId, state);
      await this.projectSessionActivity(state, 'restored');
      restored.push(state.binding);
    }
    return restored;
  }

  private getOrCreateConfigurationToken(
    state: LiveBindingState,
    configId: DshMainConfigurationId,
    value: string,
  ): string {
    let tokens = state.configurationTokens.get(configId);
    if (!tokens) {
      tokens = new Map();
      state.configurationTokens.set(configId, tokens);
    }
    const existing = tokens.get(value);
    if (existing) return existing;
    const token = `dshcfg_${randomUUID()}`;
    tokens.set(value, token);
    return token;
  }

  private async acquireInternalMcpLease(input: {
    cindySessionId: string;
    sessionInstanceId: string | undefined;
  }): Promise<DshInternalMcpLease | undefined> {
    const factory = this.internalMcpLeaseFactory;
    if (!factory) return undefined;
    if (!input.sessionInstanceId) {
      throw new Error('DSH internal MCP requires a Maker session instance id');
    }
    return factory.acquire({
      scopeId: this.scopeId,
      cindySessionId: input.cindySessionId,
      sessionInstanceId: input.sessionInstanceId,
    });
  }

  private async releaseInternalMcpLease(state: LiveBindingState): Promise<void> {
    const lease = state.mcpLease;
    if (!lease) return;
    // Clear the binding before awaiting endpoint teardown. A concurrent
    // carrier-close sweep cannot reuse or double-release this capability.
    state.mcpLease = undefined;
    await lease.release();
  }

  private async persistResume(state: LiveBindingState): Promise<void> {
    if (!this.durableBinding) return;
    const expectedRevision = this.requireDurableRevision(state);
    let persisted: DshSessionBinding | null;
    try {
      persisted = await this.durableBinding.store.markActiveAfterVerifiedRuntimeState({
        cindySessionId: state.binding.cindySessionId,
        expectedRevision,
      });
    } catch {
      return this.blockAfterDurableFailure(
        `could not persist acknowledged resume receipt for Cindy session ${state.binding.cindySessionId}`,
      );
    }
    if (!persisted) {
      return this.blockAfterDurableFailure(
        `resume receipt conflicted with durable binding for Cindy session ${state.binding.cindySessionId}`,
      );
    }
    state.durableRevision = persisted.revision;
  }

  /**
   * Persists only a Cindy-owned lifecycle fact after its durable ACP binding
   * transition succeeds. A projection failure must not return a misleading
   * receipt while native and activity state disagree, so it tears down the
   * carrier and leaves the binding for a fresh reconciliation.
   */
  private async projectSessionActivity(
    state: LiveBindingState,
    event: 'created' | 'resumed' | 'closed' | 'restored' | 'disconnected',
  ): Promise<void> {
    const coordinator = this.sessionActivity;
    if (!coordinator) return;
    const input = {
      cindySessionId: state.binding.cindySessionId,
      scopeId: state.binding.scopeId,
    };
    try {
      await coordinator[event](input);
    } catch {
      await this.blockAfterDurableFailure(
        `could not project DSH session activity ${event} for Cindy session ${input.cindySessionId}`,
      );
    }
  }

  /** Transport EOF never proves a native outcome, so every root becomes observe-only. */
  private async disconnectAllSessionActivities(): Promise<void> {
    await Promise.all(
      [...this.byCindySession.values()].map((state) =>
        this.projectSessionActivity(state, 'disconnected'),
      ),
    ).catch(() => undefined);
  }

  private async persistClose(state: LiveBindingState): Promise<void> {
    if (!this.durableBinding) return;
    const expectedRevision = this.requireDurableRevision(state);
    let persisted: DshSessionBinding | null;
    try {
      persisted = await this.durableBinding.store.markClosed({
        cindySessionId: state.binding.cindySessionId,
        expectedRevision,
      });
    } catch {
      return this.blockAfterDurableFailure(
        `could not persist acknowledged close receipt for Cindy session ${state.binding.cindySessionId}`,
      );
    }
    if (!persisted) {
      return this.blockAfterDurableFailure(
        `close receipt conflicted with durable binding for Cindy session ${state.binding.cindySessionId}`,
      );
    }
    state.durableRevision = persisted.revision;
  }

  private async persistNeedsReconcile(state: LiveBindingState): Promise<void> {
    if (!this.durableBinding || state.durableRevision === undefined) return;
    const persisted = await this.durableBinding.store.markNeedsReconcile({
      cindySessionId: state.binding.cindySessionId,
      expectedRevision: state.durableRevision,
    });
    if (!persisted) {
      return await this.blockAfterDurableFailure(
        `could not mark missing runtime session ${state.binding.runtimeSessionId} for reconciliation`,
      );
    }
    state.durableRevision = persisted.revision;
  }

  private async markStoredBindingNeedsReconcile(binding: DshSessionBinding): Promise<void> {
    if (!this.durableBinding) return;
    const persisted = await this.durableBinding.store.markNeedsReconcile({
      cindySessionId: binding.cindySessionId,
      expectedRevision: binding.revision,
    });
    if (!persisted) {
      await this.blockAfterDurableFailure(
        `could not mark missing persisted runtime session ${binding.runtimeSessionId} for reconciliation`,
      );
    }
  }

  private async persistAllBindingsNeedReconcile(): Promise<void> {
    if (!this.durableBinding) return;
    await Promise.all(
      [...this.byCindySession.values()].map(async (state) => {
        if (!state.active || state.durableRevision === undefined) return;
        const persisted = await this.durableBinding!.store.markNeedsReconcile({
          cindySessionId: state.binding.cindySessionId,
          expectedRevision: state.durableRevision,
        });
        if (persisted) state.durableRevision = persisted.revision;
      }),
    ).catch(() => undefined);
  }

  /**
   * Receipt persistence occurs before the native call. If Main crashes after
   * that point, the durable pending row prevents a later controller from
   * guessing that the prompt was safe to replay.
   */
  private async recordPendingPromptReceipt(
    state: LiveBindingState,
    receiptId: string,
  ): Promise<void> {
    const store = this.durableBinding?.promptReceiptStore;
    if (!store) return;
    if (state.pendingPromptReceiptIds.size !== 0) {
      throw new Error('DSH bridge already has a prompt receipt awaiting native acknowledgement');
    }
    await this.assertNoUnresolvedPromptReceipt(state);
    state.pendingPromptReceiptIds.add(receiptId);
    try {
      await store.recordPending({ receiptId, cindySessionId: state.binding.cindySessionId });
    } catch {
      state.pendingPromptReceiptIds.delete(receiptId);
      return this.blockAfterDurableFailure(
        'could not persist DSH prompt receipt before native prompt',
      );
    }
  }

  private async assertNoUnresolvedPromptReceipt(state: LiveBindingState): Promise<void> {
    const store = this.durableBinding?.promptReceiptStore;
    if (!store) return;
    let unresolved: boolean;
    try {
      unresolved = await store.hasUnresolved(state.binding.cindySessionId);
    } catch {
      return this.blockAfterDurableFailure('could not read DSH prompt receipt ledger');
    }
    if (unresolved) await this.blockAfterPromptReceiptUncertain();
  }

  private async acknowledgePromptReceipt(
    state: LiveBindingState,
    receiptId: string,
    stopReason: DshBridgePromptStopReason,
  ): Promise<void> {
    const store = this.durableBinding?.promptReceiptStore;
    if (!store) return;
    try {
      const acknowledged = await store.acknowledge({
        receiptId,
        cindySessionId: state.binding.cindySessionId,
        stopReason,
      });
      if (!acknowledged) {
        await this.markPromptReceiptUncertain(state, receiptId);
        await this.blockAfterPromptReceiptUncertain();
      }
      state.pendingPromptReceiptIds.delete(receiptId);
    } catch {
      await this.markPromptReceiptUncertain(state, receiptId);
      await this.blockAfterPromptReceiptUncertain();
    }
  }

  private async markPromptReceiptUncertain(
    state: LiveBindingState,
    receiptId: string,
  ): Promise<void> {
    const store = this.durableBinding?.promptReceiptStore;
    if (!store) return;
    try {
      await store.markUncertain({
        cindySessionId: state.binding.cindySessionId,
        receiptIds: [receiptId],
      });
    } finally {
      state.pendingPromptReceiptIds.delete(receiptId);
    }
  }

  private async markAllPendingPromptReceiptsUncertain(): Promise<void> {
    await Promise.all(
      [...this.byCindySession.values()].map(async (state) => {
        const receiptIds = [...state.pendingPromptReceiptIds];
        if (receiptIds.length === 0) return;
        try {
          await this.durableBinding?.promptReceiptStore?.markUncertain({
            cindySessionId: state.binding.cindySessionId,
            receiptIds,
          });
        } finally {
          state.pendingPromptReceiptIds.clear();
        }
      }),
    ).catch(() => undefined);
  }

  private async blockAfterPromptReceiptUncertain(): Promise<never> {
    this.needsReconcileReason ??= 'DSH prompt outcome is uncertain';
    await this.persistAllBindingsNeedReconcile().catch(() => undefined);
    await this.client.close('DSH prompt outcome is uncertain').catch(() => undefined);
    throw new Error('DSH bridge requires reconciliation because prompt outcome is uncertain');
  }

  /**
   * ACP has no idempotency receipt for configuration mutation. Once a select
   * request has timed out, rejected with an invalid response, or returned a
   * different selected value, Main cannot prove which route later prompts
   * would use. Keep the same fail-closed carrier boundary as an uncertain
   * prompt rather than retrying a possibly-applied setting.
   */
  private async blockAfterConfigurationOutcomeUncertain(): Promise<never> {
    this.needsReconcileReason ??= 'DSH session configuration outcome is uncertain';
    await this.persistAllBindingsNeedReconcile().catch(() => undefined);
    await this.client.close('DSH session configuration outcome is uncertain').catch(() => undefined);
    throw new Error('DSH bridge requires reconciliation because session configuration is uncertain');
  }

  private requireDurableRevision(state: LiveBindingState): number {
    if (state.durableRevision === undefined) {
      throw new Error(
        `DSH bridge has no durable revision for Cindy session ${state.binding.cindySessionId}`,
      );
    }
    return state.durableRevision;
  }

  private matchesDurableRuntimeIdentity(binding: DshSessionBinding): boolean {
    const configured = this.durableBinding?.runtimeIdentity;
    return (
      configured !== undefined &&
      binding.runtimeReleaseId === configured.runtimeReleaseId &&
      binding.runtimeVersion === configured.runtimeVersion &&
      binding.controllerApiVersion === configured.controllerApiVersion &&
      binding.capabilityFingerprint === configured.capabilityFingerprint &&
      binding.homeMode === configured.homeMode
    );
  }

  private assertDurableBindingOptions(options: DshDurableBindingOptions): void {
    if (!options.store) throw new Error('DSH bridge durable binding store is required');
    assertNonEmpty(options.runtimeIdentity.runtimeReleaseId, 'runtimeReleaseId');
    assertNonEmpty(options.runtimeIdentity.runtimeVersion, 'runtimeVersion');
    assertNonEmpty(options.runtimeIdentity.capabilityFingerprint, 'capabilityFingerprint');
    if (
      !Number.isSafeInteger(options.runtimeIdentity.controllerApiVersion) ||
      options.runtimeIdentity.controllerApiVersion <= 0
    ) {
      throw new Error('DSH bridge controllerApiVersion must be a positive safe integer');
    }
    if (
      options.runtimeIdentity.homeMode !== 'cindy-managed' &&
      options.runtimeIdentity.homeMode !== 'existing-dsh-home'
    ) {
      throw new Error('DSH bridge homeMode is unsupported');
    }
  }

  private async blockAfterDurableFailure(reason: string): Promise<never> {
    this.needsReconcileReason ??= reason;
    await this.client.close(`DSH bridge durable binding failure: ${reason}`).catch(() => undefined);
    throw new Error(`DSH bridge requires reconciliation because ${reason}`);
  }

  private receipt(operation: 'resume', acceptedAt = this.now().toISOString()): DshMainReceipt {
    return {
      contractVersion: DSH_BRIDGE_CONTRACT_VERSION,
      operation,
      receiptId: this.newReceiptId(),
      acceptedAt,
    };
  }

  private agentReceipt<Operation extends 'create' | 'resume' | 'cancel' | 'close'>(
    operation: Operation,
    state: LiveBindingState,
  ): DshBridgeAgentReceipt<Operation> {
    return {
      contractVersion: DSH_BRIDGE_CONTRACT_VERSION,
      operation,
      receiptId: this.newReceiptId(),
      acceptedAt: this.now().toISOString(),
      cindySessionId: state.binding.cindySessionId,
      scopeId: state.binding.scopeId,
      bridgeSessionKey: state.adapterSessionKey,
    };
  }

  private assertReady(): void {
    if (!this.initialized) throw new Error('DSH bridge is not initialized');
    if (this.needsReconcileReason !== null) this.throwNeedsReconcile();
  }

  private throwNeedsReconcile(): never {
    throw new Error(
      `DSH bridge needs reconciliation after transport close: ${this.needsReconcileReason}`,
    );
  }

  private async withLifecycleOperation<Result>(
    cindySessionId: string,
    operation: 'create' | 'resume' | 'close',
    run: () => Promise<Result>,
  ): Promise<Result> {
    const inFlight = this.lifecycleOperations.get(cindySessionId);
    if (inFlight) {
      throw new Error(
        `DSH bridge ${cindySessionId} already has a ${inFlight} lifecycle operation in flight`,
      );
    }
    this.lifecycleOperations.set(cindySessionId, operation);
    try {
      return await run();
    } finally {
      if (this.lifecycleOperations.get(cindySessionId) === operation) {
        this.lifecycleOperations.delete(cindySessionId);
      }
    }
  }

  private withOperationTimeout<Result>(
    operation: string,
    operationPromise: Promise<Result>,
  ): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const reason = `DSH bridge ${operation} timed out after ${this.operationTimeoutMs}ms`;
        this.needsReconcileReason ??= reason;
        // A request could have reached the runtime even though its receipt did
        // not return. Tear down the privileged carrier and leave F3 to inspect
        // durable receipt/history state; do not retry or mutate the binding.
        void this.client.close(reason).catch(() => undefined);
        reject(new Error(reason));
      }, this.operationTimeoutMs);
      timer.unref?.();

      operationPromise.then(
        (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private async resolvePermissionRequest(params: unknown): Promise<unknown> {
    const native = parseNativePermissionRequest(params);
    if (!native) return { outcome: { outcome: 'cancelled' } };
    const state = [...this.byCindySession.values()].find(
      (candidate) =>
        candidate.active && candidate.binding.runtimeSessionId === native.runtimeSessionId,
    );
    if (!state) return { outcome: { outcome: 'cancelled' } };
    // The runtime can issue this request immediately after its tool_call
    // notification. Wait only for the already-queued durable projection: the
    // adapter must never decide from an uncommitted native event, but a real
    // runtime generally will not repeat an early-cancelled request.
    const permissionDeadline = Date.now() + this.permissionTimeoutMs;
    if (
      this.projectionCoordinator &&
      !(await this.waitForPermissionProjection(state, this.permissionTimeoutMs))
    ) {
      return { outcome: { outcome: 'cancelled' } };
    }
    const remainingPermissionMs = permissionDeadline - Date.now();
    if (remainingPermissionMs <= 0) return { outcome: { outcome: 'cancelled' } };
    const resolver = state.permissionResolver;
    if (!resolver) return { outcome: { outcome: 'cancelled' } };
    // A native id is one-shot: remove it before awaiting a resolver so a
    // duplicate request cannot reuse a decision while the first one is open.
    const request = state.pendingPermissionTools.get(native.nativeToolCallId);
    if (!request) return { outcome: { outcome: 'cancelled' } };
    state.pendingPermissionTools.delete(native.nativeToolCallId);

    const decision = await this.resolvePermissionOnce(resolver, request, remainingPermissionMs);
    if (
      !state.active ||
      state.permissionResolver !== resolver ||
      this.needsReconcileReason !== null ||
      !decision ||
      !native.offeredOptions.has(decision)
    ) {
      return { outcome: { outcome: 'cancelled' } };
    }
    return { outcome: { outcome: 'selected', optionId: decision } };
  }

  private resolvePermissionOnce(
    resolver: DshPermissionResolver,
    request: Readonly<DshPermissionRequest>,
    timeoutMs = this.permissionTimeoutMs,
  ): Promise<DshPermissionDecision | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (decision: DshPermissionDecision | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(decision);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      timer.unref?.();
      void Promise.resolve()
        .then(() => resolver(request))
        .then(
          (decision) =>
            finish(decision === 'allow-once' || decision === 'reject-once' ? decision : null),
          () => finish(null),
        );
    });
  }

  private waitForPermissionProjection(state: LiveBindingState, timeoutMs: number): Promise<boolean> {
    const tail = state.projectionTail;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (completed: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(completed);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      timer.unref?.();
      void tail.then(
        () => finish(true),
        () => finish(false),
      );
    });
  }

  private assertScope(scopeId: string): void {
    if (scopeId !== this.scopeId) throw new Error('DSH bridge scope ownership mismatch');
  }

  private requireBinding(input: DshMainSessionRef): LiveBindingState {
    this.assertScope(input.scopeId);
    const current = this.byCindySession.get(input.cindySessionId);
    if (!current || current.binding.runtimeSessionId !== input.runtimeSessionId) {
      throw new Error('DSH bridge session ownership mismatch');
    }
    return current;
  }

  private requireAgentBinding(input: DshBridgeAgentSessionRef): LiveBindingState {
    this.assertScope(input.scopeId);
    const current = this.byCindySession.get(input.cindySessionId);
    if (!current) throw new Error('DSH bridge session ownership mismatch');
    if (current.adapterSessionKey !== input.bridgeSessionKey) {
      throw new Error('DSH bridge adapter session capability mismatch');
    }
    return current;
  }

  private requireBridgeSession(input: DshControlPlaneSessionRef): LiveBindingState {
    return 'runtimeSessionId' in input
      ? this.requireBinding(input)
      : this.requireAgentBinding(input);
  }

  private assertCwd(cwd: string, cindySessionId: string): void {
    if (!isAbsolute(cwd)) throw new Error('DSH bridge cwd must be absolute');
    this.assertAuthorizedCwd(cwd, cindySessionId);
  }

  private handleSessionUpdate(params: unknown): void {
    if (typeof params !== 'object' || params === null) return;
    const record = params as { sessionId?: unknown; update?: unknown };
    if (typeof record.sessionId !== 'string' || !Object.hasOwn(record, 'update')) return;
    const state = [...this.byCindySession.values()].find(
      (candidate) => candidate.active && candidate.binding.runtimeSessionId === record.sessionId,
    );
    if (!state) return;
    if (state.nextFollowSequence >= Number.MAX_SAFE_INTEGER) {
      // Do not emit a sequence whose successor is no longer exactly
      // representable. This is a durable reconciliation boundary, never a
      // reason to wrap or share another session's counter.
      void this.persistNeedsReconcile(state);
      return;
    }
    const event: DshMainFollowEvent = {
      contractVersion: DSH_BRIDGE_CONTRACT_VERSION,
      cindySessionId: state.binding.cindySessionId,
      scopeId: state.binding.scopeId,
      sequence: state.nextFollowSequence,
      receivedAt: this.now().toISOString(),
      update: record.update,
    };
    state.nextFollowSequence += 1;
    if (this.projectionCoordinator) {
      if (state.durableRevision === undefined) {
        void this.blockAfterProjectionFailure(
          state,
          'DSH follow projection has no durable binding revision',
        );
        return;
      }
      this.enqueueFollowProjection(state, event);
      return;
    }
    this.capturePendingPermissionTool(state, event);
    this.notifyFollowHandlers(state, event);
  }

  private enqueueFollowProjection(state: LiveBindingState, event: DshMainFollowEvent): void {
    const coordinator = this.projectionCoordinator;
    if (!coordinator) return;
    state.projectionTail = state.projectionTail
      .then(async () => {
        if (!state.active || this.needsReconcileReason !== null) return;
        const expectedBindingRevision = this.requireDurableRevision(state);
        const result = await coordinator.project({ event, expectedBindingRevision });
        if (result.kind === 'translated') {
          state.durableRevision = result.binding.revision;
          // A permission handler arriving after this notification waits for
          // the already-queued projection tail. It can associate only after
          // this finite tool record has committed, never from raw ACP data.
          this.capturePendingPermissionTool(state, event);
          this.notifyFollowHandlers(state, event);
          this.notifyCommittedFollowHandlers(state, {
            contractVersion: DSH_BRIDGE_CONTRACT_VERSION,
            cindySessionId: event.cindySessionId,
            scopeId: event.scopeId,
            bridgeSessionKey: state.adapterSessionKey,
            sequence: event.sequence,
            events: result.events,
          });
          return;
        }
        if (result.kind === 'ignored') {
          state.durableRevision = result.binding.revision;
          return;
        }
        if (result.kind === 'rejected') {
          state.durableRevision = result.binding.revision;
          await this.blockAfterProjectionFailure(
            state,
            `DSH follow projection rejected update: ${result.reason}`,
          );
          return;
        }
        await this.blockAfterProjectionFailure(
          state,
          `DSH follow projection failed: ${result.reason}`,
        );
      })
      .catch(() =>
        this.blockAfterProjectionFailure(state, 'DSH follow projection persistence failed'),
      );
  }

  private notifyFollowHandlers(state: LiveBindingState, event: DshMainFollowEvent): void {
    for (const handler of state.followHandlers) {
      try {
        handler(event);
      } catch {
        // One observer cannot interrupt the owned ACP follow stream. F4 adds
        // bounded diagnostic/event handling before product projection.
      }
    }
  }

  private notifyCommittedFollowHandlers(
    state: LiveBindingState,
    event: DshBridgeCommittedFollowEvent,
  ): void {
    for (const handler of state.committedFollowHandlers) {
      try {
        handler(event);
      } catch {
        // A consumer may detach but must not interrupt a committed owner stream.
      }
    }
  }

  private async blockAfterProjectionFailure(
    state: LiveBindingState,
    reason: string,
  ): Promise<void> {
    this.needsReconcileReason ??= reason;
    state.pendingPermissionTools.clear();
    state.permissionResolver = undefined;
    await this.persistAllBindingsNeedReconcile().catch(() => undefined);
    await this.markAllPendingPromptReceiptsUncertain();
    await this.client
      .close(`DSH bridge follow projection failure: ${reason}`)
      .catch(() => undefined);
  }

  private capturePendingPermissionTool(state: LiveBindingState, event: DshMainFollowEvent): void {
    if (!state.permissionResolver) return;
    if (!isRecord(event.update)) return;
    const nativeToolCallId = event.update.toolCallId;
    if (event.update.sessionUpdate === 'tool_call_update') {
      if (isSafeNativeIdentifier(nativeToolCallId)) {
        state.pendingPermissionTools.delete(nativeToolCallId);
      }
      return;
    }
    if (event.update.sessionUpdate !== 'tool_call' || !isSafeNativeIdentifier(nativeToolCallId)) {
      return;
    }
    // A duplicated native id is ambiguous. Forget the old context and make a
    // later request cancel instead of guessing which invocation it owns.
    if (
      state.pendingPermissionTools.has(nativeToolCallId) ||
      state.pendingPermissionTools.size >= MAX_PENDING_PERMISSION_TOOLS
    ) {
      state.pendingPermissionTools.delete(nativeToolCallId);
      return;
    }
    const translation = translateDshFollowEvent(event);
    if (translation.kind !== 'translated') return;
    const toolUse = translation.events.find((candidate) => candidate.type === 'tool_use');
    if (!toolUse || !isRecord(toolUse.data)) return;
    if (
      typeof toolUse.data.toolUseId !== 'string' ||
      typeof toolUse.data.toolName !== 'string' ||
      !isRecord(toolUse.data.input)
    ) {
      return;
    }
    state.pendingPermissionTools.set(
      nativeToolCallId,
      Object.freeze({
        cindySessionId: event.cindySessionId,
        toolUseId: toolUse.data.toolUseId,
        toolName: toolUse.data.toolName,
        input: toolUse.data.input,
        kind: 'other',
      }),
    );
  }
}
