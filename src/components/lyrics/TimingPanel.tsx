import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { prefersReducedMotion } from '@/core/utils/motion';
import { ARRIVE_EASING, LEAVE_EASING } from './motion';

/**
 * The surface the timing strip sits on, and its way in and out.
 *
 * It opens out of a line — the progress bar it covers in the compact view,
 * the drawer's foot in the drawer — top and bottom pulling apart from it, as
 * though the bar had thickened into the strip. Inside, the line marks fall
 * into place from left to right and the two handles come in from the ends;
 * the rest fades up. Going, it folds back into the line.
 *
 * Kept on screen through the way out, as `usePresence` keeps a view; shown
 * again part way, it turns round from where it had got to.
 */

/** How long it takes to open out of its line, and to fold back. */
const OPEN_MS = 300;
const FOLD_MS = 220;
/** When the marks start falling, and how long all of them take at most. */
const MARKS_FROM_MS = 140;
const MARKS_SPREAD_MS = 260;

export function TimingPanel({
  show,
  foldAt,
  className,
  style,
  children,
}: {
  show: boolean;
  /** The line it opens out of, from its own top; its foot when left out. */
  foldAt?: number;
  className: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const [present, setPresent] = useState(show);
  if (show && !present) setPresent(true);
  // With motion turned down there is no way out to play: gone at once.
  if (!show && present && prefersReducedMotion()) setPresent(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const midway = el.getAnimations().length > 0;
    const drawn = getComputedStyle(el).clipPath;
    for (const a of el.getAnimations({ subtree: true })) a.cancel();
    if (prefersReducedMotion()) return;

    const height = el.offsetHeight;
    const line = Math.min(height, Math.max(0, foldAt ?? height - 2));
    const shut = `inset(${Math.max(0, line - 2)}px 0px ${Math.max(0, height - line - 2)}px 0px round 2px)`;
    const open = 'inset(0px 0px 0px 0px round 8px)';
    const inside = [...el.querySelectorAll<HTMLElement>('[data-panel-fade]')];

    if (show) {
      el.animate([{ clipPath: midway && drawn !== 'none' ? drawn : shut }, { clipPath: open }], {
        duration: OPEN_MS,
        easing: ARRIVE_EASING,
      });
      if (midway) return;
      // The marks in the order they lie along the strip, left to right.
      const marks = [...el.querySelectorAll<HTMLElement>('[data-tick]')].sort(
        (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left,
      );
      const step = Math.min(14, MARKS_SPREAD_MS / Math.max(1, marks.length));
      marks.forEach((mark, i) => {
        mark.animate(
          [
            { transform: 'translateY(-8px)', opacity: 0 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: 220, delay: MARKS_FROM_MS + i * step, easing: ARRIVE_EASING, fill: 'backwards' },
        );
      });
      const pins = [...el.querySelectorAll<HTMLElement>('[data-pin]')];
      pins.forEach((pin, i) => {
        const from = i === 0 ? 'translateX(-14px)' : i === pins.length - 1 ? 'translateX(14px)' : 'none';
        pin.animate(
          [
            { transform: from, opacity: 0 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: 260, delay: MARKS_FROM_MS - 20, easing: ARRIVE_EASING, fill: 'backwards' },
        );
      });
      for (const part of inside) {
        part.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 180,
          delay: MARKS_FROM_MS + 20,
          easing: 'linear',
          fill: 'backwards',
        });
      }
      return;
    }

    el.style.pointerEvents = 'none';
    for (const part of [...inside, ...el.querySelectorAll<HTMLElement>('[data-tick], [data-pin]')]) {
      part.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100, fill: 'forwards' });
    }
    const fold = el.animate([{ clipPath: drawn !== 'none' ? drawn : open }, { clipPath: shut }], {
      duration: FOLD_MS,
      delay: 60,
      easing: LEAVE_EASING,
      fill: 'forwards',
    });
    // Cancelled means it was shown again on the way out, and stays.
    fold.finished.then(
      () => setPresent(false),
      () => {},
    );
    return () => {
      el.style.pointerEvents = '';
    };
    // The line it folds into is read when it moves, not followed while it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, present]);

  if (!present) return null;
  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
