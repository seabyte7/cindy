import { describe, expect, it, vi } from 'vitest';

import {
  DshActivityControlError,
  type DshActivityControlService,
} from '../../maker-host/dsh-activity-control.js';
import { MAKER_INVOKE } from '../channels.js';
import { registerDshActivityHandlers } from '../dshActivityHandlers.js';
import { IpcHarness } from './helpers/ipcHarness.js';

function control(): DshActivityControlService {
  return {
    read: vi.fn(async () => ({ snapshot: null })),
    createPlan: vi.fn(async () => ({
      snapshot: { sequence: 2, activities: [] },
    })),
    createTodo: vi.fn(async () => ({
      snapshot: { sequence: 3, activities: [] },
    })),
    complete: vi.fn(async () => ({
      snapshot: { sequence: 4, activities: [] },
    })),
    cancel: vi.fn(async () => ({
      snapshot: { sequence: 4, activities: [] },
    })),
  };
}

describe('DSH activity IPC handlers', () => {
  it('offers only narrow local actions after trusted-renderer admission', async () => {
    const registry = new IpcHarness();
    const service = control();
    const assertTrustedCaller = vi.fn();
    registerDshActivityHandlers(registry, {
      assertTrustedCaller,
      getControl: () => service,
    });

    await expect(
      registry.invoke(MAKER_INVOKE.DSH_PLAN_CREATE, {
        sessionId: 'task-1',
        label: 'Verify the local package',
      }),
    ).resolves.toEqual({ snapshot: { sequence: 2, activities: [] } });
    expect(assertTrustedCaller).toHaveBeenCalledTimes(1);
    expect(service.createPlan).toHaveBeenCalledWith({
      cindySessionId: 'task-1',
      label: 'Verify the local package',
    });

    await registry.invoke(MAKER_INVOKE.DSH_TODO_CREATE, {
      sessionId: 'task-1',
      planActivityId: 'plan-1',
      label: 'Run the Helper smoke test',
    });
    await registry.invoke(MAKER_INVOKE.DSH_ACTIVITY_COMPLETE, {
      sessionId: 'task-1',
      activityId: 'todo-1',
    });
    await registry.invoke(MAKER_INVOKE.DSH_ACTIVITY_CANCEL, {
      sessionId: 'task-1',
      activityId: 'todo-2',
    });
    expect(service.createTodo).toHaveBeenCalledWith({
      cindySessionId: 'task-1',
      planActivityId: 'plan-1',
      label: 'Run the Helper smoke test',
    });
    expect(service.complete).toHaveBeenCalledWith({ cindySessionId: 'task-1', activityId: 'todo-1' });
    expect(service.cancel).toHaveBeenCalledWith({ cindySessionId: 'task-1', activityId: 'todo-2' });
  });

  it('rejects generic/raw activity shapes before service invocation', async () => {
    const registry = new IpcHarness();
    const service = control();
    registerDshActivityHandlers(registry, {
      assertTrustedCaller: vi.fn(),
      getControl: () => service,
    });

    await expect(
      registry.invoke(MAKER_INVOKE.DSH_PLAN_CREATE, {
        sessionId: 'task-1',
        label: 'Known local label',
        mutation: { type: 'transition', status: 'completed' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await expect(
      registry.invoke(MAKER_INVOKE.DSH_ACTIVITY_READ, {
        sessionId: 'task-1',
        nativeSessionId: 'must-not-cross',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(service.createPlan).not.toHaveBeenCalled();
    expect(service.read).not.toHaveBeenCalled();
  });

  it('keeps controller error classifications at the IPC boundary', async () => {
    const registry = new IpcHarness();
    const service = control();
    vi.mocked(service.complete).mockRejectedValue(
      new DshActivityControlError('stale', 'Refresh before retrying'),
    );
    registerDshActivityHandlers(registry, {
      assertTrustedCaller: vi.fn(),
      getControl: () => service,
    });
    await expect(
      registry.invoke(MAKER_INVOKE.DSH_ACTIVITY_COMPLETE, {
        sessionId: 'task-1',
        activityId: 'todo-1',
      }),
    ).rejects.toMatchObject({ code: 'STALE_DIFF' });
  });
});
