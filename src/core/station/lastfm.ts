import { isTauri } from '@/core/utils/env';

/**
 * Bridge to the Last.fm lookup in `src-tauri/src/lastfm.rs`.
 *
 * The call itself lives in Rust rather than here for a reason that is not just
 * habit: Last.fm requires an identifying `User-Agent`, and browsers refuse to
 * let JavaScript set that header. Keeping the API key out of the webview is the
 * second reason.
 */

export interface SimilarTrack {
  title: string;
  artist: string;
  /** Last.fm's similarity score, 0..1. Results arrive most-similar first. */
  matchScore: number;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}

export async function hasApiKey(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('lastfm_has_api_key');
}

export async function setApiKey(apiKey: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('lastfm_set_api_key', { apiKey });
}

export async function clearApiKey(): Promise<void> {
  if (!isTauri()) return;
  await invoke('lastfm_clear_api_key');
}

export async function openAccountPage(): Promise<void> {
  if (!isTauri()) return;
  await invoke('lastfm_open_account');
}

/** Tracks similar to this one, most similar first. */
export async function similarTracks(artist: string, title: string): Promise<SimilarTrack[]> {
  if (!isTauri()) return [];
  return invoke<SimilarTrack[]>('lastfm_similar_tracks', { artist, title });
}

/**
 * Tracks by artists similar to this one.
 *
 * What `similarTracks` falls back to. Last.fm's track database is far thinner
 * than its artist database — album tracks by well-known bands routinely return
 * nothing — and the artist is almost always known even when the song is not.
 */
export async function artistCandidates(artist: string): Promise<SimilarTrack[]> {
  if (!isTauri()) return [];
  return invoke<SimilarTrack[]>('lastfm_artist_candidates', { artist });
}

/** A word Last.fm's listeners file an artist under, and how strongly (0..100). */
export interface Tag {
  name: string;
  count: number;
}

/** What Last.fm's listeners call this artist's music, strongest first. */
export async function artistTags(artist: string): Promise<Tag[]> {
  if (!isTauri()) return [];
  return invoke<Tag[]>('lastfm_artist_tags', { artist });
}

/** The songs most listened to under a tag, fifty to a page. */
export async function tagTracks(tag: string, page: number): Promise<SimilarTrack[]> {
  if (!isTauri()) return [];
  return invoke<SimilarTrack[]>('lastfm_tag_tracks', { tag, page });
}
