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
 * How long a line gets when there is no next line to end it: the last line of
 * a song, which no source says the end of.
 */
export const LAST_LINE_MS = 6_000;

/**
 * How far through a line the singing is, from nought as it begins to one as
 * the next line does.
 *
 * The light drawn over the line being sung is this: it crosses the line in the
 * time the line has, and reaches the last letter as the next line starts. A
 * line a source timed to the same millisecond as the next is already over.
 */
export function lineSweep(lines: readonly LyricLine[], index: number, ms: number): number {
  const line = lines[index];
  if (!line) return 0;
  const ends = lines[index + 1]?.timeMs ?? line.timeMs + LAST_LINE_MS;
  const span = ends - line.timeMs;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (ms - line.timeMs) / span));
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
