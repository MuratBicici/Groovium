/**
 * Reading a palette that is on the move.
 *
 * The colour variables are registered with `@property` and `:root` declares a
 * transition across all of them, which is what makes a theme change a fade
 * rather than a jump. It also means a registered property is *animating*, and
 * what `getComputedStyle` reports is wherever the animation currently is.
 *
 * That single fact needs two different answers, and this module holds both.
 *
 * Anything drawn from the palette — the blocks behind the deck, the light on
 * the window's edge — wants the animated value, and wants it every frame: that
 * is what makes a canvas fade along with the window instead of switching at one
 * end of the fade or the other.
 *
 * Anything *derived* from the palette and written back into it — the hairline
 * between the player and the drawer, the text colour on a filled button — wants
 * the value the fade is heading for, before it sets off. Those are transitioned
 * properties themselves, so given the destination they fade in step with
 * everything else. Given the animated value they would chase it a frame behind
 * and land late, which is what "it changes with a click, a moment afterwards"
 * looks like.
 */

/** Only the palette. Every other transition on the document is somebody else's. */
const PALETTE = '--color-';

/** How long to keep drawing when nothing ever says the fade ended. */
const CAP_MS = 2000;

/** A little past the first property to finish; they all share one duration. */
const TAIL_MS = 60;

function isPalette(event: Event): boolean {
  return ((event as TransitionEvent).propertyName ?? '').startsWith(PALETTE);
}

/**
 * Call `step` every frame for as long as the palette is moving.
 *
 * For the things that draw the palette rather than derive from it. Nothing
 * fires when the transition is off, which is what turning motion down does —
 * and that is not a gap, because with no animation there is nothing to follow.
 */
export function whilePaletteMoves(step: () => void): () => void {
  if (typeof document === 'undefined') return () => {};

  const root = document.documentElement;
  let frame = 0;
  let until = 0;

  const tick = () => {
    step();
    frame = performance.now() < until ? requestAnimationFrame(tick) : 0;
  };

  const started = (event: Event) => {
    if (!isPalette(event)) return;
    until = Math.max(until, performance.now() + CAP_MS);
    if (!frame) frame = requestAnimationFrame(tick);
  };

  const ended = (event: Event) => {
    if (!isPalette(event)) return;
    // Not stopped outright: one last frame lands the colours exactly where the
    // transition left them rather than a frame short of it.
    until = Math.min(until, performance.now() + TAIL_MS);
  };

  root.addEventListener('transitionstart', started);
  root.addEventListener('transitionend', ended);
  root.addEventListener('transitioncancel', ended);

  return () => {
    root.removeEventListener('transitionstart', started);
    root.removeEventListener('transitionend', ended);
    root.removeEventListener('transitioncancel', ended);
    if (frame) cancelAnimationFrame(frame);
  };
}

/**
 * Read the document as it will be once `wearing` is on it, before it moves.
 *
 * A registered property cannot be asked for its target while it is in flight,
 * so the target is fetched by going there and coming back with the transition
 * held off: put the new theme on, force the styles to resolve, read, put the
 * old theme back, force them again, and only then let the transition return.
 * The change is made for real afterwards, from exactly where it started, so it
 * still fades.
 *
 * All of it inside one task, and a browser paints between tasks rather than
 * inside one — so nothing of the two forced resolutions reaches a screen. What
 * it costs is a handful of style recalculations on a gesture a person makes by
 * hand, perhaps once a day.
 *
 * `wear` is asked to put a theme on the document; `read` to say what it sees.
 */
export function palettePeek<T>(
  root: HTMLElement,
  wearing: string | null,
  wear: (theme: string | null) => void,
  read: () => T,
): T {
  const worn = root.dataset.theme ?? null;
  const stashed = root.style.transition;

  try {
    root.style.transition = 'none';
    wear(wearing);
    const seen = read();
    wear(worn);
    // Reading a layout property is what forces the styles to resolve again, so
    // the old palette is back in place before the transition is allowed to
    // notice anything changed.
    void root.offsetWidth;
    return seen;
  } finally {
    if (stashed) root.style.transition = stashed;
    else root.style.removeProperty('transition');
  }
}
