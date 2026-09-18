/**
 * On-demand controls for one local DSH task.
 *
 * DSH's Cindy-owned local plan/todo state belongs behind this one trigger.
 * The native runtime controls may be rendered here by another surface, or
 * directly beside the composer when model selection should stay visible.
 * Either form uses the same narrow, Main-owned configuration API.
 */

import type { ReactElement } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DshActivityPanel } from './DshActivityPanel';
import { DshRuntimeConfigurationPanel } from './DshRuntimeConfigurationPanel';

export function DshTaskControlsPopover({
  sessionId,
  runtimeConfigurationDisabled,
  showRuntimeConfiguration = true,
}: {
  sessionId: string | null;
  /** Runtime choices apply only to the next message and must not change mid-turn. */
  runtimeConfigurationDisabled: boolean;
  /** Use false when the model controls are surfaced directly beside the composer. */
  showRuntimeConfiguration?: boolean;
}): ReactElement | null {
  const { t } = useTranslation();

  if (!sessionId) return null;

  return (
    <div className="self-end" data-dsh-task-controls>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--composer-pill-bg)] px-2.5 text-12 font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            aria-label={t('ccAgent.dshTaskControls.ariaLabel')}
          >
            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
            <span>{t('ccAgent.dshTaskControls.trigger')}</span>
            <ChevronDown className="size-3.5 text-[var(--text-tertiary)]" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          className="w-[min(28rem,calc(100vw-2rem))] max-h-[min(36rem,calc(100vh-8rem))] overflow-y-auto border-[var(--border-default)] bg-[var(--surface)] p-2 text-[var(--text-primary)]"
          aria-label={t('ccAgent.dshTaskControls.ariaLabel')}
        >
          <div className="space-y-2" data-dsh-task-controls-content>
            {showRuntimeConfiguration && !runtimeConfigurationDisabled && (
              <DshRuntimeConfigurationPanel
                sessionId={sessionId}
                className="border-0 bg-transparent px-2 py-2"
              />
            )}
            <DshActivityPanel sessionId={sessionId} className="border-0 bg-transparent px-2 py-2" />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
