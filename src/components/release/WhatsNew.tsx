import { useEffect, useMemo } from 'react';
import { useSheet } from '@/core/utils/useSheet';
import { paragraphsOf, type ReleaseSummary } from '@/core/release';
import { APP_VERSION } from '@/core/version';
import { useT } from '@/core/i18n';

interface WhatsNewProps {
  open: boolean;
  /** The running version's summary. Never opened without one. */
  summary: ReleaseSummary;
  onClose: () => void;
}

/**
 * What changed in the version now running.
 *
 * A sheet rather than a panel, and that is not a matter of taste. The `z-20`
 * panels are suppressed while the window is collapsed — `App` derives `shown`
 * from `compact` — so a first launch in compact mode would have shown this to
 * nobody and then marked it read. A sheet covers the whole window on its own
 * terms, which is also right for the one thing here that wants reading before
 * anything else is touched.
 *
 * Closing is closing, however it is done: the cross, the backdrop, Escape and
 * the button all mean the same thing, and all of them count as having seen it.
 * There is no way to be shown this twice by accident and no way to dismiss it
 * so that it comes back — Settings keeps a way in for anyone who wants it
 * again.
 */
export function WhatsNew({ open, summary, onClose }: WhatsNewProps) {
  const t = useT();
  const { present, shown } = useSheet(open);
  const paragraphs = useMemo(() => paragraphsOf(summary.text), [summary.text]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Capture phase and `stopImmediatePropagation`, for the reason the
        // other sheets do it: the shell listens on `window` too, and only the
        // immediate variant keeps a single press from closing two things.
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!present) return null;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-5">
      <button
        type="button"
        aria-label={t('whatsNew.close')}
        onClick={onClose}
        className={`absolute inset-0 cursor-default bg-shell-900/70 backdrop-blur-[2px] transition-opacity duration-[180ms] ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div
        role="dialog"
        aria-label={t('whatsNew.title')}
        className={`relative flex max-h-full w-full flex-col groove-surface overflow-hidden rounded-lg ring-1 ring-[var(--color-edge)] transition-all duration-[180ms] ease-out ${
          shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-[0.97] opacity-0'
        }`}
      >
        <div className="flex shrink-0 items-start justify-between gap-2 px-3 pt-2.5 pb-1">
          <div className="min-w-0">
            <p className="text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
              {t('whatsNew.title')}
            </p>
            <p className="mt-0.5 truncate text-meta text-cream-400">
              {t('settings.version', { version: APP_VERSION })}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('whatsNew.close')}
            title={t('common.close')}
            onClick={onClose}
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
        </div>

        {/* Marked with the language the text is actually in, which is not always
            the interface's: a release with no Turkish section falls back to the
            English one, and a Turkish page holding an English paragraph gets
            both `text-transform` and a screen reader wrong without this. */}
        <div
          lang={summary.language}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pt-1 pb-2 text-body leading-relaxed text-cream-200"
        >
          {/* Keyed by position, which is what a list that never reorders and
              never grows should use. Keying by the text would collide the day
              a release repeated a sentence. */}
          {paragraphs.map((para, at) => (
            <p key={at}>{para}</p>
          ))}
        </div>

        <div className="flex shrink-0 justify-end px-3 pt-1 pb-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-brass-600 px-3 py-1 text-meta font-medium tracking-wide text-on-accent uppercase transition-colors hover:bg-brass-500"
          >
            {t('whatsNew.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}
