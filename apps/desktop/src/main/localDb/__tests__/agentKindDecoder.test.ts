import { describe, expect, it } from 'vitest';

import { messageToCamel, sessionCreateToRow, sessionToCamel, type SessionRowWithCount } from '../mapper.js';

function sessionRow(agentKind: string): SessionRowWithCount {
  return {
    id: 'session-dsh',
    title: 'DSH task',
    workingDir: '/repo',
    workspaceKind: 'project',
    worktreePath: null,
    model: 'dsh-default',
    providerId: null,
    effort: 'high',
    permissionMode: 'ask',
    status: 'active',
    sdkSessionId: null,
    totalTokenUsage: 0,
    totalCostUsd: 0,
    totalCostAmount: 0,
    totalCostCurrency: null,
    totalCostIsApproximate: false,
    contextTokens: 0,
    contextWindow: 0,
    fastMode: false,
    planModeEnabled: false,
    clearedAt: null,
    pinnedAt: null,
    userSendAt: null,
    agentKind,
    source: 'desktop',
    orcaRole: null,
    parentSessionId: null,
    forkedAtMessageId: null,
    usedProjectContext: false,
    extraDirs: '[]',
    writableDirs: '[]',
    remoteHostId: null,
    activeTurnStartedAt: null,
    lastTurnEndedAt: null,
    listPreview: null,
    listPreviewRole: null,
    listMessageCount: null,
    summary: null,
    createdAt: 1,
    updatedAt: 1,
    messageCount: 0,
  } as SessionRowWithCount;
}

describe('local DB agent-kind decoder', () => {
  it('preserves dsh in session and message projections', () => {
    expect(sessionToCamel(sessionRow('dsh')).agentKind).toBe('dsh');
    expect(messageToCamel({
      id: 'message-dsh',
      clientId: 'client-dsh',
      sessionId: 'session-dsh',
      role: 'assistant',
      content: 'ready',
      toolUseId: null,
      agentMeta: null,
      agentKind: 'dsh',
      createdAt: 1,
      rewindAt: null,
    } as Parameters<typeof messageToCamel>[0]).agentKind).toBe('dsh');
    expect(sessionCreateToRow('new-dsh', { agentKind: 'dsh' }, 1).agentKind).toBe('dsh');
  });

  it('rejects an explicit unknown persisted agent instead of presenting it as Claude', () => {
    expect(() => sessionToCamel(sessionRow('future-agent'))).toThrow('future-agent');
    expect(() => messageToCamel({
      id: 'message-future',
      clientId: 'client-future',
      sessionId: 'session-future',
      role: 'assistant',
      content: 'ready',
      toolUseId: null,
      agentMeta: null,
      agentKind: 'future-agent',
      createdAt: 1,
      rewindAt: null,
    } as Parameters<typeof messageToCamel>[0])).toThrow('future-agent');
  });
});
