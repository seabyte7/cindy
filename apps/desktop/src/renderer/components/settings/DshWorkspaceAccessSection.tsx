/**
 * Main-owned, reusable DSH task workspace authorization.
 *
 * The Renderer receives only a count/status projection. Directory names and
 * security-scoped bookmarks stay inside Main and the native picker.
 */

import { useEffect, useRef, useState } from 'react';
import { FolderKey, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { DshWorkspaceAccessProjection } from '@/../shared/dshWorkspaceAccess';
import { toast } from '@/lib/toast';

const CARD_CLASS =
  'flex flex-col overflow-hidden rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)]';
const ACTION_CLASS =
  'inline-flex h-8 items-center justify-center rounded-full border border-[var(--settings-theme-card-border)] px-3 text-12 font-medium text-[var(--settings-section-sublabel)] transition-colors hover:bg-sidebar-item-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50';

export function DshWorkspaceAccessSection() {
  const { t } = useTranslation();
  const [projection, setProjection] = useState<DshWorkspaceAccessProjection | null>(null);
  const [busy, setBusy] = useState<'select' | 'reset' | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    void window.electronAPI.maker
      .getDshWorkspaceAccess()
      .then((value) => {
        if (mountedRef.current) setProjection(value);
      })
      .catch(() => {
        if (mountedRef.current) setProjection({ status: 'unavailable', count: 0 });
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const select = async () => {
    if (busy) return;
    setBusy('select');
    try {
      const next = await window.electronAPI.maker.selectDshWorkspaceAccess();
      if (mountedRef.current) setProjection(next);
      toast.success(t('settings.dshWorkspaceAccess.selectionSaved'));
    } catch {
      toast.error(t('settings.dshWorkspaceAccess.saveFailed'));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const reset = async () => {
    if (busy) return;
    setBusy('reset');
    try {
      const next = await window.electronAPI.maker.resetDshWorkspaceAccess();
      if (mountedRef.current) setProjection(next);
      toast.success(t('settings.dshWorkspaceAccess.resetDone'));
    } catch {
      toast.error(t('settings.dshWorkspaceAccess.resetFailed'));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  if (!projection) return null;

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--settings-btn-secondary-border)] bg-[var(--surface)] text-[var(--settings-section-desc)]">
          <FolderKey size={18} />
        </div>
        <div className="min-w-0">
          <h2 className="text-16 font-medium leading-[1.2] text-[var(--settings-section-title)]">
            {t('settings.dshWorkspaceAccess.title')}
          </h2>
          <p className="mt-1 text-12 leading-[1.45] text-[var(--settings-section-desc)]">
            {t('settings.dshWorkspaceAccess.description')}
          </p>
        </div>
      </div>

      <div className={CARD_CLASS}>
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <div className="min-w-0">
            <p className="text-13 font-medium text-[var(--settings-section-sublabel)]">
              {t(`settings.dshWorkspaceAccess.status.${projection.status}`)}
            </p>
            <p className="mt-1 text-12 leading-[1.45] text-[var(--settings-section-desc)]">
              {projection.status === 'unavailable'
                ? t('settings.dshWorkspaceAccess.unavailableHint')
                : projection.count > 0
                ? t('settings.dshWorkspaceAccess.savedCount', { count: projection.count })
                : t('settings.dshWorkspaceAccess.hint')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void select()}
            disabled={busy !== null}
            className={ACTION_CLASS}
          >
            {busy === 'select'
              ? t('settings.dshWorkspaceAccess.choosing')
              : t('settings.dshWorkspaceAccess.choose')}
          </button>
        </div>
        <div className="mx-4 h-px bg-[var(--settings-theme-card-border)]" />
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <p className="min-w-0 text-12 leading-[1.45] text-[var(--settings-section-desc)]">
            {t('settings.dshWorkspaceAccess.resetHint')}
          </p>
          <button
            type="button"
            onClick={() => void reset()}
            disabled={projection.count === 0 || busy !== null}
            className={ACTION_CLASS}
          >
            <RotateCcw size={14} aria-hidden="true" />
            {busy === 'reset'
              ? t('settings.dshWorkspaceAccess.resetting')
              : t('settings.dshWorkspaceAccess.reset')}
          </button>
        </div>
      </div>
    </div>
  );
}
