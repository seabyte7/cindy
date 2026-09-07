/**
 * Main-owned boundary for selecting an existing DSH Home.
 *
 * The Renderer receives only a display-safe projection. It cannot choose an
 * account, submit a pathname or bookmark, or invoke this on an untrusted page.
 */

import type { DshExistingHomeProjection } from '../../shared/dshExistingHome.js';
import { isIpcError } from '../../shared/ipc-errors.js';
import { throwIpcError } from '../utils/ipcValidate.js';

export interface DshExistingHomeIpcOwner {
  dataOwnerId: string | null;
  generation: number;
}

export interface DshExistingHomeIpcDeps {
  assertTrustedSender(event: unknown): void;
  isSupportedPlatform(): boolean;
  getActiveOwner(): DshExistingHomeIpcOwner;
  getProjection(accountId: string): DshExistingHomeProjection;
  selectExistingHome(
    accountId: string,
    isAccountCurrent: () => boolean,
  ): Promise<DshExistingHomeProjection>;
  reset(accountId: string): DshExistingHomeProjection;
}

function sameOwner(left: DshExistingHomeIpcOwner, right: DshExistingHomeIpcOwner): boolean {
  return left.dataOwnerId === right.dataOwnerId && left.generation === right.generation;
}

function ownerIdOrThrow(deps: DshExistingHomeIpcDeps): {
  accountId: string;
  owner: DshExistingHomeIpcOwner;
} {
  if (!deps.isSupportedPlatform()) {
    throwIpcError('UNSUPPORTED_CAPABILITY', 'existing DSH Home is only available on local macOS');
  }
  const owner = deps.getActiveOwner();
  if (!owner.dataOwnerId) {
    throwIpcError('PRECONDITION_FAILED', 'an active local account is required');
  }
  return { accountId: owner.dataOwnerId, owner };
}

function throwInternal(action: 'read' | 'select' | 'reset'): never {
  const messages = {
    read: 'DSH Home settings could not be read',
    select: 'DSH Home selection could not be saved',
    reset: 'DSH Home settings could not be restored',
  } as const;
  return throwIpcError('INTERNAL', messages[action]);
}

/**
 * Extracted from the Electron adapter for direct tests of authorization,
 * platform, account-generation, and redaction behaviour.
 */
export function createDshExistingHomeIpc(deps: DshExistingHomeIpcDeps) {
  return {
    get(event: unknown): DshExistingHomeProjection {
      deps.assertTrustedSender(event);
      const { accountId } = ownerIdOrThrow(deps);
      try {
        return deps.getProjection(accountId);
      } catch {
        return throwInternal('read');
      }
    },

    async select(event: unknown): Promise<DshExistingHomeProjection> {
      deps.assertTrustedSender(event);
      const { accountId, owner } = ownerIdOrThrow(deps);
      try {
        const projection = await deps.selectExistingHome(accountId, () =>
          sameOwner(owner, deps.getActiveOwner()),
        );
        if (!sameOwner(owner, deps.getActiveOwner())) {
          throwIpcError('PRECONDITION_FAILED', 'active account changed while choosing a DSH Home');
        }
        return projection;
      } catch (error) {
        // Node filesystem errors also carry a `code` field (for example
        // EACCES) and their message may expose a private bookmark-store path.
        // Only our structured IPC errors are safe to preserve for Renderer
        // recovery; every other failure is converted to a generic receipt.
        if (isIpcError(error)) throw error;
        return throwInternal('select');
      }
    },

    reset(event: unknown): DshExistingHomeProjection {
      deps.assertTrustedSender(event);
      const { accountId } = ownerIdOrThrow(deps);
      try {
        return deps.reset(accountId);
      } catch {
        return throwInternal('reset');
      }
    },
  };
}
