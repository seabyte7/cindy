import { describe, expect, it, vi } from 'vitest';

import type { DshRuntimeStatus } from '../../../shared/dshRuntimeStatus.js';
import { MAKER_INVOKE } from '../channels.js';
import { registerDshRuntimeStatusHandlers } from '../dsh-runtime-status-ipc.js';
import { IpcHarness } from './helpers/ipcHarness.js';

const status: DshRuntimeStatus = {
  revision: 1,
  configuration: { status: 'unavailable', reason: 'missing-api-key' },
  registration: 'not-registered',
  activeTaskCount: 0,
  evidence: {
    modelConnection: 'not-verified-in-this-app',
    commands: 'not-verified-in-this-app',
    fileTools: 'not-verified-in-this-app',
    attachments: 'not-verified-in-this-app',
    permissions: 'not-verified-in-this-app',
  },
  actions: { canRetryRegistration: true, mustCloseActiveTasksBeforeReplacement: false },
};

describe('DSH runtime status IPC', () => {
  it('returns only the fixed display-safe status contract', async () => {
    const registry = new IpcHarness();
    const assertTrustedCaller = vi.fn();
    const get = vi.fn(async () => status);
    registerDshRuntimeStatusHandlers(registry, {
      assertTrustedCaller,
      getService: () => ({ get, retry: async () => status }),
    });

    await expect(registry.invoke(MAKER_INVOKE.DSH_RUNTIME_STATUS_GET)).resolves.toEqual(status);
    expect(assertTrustedCaller).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('requires a trusted caller and rejects probe input', async () => {
    const registry = new IpcHarness();
    const retry = vi.fn(async () => status);
    registerDshRuntimeStatusHandlers(registry, {
      assertTrustedCaller: () => undefined,
      getService: () => ({ get: async () => status, retry }),
    });

    await expect(registry.invoke(MAKER_INVOKE.DSH_RUNTIME_STATUS_RETRY, { providerId: 'x' }))
      .rejects.toThrow('DSH runtime status does not accept input');
    expect(retry).not.toHaveBeenCalled();
  });
});
