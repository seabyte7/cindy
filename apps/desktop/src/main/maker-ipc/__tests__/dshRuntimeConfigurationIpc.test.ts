import { describe, expect, it, vi } from 'vitest';

import type { DshRuntimeConfigurationSnapshot } from '../../../shared/dshRuntimeConfiguration.js';
import { MAKER_INVOKE } from '../channels.js';
import {
  registerDshRuntimeConfigurationHandlers,
  type DshRuntimeConfigurationControlService,
} from '../dsh-runtime-configuration-ipc.js';
import { IpcHarness } from './helpers/ipcHarness.js';

const snapshot: DshRuntimeConfigurationSnapshot = {
  controls: [
    {
      id: 'model',
      currentChoiceId: 'dshcfg_current',
      choices: [
        { id: 'dshcfg_current', label: 'Model A' },
        { id: 'dshcfg_other', label: 'Model B' },
      ],
    },
  ],
};

function control(): DshRuntimeConfigurationControlService {
  return {
    getRuntimeConfigurationForProduct: vi.fn(async () => snapshot),
    setRuntimeConfigurationForProduct: vi.fn(async () => snapshot),
  };
}

describe('DSH runtime configuration IPC', () => {
  it('projects only Main-issued choice ids through a trusted local boundary', async () => {
    const registry = new IpcHarness();
    const service = control();
    const assertTrustedCaller = vi.fn();
    registerDshRuntimeConfigurationHandlers(registry, {
      assertTrustedCaller,
      getControl: () => service,
    });

    await expect(
      registry.invoke(MAKER_INVOKE.DSH_RUNTIME_CONFIGURATION_GET, { sessionId: 'task-1' }),
    ).resolves.toEqual(snapshot);
    await expect(
      registry.invoke(MAKER_INVOKE.DSH_RUNTIME_CONFIGURATION_SET, {
        sessionId: 'task-1',
        controlId: 'model',
        choiceId: 'dshcfg_other',
      }),
    ).resolves.toEqual(snapshot);

    expect(assertTrustedCaller).toHaveBeenCalledTimes(2);
    expect(service.setRuntimeConfigurationForProduct).toHaveBeenCalledWith({
      cindySessionId: 'task-1',
      configId: 'model',
      choiceId: 'dshcfg_other',
    });
    expect(JSON.stringify(snapshot)).not.toContain('runtimeSessionId');
    expect(JSON.stringify(snapshot)).not.toContain('fixture","model');
  });

  it('rejects raw ACP-style fields and unknown controls before invoking Main', async () => {
    const registry = new IpcHarness();
    const service = control();
    registerDshRuntimeConfigurationHandlers(registry, {
      assertTrustedCaller: vi.fn(),
      getControl: () => service,
    });

    await expect(
      registry.invoke(MAKER_INVOKE.DSH_RUNTIME_CONFIGURATION_SET, {
        sessionId: 'task-1',
        controlId: 'model',
        choiceId: 'dshcfg_other',
        value: '["provider","model"]',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await expect(
      registry.invoke(MAKER_INVOKE.DSH_RUNTIME_CONFIGURATION_SET, {
        sessionId: 'task-1',
        controlId: 'provider',
        choiceId: 'dshcfg_other',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(service.setRuntimeConfigurationForProduct).not.toHaveBeenCalled();
  });

  it('does not pass a native error message through the product boundary', async () => {
    const registry = new IpcHarness();
    const service = control();
    vi.mocked(service.setRuntimeConfigurationForProduct).mockRejectedValue(
      new Error('native runtime session runtime-123 rejected provider https://private.example'),
    );
    registerDshRuntimeConfigurationHandlers(registry, {
      assertTrustedCaller: vi.fn(),
      getControl: () => service,
    });

    await expect(
      registry.invoke(MAKER_INVOKE.DSH_RUNTIME_CONFIGURATION_SET, {
        sessionId: 'task-1',
        controlId: 'model',
        choiceId: 'dshcfg_other',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.not.stringContaining('runtime-123'),
    });
  });
});
