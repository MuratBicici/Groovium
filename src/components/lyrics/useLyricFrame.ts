import { useEffect, useState, type RefObject } from 'react';
import { acrossWords, activeLine, lineSweep, type LyricLine } from '@/core/lyrics/activeLine';
import { playheadMs } from '@/core/lyrics/playhead';
import { prefersReducedMotion } from '@/core/utils/motion';
import { useShown } from '@/platform/shown';
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
 * minute, not sixty times a second. The light over the line being sung is put
 * there from the same loop by hand, on the element `activeEl` points at.
 *
 * How the line is lit depends on what the source gave. Timed syllable by
 * syllable, each is lit as it is reached — the exact thing, and only when the
 * syllable reached changes. Timed only as a line, the light crosses its words
 * evenly instead, in the time between this line and the next: each word is
 * told how far into it the light has got, and the stylesheet draws it. Either
 * way the whole line is lit as it ends.
 *
 * Along the words rather than across the box, because a line can wrap. A ramp
 * across the box is a ramp across both rows at once, and the second row fills
 * before its first word is sung; along the words, a row break is only where
 * the next word happens to be.
 */
export function useLyricFrame(
  lines: readonly LyricLine[] | null,
  activeEl: RefObject<HTMLElement | null>,
): Place {
  const [place, setPlace] = useState<Place>({ active: -1, jumped: true });
  // Not `shown`: below, that is the line last shown.
  const onScreen = useShown();

  useEffect(() => {
    // A window nobody can see has no line to light. The clock keeps the time
    // either way, so coming back is the next frame rather than a catch-up.
    if (!lines || !onScreen) return;
    let frame = 0;
    let shown = Number.NaN;
    /** No light crossing the line when motion is not wanted: lit, and still. */
    let still = prefersReducedMotion();
    /** The element lit so far, and how far into it. */
    let litIn: HTMLElement | null = null;
    let lit = -2;
    /** The line whose words were measured, and what came back. */
    let wordsIn: HTMLElement | null = null;
    // Not `words`: below, that is what a source timed, if it timed any.
    let spans: HTMLElement[] = [];
    let widths: number[] = [];
    /** What each word was last told, so a frame that moves nothing writes nothing. */
    let told: number[] = [];

    const tick = () => {
      const ms = playheadMs();
      const index = activeLine(lines, ms);
      if (index !== shown) {
        setPlace({ active: index, jumped: Number.isNaN(shown) || !turnsTo(shown, index) });
        shown = index;
        still = prefersReducedMotion();
      }

      // The element for this line only once React has put it there: until
      // then the one pointed at is still the previous line's.
      const el = activeEl.current;
      const words = index >= 0 ? lines[index]?.words : undefined;
      if (el && el.dataset.line === String(index)) {
        if (words) {
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
        } else {
          // Measured once a line, off the words as they are laid out — which is
          // where a wrapped row is decided, and the only thing that has to be
          // true is that they are in the order they are read.
          if (el !== wordsIn) {
            wordsIn = el;
            spans = [...el.querySelectorAll<HTMLElement>('[data-word]')];
            widths = spans.map((span) => span.offsetWidth);
            told = [];
          }
          const through = still ? 1 : lineSweep(lines, index, ms);
          const shares = acrossWords(widths, through);
          for (let w = 0; w < spans.length; w += 1) {
            const share = shares[w] ?? 0;
            const was = told[w];
            // A hundredth of a word is well under a pixel of one: writing it
            // is a style change nobody could see.
            if (was !== undefined && Math.abs(was - share) < 0.01) continue;
            told[w] = share;
            spans[w]?.style.setProperty('--sung', share.toFixed(3));
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [lines, activeEl, onScreen]);

  return lines ? place : { active: -1, jumped: true };
}
