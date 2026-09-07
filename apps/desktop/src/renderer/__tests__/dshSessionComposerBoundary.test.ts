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

describe('DSH session composer boundary', () => {
  it('keeps the created session in the same managed text-only mode as New Maker', () => {
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
  });

  it('keeps the local, text-only, same-task recovery boundary visible while creating a DSH task', () => {
    expect(newMakerDraftSource).toContain('{isDshDraft && (');
    expect(newMakerDraftSource).toContain('data-testid="dsh-managed-runtime-notice"');
    expect(newMakerDraftSource).toContain("t('newChat.dsh.managedRuntimeDetails')");
    expect(newMakerDraftSource).toContain('const dshAllowedAtTarget = !isRemoteProjectDraft && !effectiveDeviceLinkDeviceId;');
  });

  it('does not route a DSH prompt or transcription through the Codex auth gate', () => {
    expect(sessionViewSource).toContain('if (!remoteDeviceId && !isDshSession) {');
    expect(sessionViewSource).toContain('if (isDshSession) return true;');
  });

  it('does not invent an unknown DSH context capacity', () => {
    const headerStart = sessionViewSource.indexOf('Right: Context capacity indicator');
    const headerBlock = sessionViewSource.slice(headerStart, headerStart + 2800);

    expect(headerStart).toBeGreaterThan(-1);
    expect(headerBlock).toContain('{!isDshSession && (\n                    <ContextCapacityRing');
  });
});
