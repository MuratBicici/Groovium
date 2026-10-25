import type { SourceType, TrackMetadata } from '@/core/types';

/**
 * What has been listened to here, kept by the app itself.
 *
 * Spotify keeps a log of its own, and the drawer showed that one. It knows
 * nothing about a song played from this computer, and it is fifty entries
 * long. This one is both sides of the drawer, kept for as long as it is
 * useful, and it is what the shelves built from somebody's listening are
 * built from.
 *
 * Kept in the webview's storage, as the recent searches are. Losing it costs
 * a shelf that starts again from nothing, which is a worse drawer for a day
 * and not lost music. The Spotify half belongs to whoever is signed in and is
 * forgotten with them.
 */

export interface Heard {
  /** The track as it was when it was heard, enough to put it back on a shelf. */
  track: TrackMetadata;
  /** When it counted as heard. */
  at: number;
}

/** A few weeks of steady listening: enough to tell taste from a single evening. */
export const HISTORY_KEPT = 400;

/**
 * How long a song has to play before it counts as heard.
 *
 * Thirty seconds, which is the line Spotify and Last.fm both draw. Or half
 * the song, for one shorter than a minute.
 */
export const HEARD_AFTER_MS = 30_000;

/** A step forward bigger than this between two reports is a seek, not listening. */
const MOST_PER_REPORT_MS = 3_000;

const KEY = 'groovium.listening';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function isEntry(value: unknown): value is Heard {
  if (!isObject(value) || typeof value.at !== 'number' || !isObject(value.track)) return false;
  const { id, title, artist, album, duration, source } = value.track;
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    typeof title === 'string' &&
    typeof artist === 'string' &&
    typeof album === 'string' &&
    typeof duration === 'number' &&
    (source === 'spotify' || source === 'local')
  );
}

/** Everything kept, newest first. Empty when storage is missing or garbled. */
export function heard(): Heard[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();

/** Told whenever something is added or forgotten. Returns the way to stop. */
export function onHeard(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function write(entries: Heard[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, HISTORY_KEPT)));
  } catch {
    // Storage refused: this listen goes unrecorded, and the shelves go on.
  }
  for (const listener of listeners) listener();
}

/**
 * Keep a listen.
 *
 * Without the reason Spotify would not play it, which is about the moment it
 * was asked rather than about the song. A song that just played for half a
 * minute plays, and one that stops playing later is remembered as refused
 * where every shelf looks — see `playable`.
 */
export function noteHeard(track: TrackMetadata, at = Date.now()): void {
  const { unplayable: _, ...kept } = track;
  write([{ track: kept, at }, ...heard()]);
}

/** Forget one side's listening: Spotify's, when whoever it belonged to signs out. */
export function forgetHeard(source: SourceType): void {
  write(heard().filter((entry) => entry.track.source !== source));
}

/**
 * The most recent listen of each song from one side, newest first.
 *
 * The same song three times tonight is one record on the shelf, where it was
 * last heard.
 */
export function lastHeard(entries: readonly Heard[], source: SourceType): Heard[] {
  const seen = new Set<string>();
  const kept: Heard[] = [];
  for (const entry of entries) {
    if (entry.track.source !== source || seen.has(entry.track.id)) continue;
    seen.add(entry.track.id);
    kept.push(entry);
  }
  return kept;
}

/**
 * How many times each artist was heard on one side.
 *
 * By the first name on the track, lowercased. A song by two artists is
 * mostly the first one's, and "Artist" and "artist" are one person.
 */
export function artistCounts(entries: readonly Heard[], source: SourceType): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.track.source !== source) continue;
    const name = firstArtist(entry.track.artist);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

/** The first of the names a track is credited to, as a key. */
export function firstArtist(credit: string): string {
  return (credit.split(',')[0] ?? '').trim().toLowerCase();
}

/**
 * Whether the song on the deck has now been heard.
 *
 * Fed every report the player makes. Counts only what was actually played:
 * a report a little further on than the last one is listening, and a jump —
 * forwards past a stretch nobody heard, or back to the start — is a seek and
 * adds nothing. Says yes once per playing of the song; a song started again
 * from the top after it counted can count again.
 */
export class Ear {
  private id: string | null = null;
  private last = 0;
  private played = 0;
  private counted = false;

  /** True on the report at which the song on the deck first counts as heard. */
  hear(trackId: string | null, positionMs: number, durationMs: number, playing: boolean): boolean {
    if (trackId !== this.id) {
      this.id = trackId;
      this.last = positionMs;
      this.played = 0;
      this.counted = false;
      return false;
    }
    if (trackId === null) return false;

    const step = positionMs - this.last;
    this.last = positionMs;
    // Back to the beginning after it counted: a second playing, from nothing.
    if (this.counted && step < 0 && positionMs < MOST_PER_REPORT_MS) {
      this.played = 0;
      this.counted = false;
      return false;
    }
    if (!playing || step <= 0 || step > MOST_PER_REPORT_MS) return false;

    this.played += step;
    const needed = durationMs > 0 ? Math.min(HEARD_AFTER_MS, durationMs / 2) : HEARD_AFTER_MS;
    if (this.counted || this.played < needed) return false;
    this.counted = true;
    return true;
  }
}
