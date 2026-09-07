/**
 * Advanced, local-only DSH Home selection.
 *
 * The component is intentionally unable to render a local pathname or ask the
 * native picker for a path. Both happen exclusively in Main; this layer gets a
 * three-state display projection and can invoke fixed-purpose commands only.
 */

import { useEffect, useRef, useState } from 'react';
import { FolderKey, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { DshExistingHomeProjection } from '@/../shared/dshExistingHome';
import { toast } from '@/lib/toast';

const CARD_CLASS =
  'flex flex-col overflow-hidden rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)]';
const ACTION_CLASS =
  'inline-flex h-8 items-center justify-center rounded-full border border-[var(--settings-theme-card-border)] px-3 text-12 font-medium text-[var(--settings-section-sublabel)] transition-colors hover:bg-sidebar-item-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50';

function statusKey(state: DshExistingHomeProjection): string {
  if (state.mode === 'cindy-managed') return 'cindyManaged';
  return state.status;
}

export function DshExistingHomeSection() {
  const { t } = useTranslation();
  const [projection, setProjection] = useState<DshExistingHomeProjection | null>(null);
  const [busy, setBusy] = useState<'select' | 'reset' | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    void window.electronAPI.maker
      .getDshExistingHome()
      .then((value) => {
        if (mountedRef.current) setProjection(value);
      })
      .catch(() => {
        if (mountedRef.current) {
          // Do not invent a default when Main cannot prove it. The unavailable
          // state avoids implying that an existing Home may safely be used.
          setProjection({ mode: 'existing-dsh-home', status: 'unavailable' });
        }
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const select = async () => {
    if (busy) return;
    setBusy('select');
    try {
      const next = await window.electronAPI.maker.selectDshExistingHome();
      if (mountedRef.current) setProjection(next);
      toast.success(t('settings.dshExistingHome.selectionSaved'));
    } catch {
      toast.error(t('settings.dshExistingHome.saveFailed'));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const reset = async () => {
    if (busy) return;
    setBusy('reset');
    try {
      const next = await window.electronAPI.maker.resetDshExistingHome();
      if (mountedRef.current) setProjection(next);
      toast.success(t('settings.dshExistingHome.restored'));
    } catch {
      toast.error(t('settings.dshExistingHome.restoreFailed'));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  // Like other local Settings reads, avoid a temporary row that would shift
  // the remainder of General while Main responds.
  if (!projection) return null;

  const canRestore = projection.mode === 'existing-dsh-home';
  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--settings-btn-secondary-border)] bg-[var(--surface)] text-[var(--settings-section-desc)]">
          <FolderKey size={18} />
        </div>
        <div className="min-w-0">
          <h2 className="text-16 font-medium leading-[1.2] text-[var(--settings-section-title)]">
            {t('settings.dshExistingHome.title')}
          </h2>
          <p className="mt-1 text-12 leading-[1.45] text-[var(--settings-section-desc)]">
            {t('settings.dshExistingHome.description')}
          </p>
        </div>
      </div>

      <div className={CARD_CLASS}>
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <div className="min-w-0">
            <p className="text-13 font-medium text-[var(--settings-section-sublabel)]">
              {t(`settings.dshExistingHome.status.${statusKey(projection)}`)}
            </p>
            <p className="mt-1 text-12 leading-[1.45] text-[var(--settings-section-desc)]">
              {projection.mode === 'existing-dsh-home'
                ? t('settings.dshExistingHome.existingHomeHint')
                : t('settings.dshExistingHome.managedHomeHint')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void select()}
            disabled={busy !== null}
            className={ACTION_CLASS}
          >
            {busy === 'select'
              ? t('settings.dshExistingHome.choosing')
              : t('settings.dshExistingHome.choose')}
          </button>
        </div>
        <div className="mx-4 h-px bg-[var(--settings-theme-card-border)]" />
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <p className="min-w-0 text-12 leading-[1.45] text-[var(--settings-section-desc)]">
            {t('settings.dshExistingHome.executionGate')}
          </p>
          <button
            type="button"
            onClick={() => void reset()}
            disabled={!canRestore || busy !== null}
            aria-label={t('settings.dshExistingHome.useManaged')}
            className={ACTION_CLASS}
          >
            <RotateCcw size={14} aria-hidden="true" />
            {busy === 'reset'
              ? t('settings.dshExistingHome.restoring')
              : t('settings.dshExistingHome.useManaged')}
          </button>
        </div>
      </div>
    </div>
  );
}
