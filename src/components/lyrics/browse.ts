/**
 * Scrolling through the lyrics by hand, and coming back.
 *
 * Either view can be scrolled away from the line being sung, to read ahead or
 * look back. It stays where it was left for `HOLD_MS` after the last scroll —
 * scrolling again restarts the wait — and then returns to the line being sung
 * on its own. While away it holds its place in the song, not its distance from
 * the singing: lines the singer reaches meanwhile do not pull it along.
 *
 * These are the rules, kept apart from the component so they can be tested.
 */

/** How long a view scrolled away stays there after the last scroll. */
export const HOLD_MS = 5_000;

/**
 * How long after a tick the next one counts.
 *
 * A wheel notch is one line, whatever the notch's size — some mice send 100,
 * some send 53, a touchpad sends a stream of small ones, and a line each was
 * asked for. A touchpad sending sixty of those a second would fly through the
 * song, so a tick only counts once this long has passed since the last one
 * that did.
 */
export const TICK_MS = 110;

export interface Wheel {
  /** When the last tick that counted was, on the clock the caller passes. */
  at: number;
}

/**
 * Lines to move for one wheel event: one, in the direction scrolled, unless
 * the last one was too recent to count.
 */
export function linesFor(wheel: Wheel, deltaY: number, now: number): { lines: number; wheel: Wheel } {
  if (deltaY === 0 || now - wheel.at < TICK_MS) return { lines: 0, wheel };
  return { lines: deltaY > 0 ? 1 : -1, wheel: { at: now } };
}

/**
 * Where a scrolled view goes: from where it is — or from the line being sung,
 * if it is not away yet — by `lines`, kept inside the song.
 */
export function scrollTo(
  away: number | null,
  sung: number,
  lines: number,
  count: number,
): number | null {
  if (count <= 0) return null;
  const from = away ?? Math.max(0, sung);
  return Math.min(count - 1, Math.max(0, from + lines));
}

/** The line a view shows: the one scrolled to, or the one being sung. */
export function shownLine(away: number | null, sung: number): number {
  return away ?? sung;
}

/**
 * How to move between two lines on screen.
 *
 * - `turn`: an ordinary turn, a line or two — the song going on, or a scroll.
 * - `return`: the way back from a scroll, turned rather than cut however far,
 *   up to `RETURN_REACH` lines — the record winding back to where the singing
 *   is, which is worth watching once. Takes longer the further it is.
 * - `cut`: anything else, a seek to the middle of the song — no turn through
 *   everything between; the lines are simply there, faded in.
 */
export type Move = { kind: 'turn' } | { kind: 'return'; ms: number } | { kind: 'cut' };

export const RETURN_REACH = 12;

export function moveBetween(from: number, to: number, returning: boolean): Move {
  const lines = Math.abs(to - from);
  if (lines <= 2) return { kind: 'turn' };
  if (returning && lines <= RETURN_REACH) {
    return { kind: 'return', ms: Math.min(900, 450 + lines * 40) };
  }
  return { kind: 'cut' };
}
