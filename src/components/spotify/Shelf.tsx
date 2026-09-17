import { useCallback, useEffect, useRef, useState } from 'react';
import { canGo, edgeWay, nextStop, scrolls, type Reach, type Way } from './shelfScroll';
import { useDiscHold } from '@/components/player/DiscHold';
import { useT } from '@/core/i18n';

/**
 * One shelf: a name, a row that runs off the side, and the way along it.
 *
 * The drawer is three of these now — what is on repeat, what was played, and
 * the playlists — so what used to be a shelf above a wall of crates is a wall
 * of nothing but shelves, each the same height and read the same way. A record
 * shop rather than a record shop's stockroom.
 *
 * The arrows exist because a row you run along is only a row you *can* run
 * along with a sideways wheel under your fingers. A touchpad has one, and a
 * mouse does not, so half the people using this had a shelf they could see the
 * start of and nothing else. They appear only on a shelf that is longer than
 * its window and go out at each end, which is the arrows telling the truth
 * about what is left — see `shelfScroll`.
 */
/** How long a record is held at an end before the shelf moves, and between moves. */
const EDGE_WAIT_MS = 400;
const EDGE_REPEAT_MS = 650;

export function Shelf({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const rail = useRef<HTMLDivElement | null>(null);
  const row = useRef<HTMLDivElement | null>(null);
  const [reach, setReach] = useState<Reach>({ at: 0, width: 0, visible: 0 });

  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    setReach({ at: el.scrollLeft, width: el.scrollWidth, visible: el.clientWidth });
  }, []);

  useEffect(() => {
    const el = rail.current;
    const inner = row.current;
    if (!el || !inner) return;
    // The first measurement comes from the observer's own opening call rather
    // than from a `measure()` here: measuring in the effect body would set
    // state during the effect, and the observer reports the same numbers one
    // frame later regardless.
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    // The inner row as well. It is what grows when a page of playlists lands,
    // and the scroller around it does not change size when that happens.
    watch.observe(inner);
    return () => watch.disconnect();
  }, [measure]);

  /**
   * Move along.
   *
   * Measured at the press rather than read off the last render. A press during
   * a smooth scroll that is still running would otherwise step from where the
   * shelf was when it started, and land short or long.
   */
  const go = useCallback((way: Way) => {
    const el = rail.current;
    if (!el) return;
    const now = { at: el.scrollLeft, width: el.scrollWidth, visible: el.clientWidth };
    el.scrollTo({ left: nextStop(now, way), behavior: 'smooth' });
  }, []);

  /**
   * The way along with a record in the hand.
   *
   * Held against either end for a moment, the shelf moves one step, and again
   * for as long as it stays there. A moment rather than at once, so a record
   * swept across the drawer on its way to the deck does not scroll every shelf
   * it passes.
   */
  const { subscribeCarry } = useDiscHold();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let asking: Way | null = null;
    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      asking = null;
    };
    const unsubscribe = subscribeCarry((point) => {
      const el = rail.current;
      const way = point && el ? edgeWay(point, el.getBoundingClientRect()) : null;
      if (way === asking) return;
      stop();
      if (!way) return;
      asking = way;
      const step = () => {
        go(way);
        timer = setTimeout(step, EDGE_REPEAT_MS);
      };
      timer = setTimeout(step, EDGE_WAIT_MS);
    });
    return () => {
      stop();
      unsubscribe();
    };
  }, [go, subscribeCarry]);

  return (
    <section className="flex shrink-0 flex-col" aria-label={heading}>
      <div className="flex items-center justify-between gap-2 px-0.5 pb-1">
        <span className="min-w-0 truncate text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
          {heading}
        </span>
        {/* Nothing at all on a shelf that fits. A pair of arrows that can never
            do anything is furniture, and three rows of it is a lot of
            furniture. */}
        {scrolls(reach) && (
          <div className="flex shrink-0 items-center gap-0.5">
            <Arrow way="left" label={t('shelf.left')} spent={!canGo(reach, 'left')} onPress={go} />
            <Arrow
              way="right"
              label={t('shelf.right')}
              spent={!canGo(reach, 'right')}
              onPress={go}
            />
          </div>
        )}
      </div>
      <div
        ref={rail}
        onScroll={measure}
        className="overflow-x-auto"
        // No bar. The arrows are the control, the wheel still works, and a
        // scrollbar under every one of three rows is three grey lines across a
        // drawer that is mostly artwork.
        style={{ scrollbarWidth: 'none' }}
      >
        {/* `w-max` so the row is as wide as what is on it. Left to the flex
            default it would be the scroller's width, there would be nothing to
            scroll, and the observer would never see it grow.

            Padded top and bottom rather than only at the bottom, for the same
            two pixels in total. A scroller that scrolls sideways clips what
            goes above it as well, and a record that lifts on hover lifts
            upwards — with the padding all at the foot, the lift happened and
            nobody could see it. */}
        <div ref={row} className="flex w-max gap-2.5 pt-0.5 pb-0.5">
          {children}
        </div>
      </div>
    </section>
  );
}

function Arrow({
  way,
  label,
  spent,
  onPress,
}: {
  way: Way;
  label: string;
  /** There is nothing left this way. */
  spent: boolean;
  onPress: (way: Way) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={spent}
      onClick={() => onPress(way)}
      className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50 disabled:pointer-events-none disabled:opacity-25"
    >
      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true" fill="none">
        <path
          d={way === 'left' ? 'M6.5 1 2.5 5l4 4' : 'M3.5 1 7.5 5l-4 4'}
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
