import { useLayoutEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/core/utils/motion';
import { ARRIVE_EASING, LEAVE_EASING, LEAVE_MS, SCENE_MS } from './motion';

/**
 * Keeps a view on screen long enough to arrive and leave.
 *
 * `show` says whether it should be there. The moment it says no the view
 * would be gone with nothing left to fade, so this holds it, plays the way out
 * on it, and only then lets it go. Shown again part way out, it turns round
 * from wherever it had got to.
 *
 * `away` is where it comes from and goes to, as a transform.
 */
export function usePresence(show: boolean, away = 'scale(0.985)') {
  const [present, setPresent] = useState(show);
  if (show && !present) setPresent(true);
  // With motion turned down there is no way out to play: gone at once.
  if (!show && present && prefersReducedMotion()) setPresent(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Start from what is drawn now, not from either end.
    const from = getComputedStyle(el);
    const now = { opacity: from.opacity, transform: from.transform };
    const midway = el.getAnimations().length > 0;
    for (const a of el.getAnimations()) a.cancel();
    if (prefersReducedMotion()) return;
    if (show) {
      el.animate([midway ? now : { opacity: 0, transform: away }, { opacity: 1, transform: 'none' }], {
        duration: SCENE_MS,
        easing: ARRIVE_EASING,
      });
      return;
    }
    el.style.pointerEvents = 'none';
    const out = el.animate([now, { opacity: 0, transform: away }], {
      duration: LEAVE_MS,
      easing: LEAVE_EASING,
      fill: 'forwards',
    });
    // Cancelled means it was shown again on the way out, and stays.
    out.finished.then(
      () => setPresent(false),
      () => {},
    );
    return () => {
      el.style.pointerEvents = '';
    };
  }, [show, present, away]);

  return { present, ref };
}
