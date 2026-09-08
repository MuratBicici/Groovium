import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/core/utils/motion';
import type { DrawerSide } from '@/core/settings';
import {
  DRAWER_WIDTH,
  EXPANDED_HEIGHT,
  setClickArea,
  setWindowSize,
  widthFor,
  windowWidthFor,
} from '@/platform/window';

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
 *
 * The heights it animates *from* are recorded while each state is settled,
 * rather than read when the toggle flips. A layout effect runs after React has
 * already put the new layout in the DOM, so measuring there gives the height
 * being animated to — and an animation from a number to itself is a jump. That
 * is exactly what shipped the first time.
 *
 * The record and the two lines of text travel between their two homes rather
 * than being swapped: each one is measured in the layout it is leaving and in
 * the layout it is arriving at, and the arriving element is animated from the
 * first to the second. The two are different elements — a 152px deck and a
 * 28px disc are not the same node — so this reads the old position from a
 * recording rather than from the DOM, which is the only part that differs from
 * an ordinary FLIP.
 *
 * For that to work the destination has to hold still. The stage centres its
 * contents, so while it shrinks the target would drift upward and the arrival
 * would never quite land; during a transition the contents are pinned to where
 * they will end up, and only the box around them moves.
 */

export const DURATION_MS = 260;

/**
 * When the window has finished catching up with the animation.
 *
 * The shell stops moving at `DURATION_MS`; the window is corrected to its exact
 * size a little after, once the shell has settled and can be measured. Anything
 * that wants to act on a finished drawer has to wait for this rather than for
 * the animation — starting the next one in between leaves it working from a
 * window that is still the old size, which is how swapping sides teleported the
 * player across the screen.
 */
export const SETTLE_MS = DURATION_MS + 40;

/**
 * Half of the fade the window changes sides behind.
 *
 * The one geometry change left that cannot be made invisible by arranging it
 * better. Going from one side to the other, the window's left edge moves and
 * the shell's place inside the window moves by the same amount in the opposite
 * direction — and those two live in different processes, so one of them is
 * always a frame late. Whichever way round, that frame is the player six
 * hundred and eighty pixels from where it belongs.
 *
 * So it happens with nothing on screen. The shell fades out, the window changes
 * shape to nothing at all — no outline for Windows to draw — moves, comes back,
 * and the shell fades in on the other side. It reads as a deliberate swap,
 * which is what it is: nobody presses this by accident.
 */
const SWAP_FADE_MS = 130;

/**
 * The whole of the side swap: out, across, and back in.
 *
 * Exported because the drawer must not start opening on the new side while this
 * is still running. It used to, both at once, which put a drawer growing out of
 * a shell that was fading and a window that was moving.
 */
export const SWAP_MS = SWAP_FADE_MS * 2;

/**
 * A beat after the swap before the drawer opens again.
 *
 * Short enough not to feel like waiting and long enough to read as two things
 * rather than one blurred one: the widget settles on its new side, and then the
 * drawer comes out of it.
 */
export const SWAP_PAUSE_MS = 90;
const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';

/**
 * Cut the window down to the part of it the shell is actually using.
 *
 * Narrower than the window only on the left, and only while the drawer is shut
 * — which is the whole of what pays for the window never moving. Outside the
 * shape the window is not there at all, so the transparent strip beside the
 * player does not swallow clicks meant for whatever is behind it.
 *
 * Every other case hands the window back whole.
 */
/**
 * The width to leave the shell at once it has stopped moving.
 *
 * Empty on the right, where the window is exactly the shell and letting the
 * shell follow it is what keeps the two in step through anything else that
 * resizes the window. On the left the window is deliberately wider than the
 * shell, so releasing it there would fill the drawer's space with opaque
 * player.
 */
function restingWidth(side: DrawerSide, width: number): string {
  return side === 'left' ? `${width}px` : '';
}

