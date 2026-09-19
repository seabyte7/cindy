/**
 * Live configuration controls for one local DSH task.
 *
 * The values presented here are Main-issued capabilities, not ACP values:
 * this component never knows a runtime id, provider route, or raw selection.
 * It deliberately does not use the persistent generic ModelSelector because
 * DSH configuration belongs only to this live native task.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Check, ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
  DshRuntimeConfigurationControl,
  DshRuntimeConfigurationId,
  DshRuntimeConfigurationSnapshot,
} from '../../../shared/dshRuntimeConfiguration';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

function controlLabelKey(id: DshRuntimeConfigurationId): string {
  return `ccAgent.dshRuntimeConfiguration.control.${id}`;
}

function currentChoice(control: DshRuntimeConfigurationControl): string {
  return control.choices.find((choice) => choice.id === control.currentChoiceId)?.label ?? '';
}

export function DshRuntimeConfigurationPanel({
  sessionId,
  disabled = false,
  className,
}: {
  sessionId: string | null;
  /** Main also rejects a race; this only makes the next-message boundary clear in the UI. */
  disabled?: boolean;
  className?: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<DshRuntimeConfigurationSnapshot | null>(null);
  const [snapshotSessionId, setSnapshotSessionId] = useState<string | null>(null);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(sessionId);
  const [unavailableSessionId, setUnavailableSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState<{
    sessionId: string;
    controlId: DshRuntimeConfigurationId;
  } | null>(null);
  const readGeneration = useRef(0);
  const currentSessionId = useRef(sessionId);
  currentSessionId.current = sessionId;

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const requestedSessionId = sessionId;
    const generation = ++readGeneration.current;
    setLoadingSessionId(requestedSessionId);
    setUnavailableSessionId(null);
    try {
      const next = await window.electronAPI.maker.getDshRuntimeConfiguration(requestedSessionId);
      if (generation !== readGeneration.current || currentSessionId.current !== requestedSessionId) return;
      setSnapshot(next);
      setSnapshotSessionId(requestedSessionId);
    } catch {
      if (generation !== readGeneration.current || currentSessionId.current !== requestedSessionId) return;
      // Main has already redacted native details. Do not render a caught error
      // because a raw runtime response must never become product text.
      setSnapshot(null);
      setSnapshotSessionId(null);
      setUnavailableSessionId(requestedSessionId);
    } finally {
      if (generation === readGeneration.current && currentSessionId.current === requestedSessionId) {
        setLoadingSessionId(null);
      }
    }
  }, [sessionId]);

  useEffect(() => {
    // Re-read after a turn settles so the last native image refusal is visible.
    if (!disabled) void refresh();
  }, [disabled, refresh]);

  const choose = useCallback(
    async (controlId: DshRuntimeConfigurationId, choiceId: string): Promise<void> => {
      if (!sessionId || disabled || busy !== null || snapshotSessionId !== sessionId) return;
      const requestedSessionId = sessionId;
      setBusy({ sessionId: requestedSessionId, controlId });
      setUnavailableSessionId(null);
      try {
        const next = await window.electronAPI.maker.setDshRuntimeConfiguration(
          requestedSessionId,
          controlId,
          choiceId,
        );
        if (currentSessionId.current !== requestedSessionId) return;
        setSnapshot(next);
        setSnapshotSessionId(requestedSessionId);
      } catch {
        if (currentSessionId.current !== requestedSessionId) return;
        // A failed set could be an uncertain native outcome. Main is the
        // authority, so leave all choices unavailable until an explicit read.
        setSnapshot(null);
        setSnapshotSessionId(null);
        setUnavailableSessionId(requestedSessionId);
      } finally {
        setBusy((active) =>
          active?.sessionId === requestedSessionId && active.controlId === controlId ? null : active,
        );
      }
    },
    [busy, disabled, sessionId, snapshotSessionId],
  );

  const loading = loadingSessionId === sessionId;
  const unavailable = unavailableSessionId === sessionId;
  const controls = snapshotSessionId === sessionId ? (snapshot?.controls ?? []) : [];
  const imageInput = snapshotSessionId === sessionId ? snapshot?.imageInput : undefined;
  const busyControlId = busy?.sessionId === sessionId ? busy.controlId : null;
  if (!sessionId || (loading && controls.length === 0 && !unavailable)) return null;
  if (!unavailable && controls.length === 0) return null;

  return (
    <section
      aria-label={t('ccAgent.dshRuntimeConfiguration.ariaLabel')}
      className={cn(
        'w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text-primary)]',
        className,
      )}
      data-dsh-runtime-configuration-panel
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-13 font-medium leading-5">{t('ccAgent.dshRuntimeConfiguration.title')}</h2>
          <p className="text-11 leading-4 text-[var(--text-tertiary)]">
            {t('ccAgent.dshRuntimeConfiguration.nextMessageOnly')}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
          onClick={() => void refresh()}
          disabled={loading || busyControlId !== null}
          aria-label={t('ccAgent.dshRuntimeConfiguration.refresh')}
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} aria-hidden="true" />
        </button>
      </div>

      {!unavailable && imageInput && (
        <p role="status" className="mt-2 text-12 text-[var(--text-secondary)]">
          {t(`ccAgent.dshRuntimeConfiguration.${
            imageInput.lastRejection === 'image-model-unsupported' ? 'imageModelRejected' :
            imageInput.connectionSupported ? 'imageConnectionReady' : 'imageConnectionUnavailable'
          }`)}
        </p>
      )}

      {unavailable ? (
        <p role="status" className="mt-2 text-12 text-[var(--error-fg-strong)]">
          {t('ccAgent.dshRuntimeConfiguration.unavailable')}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {controls.map((control) => (
            <RuntimeConfigurationControl
              key={control.id}
              control={control}
              disabled={disabled || busyControlId !== null}
              loading={busyControlId === control.id}
              label={t(controlLabelKey(control.id))}
              choose={choose}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RuntimeConfigurationControl({
  control,
  disabled,
  loading,
  label,
  choose,
}: {
  control: DshRuntimeConfigurationControl;
  disabled: boolean;
  loading: boolean;
  label: string;
  choose: (controlId: DshRuntimeConfigurationId, choiceId: string) => Promise<void>;
}): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const value = currentChoice(control);
  const triggerLabel = value ? `${label}: ${value}` : label;

  const onChoice = (choiceId: string): void => {
    if (choiceId === control.currentChoiceId || disabled) {
      setOpen(false);
      return;
    }
    setOpen(false);
    void choose(control.id, choiceId);
  };

  return (
    <Popover open={open && !disabled} onOpenChange={(next) => setOpen(disabled ? false : next)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--composer-pill-bg)] px-2.5 text-12 font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          aria-label={triggerLabel}
        >
          <span className="shrink-0 text-[var(--text-tertiary)]">{label}</span>
          <span className="max-w-44 truncate">{value || t('ccAgent.dshRuntimeConfiguration.noSelection')}</span>
          {loading ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-64 border-[var(--border-default)] bg-[var(--surface-elevated)] p-1.5 text-[var(--text-primary)]"
      >
        <div role="listbox" aria-label={label} className="max-h-60 overflow-y-auto">
          {control.choices.map((choice) => {
            const selected = choice.id === control.currentChoiceId;
            return (
              <button
                key={choice.id}
                type="button"
                role="option"
                aria-selected={selected}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-12 transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                onClick={() => onChoice(choice.id)}
              >
                <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                {selected && <Check className="size-3.5 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
