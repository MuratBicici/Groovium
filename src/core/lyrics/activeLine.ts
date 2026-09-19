/** A piece of a line — a syllable or a word — and when it is sung. */
export interface Syllable {
  timeMs: number;
  text: string;
}

/** A line of synced lyrics: when it starts, in milliseconds, and its words. */
export interface LyricLine {
  timeMs: number;
  text: string;
  /**
   * The line in pieces, each timed, when some source times them. Joined, they
   * are `text` exactly. Missing when only the line is timed.
   */
  words?: Syllable[];
}

/**
 * The line being sung at `ms`: the last one that has started.
 *
 * A binary search, since it runs every frame against a list that can be a few
 * hundred lines long. −1 before the first line has begun. The same search
 * finds the syllable being sung within a line.
 */
export function activeLine(lines: readonly { timeMs: number }[], ms: number): number {
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
