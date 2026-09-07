// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { DshRuntimeConfigurationSnapshot } from '../../../../shared/dshRuntimeConfiguration';
import { DshRuntimeConfigurationPanel } from '../DshRuntimeConfigurationPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const initialSnapshot: DshRuntimeConfigurationSnapshot = {
  controls: [
    {
      id: 'model',
      currentChoiceId: 'dshcfg_model_a',
      choices: [
        { id: 'dshcfg_model_a', label: 'Model A' },
        { id: 'dshcfg_model_b', label: 'Model B' },
      ],
    },
    {
      id: 'reasoning_effort',
      currentChoiceId: 'dshcfg_effort_low',
      choices: [
        { id: 'dshcfg_effort_low', label: 'Low' },
        { id: 'dshcfg_effort_high', label: 'High' },
      ],
    },
  ],
};

function runtimeConfigurationApi(snapshot = initialSnapshot) {
  return {
    getDshRuntimeConfiguration: vi.fn(async () => snapshot),
    setDshRuntimeConfiguration: vi.fn(async () => snapshot),
  };
}

function deferred<Value>(): { promise: Promise<Value>; resolve: (value: Value) => void } {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  delete (window as Partial<Window>).electronAPI;
});

describe('DshRuntimeConfigurationPanel', () => {
  it('renders only Main-issued display choices and uses the narrow configuration API', async () => {
    const updated: DshRuntimeConfigurationSnapshot = {
      controls: [
        {
          id: 'model',
          currentChoiceId: 'dshcfg_model_b_next',
          choices: [{ id: 'dshcfg_model_b_next', label: 'Model B' }],
        },
      ],
    };
    const maker = runtimeConfigurationApi();
    maker.setDshRuntimeConfiguration.mockResolvedValue(updated);
    (window as unknown as { electronAPI: unknown }).electronAPI = { maker };

    render(<DshRuntimeConfigurationPanel sessionId="task-1" />);

    const trigger = await screen.findByRole('button', {
      name: 'ccAgent.dshRuntimeConfiguration.control.model: Model A',
    });
    expect(document.body.textContent).not.toContain('runtime-1');
    expect(document.body.textContent).not.toContain('["fixture","model-a"]');

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: 'Model B' }));
    await waitFor(() =>
      expect(maker.setDshRuntimeConfiguration).toHaveBeenCalledWith(
        'task-1',
        'model',
        'dshcfg_model_b',
      ),
    );
    expect(
      await screen.findByRole('button', {
        name: 'ccAgent.dshRuntimeConfiguration.control.model: Model B',
      }),
    ).toBeTruthy();
  });

  it('does not expose a settings panel when Main advertises no live controls', async () => {
    const maker = runtimeConfigurationApi({ controls: [] });
    (window as unknown as { electronAPI: unknown }).electronAPI = { maker };

    const { container } = render(<DshRuntimeConfigurationPanel sessionId="task-1" />);
    await waitFor(() => expect(maker.getDshRuntimeConfiguration).toHaveBeenCalledWith('task-1'));
    expect(container.querySelector('[data-dsh-runtime-configuration-panel]')).toBeNull();
  });

  it('does not carry a delayed snapshot from one task into another task view', async () => {
    const firstRead = deferred<DshRuntimeConfigurationSnapshot>();
    const taskTwoSnapshot: DshRuntimeConfigurationSnapshot = {
      controls: [
        {
          id: 'model',
          currentChoiceId: 'dshcfg_task_two',
          choices: [{ id: 'dshcfg_task_two', label: 'Task two model' }],
        },
      ],
    };
    const maker = runtimeConfigurationApi();
    maker.getDshRuntimeConfiguration
      .mockImplementationOnce(async () => await firstRead.promise)
      .mockResolvedValueOnce(taskTwoSnapshot);
    (window as unknown as { electronAPI: unknown }).electronAPI = { maker };

    const { rerender } = render(<DshRuntimeConfigurationPanel sessionId="task-1" />);
    await waitFor(() => expect(maker.getDshRuntimeConfiguration).toHaveBeenCalledWith('task-1'));
    rerender(<DshRuntimeConfigurationPanel sessionId="task-2" />);
    await waitFor(() => expect(maker.getDshRuntimeConfiguration).toHaveBeenCalledWith('task-2'));

    firstRead.resolve(initialSnapshot);
    await screen.findByRole('button', {
      name: 'ccAgent.dshRuntimeConfiguration.control.model: Task two model',
    });
    expect(
      screen.queryByRole('button', {
        name: 'ccAgent.dshRuntimeConfiguration.control.model: Model A',
      }),
    ).toBeNull();
  });

  it('fails closed after a rejected configuration mutation until the user explicitly refreshes', async () => {
    const maker = runtimeConfigurationApi();
    maker.setDshRuntimeConfiguration.mockRejectedValueOnce(new Error('native value must stay redacted'));
    (window as unknown as { electronAPI: unknown }).electronAPI = { maker };

    render(<DshRuntimeConfigurationPanel sessionId="task-1" />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'ccAgent.dshRuntimeConfiguration.control.model: Model A',
      }),
    );
    fireEvent.click(await screen.findByRole('option', { name: 'Model B' }));
    expect(await screen.findByText('ccAgent.dshRuntimeConfiguration.unavailable')).toBeTruthy();
    expect(
      screen.queryByRole('button', {
        name: 'ccAgent.dshRuntimeConfiguration.control.model: Model A',
      }),
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'ccAgent.dshRuntimeConfiguration.refresh' }));
    await waitFor(() => expect(maker.getDshRuntimeConfiguration).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole('button', {
        name: 'ccAgent.dshRuntimeConfiguration.control.model: Model A',
      }),
    ).toBeTruthy();
  });
});
