import { describe, expect, it, vi } from 'vitest';

import type { DshWorkspaceAccessProjection } from '../../../shared/dshWorkspaceAccess';
import { createDshWorkspaceAccessIpc } from '../dsh-workspace-access-ipc';

const EVENT = { senderFrame: 'fake' };
const DEFAULT: DshWorkspaceAccessProjection = { status: 'default', count: 0 };
const CONFIGURED: DshWorkspaceAccessProjection = { status: 'configured', count: 1 };

function makeIpc(overrides?: {
  supported?: boolean;
  owner?: { dataOwnerId: string | null; generation: number };
  assertTrustedSender?: (event: unknown) => void;
  select?: (
    accountId: string,
    isAccountCurrent: () => boolean,
  ) => Promise<DshWorkspaceAccessProjection>;
}) {
  let owner = overrides?.owner ?? { dataOwnerId: 'account-a', generation: 4 };
  const assertTrustedSender = vi.fn(overrides?.assertTrustedSender ?? (() => {}));
  const getProjection = vi.fn(() => DEFAULT);
  const reset = vi.fn(() => DEFAULT);
  const selectWorkspace = vi.fn(overrides?.select ?? (async () => CONFIGURED));
  const ipc = createDshWorkspaceAccessIpc({
    assertTrustedSender,
    isSupportedPlatform: () => overrides?.supported ?? true,
    getActiveOwner: () => owner,
    getProjection,
    selectWorkspace,
    reset,
  });
  return {
    ipc,
    getProjection,
    selectWorkspace,
    reset,
    setOwner(next: typeof owner) {
      owner = next;
    },
  };
}

describe('DSH workspace access IPC business body', () => {
  it('uses Main-owned account identity and returns only a projection', async () => {
    const { ipc, getProjection, selectWorkspace, reset } = makeIpc();

    expect(ipc.get(EVENT)).toEqual(DEFAULT);
    await expect(ipc.select(EVENT)).resolves.toEqual(CONFIGURED);
    expect(ipc.reset(EVENT)).toEqual(DEFAULT);
    expect(getProjection).toHaveBeenCalledWith('account-a');
    expect(selectWorkspace).toHaveBeenCalledWith('account-a', expect.any(Function));
    expect(reset).toHaveBeenCalledWith('account-a');
    expect(JSON.stringify(CONFIGURED)).not.toContain('/');
    expect(JSON.stringify(CONFIGURED)).not.toContain('bookmark');
  });

  it('rejects untrusted senders, missing owners, and unsupported platforms', async () => {
    const untrusted = makeIpc({
      assertTrustedSender: () => {
        throw new Error('untrusted sender');
      },
    });
    expect(() => untrusted.ipc.get(EVENT)).toThrow('untrusted sender');
    await expect(untrusted.ipc.select(EVENT)).rejects.toThrow('untrusted sender');

    const noOwner = makeIpc({ owner: { dataOwnerId: null, generation: 0 } });
    expect(() => noOwner.ipc.get(EVENT)).toThrow('[PRECONDITION_FAILED]');

    const unsupported = makeIpc({ supported: false });
    expect(() => unsupported.ipc.get(EVENT)).toThrow('[UNSUPPORTED_CAPABILITY]');
  });

  it('drops a picker result when the active account changes', async () => {
    let resolveSelection: ((value: DshWorkspaceAccessProjection) => void) | null = null;
    const pendingSelection = new Promise<DshWorkspaceAccessProjection>((resolve) => {
      resolveSelection = resolve;
    });
    const harness = makeIpc({ select: async () => pendingSelection });

    const pending = harness.ipc.select(EVENT);
    harness.setOwner({ dataOwnerId: 'account-b', generation: 5 });
    resolveSelection!(CONFIGURED);

    await expect(pending).rejects.toThrow('[PRECONDITION_FAILED]');
  });
});
