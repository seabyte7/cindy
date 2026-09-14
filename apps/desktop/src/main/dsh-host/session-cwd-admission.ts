/**
 * One-shot Main authorization between a Cindy session startup and DSH ACP.
 *
 * A user-selected workspace path is not itself a capability. Before DSH can
 * issue `session/new` or `session/resume`, Desktop Main reserves the canonical local directory
 * for one Cindy session id; the control plane consumes that exact pair. This
 * prevents a generic bridge call, a stale async startup, or a second task
 * borrowing an otherwise valid worktree path.
 */

import path from 'node:path';

import type { DshWorkspaceBookmarkHandoff } from './implicit-bookmark-handoff.js';

interface PendingCwdAdmission {
  readonly cwd: string;
  readonly workspaceBookmark: DshWorkspaceBookmarkHandoff;
}

/** Named fields prevent two string-valued authority coordinates being swapped at wiring sites. */
export interface DshWorkspaceBookmarkClaim {
  readonly cindySessionId: string;
  readonly cwd: string;
}

function assertSessionId(value: string): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error('DSH cwd admission session id is invalid');
  }
}

function assertCanonicalCwd(value: string): void {
  if (
    typeof value !== 'string' ||
    !path.isAbsolute(value) ||
    value.trim() !== value ||
    value !== path.normalize(value) ||
    /\u0000/.test(value)
  ) {
    throw new Error('DSH cwd admission requires a canonical absolute directory');
  }
}

export interface DshSessionCwdAdmission {
  /**
   * Reserve a verified local workspace for exactly one forthcoming lifecycle start.
   * A repeat reservation for the same unconsumed session replaces a stale
   * ticket, so a fail-closed pre-create error can retry without widening the
   * authorization to another session or directory.
   */
  reserve(cindySessionId: string, cwd: string, workspaceBookmark: DshWorkspaceBookmarkHandoff): void;
  /** Consume the reservation immediately before the native ACP lifecycle request. */
  assertAndConsume(cwd: string, cindySessionId: string): void;
  /** Consume the Main-issued sandbox handoff only after the same cwd check. */
  consumeWorkspaceBookmark(claim: DshWorkspaceBookmarkClaim): DshWorkspaceBookmarkHandoff;
  /** Discard an unconsumed startup reservation during an owner/runtime reset. */
  clear(cindySessionId: string): void;
  /** Account boundary cleanup; no old startup may authorize a new owner. */
  clearAll(): void;
}

export function createDshSessionCwdAdmission(): DshSessionCwdAdmission {
  const pendingBySessionId = new Map<string, PendingCwdAdmission>();

  return {
    reserve(cindySessionId, cwd, workspaceBookmark) {
      assertSessionId(cindySessionId);
      assertCanonicalCwd(cwd);
      if (
        workspaceBookmark?.kind !== 'dsh-task-workspace-implicit-bookmark' ||
        typeof workspaceBookmark.bookmark !== 'string' ||
        workspaceBookmark.bookmark.length === 0
      ) {
        throw new Error('DSH workspace bookmark admission is invalid');
      }
      pendingBySessionId.set(cindySessionId, { cwd, workspaceBookmark });
    },
    assertAndConsume(cwd, cindySessionId) {
      assertSessionId(cindySessionId);
      assertCanonicalCwd(cwd);
      const pending = pendingBySessionId.get(cindySessionId);
      // Consume before reporting a mismatch: a malformed or stale native call
      // must never leave a reusable path capability behind.
      pendingBySessionId.delete(cindySessionId);
      if (!pending || pending.cwd !== cwd) {
        throw new Error('DSH bridge cwd is not authorized for this Cindy session');
      }
    },
    consumeWorkspaceBookmark({ cwd, cindySessionId }) {
      assertSessionId(cindySessionId);
      assertCanonicalCwd(cwd);
      const pending = pendingBySessionId.get(cindySessionId);
      pendingBySessionId.delete(cindySessionId);
      if (!pending || pending.cwd !== cwd) {
        throw new Error('DSH workspace is not authorized for this Cindy session');
      }
      return pending.workspaceBookmark;
    },
    clear(cindySessionId) {
      assertSessionId(cindySessionId);
      pendingBySessionId.delete(cindySessionId);
    },
    clearAll() {
      pendingBySessionId.clear();
    },
  };
}
