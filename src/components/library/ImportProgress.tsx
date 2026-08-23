import { useEffect } from 'react';
import { onImportProgress } from '@/core/library';
import { useImporting, usePlayerStore } from '@/core/store';
import { useT } from '@/core/i18n';

/**
 * Live strip shown while audio is being copied into the library.
 *
 * It sits in the shell rather than inside the Library panel on purpose: copying
 * a large folder takes a while, and the user should be able to close the panel
 * and keep listening without losing sight of what is happening.
 *
 * Cancelling matters as much as showing progress. Picking a 50 GB folder by
 * accident should not leave killing the app as the only way out.
 */
export function ImportProgress() {
  const t = useT();
  const importing = useImporting();
  const cancelImport = usePlayerStore((s) => s.cancelImport);

  useEffect(() => {
    // Rust reports per file; the store holds the latest.
    return onImportProgress(
      (progress) => {
        usePlayerStore.setState({ importing: progress.done >= progress.total ? null : progress });
      },
      (message) => usePlayerStore.setState({ error: message }),
    );
  }, []);

  if (!importing) return null;

  const fraction = importing.total > 0 ? importing.done / importing.total : 0;

  return (
    <div className="shrink-0 bg-shell-900 px-3 py-1.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-meta text-cream-200">
          {t('library.importing', { done: importing.done + 1, total: importing.total })}
          {importing.currentName && (
            <span className="text-cream-400"> · {importing.currentName}</span>
          )}
        </span>
        <button
          type="button"
          aria-label={t('library.cancelImport')}
          title={t('common.cancel')}
          onClick={() => void cancelImport()}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-700 hover:text-cream-50"
        >
          <svg viewBox="0 0 10 10" className="h-2 w-2" aria-hidden="true">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-shell-700">
        <div
          className="h-full rounded-full bg-brass-500 transition-[width] duration-200"
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}
