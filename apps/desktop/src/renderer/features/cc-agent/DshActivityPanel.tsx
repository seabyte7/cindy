/**
 * Cindy-owned local plan/todo panel for an already-bound DSH task.
 *
 * This is not a DSH-native UI: every visible label was authored locally, and
 * every button calls one narrow local IPC operation. No ACP/raw runtime state
 * reaches the component.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import { Check, Plus, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
  DshActivityViewObject,
  DshActivityViewSnapshot,
} from '../../../shared/dshActivity';
import { cn } from '@/lib/utils';

function statusKey(status: DshActivityViewObject['status']): string {
  return `ccAgent.dshActivity.status.${status}`;
}

function isOpen(activity: DshActivityViewObject): boolean {
  return activity.status !== 'completed' && activity.status !== 'cancelled' && activity.status !== 'failed' && activity.status !== 'unavailable';
}

function actionEnabled(activity: DshActivityViewObject, action: 'complete' | 'cancel'): boolean {
  return isOpen(activity) && activity.allowedActions.includes(action);
}

export function DshActivityPanel({
  sessionId,
  className,
}: {
  sessionId: string | null;
  className?: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<DshActivityViewSnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [unavailable, setUnavailable] = useState(false);
  const [busyActivityId, setBusyActivityId] = useState<string | null>(null);
  const [planDraft, setPlanDraft] = useState('');
  const [todoDrafts, setTodoDrafts] = useState<Record<string, string>>({});
  // A route change or an explicit retry can resolve out of order. The IPC view
  // has no session id by design, so accept only the newest request's result.
  const readGeneration = useRef(0);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const generation = ++readGeneration.current;
    setLoading(true);
    setUnavailable(false);
    try {
      const result = await window.electronAPI.maker.readDshActivity(sessionId);
      if (generation !== readGeneration.current) return;
      setSnapshot(result.snapshot);
    } catch {
      if (generation !== readGeneration.current) return;
      // Native/internal details do not belong in this local product panel.
      setUnavailable(true);
      setSnapshot(null);
    } finally {
      if (generation === readGeneration.current) setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const plans = useMemo(
    () => (snapshot?.activities ?? []).filter((activity) => activity.kind === 'plan'),
    [snapshot],
  );
  const todosByPlan = useMemo(() => {
    const next = new Map<string, DshActivityViewObject[]>();
    for (const activity of snapshot?.activities ?? []) {
      if (activity.kind !== 'todo' || !activity.parentActivityId) continue;
      const todos = next.get(activity.parentActivityId) ?? [];
      todos.push(activity);
      next.set(activity.parentActivityId, todos);
    }
    return next;
  }, [snapshot]);
  const sessionRoot = useMemo(
    () =>
      (snapshot?.activities ?? []).find(
        (activity) => activity.kind === 'session' && activity.parentActivityId === null,
      ) ?? null,
    [snapshot],
  );
  const canMutateLocalActivity =
    !unavailable &&
    !loading &&
    busyActivityId === null &&
    sessionRoot?.status === 'running' &&
    sessionRoot.allowedActions.some((action) => action !== 'observe');

  const apply = useCallback(
    async (activityId: string, operation: () => Promise<{ snapshot: DshActivityViewSnapshot }>) => {
      setBusyActivityId(activityId);
      setUnavailable(false);
      try {
        const result = await operation();
        setSnapshot(result.snapshot);
      } catch {
        // The next explicit refresh fetches the current durable view; never
        // optimistic-guess an accepted local or native operation.
        setUnavailable(true);
      } finally {
        setBusyActivityId(null);
      }
    },
    [],
  );

  if (!sessionId) return null;

  const submitPlan = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!canMutateLocalActivity) return;
    const label = planDraft.trim();
    if (!label) return;
    void apply('new-plan', async () => {
      const result = await window.electronAPI.maker.createDshPlan(sessionId, label);
      setPlanDraft('');
      return result;
    });
  };

  const submitTodo = (event: FormEvent<HTMLFormElement>, planActivityId: string): void => {
    event.preventDefault();
    if (!canMutateLocalActivity) return;
    const label = todoDrafts[planActivityId]?.trim() ?? '';
    if (!label) return;
    void apply(`new-todo:${planActivityId}`, async () => {
      const result = await window.electronAPI.maker.createDshTodo(sessionId, planActivityId, label);
      setTodoDrafts((current) => ({ ...current, [planActivityId]: '' }));
      return result;
    });
  };

  return (
    <section
      aria-label={t('ccAgent.dshActivity.ariaLabel')}
      className={cn(
        'w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text-primary)]',
        className,
      )}
      data-dsh-local-activity-panel
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-13 font-medium leading-5">{t('ccAgent.dshActivity.title')}</h2>
          <p className="text-11 leading-4 text-[var(--text-tertiary)]">
            {t('ccAgent.dshActivity.localOnly')}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
          onClick={() => void refresh()}
          disabled={loading || busyActivityId !== null}
          aria-label={t('ccAgent.dshActivity.refresh')}
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} aria-hidden="true" />
        </button>
      </div>

      {unavailable && (
        <p role="status" className="mt-2 text-12 text-[var(--error-fg-strong)]">
          {t('ccAgent.dshActivity.unavailable')}
        </p>
      )}

      {loading && snapshot === null ? (
        <p className="mt-2 text-12 text-[var(--text-tertiary)]">{t('ccAgent.dshActivity.loading')}</p>
      ) : snapshot === null ? (
        <p className="mt-2 text-12 text-[var(--text-tertiary)]">{t('ccAgent.dshActivity.notReady')}</p>
      ) : (
        <>
          {!canMutateLocalActivity && !unavailable && (
            <p role="status" className="mt-2 text-12 text-[var(--text-tertiary)]">
              {t('ccAgent.dshActivity.readOnlyUntilResumed')}
            </p>
          )}

          {canMutateLocalActivity && (
            <form className="mt-2 flex gap-2" onSubmit={submitPlan}>
              <input
                value={planDraft}
                onChange={(event) => setPlanDraft(event.target.value)}
                maxLength={240}
                autoComplete="off"
                placeholder={t('ccAgent.dshActivity.planPlaceholder')}
                aria-label={t('ccAgent.dshActivity.planPlaceholder')}
                className="min-w-0 flex-1 rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-12 text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] outline-none transition-colors focus:border-[var(--focus-ring)] focus:ring-1 focus:ring-[var(--focus-ring)]"
                disabled={busyActivityId !== null}
              />
              <button
                type="submit"
                disabled={!planDraft.trim() || busyActivityId !== null}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-[var(--confirm-btn-primary-bg)] px-2.5 text-12 font-medium text-[var(--confirm-btn-primary-text)] transition-colors hover:bg-[var(--confirm-btn-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                {t('ccAgent.dshActivity.addPlan')}
              </button>
            </form>
          )}

          {plans.length === 0 ? (
            <p className="mt-3 text-12 text-[var(--text-tertiary)]">{t('ccAgent.dshActivity.empty')}</p>
          ) : (
            <div className="mt-3 space-y-2">
              {plans.map((plan) => {
                const todos = todosByPlan.get(plan.activityId) ?? [];
                const isBusy = busyActivityId === plan.activityId;
                return (
                  <article
                    key={plan.activityId}
                    className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] p-2"
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-12 font-medium">
                          {plan.label ?? t('ccAgent.dshActivity.unnamedPlan')}
                        </h3>
                        <p className="mt-0.5 text-11 text-[var(--text-tertiary)]">
                          {t(statusKey(plan.status))}
                        </p>
                      </div>
                      <ActivityButtons
                        activity={plan}
                        busy={isBusy}
                        allowMutation={canMutateLocalActivity}
                        onComplete={() =>
                          void apply(plan.activityId, () =>
                            window.electronAPI.maker.completeDshActivity(sessionId, plan.activityId),
                          )
                        }
                        onCancel={() =>
                          void apply(plan.activityId, () =>
                            window.electronAPI.maker.cancelDshActivity(sessionId, plan.activityId),
                          )
                        }
                      />
                    </div>

                    {todos.length > 0 && (
                      <ul className="mt-2 space-y-1.5 border-t border-[var(--border-default)] pt-2">
                        {todos.map((todo) => (
                          <li key={todo.activityId} className="flex items-start gap-2">
                            <span
                              className={cn(
                                'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)]',
                                todo.status === 'completed' && 'bg-[var(--confirm-btn-primary-bg)] text-[var(--confirm-btn-primary-text)]',
                              )}
                              aria-hidden="true"
                            >
                              {todo.status === 'completed' && <Check className="size-3" />}
                            </span>
                            <span className="min-w-0 flex-1 text-12 leading-4">
                              {todo.label ?? t('ccAgent.dshActivity.unnamedTodo')}
                            </span>
                            <ActivityButtons
                              activity={todo}
                              busy={busyActivityId === todo.activityId}
                              allowMutation={canMutateLocalActivity}
                              onComplete={() =>
                                void apply(todo.activityId, () =>
                                  window.electronAPI.maker.completeDshActivity(sessionId, todo.activityId),
                                )
                              }
                              onCancel={() =>
                                void apply(todo.activityId, () =>
                                  window.electronAPI.maker.cancelDshActivity(sessionId, todo.activityId),
                                )
                              }
                            />
                          </li>
                        ))}
                      </ul>
                    )}

                    {isOpen(plan) && canMutateLocalActivity && (
                      <form className="mt-2 flex gap-2 border-t border-[var(--border-default)] pt-2" onSubmit={(event) => submitTodo(event, plan.activityId)}>
                        <input
                          value={todoDrafts[plan.activityId] ?? ''}
                          onChange={(event) =>
                            setTodoDrafts((current) => ({ ...current, [plan.activityId]: event.target.value }))
                          }
                          maxLength={240}
                          autoComplete="off"
                          placeholder={t('ccAgent.dshActivity.todoPlaceholder')}
                          aria-label={t('ccAgent.dshActivity.todoPlaceholder')}
                          className="min-w-0 flex-1 rounded-full border border-[var(--border-default)] bg-[var(--surface)] px-2 py-1 text-12 text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] outline-none transition-colors focus:border-[var(--focus-ring)] focus:ring-1 focus:ring-[var(--focus-ring)]"
                          disabled={busyActivityId !== null}
                        />
                        <button
                          type="submit"
                          disabled={!todoDrafts[plan.activityId]?.trim() || busyActivityId !== null}
                          className="inline-flex h-7 items-center rounded-full px-2 text-12 font-medium text-[var(--confirm-btn-secondary-text)] transition-colors hover:bg-[var(--confirm-btn-secondary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
                        >
                          {t('ccAgent.dshActivity.addTodo')}
                        </button>
                      </form>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ActivityButtons({
  activity,
  busy,
  allowMutation,
  onComplete,
  onCancel,
}: {
  activity: DshActivityViewObject;
  busy: boolean;
  /** A rejected Main mutation leaves the displayed snapshot stale. */
  allowMutation: boolean;
  onComplete: () => void;
  onCancel: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  if (!allowMutation || (!actionEnabled(activity, 'complete') && !actionEnabled(activity, 'cancel'))) return null;
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {actionEnabled(activity, 'complete') && (
        <button
          type="button"
          disabled={busy}
          onClick={onComplete}
          aria-label={t('ccAgent.dshActivity.complete')}
          className="inline-flex size-6 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-chip)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
        >
          <Check className="size-3.5" aria-hidden="true" />
        </button>
      )}
      {actionEnabled(activity, 'cancel') && (
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          aria-label={t('ccAgent.dshActivity.cancel')}
          className="inline-flex size-6 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-chip)] hover:text-[var(--error-fg-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
