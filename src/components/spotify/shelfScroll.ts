/**
 * How far a shelf moves when its arrow is pressed, and when it has run out.
 *
 * Kept apart from the shelf itself because it is arithmetic and nothing else.
 * A row of records reads as a row you run along, which is fine with a wheel
 * under your fingers and impossible without one — a mouse has no sideways. The
 * arrows are the sideways, and what makes them feel like part of the shelf
 * rather than a pair of buttons is entirely in these two numbers: how far one
 * press goes, and when a press stops being offered.
 */

/** Which way an arrow points. */
export type Way = 'left' | 'right';

/** A shelf as its scroller currently sees itself. */
export interface Reach {
  /** How far along it has been scrolled. */
  at: number;
  /** The width of everything on it. */
  width: number;
  /** How much of that width is on screen. */
  visible: number;
}

/**
 * Slack before an end counts as reached.
 *
 * Scroll positions are fractional — a shelf scrolled fully right lands on
 * something like 411.2 against a 411.6 it can reach — so an exact comparison
 * leaves an arrow lit that does nothing when pressed.
 */
const ARRIVED = 1;

/** Whether there is anything left that way. */
export function canGo(reach: Reach, way: Way): boolean {
  if (way === 'left') return reach.at > ARRIVED;
  return reach.at + reach.visible < reach.width - ARRIVED;
}

/** Whether the shelf is longer than its window, and so worth arrows at all. */
export function scrolls(reach: Reach): boolean {
  return reach.width > reach.visible + ARRIVED;
}

/**
 * How much stays on screen after a press.
 *
 * A press that moves exactly one screenful leaves nothing in common between
 * before and after, and a row of sleeves with nothing in common is a row you
 * have lost your place in. Keeping a card and a bit in view is what makes the
 * movement read as the shelf sliding rather than as the page changing.
 */
const KEEPS = 96;

/** Where a press that way lands. */
export function nextStop(reach: Reach, way: Way): number {
  // Never less than half a screen, or a narrow shelf would crawl.
  const step = Math.max(reach.visible - KEEPS, reach.visible / 2);
  const to = way === 'left' ? reach.at - step : reach.at + step;
  const furthest = Math.max(reach.width - reach.visible, 0);
  return Math.min(Math.max(to, 0), furthest);
}
