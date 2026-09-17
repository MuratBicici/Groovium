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

/**
 * How near a shelf's end a carried record has to be to scroll it.
 *
 * A crate off the side of the shelf cannot be reached with a record in the hand:
 * the arrows need the hand, and the hand is holding something. Holding the record
 * against the edge is the way along instead.
 */
export const EDGE_ZONE_PX = 28;

/**
 * Which way a record held at `point` asks the shelf to go, if any.
 *
 * Only inside the shelf's own band, top to bottom: a record passing the edge of
 * the drawer on its way somewhere else is not asking this shelf for anything.
 */
export function edgeWay(
  point: { x: number; y: number },
  box: { left: number; right: number; top: number; bottom: number },
): Way | null {
  if (point.y < box.top || point.y > box.bottom) return null;
  if (point.x < box.left || point.x > box.right) return null;
  if (point.x < box.left + EDGE_ZONE_PX) return 'left';
  if (point.x > box.right - EDGE_ZONE_PX) return 'right';
  return null;
}

