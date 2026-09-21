import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { createDshWorkspaceAccessSettingsStore } from '../workspace-access-settings.js';

const BOOKMARK_A = Buffer.from('persistent-bookmark-a').toString('base64');
const BOOKMARK_B = Buffer.from('persistent-bookmark-b').toString('base64');

function createSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  };
}

describe('DshWorkspaceAccessSettingsStore', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('persists encrypted workspace grants per account and workspace', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'cindy-dsh-workspace-access-'));
    roots.push(userDataPath);
    const workspaceA = join(userDataPath, 'workspace-a');
    const workspaceB = join(userDataPath, 'workspace-b');
    mkdirSync(workspaceA);
    mkdirSync(workspaceB);
    const safeStorage = createSafeStorage();
    const store = createDshWorkspaceAccessSettingsStore({ userDataPath, safeStorage });

    expect(store.getProjection('account-a')).toEqual({ status: 'default', count: 0 });
    expect(store.selectWorkspace('account-a', workspaceA, BOOKMARK_A)).toEqual({
      status: 'configured',
      count: 1,
    });
    expect(store.selectWorkspace('account-a', workspaceB, BOOKMARK_B)).toEqual({
      status: 'configured',
      count: 2,
    });
    expect(store.getProjection('account-a')).toEqual({ status: 'configured', count: 2 });
    expect(store.readWorkspaceBookmark('account-a', workspaceA)).toBe(BOOKMARK_A);
    expect(store.readWorkspaceBookmark('account-a', workspaceB)).toBe(BOOKMARK_B);
    expect(store.readWorkspaceBookmark('account-b', workspaceA)).toBeNull();

    const index = readFileSync(join(userDataPath, 'dsh-workspace-access', 'index.json'), 'utf8');
    expect(index).not.toContain(workspaceA);
    expect(index).not.toContain(workspaceB);
    expect(index).not.toContain(BOOKMARK_A);
    expect(index).not.toContain(BOOKMARK_B);
  });

  it('replaces a workspace grant and clears only the selected account', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'cindy-dsh-workspace-access-'));
    roots.push(userDataPath);
    const workspace = join(userDataPath, 'workspace');
    mkdirSync(workspace);
    const safeStorage = createSafeStorage();
    const store = createDshWorkspaceAccessSettingsStore({ userDataPath, safeStorage });

    store.selectWorkspace('account-a', workspace, BOOKMARK_A);
    store.selectWorkspace('account-a', workspace, BOOKMARK_B);
    store.selectWorkspace('account-b', workspace, BOOKMARK_A);

    expect(store.readWorkspaceBookmark('account-a', workspace)).toBe(BOOKMARK_B);
    expect(store.reset('account-a')).toEqual({ status: 'default', count: 0 });
    expect(store.readWorkspaceBookmark('account-a', workspace)).toBeNull();
    expect(store.readWorkspaceBookmark('account-b', workspace)).toBe(BOOKMARK_A);
    expect(store.getProjection('account-b')).toEqual({ status: 'configured', count: 1 });
  });

  it('fails closed when safe storage becomes unavailable', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'cindy-dsh-workspace-access-'));
    roots.push(userDataPath);
    const workspace = join(userDataPath, 'workspace');
    mkdirSync(workspace);
    const store = createDshWorkspaceAccessSettingsStore({
      userDataPath,
      safeStorage: createSafeStorage(),
    });
    store.selectWorkspace('account-a', workspace, BOOKMARK_A);

    const unavailable = createDshWorkspaceAccessSettingsStore({
      userDataPath,
      safeStorage: createSafeStorage(false),
    });
    expect(unavailable.getProjection('account-a')).toEqual({ status: 'unavailable', count: 0 });
    expect(unavailable.readWorkspaceBookmark('account-a', workspace)).toBeNull();
  });
});
