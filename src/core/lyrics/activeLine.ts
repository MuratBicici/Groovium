/** A line of synced lyrics: when it starts, in milliseconds, and its words. */
export interface LyricLine {
  timeMs: number;
  text: string;
}

/**
 * The line being sung at `ms`: the last one that has started.
 *
 * A binary search, since it runs every frame against a list that can be a few
 * hundred lines long. −1 before the first line has begun.
 */
export function activeLine(lines: readonly LyricLine[], ms: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((lines[mid]?.timeMs ?? Infinity) <= ms) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}