function shape(
  side: DrawerSide,
  windowWidth: number,
  shellWidth: number,
  height: number,
): Promise<void> {
  return setClickArea(
    side === 'left' && shellWidth < windowWidth
      ? { x: windowWidth - shellWidth, y: 0, width: shellWidth, height }
      : null,
  );
}

export function useShellSize(
  compact: boolean,
  wide: boolean,
  ready: boolean,
  side: DrawerSide,
) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const width = widthFor(wide);
  /**
   * The window's width, which on the left is not the shell's.
   *
   * See `windowWidthFor`: opening leftwards without moving the window is the
   * only arrangement that does not flicker, so on that side the window is
   * always as wide as the drawer needs and the shell grows inside it.
   */
  const windowWidth = windowWidthFor(wide, side);

  /**
   * Whether to render the drawer, which outlives `wide` by the length of the
   * close.
   *
   * Unmounting it the moment the drawer starts shutting would empty it in one
   * frame and then spend a quarter of a second narrowing an empty box. The
   * same reason `useSheet` keeps a sheet present through its exit — with this
   * animation's duration rather than that one's.
   */
  const [closing, setClosing] = useState(false);
  /** What `wide` was last render, so the change can be noticed during this one. */
  const [wasWideRender, setWasWideRender] = useState(wide);

  // Adjusted during render rather than in an effect, which is what React's own
  // guidance says to do for state derived from a prop — and what keeps the
  // close from costing a second paint with the drawer already gone. The same
  // shape `useSheet` uses for the modal sheets.
  if (wasWideRender !== wide) {
    setWasWideRender(wide);
    setClosing(!wide);
  }

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setClosing(false), prefersReducedMotion() ? 0 : DURATION_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  const drawerPresent = wide || closing;

  const was = useRef(compact);
  const wasWide = useRef(wide);
  const wasSide = useRef(side);
  const applied = useRef(false);
  /** The current state's geometry, taken while it is at rest. */
  const settled = useRef<{
    stage: number;
    bottom: number;
    chrome: number;
    rects: Record<string, DOMRect>;
  } | null>(null);

  const record = () => {
    const shell = shellRef.current;
    const stage = stageRef.current;
    const bottom = bottomRef.current;
    if (!shell || !stage || !bottom) return;
    settled.current = {
      stage: stage.offsetHeight,
      bottom: bottom.offsetHeight,
      // Everything that never changes height: the header, the progress bar,
      // the controls, the gaps between them and the padding. Taken as a
      // difference rather than added up, so no gap has to be accounted for by
      // hand.
      chrome: shell.offsetHeight - stage.offsetHeight - bottom.offsetHeight,
      rects: morphRects(shell),
    };
  };

  /**
   * Changing which side the drawer belongs to.
   *
   * The one time the window moves, and the only one left. On the left it is
   * permanently as wide as the drawer needs, so going there widens it leftwards
   * and coming back narrows it from the left — either way by the drawer's own
   * width, and either way the player stays exactly where it is.
   *
   * Declared before the animation below so that when a swap does both at once —
   * the drawer shuts on one side and opens on the other — the window is the
   * right size and in the right place before anything starts moving inside it.
   */
  useLayoutEffect(() => {
    if (wasSide.current === side) return;
    const cameFrom = wasSide.current;

    const shell = shellRef.current;
    if (!shell || !ready) return;

    const dx = cameFrom === 'right' ? -DRAWER_WIDTH : DRAWER_WIDTH;
    // Recorded at the point of no return rather than up here, so a swap
    // interrupted before the window has moved is restarted rather than lost.
    const move = () => {
      wasSide.current = side;
      shell.style.width = restingWidth(side, width);
      const height = compact ? shell.offsetHeight : EXPANDED_HEIGHT;
      return setWindowSize(windowWidth, height, dx).then(() =>
        shape(side, windowWidth, width, height),
      );
    };

    if (prefersReducedMotion()) {
      void setClickArea(null);
      void move();
      return;
    }

    let alive = true;
    shell.style.transition = `opacity ${SWAP_FADE_MS}ms linear`;
    shell.style.opacity = '0';

    const swap = setTimeout(() => {
      if (!alive) return;
      // No shape at all, so there is no outline around a window with nothing
      // in it while it travels.
      void setClickArea({ x: 0, y: 0, width: 0, height: 0 });
      void move().then(() => {
        if (!alive) return;
        shell.style.opacity = '1';
      });
    }, SWAP_FADE_MS);

    return () => {
      alive = false;
      clearTimeout(swap);
      shell.style.opacity = '';
      shell.style.transition = '';
    };
  }, [side, ready, compact, windowWidth, width]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const stage = stageRef.current;
    const track = trackRef.current;
    const bottom = bottomRef.current;
    if (!shell || !stage || !track || !bottom) return;


    // Starting collapsed, from a stored preference. The window comes back at
    // whatever size it was quit at, which is close but not what the stored
    // preferences say — nothing on this side has run yet to agree with it — so
    // it is brought to size once, without animating something nobody asked to
    // watch.
    if (!applied.current && ready) {
      applied.current = true;
      was.current = compact;
      wasWide.current = wide;
      // On the left the window is wider than the shell even when the drawer
      // is shut, so this runs whichever state it starts in.
      shell.style.width = restingWidth(side, width);
      const height = compact ? ((shell.style.height = 'auto'), shell.offsetHeight) : EXPANDED_HEIGHT;
      void setWindowSize(windowWidth, height).then(() => shape(side, windowWidth, width, height));
      record();
      return;
    }

    if (was.current === compact && wasWide.current === wide) return;
    const fromWidth = widthFor(wasWide.current);
    /**
     * Whether the height is going anywhere.
     *
     * Everything below that touches the stage exists to collapse the player
     * into its controls, and none of it applies to a drawer sliding out beside
     * one. Running it anyway is not harmless: pinning the stage swaps its
     * centring for `flex-start` and a computed padding, which lifts the record
     * and the title by a pixel or two for the length of the animation and drops
     * them back at the end. That was the twitch.
     */
    const heightMoves = was.current !== compact;
    was.current = compact;
    wasWide.current = wide;

    const before = settled.current;
    if (!before) return;
    const chrome = before.chrome;

    const from = { stage: before.stage, bottom: before.bottom };
    const to = compact
      ? // The track display is content-sized, so this is its true collapsed
        // height even though the stage around it is still pinned open.
        { stage: track.offsetHeight, bottom: 0 }
      : // The stage fills what is left of a full-height window, so its expanded
        // height comes from the window rather than from its contents.
        { stage: 0, bottom: naturalHeight(bottom) };
    if (!compact) to.stage = EXPANDED_HEIGHT - chrome - to.bottom;

    // Room for both ends before anything moves. Whichever way each axis is
    // going, the window has to be at least as large as the larger of the two
    // for the duration, or the shell would animate past its edge and be cut
    // off. Shrinking, the surplus is transparent and nobody sees it; the exact
    // size is set at the far end.
    // Room for both ends before anything moves, and on the left the window is
    // already at both.
    const wideEnough = Math.max(fromWidth, width, windowWidth);
    const room = setWindowSize(wideEnough, EXPANDED_HEIGHT);

    if (prefersReducedMotion()) {
      if (compact) shell.style.height = 'auto';
      shell.style.width = `${width}px`;
      const settledHeight = compact ? chrome + to.stage + to.bottom : EXPANDED_HEIGHT;
      void setWindowSize(windowWidth, settledHeight).then(() => {
        shell.style.width = restingWidth(side, width);
        void shape(side, windowWidth, width, settledHeight);
        record();
      });
      return;
    }

    const pin = (height: { stage: number; bottom: number }) => {
      stage.style.height = `${height.stage}px`;
      bottom.style.height = `${height.bottom}px`;
    };

    // Only while the height is actually moving. Left to its own devices the
    // shell is as tall as the window; `auto` hands that job to its contents,
    // which is right mid-collapse and wrong for a drawer, where it briefly
    // sizes the shell to something other than the window it sits in.
    if (heightMoves) shell.style.height = 'auto';
    // Pinned for the duration. The shell is the only thing anyone can see —
    // the window around it is transparent — so widening the shell inside an
    // already-wide window *is* the drawer coming out, and the row inside is
    // simply clipped until there is room for it. Both halves are `shrink-0`,
    // so nothing squashes on the way.
    shell.style.width = `${fromWidth}px`;
    if (heightMoves) {
      stage.style.overflow = 'hidden';
      bottom.style.overflow = 'hidden';
      // `flex-1` would make flex-basis the stage's main size and ignore the
      // height being animated, so the stage stops growing for the duration.
      stage.style.flex = '0 0 auto';

      // Hold the contents where they will finish, so what the record and the
      // text are travelling towards does not move while they travel. The
      // stage's top edge never moves, so its final centring is a padding away.
      stage.style.justifyContent = 'flex-start';
      stage.style.paddingTop = `${Math.max(0, (to.stage - naturalHeight(stage)) / 2)}px`;
      pin(from);
    }

    const arriving = heightMoves ? morphRects(shell) : null;

    // Two frames: one to paint the starting heights, one to change them. Both
    // in a single frame land in the same style recalculation, and the browser
    // has nothing to interpolate from.
    let alive = true;
    let start = 0;
    let tracking = 0;

    /**
     * Keep the window's shape on the shell while the shell is moving.
     *
     * The shape used to be opened to the whole window before the animation and
     * closed again after, and for the length of the animation the window was
     * larger than anything drawn in it. Windows draws its own frame around a
     * window's shape, so what that produced was an empty bordered rectangle
     * sitting where the drawer was about to be — a window from a much older
     * Windows, and the fault three attempts at repainting could not touch,
     * because it was never the painting.
     *
     * Followed frame by frame instead. The shape is the shell, always, so the
     * frame is drawn around the drawer as it grows rather than around where it
     * is going. A shape change neither moves nor resizes the window, so unlike
     * a resize per frame this asks nothing of the webview at all.
     */
    const follow = () => {
      if (!alive) return;
      tracking = requestAnimationFrame(follow);
      const box = shell.getBoundingClientRect();
      void shape(side, windowWidth, box.width, box.height);
    };
    // Behind the window rather than alongside it. Where the shell lands on
    // screen is measured from the window's edges, so a shell that starts
    // moving before the window has finished is being drawn against edges that
    // are about to change — which on the left, where the window's own position
    // moves, is the difference between growing leftwards and jumping.
    void room.then(() => {
      if (!alive) return;
      start = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (side === 'left') follow();
          shell.style.transition = `width ${DURATION_MS}ms ${EASING}`;
          shell.style.width = `${width}px`;
          if (heightMoves && arriving) {
            stage.style.transition = `height ${DURATION_MS}ms ${EASING}`;
            bottom.style.transition = `height ${DURATION_MS}ms ${EASING}`;
            pin(to);
            morph(shell, before.rects, arriving);
          }
        });
      });
    });

    const settle = setTimeout(() => {
      if (heightMoves) {
        for (const el of [stage, bottom]) {
          el.style.height = '';
          el.style.overflow = '';
          el.style.transition = '';
        }
        stage.style.flex = '';
        stage.style.justifyContent = '';
        stage.style.paddingTop = '';
        shell.style.height = compact ? 'auto' : '';
      }
      // The window first, the shell's pinned width after it. The other way
      // round hands the shell back to a window that has not been resized yet,
      // so it snaps out to the old width — the whole drawer, back for as long
      // as the resize takes to land.
      //
      // Measured off the settled shell rather than predicted, so the window
      // ends up exactly as tall as what it is showing. Read while the shell is
      // still pinned to the width it is about to keep, which is the width the
      // height belongs to.
      cancelAnimationFrame(tracking);
      tracking = 0;
      const settledHeight = compact ? shell.offsetHeight : EXPANDED_HEIGHT;
      void setWindowSize(windowWidth, settledHeight).then(() => {
        if (!alive) return;
        // The shape last, once the window is the size the shape is measured
        // against.
        void shape(side, windowWidth, width, settledHeight);
        // Handed back to the window, except on the left where the window is
        // wider than the shell on purpose. Released, the shell follows a window
        // that changed size for any other reason, and collapsed it keeps sizing
        // to its contents — which is what makes the bar look right in a plain
        // browser where there is no window at all.
        shell.style.width = restingWidth(side, width);
        shell.style.transition = '';
        record();
      });
    }, SETTLE_MS);

    return () => {
      alive = false;
      cancelAnimationFrame(start);
      cancelAnimationFrame(tracking);
      clearTimeout(settle);
    };
    // `width` and `windowWidth` are read, so they are declared — but neither
    // drives this effect. A drawer opening changes them without changing
    // `compact`, and the guard above returns before anything is animated. What
    // they must not do is go stale: the next collapse has to resize to the
    // width the window actually has, not the one it had when the panel was
    // last toggled.
  }, [compact, wide, ready, width, windowWidth, side]);

  return { shellRef, stageRef, trackRef, bottomRef, drawerPresent };
}

