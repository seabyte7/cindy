/** Narrow local IPC for display-safe DSH registration status and retry. */

import type { DshRuntimeStatus } from '../../shared/dshRuntimeStatus.js';
import { throwIpcError } from '../utils/ipcValidate.js';
import { MAKER_INVOKE } from './channels.js';
import type { IpcHandlerRegistry } from './ipcHandlerRegistry.js';

export interface DshRuntimeStatusService {
  get(): Promise<DshRuntimeStatus>;
  retry(): Promise<DshRuntimeStatus>;
}

export interface DshRuntimeStatusHandlerDeps {
  assertTrustedCaller(event: unknown): void;
  getService(): DshRuntimeStatusService;
}

function assertNoInput(value: unknown): void {
  if (value !== undefined && value !== null) {
    throwIpcError('INVALID_PARAMS', 'DSH runtime status does not accept input');
  }
}

/** Local-only, intentionally excluded from device-link and generic provider probes. */
export function registerDshRuntimeStatusHandlers(
  registry: IpcHandlerRegistry,
  deps: DshRuntimeStatusHandlerDeps,
): void {
  registry.handle(MAKER_INVOKE.DSH_RUNTIME_STATUS_GET, async (event, rawInput?: unknown) => {
    deps.assertTrustedCaller(event);
    assertNoInput(rawInput);
    try {
      return await deps.getService().get();
    } catch {
      throwIpcError('INTERNAL', 'DSH runtime status is unavailable');
    }
  });

  registry.handle(MAKER_INVOKE.DSH_RUNTIME_STATUS_RETRY, async (event, rawInput?: unknown) => {
    deps.assertTrustedCaller(event);
    assertNoInput(rawInput);
    try {
      return await deps.getService().retry();
    } catch {
      throwIpcError('INTERNAL', 'DSH runtime retry failed');
    }
  });
}
