import { describe, expect, it, vi } from 'vitest';

import type { DshExistingHomeSettingsStore } from '../existing-home-settings.js';
import { resolveDshExistingHomeLaunch } from '../existing-home-launch.js';

const PERSISTENT = Buffer.from('persistent-existing-home-fixture').toString('base64');
const IMPLICIT = Buffer.from('implicit-existing-home-fixture').toString('base64');

function store(selection: ReturnType<DshExistingHomeSettingsStore['readLaunchSelection']>) {
  return {
    readLaunchSelection: vi.fn(() => selection),
  } as unknown as DshExistingHomeSettingsStore;
}

describe('DSH existing Home launch authorization', () => {
  it('keeps the default managed selection free of bookmark conversion', () => {
    const settings = store({ mode: 'cindy-managed' });
    const createImplicitBookmark = vi.fn();
    const launch = resolveDshExistingHomeLaunch({
      accountId: 'account-a',
      store: settings,
      createImplicitBookmark,
    });

    expect(launch.homeMode).toBe('cindy-managed');
    expect(launch.implicitHomeBookmark).toBeUndefined();
    launch.assertStillCurrent();
    expect(createImplicitBookmark).not.toHaveBeenCalled();
  });

  it('creates a one-shot handoff and retains only a digest for future invalidation', () => {
    const settings = store({ mode: 'existing-dsh-home', bookmark: PERSISTENT });
    const createImplicitBookmark = vi.fn(() => ({
      kind: 'dsh-existing-home-implicit-bookmark' as const,
      bookmark: IMPLICIT,
    }));
    const launch = resolveDshExistingHomeLaunch({
      accountId: 'account-a',
      store: settings,
      createImplicitBookmark,
    });

    expect(createImplicitBookmark).toHaveBeenCalledWith(PERSISTENT);
    expect(launch).toMatchObject({
      homeMode: 'existing-dsh-home',
      implicitHomeBookmark: { kind: 'dsh-existing-home-implicit-bookmark', bookmark: IMPLICIT },
    });
    expect(JSON.stringify(launch)).not.toContain(PERSISTENT);
    launch.assertStillCurrent();
  });

  it('fails closed for a new operation after a selected Home is replaced or reset', () => {
    let current: ReturnType<DshExistingHomeSettingsStore['readLaunchSelection']> = {
      mode: 'existing-dsh-home',
      bookmark: PERSISTENT,
    };
    const settings = {
      readLaunchSelection: vi.fn(() => current),
    } as unknown as DshExistingHomeSettingsStore;
    const launch = resolveDshExistingHomeLaunch({
      accountId: 'account-a',
      store: settings,
      createImplicitBookmark: () => ({
        kind: 'dsh-existing-home-implicit-bookmark',
        bookmark: IMPLICIT,
      }),
    });

    current = { mode: 'cindy-managed' };
    expect(() => launch.assertStillCurrent()).toThrow('Home selection is no longer current');
  });
});
