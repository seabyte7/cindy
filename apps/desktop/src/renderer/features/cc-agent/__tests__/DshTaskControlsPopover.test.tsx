// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { DshActivityViewSnapshot } from '../../../../shared/dshActivity';
import type { DshRuntimeConfigurationSnapshot } from '../../../../shared/dshRuntimeConfiguration';
import { DshTaskControlsPopover } from '../DshTaskControlsPopover';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const runtimeConfiguration: DshRuntimeConfigurationSnapshot = {
  controls: [
    {
      id: 'model',
      currentChoiceId: 'dshcfg_model_a',
      choices: [{ id: 'dshcfg_model_a', label: 'Model A' }],
    },
  ],
};

const localActivity: DshActivityViewSnapshot = {
  sequence: 1,
  activities: [
    {
      activityId: 'session-root',
      parentActivityId: null,
      kind: 'session',
      status: 'running',
      summary: 'running',
      allowedActions: ['observe', 'cancel', 'close'],
      revision: 1,
    },
  ],
};

function makerApi() {
  return {
    getDshRuntimeConfiguration: vi.fn(async () => runtimeConfiguration),
    setDshRuntimeConfiguration: vi.fn(async () => runtimeConfiguration),
    readDshActivity: vi.fn(async () => ({ snapshot: localActivity })),
    createDshPlan: vi.fn(async () => ({ snapshot: localActivity })),
    createDshTodo: vi.fn(async () => ({ snapshot: localActivity })),
    completeDshActivity: vi.fn(async () => ({ snapshot: localActivity })),
    cancelDshActivity: vi.fn(async () => ({ snapshot: localActivity })),
  };
}

afterEach(() => {
  cleanup();
  delete (window as Partial<Window>).electronAPI;
});

describe('DshTaskControlsPopover', () => {
  it('keeps DSH task controls out of the default conversation surface until the user opens them', async () => {
    const maker = makerApi();
    (window as unknown as { electronAPI: unknown }).electronAPI = { maker };

    render(<DshTaskControlsPopover sessionId="task-1" runtimeConfigurationDisabled={false} />);

    expect(screen.getByRole('button', { name: 'ccAgent.dshTaskControls.ariaLabel' })).toBeTruthy();
    expect(maker.getDshRuntimeConfiguration).not.toHaveBeenCalled();
    expect(maker.readDshActivity).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'ccAgent.dshTaskControls.ariaLabel' }));
    expect(await screen.findByText('ccAgent.dshRuntimeConfiguration.title')).toBeTruthy();
    expect(await screen.findByText('ccAgent.dshActivity.title')).toBeTruthy();
    await waitFor(() => expect(maker.getDshRuntimeConfiguration).toHaveBeenCalledWith('task-1'));
    await waitFor(() => expect(maker.readDshActivity).toHaveBeenCalledWith('task-1'));
  });

  it('keeps the local checklist available while a turn runs but does not read or show mutable runtime settings', async () => {
    const maker = makerApi();
    (window as unknown as { electronAPI: unknown }).electronAPI = { maker };

    render(<DshTaskControlsPopover sessionId="task-1" runtimeConfigurationDisabled />);

    fireEvent.click(screen.getByRole('button', { name: 'ccAgent.dshTaskControls.ariaLabel' }));
    expect(await screen.findByText('ccAgent.dshActivity.title')).toBeTruthy();
    expect(screen.queryByText('ccAgent.dshRuntimeConfiguration.title')).toBeNull();
    await waitFor(() => expect(maker.readDshActivity).toHaveBeenCalledWith('task-1'));
    expect(maker.getDshRuntimeConfiguration).not.toHaveBeenCalled();
  });

  it('can omit runtime settings when the composer shows them directly', async () => {
    const maker = makerApi();
    (window as unknown as { electronAPI: unknown }).electronAPI = { maker };

    render(
      <DshTaskControlsPopover
        sessionId="task-1"
        runtimeConfigurationDisabled={false}
        showRuntimeConfiguration={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'ccAgent.dshTaskControls.ariaLabel' }));
    expect(await screen.findByText('ccAgent.dshActivity.title')).toBeTruthy();
    expect(screen.queryByText('ccAgent.dshRuntimeConfiguration.title')).toBeNull();
    expect(maker.getDshRuntimeConfiguration).not.toHaveBeenCalled();
  });

  it('does not create a control trigger before a DSH task has an id', () => {
    const { container } = render(
      <DshTaskControlsPopover sessionId={null} runtimeConfigurationDisabled={false} />,
    );

    expect(container.firstChild).toBeNull();
  });
});
