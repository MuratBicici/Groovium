/**
 * How large a playlist's name can be on its page.
 *
 * As large as it is meant to be while it fits on one line, smaller as it grows,
 * and only once it would have to get too small to read is it given a second line,
 * at the largest size that fits it in two. Never cut off and never a third line,
 * which pushed the cover up the page and the foot of the letters out of the box.
 */

/** The size a name is meant to be, and the least it shrinks to on one line. */
export const TITLE_MAX_PX = 30;
export const ONE_LINE_MIN_PX = 20;
/** The size two lines start from, and the least they go to before the name is cut short. */
export const TWO_LINES_MAX_PX = 26;
export const TITLE_MIN_PX = 16;
/** Room between lines, as a share of the size: enough for a ş and a g to keep their tails. */
export const TITLE_LEADING = 1.2;
/** The height kept for the name whatever it is: two lines at their largest. */
export const TITLE_ROOM_PX = Math.ceil(2 * TWO_LINES_MAX_PX * TITLE_LEADING);

/**
 * The size for one line, from how wide the name is at the full size.
 *
 * Text grows in proportion to its size, so one measurement says where it fits.
 * Null when that is under the least one line goes to.
 */
export function oneLineSize(widthAtMax: number, room: number): number | null {
  if (widthAtMax <= room) return TITLE_MAX_PX;
  // A pixel spare, as hinting does not scale quite in proportion.
  const size = Math.floor((TITLE_MAX_PX * (room - 1)) / widthAtMax);
  return size >= ONE_LINE_MIN_PX ? size : null;
}

/** The sizes to try for two lines, largest first. */
export function twoLineSizes(): number[] {
  const sizes: number[] = [];
  for (let size = TWO_LINES_MAX_PX; size >= TITLE_MIN_PX; size -= 1) sizes.push(size);
  return sizes;
}
