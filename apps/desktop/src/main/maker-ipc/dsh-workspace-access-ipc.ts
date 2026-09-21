import type { DshWorkspaceAccessProjection } from '../../shared/dshWorkspaceAccess.js';
import { isIpcError } from '../../shared/ipc-errors.js';
import { throwIpcError } from '../utils/ipcValidate.js';

export interface DshWorkspaceAccessIpcOwner {
  dataOwnerId: string | null;
  generation: number;
}

export interface DshWorkspaceAccessIpcDeps {
  assertTrustedSender(event: unknown): void;
  isSupportedPlatform(): boolean;
  getActiveOwner(): DshWorkspaceAccessIpcOwner;
  getProjection(accountId: string): DshWorkspaceAccessProjection;
  selectWorkspace(
    accountId: string,
    isAccountCurrent: () => boolean,
  ): Promise<DshWorkspaceAccessProjection>;
  reset(accountId: string): DshWorkspaceAccessProjection;
}

function sameOwner(left: DshWorkspaceAccessIpcOwner, right: DshWorkspaceAccessIpcOwner): boolean {
  return left.dataOwnerId === right.dataOwnerId && left.generation === right.generation;
}

function ownerIdOrThrow(deps: DshWorkspaceAccessIpcDeps): {
  accountId: string;
  owner: DshWorkspaceAccessIpcOwner;
} {
  if (!deps.isSupportedPlatform()) {
    throwIpcError(
      'UNSUPPORTED_CAPABILITY',
      'persistent DSH workspace access is only available on local macOS',
    );
  }
  const owner = deps.getActiveOwner();
  if (!owner.dataOwnerId)
    throwIpcError('PRECONDITION_FAILED', 'an active local account is required');
  return { accountId: owner.dataOwnerId, owner };
}

function throwInternal(action: 'read' | 'select' | 'reset'): never {
  const messages = {
    read: 'DSH workspace access could not be read',
    select: 'DSH workspace access could not be saved',
    reset: 'DSH workspace access could not be cleared',
  } as const;
  return throwIpcError('INTERNAL', messages[action]);
}

export function createDshWorkspaceAccessIpc(deps: DshWorkspaceAccessIpcDeps) {
  return {
    get(event: unknown): DshWorkspaceAccessProjection {
      deps.assertTrustedSender(event);
      const { accountId } = ownerIdOrThrow(deps);
      try {
        return deps.getProjection(accountId);
      } catch {
        return throwInternal('read');
      }
    },
    async select(event: unknown): Promise<DshWorkspaceAccessProjection> {
      deps.assertTrustedSender(event);
      const { accountId, owner } = ownerIdOrThrow(deps);
      try {
        const projection = await deps.selectWorkspace(accountId, () =>
          sameOwner(owner, deps.getActiveOwner()),
        );
        if (!sameOwner(owner, deps.getActiveOwner())) {
          throwIpcError('PRECONDITION_FAILED', 'active account changed while choosing a workspace');
        }
        return projection;
      } catch (error) {
        if (isIpcError(error)) throw error;
        return throwInternal('select');
      }
    },
    reset(event: unknown): DshWorkspaceAccessProjection {
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
