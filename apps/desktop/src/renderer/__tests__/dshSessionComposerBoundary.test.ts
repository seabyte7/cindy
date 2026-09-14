import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const sessionViewSource = readFileSync(
  resolve(__dirname, '..', 'features', 'cc-agent', 'CCAgentSessionView.tsx'),
  'utf8',
);

const chatInputSource = readFileSync(
  resolve(__dirname, '..', 'components', 'new-chat', 'ChatInput.tsx'),
  'utf8',
);

const newMakerDraftSource = readFileSync(
  resolve(__dirname, '..', 'features', 'cc-agent', 'NewMakerDraftRoute.tsx'),
  'utf8',
);

const makerIpcSource = readFileSync(
  resolve(__dirname, '..', '..', 'main', 'maker-ipc', 'register.ts'),
  'utf8',
);

const dshSessionSource = readFileSync(resolve(__dirname, '..', '..', 'shared', 'dshSession.ts'), 'utf8');

describe('DSH session composer boundary', () => {
  it('keeps the created session in the same managed, request-scoped permission mode as New Maker', () => {
    expect(sessionViewSource).toContain("const isDshSession = realAgentKind === 'dsh';");

    const composerStart = sessionViewSource.indexOf('<ChatInput');
    const composerBlock = sessionViewSource.slice(
      composerStart,
      sessionViewSource.indexOf('collaboration={', composerStart),
    );

    expect(composerStart).toBeGreaterThan(-1);
    expect(composerBlock).toContain("isDshSession\n                      ? 'dsh'");
    expect(composerBlock).toContain('planModeEnabled={isDshSession ? false : planModeEnabled}');
    expect(composerBlock).toContain('onPlanModeChange={isDshSession ? undefined : setPlanMode}');
    expect(composerBlock).toContain('fastMode={isDshSession ? false : fastMode}');
    expect(composerBlock).toContain('onFastModeChange={isDshSession ? undefined : setFastMode}');
    expect(composerBlock).toContain('onExtraDirsChange={isDshSession ? undefined : handleExtraDirsChange}');
    expect(composerBlock).toContain('!isDshSession && writableDirsChangeSupported');

    expect(chatInputSource).toContain("const isDshManagedRuntime = vendorKey === 'dsh';");
    expect(chatInputSource).toContain('data-testid="dsh-managed-runtime-badge"');
    expect(chatInputSource).toContain("title={t('newChat.dsh.managedRuntimeDetails')}");
    expect(chatInputSource).toContain("aria-label={t('newChat.dsh.managedRuntimeDetails')}");
    expect(chatInputSource).toContain('{!isDshManagedRuntime && (\n                  <PermissionSelector');
    expect(chatInputSource).not.toContain("const items = isDshManagedRuntime ? undefined");
    expect(chatInputSource).not.toContain("toast.warning(t('newChat.dsh.textOnlyInput'))");
  });

  it('keeps the local, same-task recovery boundary visible while creating a DSH task', () => {
    expect(newMakerDraftSource).toContain('{isDshDraft && (');
    expect(newMakerDraftSource).toContain('data-testid="dsh-managed-runtime-notice"');
    expect(newMakerDraftSource).toContain("t('newChat.dsh.managedRuntimeDetails')");
    expect(newMakerDraftSource).toContain('const dshAllowedAtTarget = !isRemoteProjectDraft && !effectiveDeviceLinkDeviceId;');
    expect(newMakerDraftSource).not.toContain("if (isDshDraft) {\n      return {\n        ...attachmentState");
  });

  it('creates a DSH task through the managed Main runtime instead of the generic local database path', () => {
    expect(newMakerDraftSource).toContain('const createManagedDshSession = useCallback(');
    expect(newMakerDraftSource).toContain("agentKind: 'dsh',");
    expect(newMakerDraftSource).toContain('model: DSH_MANAGED_RUNTIME_MODEL_ID,');
    expect(newMakerDraftSource).toContain("permissionMode: 'auto',");
    expect(newMakerDraftSource).toContain('await window.electronAPI.maker.createSession({');
    expect(newMakerDraftSource).toContain('const newSession = isDshDraft');
    expect(newMakerDraftSource).toContain('? await createManagedDshSession({');
    expect(newMakerDraftSource).toContain('worktreeDisabled={isRemoteProjectDraft || isDshDraft}');
  });

  it('does not send DSH’s internal runtime marker through the generic provider-model guard', () => {
    expect(dshSessionSource).toContain('export function isManagedDshRuntimeRoute(');
    expect(dshSessionSource).toContain("agentKind === 'dsh' && model === DSH_MANAGED_RUNTIME_MODEL_ID");
    expect(makerIpcSource).toContain('if (model && !isManagedDshRuntimeRoute(session.agentKind, model)) {');
    expect(makerIpcSource).toContain('!isManagedDshRuntimeRoute(o.agentKind, o.model)');
  });

  it('does not route a DSH prompt or transcription through the Codex auth gate', () => {
    expect(sessionViewSource).toContain('if (!remoteDeviceId && !isDshSession) {');
    expect(sessionViewSource).toContain('if (isDshSession) return true;');
  });

  it('admits a local DSH prompt to the shared input queue but keeps Device Link closed', () => {
    expect(makerIpcSource).toContain("msg.createOpts.agentKind !== 'dsh'");
    expect(makerIpcSource).toContain("msg.createOpts.agentKind === 'dsh' && isDeviceLinkInvoke()");
    expect(makerIpcSource).toContain('DSH queued input is only available on this Mac');
  });

  it('does not make unsupported reversible change capture a precondition of a DSH prompt', () => {
    const changeSetStart = makerIpcSource.indexOf('export async function beginTurnChangeSetAtDispatch');
    const changeSetBlock = makerIpcSource.slice(
      changeSetStart,
      makerIpcSource.indexOf('export interface RegisterMakerIpcOptions', changeSetStart),
    );
    expect(changeSetBlock).toContain("if (session.agentKind === 'dsh') {");
    expect(changeSetBlock).toContain('return;');
    expect(changeSetBlock).not.toContain('DSH turn-change capture is unavailable');
  });

  it('does not invent an unknown DSH context capacity', () => {
    const headerStart = sessionViewSource.indexOf('Right: Context capacity indicator');
    const headerBlock = sessionViewSource.slice(headerStart, headerStart + 2800);

    expect(headerStart).toBeGreaterThan(-1);
    expect(headerBlock).toContain('{!isDshSession && (\n                    <ContextCapacityRing');
  });
});
