import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { MacosSupervisedDshBridge } from '../macos-supervised-bridge.js';
import { createDshSessionCwdAdmission } from '../session-cwd-admission.js';
import {
  createDshTaskBridgeRouter,
  DSH_TASK_BRIDGE_ROUTER_SCOPE_ID,
} from '../task-bridge-router.js';

const WORKSPACE = Object.freeze({
  kind: 'dsh-task-workspace-implicit-bookmark' as const,
  bookmark: Buffer.from('task-workspace-fixture').toString('base64'),
});

function hostFor(sessionId: string): MacosSupervisedDshBridge {
  const internal = {
    contractVersion: 1 as const,
    operation: 'create' as const,
    receiptId: `receipt-${sessionId}`,
    acceptedAt: '2026-09-11T00:00:00.000Z',
    cindySessionId: sessionId,
    scopeId: `dsh-native-${sessionId}`,
    bridgeSessionKey: `native-key-${sessionId}`,
  };
  const bridge = {
    create: vi.fn(async () => internal),
    resumeForAdapter: vi.fn(async () => ({ ...internal, operation: 'resume' as const })),
    followCommitted: vi.fn(() => () => undefined),
    bindPermissionResolver: vi.fn(() => () => undefined),
    prompt: vi.fn(async () => ({
      contractVersion: 1 as const,
      operation: 'prompt' as const,
      receiptId: `prompt-${sessionId}`,
      acceptedAt: '2026-09-11T00:00:00.000Z',
      stopReason: 'end_turn' as const,
    })),
    cancel: vi.fn(async () => ({ ...internal, operation: 'cancel' as const })),
    close: vi.fn(async () => ({ ...internal, operation: 'close' as const })),
    getRuntimeConfigurationForProduct: vi.fn(() => ({ controls: [] })),
    setRuntimeConfigurationForProduct: vi.fn(async () => ({ controls: [] })),
  };
  return {
    bridge: bridge as never,
    scopeId: `dsh-native-${sessionId}`,
    binaryPath: '/fixed/supervisor',
    runtimeIdentity: {} as never,
    adapterAdmission: { committedFollowProjection: true, promptReceiptLedger: true },
    close: vi.fn(async () => undefined),
  };
}

