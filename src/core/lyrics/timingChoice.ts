import type { LyricLine } from './activeLine';
import { fits, type LyricsTiming } from './timing';

/**
 * The listener's retiming of a Spotify song's lyrics, per song.
 *
 * A song on this computer keeps its retiming in the file its lyrics are saved
 * in. A Spotify song has no such file — its lyrics are looked up afresh — so
 * the timing is kept here, in the webview's own storage, as the source chosen
 * for a song is (see `sourceChoice.ts`). Losing it costs a drag.
 *
 * A timing is only good for the record it was set against. Each is kept with
 * enough of that record to know it again — where it came from, how many lines,
 * the first of them — and is left unused when the lyrics found are another.
 */

const KEY = 'groovium.lyricsTiming';

/** Enough songs for anyone's habits, few enough to stay small. */
const KEEP = 500;

/** What a timing was set against, to know that record again. */
export interface TimedRecord {
  /** The lookup's `via`: which source and step found it. */
  via: string;
  lines: readonly LyricLine[];
}

interface Kept {
  source: string;
  lines: number;
  first: string;
  timing: LyricsTiming;
}

function read(): Record<string, Kept> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Kept>) : {};
  } catch {
    return {};
  }
}

/** The source alone: `lrclib:get` and `lrclib:search` may well be one record. */
const sourceOf = (via: string) => via.split(':')[0] ?? via;

/** The timing kept for this song, if it was set against these lyrics. */
export function timingFor(trackId: string, record: TimedRecord): LyricsTiming | null {
  const kept = read()[trackId];
  if (!kept || !Array.isArray(kept.timing)) return null;
  const same =
    kept.source === sourceOf(record.via) &&
    kept.lines === record.lines.length &&
    kept.first === (record.lines[0]?.text ?? '');
  return same && fits(kept.timing, record.lines) ? kept.timing : null;
}

/** Keep a timing for this song, or forget it with null. The newest are kept. */
export function keepTiming(trackId: string, record: TimedRecord, timing: LyricsTiming | null): void {
  try {
    const all = read();
    delete all[trackId];
    if (timing) {
      all[trackId] = {
        source: sourceOf(record.via),
        lines: record.lines.length,
        first: record.lines[0]?.text ?? '',
        timing,
      };
    }
    const ids = Object.keys(all);
    for (const id of ids.slice(0, Math.max(0, ids.length - KEEP))) delete all[id];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage refused: the timing holds for as long as the song is on.
  }
}
