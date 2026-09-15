import { describe, expect, it } from 'vitest';

import { projectDshRuntimeStatus } from '../runtime-status.js';

describe('DSH runtime status projection', () => {
  it('does not turn unverified source wiring into a tool-ready claim', () => {
    const status = projectDshRuntimeStatus({
      revision: 4,
      provider: { available: true, providerName: 'DeepSeek' },
      registration: 'task-factory-ready',
      activeTaskCount: 0,
    });

    expect(status).toEqual({
      revision: 4,
      configuration: { status: 'ready', providerName: 'DeepSeek' },
      registration: 'task-factory-ready',
      activeTaskCount: 0,
      evidence: {
        modelConnection: 'not-verified-in-this-app',
        commands: 'not-verified-in-this-app',
        fileTools: 'not-verified-in-this-app',
        attachments: 'not-verified-in-this-app',
        permissions: 'not-verified-in-this-app',
      },
      actions: {
        canRetryRegistration: true,
        mustCloseActiveTasksBeforeReplacement: false,
      },
    });
  });

  it('shows a live-task replacement as pending instead of silently stopping it', () => {
    const status = projectDshRuntimeStatus({
      revision: 5,
      provider: { available: false, reason: 'missing-api-key' },
      registration: 'reconfiguration-pending',
      activeTaskCount: 2,
    });

    expect(status.configuration).toEqual({ status: 'unavailable', reason: 'missing-api-key' });
    expect(status.actions.mustCloseActiveTasksBeforeReplacement).toBe(true);
  });
});
