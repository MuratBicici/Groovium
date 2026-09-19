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
 * How much wheel movement is a line.
 *
 * A mouse wheel notch is about 100 in Chromium, so a notch is a line and the
 * rest carries over. A touchpad sends many small amounts, which add up the
 * same way — so a slow drag moves a line at a time instead of flinging.
 */
export const PX_PER_LINE = 90;

export interface Wheel {
  /** Wheel movement not yet enough for a line, carried to the next event. */
  carry: number;
}

/**
 * Whole lines to move for a wheel movement, and what is left over. Positive
 * is down the song, towards the lines to come.
 */
export function linesFor(wheel: Wheel, deltaY: number): { lines: number; wheel: Wheel } {
  // A change of direction starts afresh rather than first paying off what was
  // carried the other way.
  const carried = Math.sign(deltaY) === Math.sign(wheel.carry) ? wheel.carry : 0;
  const total = carried + deltaY;
  // `|| 0`: a small upward movement is no lines, not minus nought of them.
  const lines = Math.trunc(total / PX_PER_LINE) || 0;
  return { lines, wheel: { carry: total - lines * PX_PER_LINE } };
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
