// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { DshActivityViewSnapshot } from '../../../../shared/dshActivity';
import { DshActivityPanel } from '../DshActivityPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const root = {
  activityId: 'session-root',
  parentActivityId: null,
  kind: 'session' as const,
  status: 'running' as const,
  summary: 'running' as const,
  allowedActions: ['observe', 'cancel', 'close'] as const,
  revision: 1,
};

function activityApi(snapshot: DshActivityViewSnapshot | null) {
  return {
    readDshActivity: vi.fn(async () => ({ snapshot })),
    createDshPlan: vi.fn(async () => ({ snapshot: snapshot! })),
    createDshTodo: vi.fn(async () => ({ snapshot: snapshot! })),
    completeDshActivity: vi.fn(async () => ({ snapshot: snapshot! })),
    cancelDshActivity: vi.fn(async () => ({ snapshot: snapshot! })),
  };
}

afterEach(() => {
  cleanup();
  delete (window as Partial<Window>).electronAPI;
});

describe('DshActivityPanel', () => {
  it('renders only Cindy-owned plan/todo data and invokes the narrow local APIs', async () => {
    const snapshot: DshActivityViewSnapshot = {
      sequence: 3,
      activities: [
        root,
        {
          activityId: 'plan-1',
          parentActivityId: 'session-root',
          kind: 'plan',
          label: 'Validate local package',
          status: 'pending',
          summary: 'pending',
          allowedActions: ['observe', 'complete', 'cancel'],
          revision: 1,
        },
        {
          activityId: 'todo-1',
          parentActivityId: 'plan-1',
          kind: 'todo',
          label: 'Run Helper smoke test',
          status: 'pending',
          summary: 'pending',
          allowedActions: ['observe', 'complete', 'cancel'],
          revision: 1,
        },
      ],
    };
    const maker = activityApi(snapshot);
    (window as unknown as { electronAPI: unknown }).electronAPI = { maker };

    render(<DshActivityPanel sessionId="task-1" />);

    await screen.findByText('Validate local package');
    expect(screen.getByText('Run Helper smoke test')).toBeTruthy();
    expect(document.body.textContent).not.toContain('runtimeSessionId');
    expect(document.body.textContent).not.toContain('scopeId');

    fireEvent.click(screen.getAllByRole('button', { name: 'ccAgent.dshActivity.complete' })[1]!);
    await waitFor(() =>
      expect(maker.completeDshActivity).toHaveBeenCalledWith('task-1', 'todo-1'),
    );
  });

  it('creates a plan through the dedicated API rather than a generic activity mutation', async () => {
    const created: DshActivityViewSnapshot = {
      sequence: 2,
      activities: [
        root,
        {
          activityId: 'plan-2',
          parentActivityId: 'session-root',
          kind: 'plan',
          label: 'Review F6 evidence',
          status: 'pending',
          summary: 'pending',
          allowedActions: ['observe', 'complete', 'cancel'],
          revision: 1,
        },
      ],
    };
    const maker = activityApi({ sequence: 1, activities: [root] });
    maker.createDshPlan.mockResolvedValue({ snapshot: created });
    (window as unknown as { electronAPI: unknown }).electronAPI = { maker };

    render(<DshActivityPanel sessionId="task-1" />);
    const input = await screen.findByRole('textbox', {
      name: 'ccAgent.dshActivity.planPlaceholder',
    });
    fireEvent.change(input, { target: { value: '  Review F6 evidence  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'ccAgent.dshActivity.addPlan' }));

    await waitFor(() =>
      expect(maker.createDshPlan).toHaveBeenCalledWith('task-1', 'Review F6 evidence'),
    );
    expect(await screen.findByText('Review F6 evidence')).toBeTruthy();
  });

  it('shows disconnected local activity as read-only and exposes no mutation controls', async () => {
    const snapshot: DshActivityViewSnapshot = {
      sequence: 3,
      activities: [
        {
          ...root,
          status: 'disconnected',
          summary: 'disconnected',
          allowedActions: ['observe'],
        },
        {
          activityId: 'plan-1',
          parentActivityId: 'session-root',
          kind: 'plan',
          label: 'Wait for verified resume',
          status: 'pending',
          summary: 'pending',
          allowedActions: ['observe'],
          revision: 1,
        },
      ],
    };
    const maker = activityApi(snapshot);
    (window as unknown as { electronAPI: unknown }).electronAPI = { maker };

    render(<DshActivityPanel sessionId="task-1" />);

    await screen.findByText('Wait for verified resume');
    expect(screen.getByText('ccAgent.dshActivity.readOnlyUntilResumed')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'ccAgent.dshActivity.addPlan' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'ccAgent.dshActivity.complete' }),
    ).toBeNull();
  });

  it('fails closed after a rejected local mutation until an explicit refresh returns a new view', async () => {
    const snapshot: DshActivityViewSnapshot = {
      sequence: 2,
      activities: [
        root,
        {
          activityId: 'plan-1',
          parentActivityId: 'session-root',
          kind: 'plan',
          label: 'Do not repeat a rejected mutation',
          status: 'pending',
          summary: 'pending',
          allowedActions: ['observe', 'complete', 'cancel'],
          revision: 1,
        },
      ],
    };
    const maker = activityApi(snapshot);
    maker.completeDshActivity.mockRejectedValueOnce(new Error('Main rejected stale activity'));
    (window as unknown as { electronAPI: unknown }).electronAPI = { maker };

    render(<DshActivityPanel sessionId="task-1" />);
    await screen.findByText('Do not repeat a rejected mutation');

    fireEvent.click(screen.getByRole('button', { name: 'ccAgent.dshActivity.complete' }));
    await screen.findByText('ccAgent.dshActivity.unavailable');
    expect(maker.completeDshActivity).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'ccAgent.dshActivity.complete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'ccAgent.dshActivity.addPlan' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'ccAgent.dshActivity.refresh' }));
    await waitFor(() => expect(maker.readDshActivity).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'ccAgent.dshActivity.complete' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ccAgent.dshActivity.addPlan' })).toBeTruthy();
  });

  it('permits only one local mutation until Main returns its authoritative snapshot', async () => {
    const snapshot: DshActivityViewSnapshot = {
      sequence: 2,
      activities: [
        root,
        {
          activityId: 'plan-1',
          parentActivityId: 'session-root',
          kind: 'plan',
          label: 'Serialize local activity writes',
          status: 'pending',
          summary: 'pending',
          allowedActions: ['observe', 'complete', 'cancel'],
          revision: 1,
        },
      ],
    };
    let resolveComplete: ((value: { snapshot: DshActivityViewSnapshot }) => void) | undefined;
    const maker = activityApi(snapshot);
    maker.completeDshActivity.mockImplementationOnce(
      () => new Promise((resolve) => { resolveComplete = resolve; }),
    );
    (window as unknown as { electronAPI: unknown }).electronAPI = { maker };

    render(<DshActivityPanel sessionId="task-1" />);
    await screen.findByText('Serialize local activity writes');

    fireEvent.click(screen.getByRole('button', { name: 'ccAgent.dshActivity.complete' }));
    await waitFor(() => expect(maker.completeDshActivity).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'ccAgent.dshActivity.complete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'ccAgent.dshActivity.cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'ccAgent.dshActivity.addPlan' })).toBeNull();

    resolveComplete?.({ snapshot });
    expect(await screen.findByRole('button', { name: 'ccAgent.dshActivity.complete' })).toBeTruthy();
  });

  it('keeps local mutations unavailable while an explicit refresh revalidates the snapshot', async () => {
    const snapshot: DshActivityViewSnapshot = {
      sequence: 2,
      activities: [
        root,
        {
          activityId: 'plan-1',
          parentActivityId: 'session-root',
          kind: 'plan',
          label: 'Wait for refresh before mutating',
          status: 'pending',
          summary: 'pending',
          allowedActions: ['observe', 'complete', 'cancel'],
          revision: 1,
        },
      ],
    };
    let resolveRead: ((value: { snapshot: DshActivityViewSnapshot }) => void) | undefined;
    const maker = activityApi(snapshot);
    (window as unknown as { electronAPI: unknown }).electronAPI = { maker };

    render(<DshActivityPanel sessionId="task-1" />);
    await screen.findByText('Wait for refresh before mutating');
    maker.readDshActivity.mockImplementationOnce(
      () => new Promise((resolve) => { resolveRead = resolve; }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'ccAgent.dshActivity.refresh' }));
    await waitFor(() => expect(maker.readDshActivity).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'ccAgent.dshActivity.complete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'ccAgent.dshActivity.addPlan' })).toBeNull();

    resolveRead?.({ snapshot });
    expect(await screen.findByRole('button', { name: 'ccAgent.dshActivity.complete' })).toBeTruthy();
  });
});
