import { useEffect, useRef } from 'react';
import { levelFrom, settleLevel, watchBars } from '@/core/visualizer';
import { prefersReducedMotion } from '@/core/utils/motion';

/**
 * Light climbing the window's edge with the music.
 *
 * The same frames the blocks behind the deck are drawn from, read as one
 * number instead of two dozen: how loud it is right now. That number is the
 * height the light reaches, and the light gets brighter the higher it goes, so
 * a loud passage puts brass all the way round the frame and a quiet one leaves
 * a warm line along the bottom.
 *
 * A CSS custom property rather than anything React re-renders. This changes
 * sixty times a second and moves one gradient; putting that through a render
 * would be the whole window's tree for an ornament nobody is looking straight
 * at. The gradient itself is in `styles.css` under `.groove-glow`, where the
 * theme's own colours are.
 */
export function WindowGlow({ on }: { on: boolean }) {
  const edge = useRef<HTMLDivElement | null>(null);
  /** What Rust last said, and what is currently drawn. */
  const measured = useRef(0);
  const showing = useRef(0);

  useEffect(() => {
    if (!on) return;
    return watchBars((bars) => {
      measured.current = levelFrom(bars);
    });
  }, [on]);

  useEffect(() => {
    if (!on || prefersReducedMotion()) return;

    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const next = settleLevel(showing.current, measured.current);
      // Only when it moved. A property write is a style recalculation on the
      // element every layer of this window sits inside.
      if (next === showing.current) return;
      showing.current = next;
      edge.current?.style.setProperty('--glow', next.toFixed(3));
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [on]);

  if (!on) return null;

  // `z-50` and immediately before the window's edge, so the hairline stays
  // crisp on top of the light rather than under it. Both are the window's own
  // border and neither may be covered by anything inside.
  return <div ref={edge} aria-hidden="true" className="groove-glow pointer-events-none absolute inset-0 z-50" />;
}
