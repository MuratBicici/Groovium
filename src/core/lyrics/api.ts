import type { TrackMetadata } from '@/core/types';
import { isTauri } from '@/core/utils/env';
import type { LyricLine } from './activeLine';

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
  via: 'get' | 'search';
}

export interface LyricsLookup {
  result: LyricsResult;
  matched: LyricsMatch | null;
}

/** The lyrics for a track, from Rust, which asks LRCLIB and keeps the answer. */
export async function getLyrics(track: TrackMetadata): Promise<LyricsLookup | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<LyricsLookup>('get_lyrics', {
    trackId: track.id,
    trackName: track.title,
    artistName: track.artist,
    albumName: track.album,
    durationMs: Math.round(track.duration),
  });
}