/**
 * Where each travelling piece is right now.
 *
 * Text is measured by its glyphs rather than by its box. The title is centred
 * in a full-width block when the player is open and left-aligned in a flexible
 * one when it is collapsed, so the boxes share no edge that means anything —
 * but the first letter is the first letter in both, and lining those up is what
 * makes the words look like they moved rather than jumped.
 */
function travelling(root: HTMLElement): Map<string, HTMLElement> {
  const found = new Map<string, HTMLElement>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-morph]')) {
    const name = el.dataset.morph;
    // Anything inside a leaving layer is the copy being replaced, not the one
    // arriving; both are in the tree at once while a collapse runs.
    if (!name || el.closest('[data-leaving]')) continue;
    found.set(name, el);
  }
  return found;
}

function morphRects(root: HTMLElement): Record<string, DOMRect> {
  const rects: Record<string, DOMRect> = {};
  for (const [name, el] of travelling(root)) {
    rects[name] = name === 'disc' ? el.getBoundingClientRect() : glyphRect(el);
  }
  return rects;
}

function glyphRect(el: HTMLElement): DOMRect {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rect = range.getBoundingClientRect();
  // An empty line has no glyphs to measure; its box will do.
  return rect.width > 0 ? rect : el.getBoundingClientRect();
}

/** Play each piece in from where its counterpart was. */
function morph(
  root: HTMLElement,
  leaving: Record<string, DOMRect>,
  arriving: Record<string, DOMRect>,
): void {
  for (const [name, el] of travelling(root)) {
    const from = leaving[name];
    const to = arriving[name];
    if (!from || !to || to.height === 0 || from.height === 0) continue;

    // Scaled by height in both cases: the record is square, and a line of text
    // scales with its line height, which is what its font size moves.
    const scale = from.height / to.height;
    el.animate(
      [
        {
          transformOrigin: 'left top',
          transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${scale})`,
        },
        { transformOrigin: 'left top', transform: 'translate(0px, 0px) scale(1)' },
      ],
      { duration: DURATION_MS, easing: EASING },
    );
  }
}

/** An element's height as if nothing had been pinned. Never painted. */
function naturalHeight(el: HTMLElement): number {
  const pinned = el.style.height;
  el.style.height = 'auto';
  const measured = el.offsetHeight;
  el.style.height = pinned;
  return measured;
}
