// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DshWorkspaceAccessProjection } from '../../../../shared/dshWorkspaceAccess';
import { DshWorkspaceAccessSection } from '../DshWorkspaceAccessSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));

vi.mock('@/lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function installElectronApi(initial: DshWorkspaceAccessProjection) {
  let current = initial;
  const getDshWorkspaceAccess = vi.fn(async () => current);
  const selectDshWorkspaceAccess = vi.fn(async () => {
    current = { status: 'configured', count: 1 };
    return current;
  });
  const resetDshWorkspaceAccess = vi.fn(async () => {
    current = { status: 'default', count: 0 };
    return current;
  });
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    maker: { getDshWorkspaceAccess, selectDshWorkspaceAccess, resetDshWorkspaceAccess },
  };
  return { getDshWorkspaceAccess, selectDshWorkspaceAccess, resetDshWorkspaceAccess };
}

describe('DshWorkspaceAccessSection', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders status/count only and never exposes a directory path', async () => {
    installElectronApi({ status: 'configured', count: 2 });
    render(<DshWorkspaceAccessSection />);

    await waitFor(() => screen.getByText('settings.dshWorkspaceAccess.status.configured'));
    expect(screen.getByText('settings.dshWorkspaceAccess.savedCount:2')).toBeTruthy();
    expect(document.body.textContent).not.toContain('/Users/');
    expect(document.body.textContent).not.toContain('bookmark-');
  });

  it('uses fixed-purpose save and reset commands without directory arguments', async () => {
    const api = installElectronApi({ status: 'default', count: 0 });
    render(<DshWorkspaceAccessSection />);
    await waitFor(() => screen.getByText('settings.dshWorkspaceAccess.status.default'));

    fireEvent.click(screen.getByText('settings.dshWorkspaceAccess.choose'));
    await waitFor(() => {
      expect(api.selectDshWorkspaceAccess).toHaveBeenCalledTimes(1);
      expect(screen.getByText('settings.dshWorkspaceAccess.status.configured')).toBeTruthy();
    });
    expect(api.selectDshWorkspaceAccess).toHaveBeenCalledWith();

    fireEvent.click(screen.getByText('settings.dshWorkspaceAccess.reset'));
    await waitFor(() => {
      expect(api.resetDshWorkspaceAccess).toHaveBeenCalledTimes(1);
      expect(screen.getByText('settings.dshWorkspaceAccess.status.default')).toBeTruthy();
    });
    expect(api.resetDshWorkspaceAccess).toHaveBeenCalledWith();
  });
});
