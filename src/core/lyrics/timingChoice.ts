import { isTauri } from '@/core/utils/env';
import { log } from '@/platform/log';
import type { LyricLine } from './activeLine';
import { fits, type LyricsTiming } from './timing';

/**
 * The listener's retiming of a Spotify song's lyrics, per song.
 *
 * A song on this computer keeps its retiming in the file its lyrics are saved
 * in. A Spotify song has no such file — its lyrics are looked up afresh — so
 * its timing is kept in a file of its own beside the settings, which can be
 * exported and imported to carry it to another computer (`timings.rs`). Read
 * once and held here, so a song's timing is there as soon as its lyrics are.
 *
 * A timing is only good for the record it was set against. Each is kept with
 * enough of that record to know it again — where it came from, how many lines,
 * the first of them — and is left unused when the lyrics found are another.
 */

/** What a timing was set against, to know that record again. */
export interface TimedRecord {
  /** The lookup's `via`: which source and step found it. */
  via: string;
  lines: readonly LyricLine[];
}

/** One song's timing as the file keeps it. The shape is Rust's `Kept`. */
export interface Kept {
  source: string;
  lines: number;
  first: string;
  timing: LyricsTiming;
  savedAt?: number;
}

/** Where the webview kept timings before they had a file; read once, to move them. */
const LEGACY_KEY = 'groovium.lyricsTiming';

let held: Record<string, Kept> = {};
let loading: Promise<void> | null = null;

/** The source alone: `lrclib:get` and `lrclib:search` may well be one record. */
const sourceOf = (via: string) => via.split(':')[0] ?? via;

/** Whether a kept timing was set against this record. */
export function matches(kept: Kept, record: TimedRecord): boolean {
  return (
    kept.source === sourceOf(record.via) &&
    kept.lines === record.lines.length &&
    kept.first === (record.lines[0]?.text ?? '') &&
    Array.isArray(kept.timing) &&
    fits(kept.timing, record.lines)
  );
}

/** What the webview kept before, emptied once it is in the file. */
function legacy(): Record<string, Kept> {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Kept>) : {};
  } catch {
    return {};
  }
}

async function load(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  const old = legacy();
  if (Object.keys(old).length > 0) {
    try {
      await invoke<number>('lyrics_timings_merge', { songs: old });
      localStorage.removeItem(LEGACY_KEY);
    } catch (err) {
      log('warn', 'lyrics', 'could not move the old lyrics timings into their file', err);
    }
  }
  held = await invoke<Record<string, Kept>>('lyrics_timings_load');
}

/** Read the file, once; again after an import. */
function ready(): Promise<void> {
  loading ??= load().catch((err: unknown) => {
    log('warn', 'lyrics', 'could not read the lyrics timings', err);
    loading = null;
  });
  return loading;
}

/** The timing kept for this song, if it was set against these lyrics. */
export async function timingFor(trackId: string, record: TimedRecord): Promise<LyricsTiming | null> {
  await ready();
  const kept = held[trackId];
  return kept && matches(kept, record) ? kept.timing : null;
}

/** Keep a timing for this song, or forget it with null. */
export function keepTiming(trackId: string, record: TimedRecord, timing: LyricsTiming | null): void {
  const kept: Kept | null = timing
    ? {
        source: sourceOf(record.via),
        lines: record.lines.length,
        first: record.lines[0]?.text ?? '',
        timing,
        savedAt: Date.now(),
      }
    : null;
  if (kept) held[trackId] = kept;
  else delete held[trackId];
  if (!isTauri()) return;
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('lyrics_timing_keep', { trackId, kept }))
    .catch((err: unknown) => log('warn', 'lyrics', `could not keep the timing for ${trackId}`, err));
}

/** Write every Spotify song's timing to a file of the listener's choosing: how many, or null if closed. */
export async function exportTimings(): Promise<number | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<number | null>('lyrics_timings_export');
}

/**
 * Take in timings exported elsewhere, merged with these: how many songs were
 * taken, or null if the dialog was closed. Throws `unreadable` for a file that
 * is not one.
 */
export async function importTimings(): Promise<number | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  const taken = await invoke<number | null>('lyrics_timings_import');
  if (taken !== null) {
    loading = null;
    await ready();
  }
  return taken;
}
