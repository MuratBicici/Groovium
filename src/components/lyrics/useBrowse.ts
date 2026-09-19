import { useCallback, useEffect, useRef, useState } from 'react';
import { HOLD_MS, linesFor, moveBetween, scrollTo, shownLine, type Move, type Wheel } from './browse';

/**
 * A view's own scrolling through the lyrics — see `browse.ts` for the rules.
 *
 * Returns the line the view shows, how it moved there, a wheel handler, and a
 * way to come back at once (a line picked by hand). A new song starts back at
 * the singing.
 */
export function useBrowse(count: number, sung: number, song: string | undefined) {
  const [away, setAway] = useState<number | null>(null);
  const [songShown, setSongShown] = useState(song);
  if (songShown !== song) {
    setSongShown(song);
    setAway(null);
  }

  // How the view got to the line it shows, worked out as it changes: the move
  // from the last line shown, and whether that was the way back from a scroll.
  const view = shownLine(away, sung);
  const [shown, setShown] = useState<{ view: number; away: boolean; move: Move }>({
    view,
    away: false,
    move: { kind: 'cut' },
  });
  if (shown.view !== view) {
    setShown({
      view,
      away: away !== null,
      move: moveBetween(shown.view, view, shown.away && away === null),
    });
  }

  const wheel = useRef<Wheel>({ at: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sungNow = useRef(sung);
  useEffect(() => {
    sungNow.current = sung;
  }, [sung]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onWheel = useCallback(
    (deltaY: number) => {
      const step = linesFor(wheel.current, deltaY, performance.now());
      wheel.current = step.wheel;
      // Every scroll, even one short of a line, restarts the wait.
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setAway(null), HOLD_MS);
      if (step.lines !== 0) {
        setAway((current) => scrollTo(current, sungNow.current, step.lines, count));
      }
    },
    [count],
  );

  const release = useCallback(() => {
    clearTimeout(timer.current);
    setAway(null);
  }, []);

  return { view, browsing: away !== null, move: shown.move, onWheel, release };
}
