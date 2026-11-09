/**
 * Scrollbars that are only there while something is scrolling.
 *
 * Nothing in the app needs to mark itself: `scroll` does not bubble but it can be
 * caught on its way down, so one listener hears every list there is, including
 * ones not on screen yet. The look of the two states is in `styles.css`.
 */

/** How long a scrollbar stays after the last movement, before it fades. */
const STAYS_FOR_MS = 1200;

export function fadeScrollbarsWhenIdle(): () => void {
  const timers = new WeakMap<Element, number>();

  const onScroll = (event: Event) => {
    const scrolled = event.target === document ? document.documentElement : event.target;
    if (!(scrolled instanceof Element)) return;
    // Once per burst. This runs every frame of a scroll, and writing the same
    // value each time would have the styles looked at again every frame as well.
    if (scrolled.getAttribute('data-scrollbar') !== 'shown') scrolled.setAttribute('data-scrollbar', 'shown');
    window.clearTimeout(timers.get(scrolled));
    timers.set(
      scrolled,
      window.setTimeout(() => scrolled.setAttribute('data-scrollbar', 'idle'), STAYS_FOR_MS),
    );
  };

  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  return () => document.removeEventListener('scroll', onScroll, { capture: true });
}
