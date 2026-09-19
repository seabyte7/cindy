/**
 * Cindy-owned DSH control-plane contract.
 *
 * This is intentionally independent from ACP wire fields. Desktop Main owns an implementation,
 * durable binding and receipt persistence; maker-core only depends on this narrow, versioned port.
 */

import type { AgentEvent } from '../../types/events.js';

export const DSH_BRIDGE_CONTRACT_VERSION = 1 as const;

/** Cindy-generated id, never an upstream session id and never a credential. */
export type DshBridgeReceiptId = string;

/**
 * Opaque adapter reference. The native runtime session id remains inside the
 * owning Desktop Main control plane and is never an input to maker-core.
 */
export interface DshBridgeAgentSessionRef {
  cindySessionId: string;
  scopeId: string;
  /** Main-generated ephemeral capability, never a native runtime identity. */
  bridgeSessionKey: string;
}

export interface DshBridgeAgentReceipt<
  Operation extends 'create' | 'resume' | 'cancel' | 'close' = 'create' | 'resume' | 'cancel' | 'close',
> {
  contractVersion: typeof DSH_BRIDGE_CONTRACT_VERSION;
  operation: Operation;
  receiptId: DshBridgeReceiptId;
  acceptedAt: string;
  cindySessionId: string;
  scopeId: string;
  bridgeSessionKey: string;
}

export type DshBridgeAgentSessionReceipt = DshBridgeAgentReceipt<'create'>;
/**
 * A Main-verified continuation of the same Cindy task. The adapter supplies
 * no native runtime identity: Main finds that identity only in its recovered
 * owner-scoped binding.
 */
export type DshBridgeAgentResumeReceipt = DshBridgeAgentReceipt<'resume'>;

/** A deliberately small, protocol-validated terminal outcome for one prompt turn. */
export type DshBridgePromptStopReason = 'end_turn' | 'cancelled';

/**
 * Safe, product-owned failure categories for a prompt turn.  The underlying
 * ACP/provider error must stay inside Main because it may contain endpoint,
 * credential, or user-input text.
 */
export type DshBridgePromptFailureCode =
  | 'image-input-unavailable'
  | 'prompt-outcome-uncertain'
  | 'prompt-failed';

export class DshBridgePromptFailure extends Error {
  readonly name = 'DshBridgePromptFailure';

  constructor(
    readonly code: DshBridgePromptFailureCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A Renderer-originated content reference after generic Maker has validated
 * only its shape. Desktop Main remains solely responsible for authorizing,
 * staging and serializing local bytes into ACP prompt blocks.
 */
export type DshBridgePromptContent =
  | { type: 'text'; text: string }
  | { type: 'image'; path: string; mimeType?: string }
  | { type: 'file'; path: string; mimeType?: string }
  | { type: 'mention'; name: string; path: string; kind?: 'file' | 'dir' | 'agent' };

export interface DshBridgePromptReceipt {
  contractVersion: typeof DSH_BRIDGE_CONTRACT_VERSION;
  operation: 'prompt';
  receiptId: DshBridgeReceiptId;
  acceptedAt: string;
  stopReason: DshBridgePromptStopReason;
}

/**
 * A Main-committed projection of a native follow update. This is the only
 * follow shape a Maker adapter may subscribe to: native ACP payloads and
 * runtime session identifiers remain in Desktop Main until the finite
 * translator and durable journal have accepted them.
 */
export interface DshBridgeCommittedFollowEvent extends DshBridgeAgentSessionRef {
  contractVersion: typeof DSH_BRIDGE_CONTRACT_VERSION;
  sequence: number;
  events: readonly AgentEvent[];
}

export type DshBridgeCommittedFollowHandler = (event: DshBridgeCommittedFollowEvent) => void;

/**
 * Display-safe context for one native DSH permission request.
 *
 * Desktop Main keeps the ACP request id and runtime session id private. The
 * adapter receives only the already-redacted tool projection and can return
 * one of the two native one-shot outcomes.
 */
export interface DshBridgePermissionRequest {
  /** Cindy-generated correlation id, never an ACP tool-call id. */
  toolUseId: string;
  toolName: string;
  input: Readonly<Record<string, unknown>>;
  /** DSH ACP presently exposes no finer permission classification. */
  kind: 'other';
}

/** DSH ACP permits only request-scoped choices; no grant is persistent. */
export type DshBridgePermissionDecision = 'allow-once' | 'reject-once';
export type DshBridgePermissionResolver = (
  request: Readonly<DshBridgePermissionRequest>,
) => Promise<DshBridgePermissionDecision>;

export interface DshBridgePort {
  create(input: {
    cindySessionId: string;
    cwd: string;
    /** Per-Maker-instance nonce; never a native session id or Renderer capability. */
    sessionInstanceId?: string;
  }): Promise<DshBridgeAgentSessionReceipt>;
  resumeForAdapter(input: {
    cindySessionId: string;
    cwd: string;
    /** Fresh on every Maker reconstruction; binds Main-only MCP leases. */
    sessionInstanceId?: string;
  }): Promise<DshBridgeAgentResumeReceipt>;
  /** Subscribe only to a committed safe projection from the owning Main bridge. */
  followCommitted(
    input: DshBridgeAgentSessionRef,
    handler: DshBridgeCommittedFollowHandler,
  ): () => void;
  /**
   * Bind the current Maker session's interaction resolver to this exact
   * Main-issued session capability. The returned cleanup revokes only this
   * binding; a missing resolver must cause native requests to be cancelled.
   */
  bindPermissionResolver(
    input: DshBridgeAgentSessionRef,
    resolver: DshBridgePermissionResolver,
  ): () => void;
  prompt(input: DshBridgeAgentSessionRef & {
    content: readonly DshBridgePromptContent[];
  }): Promise<DshBridgePromptReceipt>;
  cancel(input: DshBridgeAgentSessionRef): Promise<DshBridgeAgentReceipt<'cancel'>>;
  close(input: DshBridgeAgentSessionRef): Promise<DshBridgeAgentReceipt<'close'>>;
}
