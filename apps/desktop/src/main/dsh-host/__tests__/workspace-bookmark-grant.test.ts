import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { selectDshTaskWorkspaceBookmarkFromMain } from '../workspace-bookmark-grant.js';

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
    await expect(selectDshTaskWorkspaceBookmarkFromMain({
      cindySessionId: 'task-a',
      cwd,
      picker: { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [cwd], bookmarks: [PERSISTENT] })) },
      bridge: { createImplicitBookmark },
      isTaskCurrent: () => true,
    })).resolves.toEqual({ kind: 'dsh-task-workspace-implicit-bookmark', bookmark: IMPLICIT });
    expect(createImplicitBookmark).toHaveBeenCalledWith(PERSISTENT);
  });

  it('rejects a parent/sibling selection and an account/task boundary change', async () => {
    const cwd = workspace();
    const other = workspace();
    const picker = { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [other], bookmarks: [PERSISTENT] })) };
    await expect(selectDshTaskWorkspaceBookmarkFromMain({
      cindySessionId: 'task-a', cwd, picker,
      bridge: { createImplicitBookmark: () => IMPLICIT }, isTaskCurrent: () => true,
    })).rejects.toThrow('match this task workspace exactly');
    await expect(selectDshTaskWorkspaceBookmarkFromMain({
      cindySessionId: 'task-a', cwd,
      picker: { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [cwd], bookmarks: [PERSISTENT] })) },
      bridge: { createImplicitBookmark: () => IMPLICIT }, isTaskCurrent: () => false,
    })).rejects.toThrow('task changed');
  });

  it('uses the signed Main bridge only when a Global picker returns no bookmark', async () => {
    const cwd = workspace();
    const createPersistentBookmarkForPath = vi.fn(() => PERSISTENT);
    const createImplicitBookmark = vi.fn(() => IMPLICIT);
    await expect(selectDshTaskWorkspaceBookmarkFromMain({
      cindySessionId: 'task-global-picker', cwd,
      picker: { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [cwd] })) },
      bridge: { createPersistentBookmarkForPath, createImplicitBookmark }, isTaskCurrent: () => true,
    })).resolves.toEqual({ kind: 'dsh-task-workspace-implicit-bookmark', bookmark: IMPLICIT });
    expect(createPersistentBookmarkForPath).toHaveBeenCalledWith(cwd);
    expect(createImplicitBookmark).toHaveBeenCalledWith(PERSISTENT);
  });

  it('does not turn a malformed picker bookmark array into a native fallback', async () => {
    const cwd = workspace();
    const createPersistentBookmarkForPath = vi.fn(() => PERSISTENT);
    await expect(selectDshTaskWorkspaceBookmarkFromMain({
      cindySessionId: 'task-malformed-picker', cwd,
      picker: { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [cwd], bookmarks: ['a', 'b'] })) },
      bridge: { createPersistentBookmarkForPath, createImplicitBookmark: () => IMPLICIT },
      isTaskCurrent: () => true,
    })).rejects.toThrow('did not return one security-scoped directory bookmark');
    expect(createPersistentBookmarkForPath).not.toHaveBeenCalled();
  });
});
