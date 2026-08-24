import { useEffect, useState } from 'react';

/**
 * How long a sheet takes to arrive or leave. Shorter than the panels' 200ms
 * because a sheet covers what you were looking at, and the wait to get back to
 * it is felt more than the wait to reach it.
 */
export const SHEET_MS = 180;

export interface SheetPresence {
  /** Whether to render at all. Stays true through the exit. */
  present: boolean;
  /** Whether to render in the open pose. False for the first frame, and for the exit. */
  shown: boolean;
}

/**
 * Keep a sheet on screen long enough to leave.
 *
 * The panels never had this problem: they stay mounted and fade with `inert`,
 * so a CSS transition is the whole of it. A sheet cannot — the playlist picker
 * needs a track, the colour picker needs to know which colour, and neither has
 * one while closed — so they unmounted, which is why they appeared and vanished
 * instead of opening and closing.
 *
 * Two facts rather than one. `present` outlives `open` by the length of the
 * exit, and `shown` lags it by a frame on the way in: an element that mounts
 * already in its final pose has nothing to transition from, which is the oldest
 * bug in this kind of code.
 */
export function useSheet(open: boolean): SheetPresence {
  const [leaving, setLeaving] = useState(false);
  const [shown, setShown] = useState(open);
  /** What `open` was last render, so the change can be noticed during this one. */
  const [wasOpen, setWasOpen] = useState(open);

  // Adjusted during render rather than in an effect, which is what React's own
  // guidance says to do for state derived from a prop — and what keeps the exit
  // from costing a second paint in the open pose. State rather than a ref: a
  // ref read during render is what the compiler's rules forbid, and rightly,
  // since it is invisible to React's own bookkeeping.
  if (wasOpen !== open) {
    setWasOpen(open);
    setLeaving(!open);
  }

  useEffect(() => {
    // A frame late on purpose. The browser needs to have painted the closed
    // pose once for there to be a transition into the open one.
    const frame = requestAnimationFrame(() => setShown(open));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(false), SHEET_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  return { present: open || leaving, shown: shown && open };
}
