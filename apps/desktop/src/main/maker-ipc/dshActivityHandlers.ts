/** Narrow, local-only IPC for Cindy-owned DSH plans and todos. */

import type {
  DshActivityMutationResult,
  DshActivityReadResult,
} from '../../shared/dshActivity.js';
import { throwIpcError } from '../utils/ipcValidate.js';
import {
  DshActivityControlError,
  type DshActivityControlService,
} from '../maker-host/dsh-activity-control.js';
import { MAKER_INVOKE } from './channels.js';
import type { IpcHandlerRegistry } from './ipcHandlerRegistry.js';

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_LABEL_LENGTH = 240;

export interface DshActivityHandlerDeps {
  assertTrustedCaller(event: unknown): void;
  getControl(): DshActivityControlService;
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throwIpcError('INVALID_PARAMS', 'DSH activity input must be an object');
  }
  return value as Record<string, unknown>;
}

function hasOnlyKeys(input: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(input).every((key) => allowed.has(key));
}

function requireIdentifier(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throwIpcError('INVALID_PARAMS', `${name} is invalid`);
  }
  return value;
}

function requireLabel(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_LABEL_LENGTH ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throwIpcError('INVALID_PARAMS', 'label must be 1..240 normalized characters');
  }
  return value;
}

function mapError(error: unknown): never {
  if (error instanceof DshActivityControlError) {
    if (error.code === 'not-found') throwIpcError('NOT_FOUND', error.message);
    if (error.code === 'stale') throwIpcError('STALE_DIFF', error.message);
    if (error.code === 'invalid') throwIpcError('INVALID_PARAMS', error.message);
    throwIpcError('PRECONDITION_FAILED', error.message);
  }
  throw error;
}

async function execute<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return mapError(error);
  }
}

/**
 * No device-link or WebView path is admitted. The DSH launch surface remains
 * local macOS only, and this IPC exposes neither native commands nor generic
 * activity reducer operations.
 */
export function registerDshActivityHandlers(
  registry: IpcHandlerRegistry,
  deps: DshActivityHandlerDeps,
): void {
  registry.handle(MAKER_INVOKE.DSH_ACTIVITY_READ, async (event, rawInput: unknown) => {
    deps.assertTrustedCaller(event);
    const input = requireObject(rawInput);
    if (!hasOnlyKeys(input, ['sessionId'])) {
      throwIpcError('INVALID_PARAMS', 'Unexpected DSH activity read input');
    }
    const sessionId = requireIdentifier(input.sessionId, 'sessionId');
    return await execute<DshActivityReadResult>(() =>
      deps.getControl().read({ cindySessionId: sessionId }),
    );
  });

  registry.handle(MAKER_INVOKE.DSH_PLAN_CREATE, async (event, rawInput: unknown) => {
    deps.assertTrustedCaller(event);
    const input = requireObject(rawInput);
    if (!hasOnlyKeys(input, ['sessionId', 'label'])) {
      throwIpcError('INVALID_PARAMS', 'Unexpected DSH plan input');
    }
    const sessionId = requireIdentifier(input.sessionId, 'sessionId');
    const label = requireLabel(input.label);
    return await execute<DshActivityMutationResult>(() =>
      deps.getControl().createPlan({ cindySessionId: sessionId, label }),
    );
  });

  registry.handle(MAKER_INVOKE.DSH_TODO_CREATE, async (event, rawInput: unknown) => {
    deps.assertTrustedCaller(event);
    const input = requireObject(rawInput);
    if (!hasOnlyKeys(input, ['sessionId', 'planActivityId', 'label'])) {
      throwIpcError('INVALID_PARAMS', 'Unexpected DSH todo input');
    }
    const sessionId = requireIdentifier(input.sessionId, 'sessionId');
    const planActivityId = requireIdentifier(input.planActivityId, 'planActivityId');
    const label = requireLabel(input.label);
    return await execute<DshActivityMutationResult>(() =>
      deps.getControl().createTodo({ cindySessionId: sessionId, planActivityId, label }),
    );
  });

  for (const [channel, operation] of [
    [MAKER_INVOKE.DSH_ACTIVITY_COMPLETE, 'complete'],
    [MAKER_INVOKE.DSH_ACTIVITY_CANCEL, 'cancel'],
  ] as const) {
    registry.handle(channel, async (event, rawInput: unknown) => {
      deps.assertTrustedCaller(event);
      const input = requireObject(rawInput);
      if (!hasOnlyKeys(input, ['sessionId', 'activityId'])) {
        throwIpcError('INVALID_PARAMS', 'Unexpected DSH activity control input');
      }
      const sessionId = requireIdentifier(input.sessionId, 'sessionId');
      const activityId = requireIdentifier(input.activityId, 'activityId');
      return await execute<DshActivityMutationResult>(() =>
        deps.getControl()[operation]({ cindySessionId: sessionId, activityId }),
      );
    });
  }
}
