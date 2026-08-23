import { useLayoutEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/core/utils/motion';
import { EXPANDED_HEIGHT, setWindowHeight } from '@/platform/window';

/**
 * Collapsing the widget to its controls, and opening it back up.
 *
 * **The shell animates; the window resizes once.** Calling `setSize` every
 * frame puts a window resize through the Windows compositor sixty times a
 * second, which is not what smooth looks like. The only thing anyone can see is
 * the shell — the window itself is transparent — so animating the shell *is*
 * the animation, and the window is corrected at the far end where the jump is
 * invisible.
 *
 * That makes the order matter, differently in each direction:
 *
 * - **Collapsing**, the shell shrinks first and the window follows. The extra
 *   window below the shell is transparent for those few hundred milliseconds.
 * - **Expanding**, the window grows first and the shell follows. The other way
 *   round, the shell would be taller than the window and get cut off.
 *
 * The shell's own height is never animated. It is `auto` while a transition is
 * running, so it follows its children as *they* animate — a parent sized by its
 * content reflows every frame, which is steadier than keeping two animations of
 * equal duration in step, and it needs no measurement of its own.
 *
 * Written against the DOM rather than through React state, deliberately. None
 * of this is information the tree renders from: it is one element's height
 * moving to another over a quarter of a second, and re-rendering the player
 * four hundred times to express that would be the wrong instrument.
 */

const DURATION_MS = 260;
const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';

export function useCompactShell(compact: boolean, ready: boolean) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const was = useRef(compact);
  const applied = useRef(false);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const stage = stageRef.current;
    const track = trackRef.current;
    const bottom = bottomRef.current;
    if (!shell || !stage || !track || !bottom) return;

    // Starting collapsed, from a stored preference. The window opens at the
    // size in `tauri.conf.json` every time — the state plugin saves position
    // only — so it has to be brought down to size once, without animating
    // something nobody asked to watch.
    if (!applied.current && ready) {
      applied.current = true;
      was.current = compact;
      if (compact) {
        shell.style.height = 'auto';
        void setWindowHeight(shell.offsetHeight);
      }
      return;
    }

    if (was.current === compact) return;
    was.current = compact;

    // Everything that never changes height: the header, the progress bar, the
    // controls, the gaps between them and the padding. Taken as a difference
    // rather than added up, so no gap has to be accounted for by hand.
    const chrome = shell.offsetHeight - stage.offsetHeight - bottom.offsetHeight;

    const from = { stage: stage.offsetHeight, bottom: bottom.offsetHeight };
    const to = compact
      ? // The track display is content-sized, so this is its true collapsed
        // height even though the stage around it is still pinned open.
        { stage: track.offsetHeight, bottom: 0 }
      : // The stage fills what is left of a full-height window, so its expanded
        // height comes from the window rather than from its contents.
        { stage: 0, bottom: naturalHeight(bottom) };
    if (!compact) to.stage = EXPANDED_HEIGHT - chrome - to.bottom;

    // Grow first, or the shell would animate past the bottom of the window.
    if (!compact) void setWindowHeight(EXPANDED_HEIGHT);

    if (prefersReducedMotion()) {
      if (compact) void setWindowHeight(chrome + to.stage + to.bottom);
      return;
    }

    const pin = (height: { stage: number; bottom: number }) => {
      stage.style.height = `${height.stage}px`;
      bottom.style.height = `${height.bottom}px`;
    };

    shell.style.height = 'auto';
    stage.style.overflow = 'hidden';
    bottom.style.overflow = 'hidden';
    // `flex-1` would make flex-basis the stage's main size and ignore the
    // height being animated, so the stage stops growing for the duration.
    stage.style.flex = '0 0 auto';
    pin(from);

    // Two frames: one to paint the starting heights, one to change them. Both
    // in a single frame land in the same style recalculation, and the browser
    // has nothing to interpolate from.
    const start = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        stage.style.transition = `height ${DURATION_MS}ms ${EASING}`;
        bottom.style.transition = `height ${DURATION_MS}ms ${EASING}`;
        pin(to);
      });
    });

    const settle = setTimeout(() => {
      for (const el of [stage, bottom]) {
        el.style.height = '';
        el.style.overflow = '';
        el.style.transition = '';
      }
      stage.style.flex = '';
      // Collapsed, the shell keeps sizing to its content rather than to the
      // window. The two are the same number once the resize lands, but this
      // way round the bar still looks right if the resize does not — and it is
      // what makes the collapsed state visible in a plain browser, where there
      // is no window to resize at all.
      shell.style.height = compact ? 'auto' : '';
      // Measured off the settled shell rather than predicted, so the window
      // ends up exactly as tall as what it is showing.
      if (compact && shellRef.current) void setWindowHeight(shellRef.current.offsetHeight);
    }, DURATION_MS + 40);

    return () => {
      cancelAnimationFrame(start);
      clearTimeout(settle);
    };
  }, [compact, ready]);

  return { shellRef, stageRef, trackRef, bottomRef };
}

/** An element's height as if nothing had been pinned. Never painted. */
function naturalHeight(el: HTMLElement): number {
  const pinned = el.style.height;
  el.style.height = 'auto';
  const measured = el.offsetHeight;
  el.style.height = pinned;
  return measured;
}
