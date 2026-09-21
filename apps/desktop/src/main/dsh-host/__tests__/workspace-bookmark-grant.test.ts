import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  selectDshTaskWorkspaceBookmarkFromMain,
  selectDshWorkspaceAccessFromMain,
} from '../workspace-bookmark-grant.js';

const roots: string[] = [];
const PERSISTENT = Buffer.from('workspace-persistent-fixture').toString('base64');
const IMPLICIT = Buffer.from('workspace-implicit-fixture').toString('base64');

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'cindy-dsh-workspace-grant-'));
  roots.push(root);
  return realpathSync(root);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('DSH task workspace bookmark grant', () => {
  it('accepts only an explicit picker bookmark for the exact canonical task workspace', async () => {
    const cwd = workspace();
    const createImplicitBookmark = vi.fn(() => IMPLICIT);
    const savePersistentBookmark = vi.fn();
    await expect(
      selectDshTaskWorkspaceBookmarkFromMain({
        cindySessionId: 'task-a',
        cwd,
        picker: {
          showOpenDialog: vi.fn(async () => ({
            canceled: false,
            filePaths: [cwd],
            bookmarks: [PERSISTENT],
          })),
        },
        bridge: { createImplicitBookmark },
        isTaskCurrent: () => true,
        savePersistentBookmark,
      }),
    ).resolves.toEqual({ kind: 'dsh-task-workspace-implicit-bookmark', bookmark: IMPLICIT });
    expect(createImplicitBookmark).toHaveBeenCalledWith(PERSISTENT);
    expect(savePersistentBookmark).toHaveBeenCalledWith(cwd, PERSISTENT);
  });

  it('rejects a parent/sibling selection and an account/task boundary change', async () => {
    const cwd = workspace();
    const other = workspace();
    const picker = {
      showOpenDialog: vi.fn(async () => ({
        canceled: false,
        filePaths: [other],
        bookmarks: [PERSISTENT],
      })),
    };
    await expect(
      selectDshTaskWorkspaceBookmarkFromMain({
        cindySessionId: 'task-a',
        cwd,
        picker,
        bridge: { createImplicitBookmark: () => IMPLICIT },
        isTaskCurrent: () => true,
      }),
    ).rejects.toThrow('match this task workspace exactly');
    await expect(
      selectDshTaskWorkspaceBookmarkFromMain({
        cindySessionId: 'task-a',
        cwd,
        picker: {
          showOpenDialog: vi.fn(async () => ({
            canceled: false,
            filePaths: [cwd],
            bookmarks: [PERSISTENT],
          })),
        },
        bridge: { createImplicitBookmark: () => IMPLICIT },
        isTaskCurrent: () => false,
      }),
    ).rejects.toThrow('task changed');
  });

  it('uses the signed Main bridge only when a Global picker returns no bookmark', async () => {
    const cwd = workspace();
    const createPersistentBookmarkForPath = vi.fn(() => PERSISTENT);
    const createImplicitBookmark = vi.fn(() => IMPLICIT);
    await expect(
      selectDshTaskWorkspaceBookmarkFromMain({
        cindySessionId: 'task-global-picker',
        cwd,
        picker: { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [cwd] })) },
        bridge: { createPersistentBookmarkForPath, createImplicitBookmark },
        isTaskCurrent: () => true,
      }),
    ).resolves.toEqual({ kind: 'dsh-task-workspace-implicit-bookmark', bookmark: IMPLICIT });
    expect(createPersistentBookmarkForPath).toHaveBeenCalledWith(cwd);
    expect(createImplicitBookmark).toHaveBeenCalledWith(PERSISTENT);
  });

  it('does not turn a malformed picker bookmark array into a native fallback', async () => {
    const cwd = workspace();
    const createPersistentBookmarkForPath = vi.fn(() => PERSISTENT);
    await expect(
      selectDshTaskWorkspaceBookmarkFromMain({
        cindySessionId: 'task-malformed-picker',
        cwd,
        picker: {
          showOpenDialog: vi.fn(async () => ({
            canceled: false,
            filePaths: [cwd],
            bookmarks: ['a', 'b'],
          })),
        },
        bridge: { createPersistentBookmarkForPath, createImplicitBookmark: () => IMPLICIT },
        isTaskCurrent: () => true,
      }),
    ).rejects.toThrow('did not return one security-scoped directory bookmark');
    expect(createPersistentBookmarkForPath).not.toHaveBeenCalled();
  });

  it('saves a settings-selected workspace through the Main-owned store only', async () => {
    const selected = workspace();
    const getProjection = vi.fn(() => ({ status: 'default' as const, count: 0 }));
    const selectWorkspace = vi.fn(() => ({ status: 'configured' as const, count: 1 }));
    const store = {
      getProjection,
      selectWorkspace,
      readWorkspaceBookmark: vi.fn(),
      reset: vi.fn(),
    };

    await expect(
      selectDshWorkspaceAccessFromMain({
        accountId: 'account-a',
        picker: {
          showOpenDialog: vi.fn(async () => ({
            canceled: false,
            filePaths: [selected],
            bookmarks: [PERSISTENT],
          })),
        },
        bridge: { createImplicitBookmark: () => IMPLICIT },
        store,
      }),
    ).resolves.toEqual({ status: 'configured', count: 1 });
    expect(selectWorkspace).toHaveBeenCalledWith('account-a', selected, PERSISTENT);
    expect(getProjection).not.toHaveBeenCalled();
  });

  it('does not store anything when settings workspace selection is canceled', async () => {
    const getProjection = vi.fn(() => ({ status: 'configured' as const, count: 1 }));
    const selectWorkspace = vi.fn(() => ({ status: 'configured' as const, count: 2 }));
    const store = {
      getProjection,
      selectWorkspace,
      readWorkspaceBookmark: vi.fn(),
      reset: vi.fn(),
    };

    await expect(
      selectDshWorkspaceAccessFromMain({
        accountId: 'account-a',
        picker: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
        bridge: { createImplicitBookmark: () => IMPLICIT },
        store,
      }),
    ).resolves.toEqual({ status: 'configured', count: 1 });
    expect(selectWorkspace).not.toHaveBeenCalled();
    expect(getProjection).toHaveBeenCalledWith('account-a');
  });
});
