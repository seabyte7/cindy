import { describe, expect, it, vi } from 'vitest';

import type { DshExistingHomeProjection } from '../../../shared/dshExistingHome';
import { createDshExistingHomeIpc } from '../dsh-existing-home-ipc';

const EVENT = { senderFrame: 'fake' };
const MANAGED: DshExistingHomeProjection = { mode: 'cindy-managed', status: 'default' };
const CONFIGURED: DshExistingHomeProjection = {
  mode: 'existing-dsh-home',
  status: 'configured',
};

function makeIpc(overrides?: {
  supported?: boolean;
  owner?: { dataOwnerId: string | null; generation: number };
  assertTrustedSender?: (event: unknown) => void;
  getProjectionThrows?: boolean;
  resetThrows?: boolean;
  select?: (
    accountId: string,
    isAccountCurrent: () => boolean,
  ) => Promise<DshExistingHomeProjection>;
}) {
  let owner = overrides?.owner ?? { dataOwnerId: 'account-a', generation: 4 };
  const assertTrustedSender = vi.fn(overrides?.assertTrustedSender ?? (() => {}));
  const getProjection = vi.fn(() => {
    if (overrides?.getProjectionThrows) throw new Error('EACCES: /private/internal/home');
    return MANAGED;
  });
  const reset = vi.fn(() => {
    if (overrides?.resetThrows) throw new Error('EROFS: /private/internal/home');
    return MANAGED;
  });
  const selectExistingHome = vi.fn(
    overrides?.select ?? (async () => CONFIGURED),
  );
  const ipc = createDshExistingHomeIpc({
    assertTrustedSender,
    isSupportedPlatform: () => overrides?.supported ?? true,
    getActiveOwner: () => owner,
    getProjection,
    selectExistingHome,
    reset,
  });
  return {
    ipc,
    assertTrustedSender,
    getProjection,
    reset,
    selectExistingHome,
    setOwner(next: typeof owner) {
      owner = next;
    },
  };
}

describe('DSH existing Home IPC business body', () => {
  it('rejects untrusted senders before reading, selecting, or resetting', async () => {
    const { ipc, getProjection, selectExistingHome, reset } = makeIpc({
      assertTrustedSender: () => {
        throw new Error('untrusted sender');
      },
    });

    expect(() => ipc.get(EVENT)).toThrow('untrusted sender');
    await expect(ipc.select(EVENT)).rejects.toThrow('untrusted sender');
    expect(() => ipc.reset(EVENT)).toThrow('untrusted sender');
    expect(getProjection).not.toHaveBeenCalled();
    expect(selectExistingHome).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it('takes owner identity only from Main and returns a display-safe projection', async () => {
    const { ipc, getProjection, selectExistingHome, reset } = makeIpc();

    expect(ipc.get(EVENT)).toEqual(MANAGED);
    await expect(ipc.select(EVENT)).resolves.toEqual(CONFIGURED);
    expect(ipc.reset(EVENT)).toEqual(MANAGED);
    expect(getProjection).toHaveBeenCalledWith('account-a');
    expect(selectExistingHome).toHaveBeenCalledWith('account-a', expect.any(Function));
    expect(reset).toHaveBeenCalledWith('account-a');
    expect(JSON.stringify(CONFIGURED)).not.toContain('/');
    expect(JSON.stringify(CONFIGURED)).not.toContain('bookmark');
  });

  it('fails closed for a missing active owner or unsupported local platform', () => {
    const noOwner = makeIpc({ owner: { dataOwnerId: null, generation: 0 } });
    expect(() => noOwner.ipc.get(EVENT)).toThrow('[PRECONDITION_FAILED]');
    expect(noOwner.getProjection).not.toHaveBeenCalled();

    const unsupported = makeIpc({ supported: false });
    expect(() => unsupported.ipc.get(EVENT)).toThrow('[UNSUPPORTED_CAPABILITY]');
    expect(unsupported.getProjection).not.toHaveBeenCalled();
  });

  it('drops a picker result when the active account changes while the picker is open', async () => {
    let resolveSelection: ((value: DshExistingHomeProjection) => void) | null = null;
    const pendingSelection = new Promise<DshExistingHomeProjection>((resolve) => {
      resolveSelection = resolve;
    });
    const harness = makeIpc({ select: async () => pendingSelection });

    const pending = harness.ipc.select(EVENT);
    harness.setOwner({ dataOwnerId: 'account-b', generation: 5 });
    resolveSelection!(CONFIGURED);

    await expect(pending).rejects.toThrow('[PRECONDITION_FAILED]');
  });

  it.each([
    ['read', { getProjectionThrows: true }],
    ['reset', { resetThrows: true }],
  ] as const)('redacts private storage failures from the %s route', (route, options) => {
    const { ipc } = makeIpc(options);
    let caught: Error | null = null;
    try {
      if (route === 'read') ipc.get(EVENT);
      else ipc.reset(EVENT);
    } catch (error) {
      caught = error as Error;
    }
    expect(caught?.message).toContain('[INTERNAL]');
    expect(caught?.message).not.toContain('/private/internal/home');
  });

  it('redacts picker and bookmark failures from the select route', async () => {
    const { ipc } = makeIpc({
      select: async () => {
        throw new Error('bookmark /private/internal/home cannot be decrypted');
      },
    });
    await expect(ipc.select(EVENT)).rejects.toThrow('[INTERNAL]');
    await expect(ipc.select(EVENT)).rejects.not.toThrow('/private/internal/home');
  });

  it('does not mistake a Node filesystem error code for an IPC error', async () => {
    const filesystemError = Object.assign(
      new Error('EACCES: permission denied, open \'/private/internal/home/bookmark.enc\''),
      { code: 'EACCES' },
    );
    const { ipc } = makeIpc({
      select: async () => {
        throw filesystemError;
      },
    });

    await expect(ipc.select(EVENT)).rejects.toThrow('[INTERNAL]');
    await expect(ipc.select(EVENT)).rejects.not.toThrow('/private/internal/home');
  });
});
