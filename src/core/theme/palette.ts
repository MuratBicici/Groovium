/**
 * Knowing when the palette has finished changing.
 *
 * The colour variables are registered with `@property` and `:root` declares a
 * transition across all of them, which is what makes a theme change a fade
 * rather than a jump. It also means a registered property is *animating*: what
 * `getComputedStyle` reports the instant the theme changes is where the
 * animation starts, which is the palette that is on its way out.
 *
 * Everything on this side that reads the palette back off the document was
 * therefore reading the previous one — the accent behind the visualiser, the
 * light on the window's edge, and the hairline between the player and the
 * drawer, all of them a theme behind, and all of them catching up only when
 * the next theme was chosen.
 *
 * There is no way to ask for a registered property's target value while it is
 * in flight. So the answer is to ask again once it has landed.
 */

/** Only the palette. Every other transition on the document is somebody else's. */
const PALETTE = '--color-';

/**
 * Call `then` whenever the palette has settled, until the returned function is
 * called.
 *
 * A dozen properties finish within a frame of each other and each one is its
 * own event, so they are collected into one call — the work behind this reads
 * computed styles, which is not a thing to do twelve times for one theme.
 *
 * Nothing fires at all when the transition is off, which is what motion being
 * turned down does. That is not a gap: with no animation the first read was
 * already the right one.
 */
export function whenPaletteSettles(then: () => void): () => void {
  if (typeof document === 'undefined') return () => {};

  const root = document.documentElement;
  let pending = 0;

  const heard = (event: Event) => {
    const property = (event as TransitionEvent).propertyName;
    if (!property?.startsWith(PALETTE)) return;
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      then();
    });
  };

  root.addEventListener('transitionend', heard);
  return () => {
    root.removeEventListener('transitionend', heard);
    if (pending) cancelAnimationFrame(pending);
  };
}
