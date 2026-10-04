import { useCallback, useRef, useState } from 'react';
import { linesFor, moveBetween, type Move, type Wheel } from '@/components/lyrics/browse';

/**
 * Turning the queue's palette by hand.
 *
 * The lyrics wheel winds itself back to the line being sung a few seconds
 * after it is let go, because the singing is what it is for. The queue is not
 * following anything: it is somewhere to look along and work in, and turning
 * back on its own moved the record somebody was about to press. So it stays
 * where it was turned to.
 *
 * When the song changes, every record moves up a place; the palette turns with
 * them, so what was in front of somebody is still in front of them.
 */
export function useTurn(count: number, resting: number, song: string | undefined) {
  const [turned, setTurned] = useState<number | null>(null);
  const [songShown, setSongShown] = useState(song);
  if (songShown !== song) {
    setSongShown(song);
    if (turned !== null) setTurned(Math.max(0, turned - 1));
  }

  const highest = Math.max(0, count - 1);
  const view = Math.min(turned ?? resting, highest);

  const [shown, setShown] = useState<{ view: number; move: Move }>({ view, move: { kind: 'cut' } });
  if (shown.view !== view) setShown({ view, move: moveBetween(shown.view, view, false) });

  const wheel = useRef<Wheel>({ at: 0 });
  const onWheel = useCallback(
    (deltaY: number) => {
      const step = linesFor(wheel.current, deltaY, performance.now());
      wheel.current = step.wheel;
      if (step.lines === 0) return;
      setTurned((current) => Math.min(highest, Math.max(0, (current ?? resting) + step.lines)));
    },
    [highest, resting],
  );

  /** Back to the next song: after playing one, or when asked. */
  const release = useCallback(() => setTurned(null), []);

  return { view, move: shown.move, onWheel, release };
}
