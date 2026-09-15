// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DshExistingHomeProjection } from '../../../../shared/dshExistingHome';
import { DshExistingHomeSection } from '../DshExistingHomeSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function installElectronApi(initial: DshExistingHomeProjection) {
  let current = initial;
  const getDshExistingHome = vi.fn(async () => current);
  const selectDshExistingHome = vi.fn(async () => {
    current = { mode: 'existing-dsh-home', status: 'configured' };
    return current;
  });
  const resetDshExistingHome = vi.fn(async () => {
    current = { mode: 'cindy-managed', status: 'default' };
    return current;
  });
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    maker: { getDshExistingHome, selectDshExistingHome, resetDshExistingHome },
  };
  return { getDshExistingHome, selectDshExistingHome, resetDshExistingHome };
}

describe('DshExistingHomeSection', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('shows the managed default without rendering a local pathname', async () => {
    installElectronApi({ mode: 'cindy-managed', status: 'default' });
    render(<DshExistingHomeSection />);

    await waitFor(() => expect(screen.getByText('settings.dshExistingHome.title')).toBeTruthy());
    expect(screen.getByText('settings.dshExistingHome.status.cindyManaged')).toBeTruthy();
    expect(document.body.textContent).not.toContain('/Users/');
    expect(
      screen
        .getByRole('button', { name: 'settings.dshExistingHome.useManaged' })
        .hasAttribute('disabled'),
    ).toBe(true);
  });

  it('uses fixed-purpose selection and reset commands without directory arguments', async () => {
    const api = installElectronApi({ mode: 'cindy-managed', status: 'default' });
    render(<DshExistingHomeSection />);
    await waitFor(() => screen.getByText('settings.dshExistingHome.status.cindyManaged'));

    fireEvent.click(screen.getByText('settings.dshExistingHome.choose'));
    await waitFor(() => {
      expect(api.selectDshExistingHome).toHaveBeenCalledTimes(1);
      expect(screen.getByText('settings.dshExistingHome.status.configured')).toBeTruthy();
    });
    expect(api.selectDshExistingHome).toHaveBeenCalledWith();

    fireEvent.click(screen.getByRole('button', { name: 'settings.dshExistingHome.useManaged' }));
    await waitFor(() => {
      expect(api.resetDshExistingHome).toHaveBeenCalledTimes(1);
      expect(screen.getByText('settings.dshExistingHome.status.cindyManaged')).toBeTruthy();
    });
    expect(api.resetDshExistingHome).toHaveBeenCalledWith();
  });
});
