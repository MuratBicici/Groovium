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
 * What a timer writes on a line to say there are no words on it.
 *
 * Mostly nothing at all, but not always: plenty of people timing a song for
 * LRCLIB mark an instrumental break with a note, or a row of them, or dots, or
 * a dash — and a line that says "♪" was drawn as a word that said "♪", in the
 * middle of the song, where a wave belongs. Whitespace, music signs, and the
 * punctuation such marks are made of; anything with a letter or a digit in it
 * is words, however few.
 */
const SILENCE_MARKS = /[\s♩♪♫♬🎵🎶🎼.…·•*~\-–—()[\]]/gu;

/** Whether a line has no words in it, only a mark that there are none. */
export function isSilence(text: string): boolean {
  return text.replace(SILENCE_MARKS, '') === '';
}

/**
 * How long a song has to wait before its silence is worth showing.
 *
 * Every song starts with something before the first word, and most of them
 * start with a second of it that nobody would call an introduction. Below this
 * a mark would appear and be gone before it was read.
 */
export const INTRO_WORTH_SHOWING_MS = 3_000;

/**
 * The song's own opening, as a line with nothing in it.
 *
 * A stretch with no words in the middle of a song is written as an empty line
 * by whoever timed it, and the view draws those as a mark that fills while they
 * last. The stretch before the first word is exactly the same thing and no
 * source writes it down, so the wait at the start of a song was the one silence
 * with nothing to show for it.
 *
 * Added here rather than drawn as a special case, so it is a line like any
 * other: it can be scrolled to, it can be clicked to seek back to the
 * beginning, and the light that crosses it is the light that crosses the rest.
 */
export function withIntro(lines: readonly LyricLine[]): LyricLine[] {
  const first = lines[0];
  if (!first || first.timeMs < INTRO_WORTH_SHOWING_MS) return [...lines];
  return [{ timeMs: 0, text: '' }, ...lines];
}

/**
 * How far into each word the light has got, from how far into the line it is.
 *
 * A line the eye reads left to right is not a box the light can cross left to
 * right: wrapped onto two rows, a ramp across the box lights the same distance
 * into both of them at once, and the second row fills before its first word is
 * sung. Laid out along the words in the order they are read, a row break is
 * nothing at all — the light leaves the end of one row and arrives at the
 * start of the next, because that is where the next word is.
 *
 * `widths` is each word's own width, in whatever unit they were measured in;
 * what comes back is how far through each of them the light is, nought to one.
 */
export function acrossWords(widths: readonly number[], through: number): number[] {
  let total = 0;
  for (const width of widths) total += Math.max(0, width);
  if (total <= 0) return widths.map(() => (through >= 1 ? 1 : 0));

  const at = Math.min(1, Math.max(0, through)) * total;
  let start = 0;
  return widths.map((width) => {
    const room = Math.max(0, width);
    const lit = room <= 0 ? (at > start ? 1 : 0) : (at - start) / room;
    start += room;
    return Math.min(1, Math.max(0, lit));
  });
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
