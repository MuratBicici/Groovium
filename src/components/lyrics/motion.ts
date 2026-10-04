import { prefersReducedMotion } from '@/core/utils/motion';

/**
 * How lyrics move, in one place.
 *
 * The same family as the crate's sheets: things arriving ease out, quick and
 * then settling; things leaving ease in, slow to start and gone at speed, and
 * shorter, because nobody waits to watch a thing go. The wheel's turn is its
 * own curve — a long settle, so a line glides the last few degrees onto the
 * level rather than stopping on it.
 *
 * Everything that moves animates `transform` and `opacity` and nothing else,
 * and every animation starts from where the element is drawn now, so a second
 * change arriving halfway through turns round instead of jumping.
 */

export const ARRIVE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const LEAVE_EASING = 'cubic-bezier(0.4, 0, 1, 1)';
export const TURN_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export const ARRIVE_MS = 320;
export const LEAVE_MS = 170;
export const TURN_MS = 450;
/** A line's own fade and size as it moves nearer the level or away. */
export const LOOK_MS = 300;
/** How long the view takes to cross to another song, or to come and go. */
export const SCENE_MS = 300;

/**
 * A wheel arriving: turned in from the deck's side and growing to its size, as
 * it fades up. The queue's palette and the lyrics record open the same way, so
 * the two read as parts of one machine.
 */
export function turnIn(el: HTMLElement | null, left: boolean, restsAt = 0): void {
  if (!el || prefersReducedMotion()) return;
  el.animate(
    [
      { transform: `rotate(${restsAt + (left ? -70 : 70)}deg) scale(0.7)`, opacity: 0 },
      // Where it rests: its own turn, for something that is already turned —
      // the lyrics' lines stand at the angle of the line being sung.
      { transform: restsAt ? `rotate(${restsAt}deg)` : 'none', opacity: 1 },
    ],
    { duration: ARRIVE_MS + 260, easing: ARRIVE_EASING },
  );
}
