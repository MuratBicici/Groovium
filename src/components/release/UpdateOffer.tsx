import { useEffect, useMemo } from 'react';
import { useSheet } from '@/core/utils/useSheet';
import { paragraphsOf, summaryOfNotes } from '@/core/release';
import { useUpdateStore } from '@/core/updates/store';
import { useT } from '@/core/i18n';

interface UpdateOfferProps {
  open: boolean;
  /** Put away for now. Nothing is recorded; the offer stands. */
  onDismiss: () => void;
  /** Turned down. The offer is not made again for this version. */
  onLater: () => void;
}

/**
 * The offer to install a version that is waiting.
 *
 * The check has always run at startup, and what it produced was a dot on the
 * settings button. That is a fine way to report something nobody asked about
 * and a poor way to say a new version exists: it took noticing a mark, opening
 * Settings, and scrolling to the bottom before the news arrived. Most people
 * never did, which is how an installed base sits on an old release that fixed
 * the thing they are complaining about.
 *
 * So it is asked outright, once per release. "Later" is recorded against that
 * version and the question is not put again for it — the dot stays and Settings
 * still installs it, so saying no costs nobody the update. The nagging version
 * of this feature would work better and be worse.
 *
 * Two ways out, deliberately not the same. The cross, the backdrop and Escape
 * put it away for now and record nothing. "Later" is an answer, and is kept.
 * Neither is offered mid-download, where there is no longer a question.
 *
 * The other half of this pair is `WhatsNew`, which is this same window after
 * the update is installed. This one is the before.
 */
export function UpdateOffer({ open, onDismiss, onLater }: UpdateOfferProps) {
  const t = useT();
  const status = useUpdateStore((s) => s.status);
  const version = useUpdateStore((s) => s.version);
  const notes = useUpdateStore((s) => s.notes);
  const progress = useUpdateStore((s) => s.progress);
  const error = useUpdateStore((s) => s.error);
  const checkNow = useUpdateStore((s) => s.checkNow);
  const download = useUpdateStore((s) => s.download);
  const restartNow = useUpdateStore((s) => s.restartNow);
  const { present, shown } = useSheet(open);

  // The opening prose only. Everything the release said is still in Settings,
  // which is where somebody goes to read it all rather than to answer a
  // question about it.
  const paragraphs = useMemo(() => (notes ? paragraphsOf(summaryOfNotes(notes)) : []), [notes]);

  /** Nothing is put away mid-download; there is no question on screen to leave. */
  const closeable = status !== 'downloading';
  /** Looking again after a failure, which is neither a question nor an answer. */
  const busy = status === 'checking';

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Capture phase and `stopImmediatePropagation`, as the other sheets do:
      // the shell listens on `window` too.
      e.stopImmediatePropagation();
      if (closeable) onDismiss();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, closeable, onDismiss]);

  if (!present) return null;

  /** What the filled pill does, which is a different thing in each state. */
  const act =
    status === 'ready'
      ? { label: t('update.restart'), run: restartNow }
      : status === 'error'
        ? { label: t('update.tryAgain'), run: checkNow }
        : { label: t('update.download'), run: download };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-5">
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onDismiss}
        disabled={!closeable}
        className={`absolute inset-0 cursor-default bg-shell-900/70 backdrop-blur-[2px] transition-opacity duration-[180ms] ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div
        role="dialog"
        aria-label={t('update.newVersion')}
        className={`relative flex max-h-full w-full flex-col groove-surface overflow-hidden rounded-lg ring-1 ring-[var(--color-edge)] transition-all duration-[180ms] ease-out ${
          shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-[0.97] opacity-0'
        }`}
      >
        <div className="flex shrink-0 items-start justify-between gap-2 px-3 pt-2.5 pb-1">
          <div className="min-w-0">
            <p className="text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
              {t('update.newVersion')}
            </p>
            {version && (
              <p className="mt-0.5 truncate text-meta text-cream-400">
                {t('update.available', { version })}
              </p>
            )}
          </div>
          {closeable && (
            <button
              type="button"
              aria-label={t('common.close')}
              title={t('common.close')}
              onClick={onDismiss}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
            >
              <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
                <path
                  d="M1 1l8 8M9 1l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Marked English because the changelog is. Unlike `WhatsNew` there is
            no translated copy to reach for: these notes arrive off the network
            as the release wrote them, and a Turkish page holding an English
            paragraph gets `text-transform` and screen readers wrong unsaid. */}
        {paragraphs.length > 0 && (
          <div
            lang="en"
            className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pt-1 pb-2 text-body leading-relaxed text-cream-200"
          >
            {paragraphs.map((para, at) => (
              <p key={at}>{para}</p>
            ))}
          </div>
        )}

        <div className="shrink-0 space-y-1.5 px-3 pt-1 pb-2.5">
          {status === 'downloading' && (
            <div className="space-y-1">
              <p className="text-meta text-cream-400">
                {progress === null
                  ? t('update.downloadingUnknown')
                  : t('update.downloading', { percent: Math.round(progress * 100) })}
              </p>
              {progress !== null && (
                <div className="groove-inset h-1 w-full overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brass-600 to-brass-400 transition-[width] duration-150"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {status === 'ready' && (
            <p className="text-meta leading-snug text-cream-200">{t('update.ready')}</p>
          )}

          {status === 'error' && (
            <p className="rounded bg-red-950/70 px-2 py-1.5 text-meta leading-snug text-red-200">
              {t('update.failed', { message: error ?? '' })}
            </p>
          )}

          {status !== 'downloading' && (
            <div className="flex items-center justify-end gap-2">
              {status === 'available' && (
                <button
                  type="button"
                  onClick={onLater}
                  className="rounded-full px-2.5 py-1 text-meta text-cream-200 ring-1 ring-[var(--color-edge)] transition-colors hover:text-cream-50 hover:ring-brass-500"
                >
                  {t('update.later')}
                </button>
              )}
              <button
                type="button"
                onClick={() => void act.run()}
                disabled={busy}
                className="rounded-full bg-brass-600 px-3 py-1 text-meta font-medium tracking-wide text-on-accent uppercase transition-colors hover:bg-brass-500 disabled:opacity-60"
              >
                {busy ? t('update.checking') : act.label}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
