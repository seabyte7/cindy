/** Narrow local IPC for display-safe DSH runtime configuration choices. */

import type {
  DshRuntimeConfigurationId,
  DshRuntimeConfigurationSnapshot,
} from '../../shared/dshRuntimeConfiguration.js';
import { throwIpcError } from '../utils/ipcValidate.js';
import { MAKER_INVOKE } from './channels.js';
import type { IpcHandlerRegistry } from './ipcHandlerRegistry.js';

const MAX_IDENTIFIER_LENGTH = 512;

export interface DshRuntimeConfigurationControlService {
  getRuntimeConfigurationForProduct(cindySessionId: string): Promise<DshRuntimeConfigurationSnapshot>;
  setRuntimeConfigurationForProduct(input: {
    cindySessionId: string;
    configId: DshRuntimeConfigurationId;
    choiceId: string;
  }): Promise<DshRuntimeConfigurationSnapshot>;
}

export interface DshRuntimeConfigurationHandlerDeps {
  assertTrustedCaller(event: unknown): void;
  getControl(): DshRuntimeConfigurationControlService;
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throwIpcError('INVALID_PARAMS', 'DSH runtime configuration input must be an object');
  }
  return value as Record<string, unknown>;
}

function hasOnlyKeys(input: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(input).every((key) => allowed.has(key));
}

function hasAsciiControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return code !== undefined && (code <= 0x1f || code === 0x7f);
  });
}

function requireIdentifier(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    value.trim() !== value ||
    hasAsciiControlCharacter(value)
  ) {
    throwIpcError('INVALID_PARAMS', `${name} is invalid`);
  }
  return value;
}

function requireConfigurationId(value: unknown): DshRuntimeConfigurationId {
  if (value === 'model' || value === 'reasoning_effort') return value;
  throwIpcError('INVALID_PARAMS', 'DSH runtime configuration control is invalid');
}

function unavailable(): never {
  return throwIpcError(
    'PRECONDITION_FAILED',
    'DSH runtime configuration is unavailable. Restart the DSH task and try again.',
  );
}

/**
 * The API is local-only: it accepts no provider, ACP value, runtime id, or
 * generic setting mutation, and is deliberately excluded from device-link.
 */
export function registerDshRuntimeConfigurationHandlers(
  registry: IpcHandlerRegistry,
  deps: DshRuntimeConfigurationHandlerDeps,
): void {
  registry.handle(MAKER_INVOKE.DSH_RUNTIME_CONFIGURATION_GET, async (event, rawInput: unknown) => {
    deps.assertTrustedCaller(event);
    const input = requireObject(rawInput);
    if (!hasOnlyKeys(input, ['sessionId'])) {
      throwIpcError('INVALID_PARAMS', 'Unexpected DSH runtime configuration read input');
    }
    const cindySessionId = requireIdentifier(input.sessionId, 'sessionId');
    try {
      return await deps.getControl().getRuntimeConfigurationForProduct(cindySessionId);
    } catch {
      return unavailable();
    }
  });

  registry.handle(MAKER_INVOKE.DSH_RUNTIME_CONFIGURATION_SET, async (event, rawInput: unknown) => {
    deps.assertTrustedCaller(event);
    const input = requireObject(rawInput);
    if (!hasOnlyKeys(input, ['sessionId', 'controlId', 'choiceId'])) {
      throwIpcError('INVALID_PARAMS', 'Unexpected DSH runtime configuration write input');
    }
    const cindySessionId = requireIdentifier(input.sessionId, 'sessionId');
    const configId = requireConfigurationId(input.controlId);
    const choiceId = requireIdentifier(input.choiceId, 'choiceId');
    try {
      return await deps.getControl().setRuntimeConfigurationForProduct({
        cindySessionId,
        configId,
        choiceId,
      });
    } catch {
      return unavailable();
    }
  });
}
