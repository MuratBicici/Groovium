import type { LyricLine } from './activeLine';

/**
 * The listener's own timing for a song's lyrics.
 *
 * A record is often another recording's: a longer opening, a touch faster, a
 * break in the middle the album version does not have. Only the listener can
 * hear that, so they move the lines themselves — on a strip of the song, by
 * pins.
 *
 * A pin holds one line (by its place among the lines the source gave) at a new
 * moment. The first and the last line are always pinned: those are the two
 * handles. Every other line goes where the two pins either side of it put it,
 * in proportion — so moving only the first line stretches or squeezes every
 * gap up to the next pin by the same share, and a pin in the middle keeps a
 * change on one side of it from reaching the other.
 */
export interface LyricsPin {
  /** The line's place among the source's lines. */
  line: number;
  /** When it starts now, in milliseconds. */
  ms: number;
}

/** Pins in line order, the first and the last line always among them. */
export type LyricsTiming = LyricsPin[];

/** The least two pinned lines are kept apart, so neither passes the other. */
export const PIN_GAP_MS = 250;

/** The two handles where the source put them: no change at all. */
export function defaultTiming(lines: readonly LyricLine[]): LyricsTiming {
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (!first || !last) return [];
  if (lines.length === 1) return [{ line: 0, ms: first.timeMs }];
  return [
    { line: 0, ms: first.timeMs },
    { line: lines.length - 1, ms: last.timeMs },
  ];
}

/**
 * Whether a timing fits these lines: its pins in order, inside them, with the
 * first and last line pinned. One saved for another record does not, and is
 * left unused rather than bent onto lines it was never set against.
 */
export function fits(timing: LyricsTiming, lines: readonly LyricLine[]): boolean {
  if (lines.length === 0 || timing.length === 0) return false;
  if (timing[0]?.line !== 0 || timing[timing.length - 1]?.line !== lines.length - 1) return false;
  return timing.every(
    (pin, i) =>
      Number.isFinite(pin.ms) &&
      pin.ms >= 0 &&
      (i === 0 || (pin.line > (timing[i - 1] as LyricsPin).line && pin.ms > (timing[i - 1] as LyricsPin).ms)),
  );
}

/** Whether the timing changes nothing: every pin where its line already was. */
export function isIdentity(timing: LyricsTiming, lines: readonly LyricLine[]): boolean {
  return timing.every((pin) => lines[pin.line]?.timeMs === pin.ms);
}

/**
 * A moment as the timing moves it: in proportion between the two pins around
 * it, and before the first or after the last moved as that pin was.
 */
function moved(ms: number, timing: LyricsTiming, lines: readonly LyricLine[]): number {
  const from = (pin: LyricsPin) => (lines[pin.line] as LyricLine).timeMs;
  const first = timing[0] as LyricsPin;
  const last = timing[timing.length - 1] as LyricsPin;
  if (ms <= from(first)) return ms + first.ms - from(first);
  if (ms >= from(last)) return ms + last.ms - from(last);
  for (let i = 1; i < timing.length; i++) {
    const a = timing[i - 1] as LyricsPin;
    const b = timing[i] as LyricsPin;
    if (ms > from(b)) continue;
    const span = from(b) - from(a);
    // Two lines a source timed to the same moment: nothing to spread.
    if (span <= 0) return a.ms;
    return a.ms + ((ms - from(a)) * (b.ms - a.ms)) / span;
  }
  return ms;
}

/** The lines at their new moments, words and all. */
export function retime(lines: LyricLine[], timing: LyricsTiming | null): LyricLine[] {
  if (!timing || !fits(timing, lines) || isIdentity(timing, lines)) return lines;
  const at = (ms: number) => Math.max(0, Math.round(moved(ms, timing, lines)));
  return lines.map((line) => {
    const next: LyricLine = { ...line, timeMs: at(line.timeMs) };
    if (line.words) next.words = line.words.map((word) => ({ ...word, timeMs: at(word.timeMs) }));
    return next;
  });
}

/** Move one pin, kept clear of its neighbours and of the song's start. */
export function movePin(timing: LyricsTiming, index: number, ms: number): LyricsTiming {
  const before = timing[index - 1];
  const after = timing[index + 1];
  const low = before ? before.ms + PIN_GAP_MS : 0;
  const high = after ? after.ms - PIN_GAP_MS : Number.POSITIVE_INFINITY;
  const clamped = Math.round(Math.min(high, Math.max(low, ms)));
  return timing.map((pin, i) => (i === index ? { ...pin, ms: clamped } : pin));
}

/** Move every pin by the same amount, the first never before the song starts. */
export function shiftAll(timing: LyricsTiming, deltaMs: number): LyricsTiming {
  const first = timing[0];
  if (!first) return timing;
  const delta = Math.round(Math.max(deltaMs, -first.ms));
  return timing.map((pin) => ({ ...pin, ms: pin.ms + delta }));
}

/**
 * Pin a line where the timing puts it now, so it can be moved on its own.
 * Nothing moves by adding one. A line already pinned is left as it is.
 */
export function addPin(timing: LyricsTiming, line: number, lines: readonly LyricLine[]): LyricsTiming {
  const target = lines[line];
  if (!target || timing.some((pin) => pin.line === line)) return timing;
  const ms = Math.round(moved(target.timeMs, timing, lines));
  return [...timing, { line, ms }].sort((a, b) => a.line - b.line);
}

/** Unpin a line in the middle; the two handles stay. */
export function removePin(timing: LyricsTiming, line: number): LyricsTiming {
  const index = timing.findIndex((pin) => pin.line === line);
  if (index <= 0 || index === timing.length - 1) return timing;
  return timing.filter((_, i) => i !== index);
}
