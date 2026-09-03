/**
 * Cindy-owned DSH control-plane contract.
 *
 * This is intentionally independent from ACP wire fields. Desktop Main owns an implementation,
 * durable binding and receipt persistence; maker-core only depends on this narrow, versioned port.
 */

export const DSH_BRIDGE_CONTRACT_VERSION = 1 as const;

export const DSH_BRIDGE_OPERATIONS = [
  'create',
  'list',
  'resume',
  'follow',
  'prompt',
  'cancel',
  'close',
  'reconcile',
] as const;

/** Follow is a subscription, not a command that can receive a completion receipt. */
export const DSH_BRIDGE_RECEIPT_OPERATIONS = [
  'create',
  'resume',
  'prompt',
  'cancel',
  'close',
] as const;

export type DshBridgeOperation = (typeof DSH_BRIDGE_OPERATIONS)[number];
export type DshBridgeReceiptOperation = (typeof DSH_BRIDGE_RECEIPT_OPERATIONS)[number];

/** Cindy-generated id, never an upstream session id and never a credential. */
export type DshBridgeReceiptId = string;

export interface DshBridgeReceipt {
  contractVersion: typeof DSH_BRIDGE_CONTRACT_VERSION;
  operation: DshBridgeReceiptOperation;
  receiptId: DshBridgeReceiptId;
  /** Opaque runtime id; it must only be used by the owning bridge scope. */
  runtimeSessionId?: string;
  acceptedAt: string;
}

/** A deliberately small, protocol-validated terminal outcome for one prompt turn. */
export type DshBridgePromptStopReason = 'end_turn' | 'cancelled';

export interface DshBridgePromptReceipt extends DshBridgeReceipt {
  operation: 'prompt';
  stopReason: DshBridgePromptStopReason;
}

export interface DshBridgeSessionRef {
  cindySessionId: string;
  runtimeSessionId: string;
  scopeId: string;
}

/**
 * F0-only owned observation of a public ACP `session/update` notification.
 *
 * `update` remains opaque here. F4 must validate and translate native update
 * kinds before a renderer, persistence, device-link, or activity projection
 * can consume them.
 */
export interface DshBridgeFollowEvent extends DshBridgeSessionRef {
  contractVersion: typeof DSH_BRIDGE_CONTRACT_VERSION;
  sequence: number;
  receivedAt: string;
  update: unknown;
}

export type DshBridgeFollowHandler = (event: DshBridgeFollowEvent) => void;

export interface DshBridgePort {
  create(input: { cindySessionId: string; cwd: string }): Promise<DshBridgeReceipt>;
  list(input: { scopeId: string }): Promise<readonly DshBridgeSessionRef[]>;
  resume(input: DshBridgeSessionRef & { cwd: string }): Promise<DshBridgeReceipt>;
  /** Subscribe only through the owning bridge; raw runtime ids are not an API. */
  follow(input: DshBridgeSessionRef, handler: DshBridgeFollowHandler): () => void;
  prompt(input: DshBridgeSessionRef & { text: string }): Promise<DshBridgePromptReceipt>;
  cancel(input: DshBridgeSessionRef): Promise<DshBridgeReceipt>;
  close(input: DshBridgeSessionRef): Promise<DshBridgeReceipt>;
  reconcile(input: { scopeId: string }): Promise<readonly DshBridgeSessionRef[]>;
}
