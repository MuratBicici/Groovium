import type { TrackMetadata } from '@/core/types';
import { isTauri } from '@/core/utils/env';
import type { LyricLine } from './activeLine';
import type { LyricsSource } from './sourceChoice';
import type { LyricsTiming } from './timing';

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
  /**
   * Which source and step: `lrclib:get`, `lrclib:get-clean`, `lrclib:search`
   * or `netease`; `saved:lrclib` or `saved:netease` for lyrics matched by hand.
   */
  via: string;
}

/** Whether a lookup's lyrics were matched by hand, and from which source if so. */
export function savedFrom(match: LyricsMatch | null | undefined): string | null {
  if (!match?.via.startsWith('saved')) return null;
  return match.via.split(':')[1] ?? '';
}

/** A lyrics source by the name people know it by. */
export function sourceName(source: string): string {
  if (source === 'lrclib') return 'LRCLIB';
  if (source === 'netease') return 'NetEase';
  return source;
}

/** One record a search by hand found. The shape is Rust's `Candidate`. */
export interface LyricsCandidate {
  /** `lrclib:<id>` or `netease:<id>`. */
  key: string;
  source: 'lrclib' | 'netease';
  trackName: string;
  artistName: string;
  albumName: string;
  durationMs: number;
  kind: 'synced' | 'plain' | 'instrumental';
}

/**
 * Look for lyrics by hand in every source, the likeliest first for a song
 * `durationMs` long. Outside the app, a development build makes some up.
 */
export async function searchLyrics(query: string, durationMs: number): Promise<LyricsCandidate[]> {
  if (!isTauri()) {
    if (import.meta.env.DEV) return (await import('./fixture')).candidatesFor(query, durationMs);
    return [];
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<LyricsCandidate[]>('search_lyrics', { query, durationMs: Math.round(durationMs) });
}

/** What one candidate from `searchLyrics` holds, to read before choosing it. */
export async function previewLyrics(key: string): Promise<LyricsResult> {
  if (!isTauri()) {
    if (import.meta.env.DEV) return (await import('./fixture')).previewFor(key);
    return { status: 'NotFound' };
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<LyricsResult>('lyrics_candidate', { key });
}

export interface LyricsLookup {
  result: LyricsResult;
  matched: LyricsMatch | null;
  /**
   * The listener's retiming of these lines, for lyrics matched by hand that
   * they retimed. The lines are as the source gave them; the store moves them.
   */
  timing?: LyricsTiming;
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
