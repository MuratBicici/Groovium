import { useLayoutEffect, useRef, useState } from 'react';
import { useT } from '@/core/i18n';
import type { NoticeKind } from '@/core/notice';
import { prefersReducedMotion } from '@/core/utils/motion';

/**
 * How long a notice stays: long enough to read, longer for more to read.
 * Six seconds for a sentence of forty letters, never more than twelve.
 */
export function noticeMs(text: string): number {
  return Math.min(12_000, 4_000 + text.length * 50);
}

/** How long the pill takes to open, and how much faster it closes. */
export const OPENS_MS = 560;
const CLOSES_FASTER = 1.5;
/** How long it takes to fit a different message, when one follows another. */
const REFITS_MS = 220;
/** When the words come up inside it, for how long. */
const WORDS_AT_MS = 310;
const WORDS_TAKE_MS = 180;

const SETTLING = 'cubic-bezier(.2,.8,.3,1)';

/** Round at its ends: as wide a corner as its height allows, up to a limit. */
export function pillRadius(height: number): number {
  return Math.min(height / 2, 15);
}

/**
 * The shape of it opening, as keyframes. The mark comes up on its own from below
 * the foot of the stage, waits a moment, and the pill opens out either side of it.
 */
export function openingFrames(width: number, height: number): Keyframe[] {
  const mark = Math.max(26, Math.min(height, 28));
  const asMark = { width: `${mark}px`, height: `${mark}px`, borderRadius: `${mark / 2}px` };
  return [
    { ...asMark, transform: 'translateY(26px) scale(.4)', offset: 0 },
    { ...asMark, transform: 'translateY(0) scale(1)', offset: 0.42 },
    { ...asMark, transform: 'translateY(0) scale(1)', offset: 0.5 },
    {
      width: `${width}px`,
      height: `${height}px`,
      borderRadius: `${pillRadius(height)}px`,
      transform: 'translateY(0) scale(1)',
      offset: 1,
    },
  ];
}

function Mark({ kind }: { kind: NoticeKind }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0 text-brass-400"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === 'done' && <path d="M3.25 8.5l3.2 3.2 6.3-7" />}
      {kind === 'problem' && (
        <>
          <path d="M8 2.4l6.1 10.8H1.9z" />
          <path d="M8 6.6v3M8 11.3v.1" />
        </>
      )}
      {kind === 'info' && (
        <>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.5v3.4M8 5.1v.1" />
        </>
      )}
    </svg>
  );
}

/**
 * Something the player has to say: Spotify will not play a song here, a link was
 * copied, the equaliser had to stop.
 *
 * A pill that comes up from the foot of the stage, just above the progress bar: its
 * mark first, on its own, and then opening out either side of that to say the rest.
 * A tick for something done and a warning for something wrong, since they had been
 * the same card with the same mark, and a link copied read like a fault.
 *
 * Before that it was a red strip that pushed the controls up, and then a card right
 * across the window. It goes by itself once it has been there long enough to read,
 * and waits while the pointer is on it. Pressed, it goes at once.
 */
export function Notice({
  message,
  kind,
  onDismiss,
  action,
}: {
  message: string | null;
  kind: NoticeKind;
  onDismiss: () => void;
  /** Something to do about it, as a word at the end: battery saver, and turning it off. */
  action?: { label: string; onPress: () => void } | undefined;
}) {
  const t = useT();
  /** What is shown, which outlives `message` for the length of its way out. */
  const [showing, setShowing] = useState(message);
  const [shownKind, setShownKind] = useState(kind);
  if (message !== null && message !== showing) setShowing(message);
  if (message !== null && kind !== shownKind) setShownKind(kind);

  const pill = useRef<HTMLDivElement>(null);
  const words = useRef<HTMLDivElement>(null);
  const running = useRef<Animation[]>([]);
  /** The size it was last opened to; null while it is put away. */
  const size = useRef<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const box = pill.current;
    const inner = words.current;
    if (!box || !inner || showing === null || message === null) return;
    const width = Math.ceil(inner.offsetWidth);
    const height = Math.ceil(inner.offsetHeight);
    const was = size.current;
    size.current = { width, height };
    if (was?.width === width && was.height === height) return;

    running.current.forEach((animation) => animation.cancel());
    running.current = [];
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
    box.style.borderRadius = `${pillRadius(height)}px`;
    if (prefersReducedMotion() || typeof box.animate !== 'function') return;

    if (was) {
      running.current = [
        box.animate(
          [
            { width: `${was.width}px`, height: `${was.height}px` },
            { width: `${width}px`, height: `${height}px` },
          ],
          { duration: REFITS_MS, easing: SETTLING },
        ),
      ];
      return;
    }
    running.current = [
      box.animate(openingFrames(width, height), { duration: OPENS_MS, easing: SETTLING, fill: 'both' }),
      inner.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: WORDS_TAKE_MS,
        delay: WORDS_AT_MS,
        easing: 'ease-out',
        fill: 'both',
      }),
    ];
  }, [showing, message, action?.label]);

  useLayoutEffect(() => {
    if (message !== null || showing === null) return;
    size.current = null;
    const going = running.current;
    if (going.length === 0 || prefersReducedMotion()) {
      setShowing(null);
      return;
    }
    let left = going.length;
    for (const animation of going) {
      animation.addEventListener(
        'finish',
        () => {
          left -= 1;
          if (left === 0) setShowing(null);
        },
        { once: true },
      );
      animation.updatePlaybackRate(-CLOSES_FASTER);
      animation.play();
    }
  }, [message, showing]);

  if (showing === null) return null;
  return (
    // Clipped at the top of the progress bar, below the foot of the stage, so that the
    // mark comes up out of the bar.
    <div className="pointer-events-none absolute inset-x-0 -bottom-[18px] z-40 h-44 overflow-hidden">
      <div className="absolute inset-x-0 bottom-1.5 flex justify-center">
        <div
          ref={pill}
          role="status"
          aria-live="polite"
          className="groove-notice pointer-events-auto relative overflow-hidden groove-surface shadow-[0_3px_10px_rgba(0,0,0,.5)] motion-reduce:transition-none"
        >
          <button
            type="button"
            onClick={onDismiss}
            title={t('common.dismiss')}
            aria-label={t('common.dismiss')}
            className="absolute inset-0 cursor-pointer"
          />
          <div
            ref={words}
            className="pointer-events-none absolute top-1/2 left-1/2 flex w-max max-w-[min(296px,calc(100vw-44px))] -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 px-3 py-1.5"
          >
            <Mark kind={shownKind} />
            <span className="line-clamp-4 min-w-0 text-meta leading-snug text-cream-100">{showing}</span>
            {action && (
              <button
                type="button"
                onClick={action.onPress}
                className="pointer-events-auto ml-1 shrink-0 rounded-full bg-brass-600 px-2.5 py-0.5 text-meta font-medium text-on-accent transition-colors hover:bg-brass-500"
              >
                {action.label}
              </button>
            )}
          </div>
          {/* Draws nothing. It is the notice's clock: its animation ends when the
              notice has been up long enough, and the styles pause it for a pointer
              or the focus on it. Keyed by the message, so another one starts over. */}
          <span
            key={showing}
            aria-hidden="true"
            className="groove-notice-line absolute h-0 w-0"
            style={{ ['--notice-ms' as string]: `${noticeMs(showing)}ms` }}
            onAnimationEnd={message === null ? undefined : onDismiss}
          />
        </div>
      </div>
    </div>
  );
}
