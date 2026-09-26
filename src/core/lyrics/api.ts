import type { TrackMetadata } from '@/core/types';
import { isTauri } from '@/core/utils/env';
import type { LyricLine } from './activeLine';
import type { LyricsSource } from './sourceChoice';

/** What LRCLIB had for a song. The shape is Rust's `LyricsResult`. */
export type LyricsResult =
  | { status: 'Synced'; data: LyricLine[] }
  | { status: 'Plain'; data: string }
  | { status: 'Instrumental' }
  | { status: 'NotFound' };

/** Which LRCLIB record it came from, for checking by eye. */
export interface LyricsMatch {
  trackName: string;
  artistName: string;
  albumName: string;
  durationS: number;
  /** Which source and step: `lrclib:get`, `lrclib:get-clean`, `lrclib:search` or `netease`. */
  via: string;
}

export interface LyricsLookup {
  result: LyricsResult;
  matched: LyricsMatch | null;
}

/**
 * The lyrics for a track, from Rust, which asks LRCLIB and keeps the answer.
 *
 * `source` asks one source only; without it, the usual order.
 */
export async function getLyrics(
  track: TrackMetadata,
  source: LyricsSource | null = null,
): Promise<LyricsLookup | null> {
  if (!isTauri()) {
    // The lookup lives in Rust. A development build in a browser gets made-up
    // lyrics instead, so the views can be seen without the app around them.
    if (import.meta.env.DEV) return (await import('./fixture')).fixtureFor(track);
    return null;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<LyricsLookup>('get_lyrics', {
    trackId: track.id,
    trackName: track.title,
    artistName: track.artist,
    albumName: track.album,
    durationMs: Math.round(track.duration),
    source,
  });
}
