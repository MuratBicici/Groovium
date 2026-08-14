import { accessToken } from '@/core/security/spotifyAuth';
import type { TrackMetadata } from '@/core/types';

/**
 * The slice of Spotify's Web API this app touches.
 *
 * Deliberately tiny: Spotify is a way to find one song. Browsing albums and
 * playlists lives on Spotify's own client, and collecting music is what
 * Groovium's library and playlists are for.
 *
 * An earlier version listed the user's Spotify playlists, which never worked:
 * `/me/playlists` needs the `playlist-read-private` scope, and the scope set
 * was deliberately narrowed to exclude it. Rather than widen the grant for a
 * feature the app no longer needs, the calls are gone.
 */

const API_BASE = 'https://api.spotify.com/v1';

/** Spotify caps this at 10 for Development Mode apps; it was 50 until Feb 2026. */
export const SEARCH_LIMIT = 10;

async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  const token = await accessToken();

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  // Transport commands answer 204 with no body.
  if (response.status === 204) return null;

  if (!response.ok) {
    const body = await response.text();

    if (response.status === 401) {
      throw new Error('Spotify rejected the session. Sign out and connect again.');
    }
    // 403 covers both a non-Premium account and a missing scope. Claiming it is
    // always Premium sent debugging in the wrong direction once already.
    if (response.status === 403) {
      throw new Error('Spotify refused this request — the account may not be Premium, or the app may lack permission for it.');
    }
    if (response.status === 404) {
      throw new Error('Spotify has no active device for this app yet.');
    }
    if (response.status === 429) {
      throw new Error('Too many requests to Spotify. Wait a moment and try again.');
    }
    throw new Error(`Spotify API ${response.status}: ${body.slice(0, 160)}`);
  }

  return (await response.json()) as T;
}

// --- API shapes -------------------------------------------------------------

interface ApiImage {
  url: string;
  width: number | null;
}

interface ApiTrack {
  uri: string;
  name: string;
  duration_ms: number;
  artists: { name: string }[];
  album?: { name: string; images: ApiImage[] };
}

/**
 * Pick artwork big enough to stay sharp on the 56px platter label without
 * hauling a 640px image around for a list row.
 */
function pickCover(images: ApiImage[] | null | undefined): string | undefined {
  if (!images?.length) return undefined;
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((i) => (i.width ?? 0) >= 300) ?? sorted[sorted.length - 1])?.url;
}

/** Map a Spotify track onto the shared metadata shape. */
function toTrackMetadata(track: ApiTrack): TrackMetadata {
  const cover = pickCover(track.album?.images);
  const metadata: TrackMetadata = {
    // The URI is what `play()` needs, so it doubles as the id.
    id: track.uri,
    title: track.name,
    artist: track.artists.map((a) => a.name).join(', ') || 'Unknown Artist',
    album: track.album?.name ?? 'Spotify',
    duration: track.duration_ms,
    source: 'spotify',
  };
  if (cover) metadata.coverArtUrl = cover;
  return metadata;
}

// --- Search -----------------------------------------------------------------

interface SearchResponse {
  tracks?: { items: (ApiTrack | null)[] };
}

/**
 * Find tracks. Results come back as ordinary `TrackMetadata`, so they can be
 * played or added to a playlist without any Spotify-shaped type leaking further
 * into the app.
 */
export async function searchTracks(query: string): Promise<TrackMetadata[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({
    q: trimmed,
    type: 'track',
    limit: String(SEARCH_LIMIT),
  });
  const data = await request<SearchResponse>(`/search?${params}`);

  // Spotify occasionally returns nulls among search results.
  return (data?.tracks?.items ?? [])
    .filter((track): track is ApiTrack => track !== null && !!track.uri)
    .map(toTrackMetadata);
}

/** Start playback of a track URI on this app's own device. */
export async function playOnDevice(deviceId: string, trackUri: string): Promise<void> {
  await request(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    body: JSON.stringify({ uris: [trackUri] }),
  });
}
