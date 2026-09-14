import { describe, expect, it, vi } from 'vitest';

import {
  createDshImplicitBookmarkHandoff,
  createDshWorkspaceBookmarkHandoff,
} from '../main-bookmark-bridge.js';

const PERSISTENT = Buffer.from('app-scoped-bookmark-fixture', 'utf8').toString('base64');
const IMPLICIT = Buffer.from('implicit-bookmark-fixture', 'utf8').toString('base64');

describe('DSH Main bookmark bridge boundary', () => {
  it('converts a persistent source bookmark into a validated one-shot descriptor value', () => {
    const createImplicitBookmark = vi.fn(() => IMPLICIT);
    const handoff = createDshImplicitBookmarkHandoff({
      persistentBookmark: PERSISTENT,
      bridge: { createImplicitBookmark },
    });

    expect(createImplicitBookmark).toHaveBeenCalledWith(PERSISTENT);
    expect(handoff).toEqual({ kind: 'dsh-existing-home-implicit-bookmark', bookmark: IMPLICIT });
    expect(Object.isFrozen(handoff)).toBe(true);
    expect(JSON.stringify(handoff)).not.toContain('/');
  });

  it('fails before spawn if the in-process bridge emits anything except a canonical bookmark', () => {
    expect(() => createDshImplicitBookmarkHandoff({
      persistentBookmark: PERSISTENT,
      bridge: { createImplicitBookmark: () => '/raw/path/must-not-cross' },
    })).toThrow('implicit bookmark handoff is invalid');
  });

  it('keeps a task workspace descriptor distinct from the existing-Home descriptor', () => {
    const handoff = createDshWorkspaceBookmarkHandoff({
      persistentBookmark: PERSISTENT,
      bridge: { createImplicitBookmark: () => IMPLICIT },
    });
    expect(handoff).toEqual({ kind: 'dsh-task-workspace-implicit-bookmark', bookmark: IMPLICIT });
    expect(JSON.stringify(handoff)).not.toContain('/');
  });
});