describe('DSH task bridge router', () => {
  // Use the production admission implementation and direct callback assignment:
  // independent mocks previously let session-id/cwd argument inversion pass.
  const cwd = path.resolve('dsh-test-workspace');
  const otherCwd = path.resolve('dsh-test-other-workspace');
  const cindySessionId = 'test-task';

  function fixture() {
    const admission = createDshSessionCwdAdmission();
    const host = hostFor(cindySessionId);
    const startTaskBridge = vi.fn(async () => host);
    const onStartupFailure = vi.fn();
    const router = createDshTaskBridgeRouter({
      claimWorkspaceBookmark: admission.consumeWorkspaceBookmark,
      startTaskBridge,
      onStartupFailure,
    });
    return { admission, host, startTaskBridge, onStartupFailure, router };
  }

  it.each(['create', 'resumeForAdapter'] as const)('%s consumes the exact authorized pair before starting its host', async (operation) => {
    const f = fixture();
    f.admission.reserve(cindySessionId, cwd, WORKSPACE);
    const request = { cindySessionId, cwd, sessionInstanceId: 'instance-a' };
    const receipt = await f.router[operation](request);

    expect(f.startTaskBridge).toHaveBeenCalledExactlyOnceWith({ cindySessionId, cwd, workspaceBookmark: WORKSPACE });
    expect(f.host.bridge[operation]).toHaveBeenCalledExactlyOnceWith(request);
    expect(receipt).toMatchObject({ cindySessionId, scopeId: DSH_TASK_BRIDGE_ROUTER_SCOPE_ID });
    expect(() => f.admission.consumeWorkspaceBookmark({ cindySessionId, cwd })).toThrow('not authorized');
    expect(f.onStartupFailure).not.toHaveBeenCalled();
    await f.router.close(receipt);
    // Closing a task does not restore an already consumed directory grant.
    await expect(f.router[operation](request)).rejects.toThrow('not authorized');
    expect(f.startTaskBridge).toHaveBeenCalledTimes(1);
  });

  it.each(['create', 'resumeForAdapter'] as const)('%s rejects missing, revoked, foreign-task and mismatched-directory grants before spawn', async (operation) => {
    const f = fixture();
    await expect(f.router[operation]({ cindySessionId, cwd })).rejects.toThrow('not authorized');
    f.admission.reserve(cindySessionId, cwd, WORKSPACE);
    f.admission.clearAll();
    await expect(f.router[operation]({ cindySessionId, cwd })).rejects.toThrow('not authorized');

    f.admission.reserve(cindySessionId, cwd, WORKSPACE);
    await expect(f.router[operation]({ cindySessionId: 'foreign-task', cwd })).rejects.toThrow('not authorized');
    await expect(f.router[operation]({ cindySessionId, cwd: otherCwd })).rejects.toThrow('not authorized');
    // A same-task mismatch revokes that grant, not merely the bad request.
    await expect(f.router[operation]({ cindySessionId, cwd })).rejects.toThrow('not authorized');
    expect(f.startTaskBridge).not.toHaveBeenCalled();
    expect(f.onStartupFailure).toHaveBeenLastCalledWith({ cindySessionId, stage: 'workspace-admission' });
  });

  it('requires fresh authorization after host startup fails and only logs an owned stage', async () => {
    const f = fixture();
    const sensitiveError = new Error(`fixture-secret ${cwd} ${WORKSPACE.bookmark}`);
    f.admission.reserve(cindySessionId, cwd, WORKSPACE);
    f.startTaskBridge.mockRejectedValueOnce(sensitiveError);
    await expect(f.router.create({ cindySessionId, cwd })).rejects.toBe(sensitiveError);
    expect(f.onStartupFailure).toHaveBeenCalledExactlyOnceWith({ cindySessionId, stage: 'host-start' });
    expect(JSON.stringify(f.onStartupFailure.mock.calls)).not.toContain('fixture-secret');
    expect(JSON.stringify(f.onStartupFailure.mock.calls)).not.toContain(cwd);
    expect(JSON.stringify(f.onStartupFailure.mock.calls)).not.toContain(WORKSPACE.bookmark);
    await expect(f.router.create({ cindySessionId, cwd })).rejects.toThrow('not authorized');
    expect(f.startTaskBridge).toHaveBeenCalledTimes(1);
    f.admission.reserve(cindySessionId, cwd, WORKSPACE);
    const receipt = await f.router.create({ cindySessionId, cwd });
    await f.router.close(receipt);
  });

  it.each(['create', 'resumeForAdapter'] as const)('%s closes the started host on native failure without publishing authority', async (operation) => {
    const f = fixture();
    f.admission.reserve(cindySessionId, cwd, WORKSPACE);
    vi.mocked(f.host.bridge[operation]).mockRejectedValueOnce(new Error('fixture-native-secret'));
    // Even a broken logger must not bypass host cleanup or mask the original failure.
    f.onStartupFailure.mockImplementationOnce(() => { throw new Error('fixture-logger-failure'); });
    await expect(f.router[operation]({ cindySessionId, cwd })).rejects.toThrow('fixture-native-secret');
    expect(f.onStartupFailure).toHaveBeenCalledExactlyOnceWith({
      cindySessionId, stage: operation === 'create' ? 'native-create' : 'native-resume',
    });
    expect(f.host.close).toHaveBeenCalledTimes(1);
    expect(f.router.getRuntimeConfigurationForProduct(cindySessionId)).toEqual({ controls: [] });
    await expect(f.router[operation]({ cindySessionId, cwd })).rejects.toThrow('not authorized');
    expect(f.startTaskBridge).toHaveBeenCalledTimes(1);
  });

  it('starts one host per task and never lets an external task key address another host', async () => {
    const first = hostFor('task-a');
    const second = hostFor('task-b');
    const starts: string[] = [];
    const router = createDshTaskBridgeRouter({
      claimWorkspaceBookmark: vi.fn(() => WORKSPACE),
      startTaskBridge: vi.fn(async ({ cindySessionId }) => {
        starts.push(cindySessionId);
        return cindySessionId === 'task-a' ? first : second;
      }),
    });

    const taskA = await router.create({ cindySessionId: 'task-a', cwd: '/workspace/a' });
    const taskB = await router.create({ cindySessionId: 'task-b', cwd: '/workspace/b' });

    expect(starts).toEqual(['task-a', 'task-b']);
    expect(taskA.scopeId).toBe(DSH_TASK_BRIDGE_ROUTER_SCOPE_ID);
    await expect(router.prompt({ ...taskA, content: [{ type: 'text', text: 'A' }] })).resolves.toMatchObject({
      operation: 'prompt',
    });
    await expect(router.prompt({ ...taskA, bridgeSessionKey: taskB.bridgeSessionKey, content: [{ type: 'text', text: 'bad' }] }))
      .rejects.toThrow('authority is unavailable');

    await router.close(taskA);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();
  });
});
