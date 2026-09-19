import { useEffect, useState, type RefObject } from 'react';
import { activeLine, type LyricLine } from '@/core/lyrics/activeLine';
import { playheadMs } from '@/core/lyrics/playhead';
import { turnsTo } from './arc';

/** The line being sung, and whether the move to it was a jump rather than a step. */
export interface Place {
  active: number;
  /** A seek or a skip of more than a line or two: cut to it rather than move. */
  jumped: boolean;
}

/** A syllable not yet sung, on the line being sung. */
export const UNSUNG = 'lyric-unsung';

/**
 * The line being sung, followed frame by frame.
 *
 * One animation frame loop reads the shared clock and finds the line by binary
 * search. React hears about it only when the line changes — a few times a
 * minute, not sixty times a second. The syllables of the line being sung are
 * lit from the same loop by hand, on the element `activeEl` points at, and
 * only when the syllable reached changes.
 */
export function useLyricFrame(
  lines: readonly LyricLine[] | null,
  activeEl: RefObject<HTMLElement | null>,
): Place {
  const [place, setPlace] = useState<Place>({ active: -1, jumped: true });

  useEffect(() => {
    if (!lines) return;
    let frame = 0;
    let shown = Number.NaN;
    /** The element lit so far, and how far into it. */
    let litIn: HTMLElement | null = null;
    let lit = -2;

    const tick = () => {
      const ms = playheadMs();
      const index = activeLine(lines, ms);
      if (index !== shown) {
        setPlace({ active: index, jumped: Number.isNaN(shown) || !turnsTo(shown, index) });
        shown = index;
      }

      // The element for this line only once React has put it there: until
      // then the one pointed at is still the previous line's.
      const el = activeEl.current;
      const words = index >= 0 ? lines[index]?.words : undefined;
      if (el && words && el.dataset.line === String(index)) {
        if (el !== litIn) {
          litIn = el;
          lit = -2;
        }
        const reached = activeLine(words, ms);
        if (reached !== lit) {
          const spans = el.querySelectorAll<HTMLElement>('[data-syllable]');
          // Forward as the song goes, or back after a seek within the line.
          spans.forEach((span, k) => span.classList.toggle(UNSUNG, k > reached));
          lit = reached;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [lines, activeEl]);

  return lines ? place : { active: -1, jumped: true };
}
