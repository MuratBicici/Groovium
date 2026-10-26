import { useState } from 'react';
import { useT } from '@/core/i18n';
import { useSheet } from '@/core/utils/useSheet';

/**
 * How long a notice stays: long enough to read, longer for more to read.
 * Six seconds for a sentence of forty letters, never more than twelve.
 */
export function noticeMs(text: string): number {
  return Math.min(12_000, 4_000 + text.length * 50);
}

/**
 * Something the player has to say: Spotify will not play a song here, a
 * setting could not be saved.
 *
 * It was a red strip across the foot of the window, which pushed the controls
 * up to make room, stayed until it was clicked, and made a song not sold in
 * this country look like an alarm. Now it is a card in the window's own
 * colours over the foot of the stage, above the controls, so nothing moves;
 * it goes by itself once it has been there long enough to read, with a line
 * along its foot running down to that, which waits while the pointer is on it.
 * Pressed, it goes at once.
 */
export function Notice({
  message,
  onDismiss,
  action,
}: {
  message: string | null;
  onDismiss: () => void;
  /**
   * Something to do about it, as a word on the card's right — battery saver
   * coming on, and turning it off. Beside the card's own button rather than
   * inside it: a button cannot hold another.
   */
  action?: { label: string; onPress: () => void } | undefined;
}) {
  const t = useT();
  const { present, shown } = useSheet(message !== null);
  /** What the card shows, which outlives `message` for the length of its way out. */
  const [showing, setShowing] = useState(message);
  if (message !== null && message !== showing) setShowing(message);

  if (!present || showing === null) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`groove-notice pointer-events-auto absolute inset-x-2.5 bottom-1 z-40 transition-all duration-[180ms] ease-out motion-reduce:transition-none ${
        shown ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
      }`}
    >
      <button
        type="button"
        onClick={onDismiss}
        title={t('common.dismiss')}
        className="relative flex w-full items-start gap-2 overflow-hidden rounded-lg groove-surface px-2.5 pt-2 pb-2.5 text-left shadow-lg ring-1 ring-[var(--color-edge)]"
      >
        <svg
          viewBox="0 0 16 16"
          className="mt-px h-3.5 w-3.5 shrink-0 text-brass-400"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 4.75v3.75M8 11.1v.15" />
        </svg>
        <span className="line-clamp-4 min-w-0 flex-1 text-meta leading-snug text-cream-100">{showing}</span>
        {/* Room for the action, which sits over this corner from outside. */}
        {action && <span aria-hidden="true" className="w-14 shrink-0" />}
        <svg
          viewBox="0 0 10 10"
          className="mt-0.5 h-2.5 w-2.5 shrink-0 text-cream-400"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        >
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
        </svg>
        {/* Keyed by the message, so another one starts the count again. */}
        <span
          key={showing}
          aria-hidden="true"
          className="groove-notice-line absolute inset-x-2.5 bottom-1 h-0.5 rounded-full bg-brass-400/70"
          style={{ ['--notice-ms' as string]: `${noticeMs(showing)}ms` }}
          onAnimationEnd={message === null ? undefined : onDismiss}
        />
      </button>
      {action && (
        <button
          type="button"
          onClick={action.onPress}
          className="absolute top-1.5 right-7 rounded-full bg-brass-600 px-2.5 py-0.5 text-meta font-medium text-on-accent transition-colors hover:bg-brass-500"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
