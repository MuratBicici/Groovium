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

/**
 * Longest `Retry-After` worth honouring before giving up.
 *
 * Spotify limits on a rolling 30-second window, so a wait it asks for is
 * normally seconds. Anything much longer means the app is being told to stop
 * rather than to slow down, and blocking a caller on it would be worse than
 * failing.
 */
const MAX_RETRY_AFTER_MS = 10_000;

async function send(path: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  const token = await accessToken();

  let response = await send(path, token, init);

  // Spotify's documented contract for 429 is to wait the number of seconds in
  // `Retry-After` and try again, so one honest retry beats surfacing an error
  // the user can do nothing with. Only once: a second 429 means the window is
  // genuinely full, and stacking retries is how an app gets itself throttled
  // harder.
  if (response.status === 429) {
    const after = Number(response.headers.get('Retry-After'));
    const waitMs = Number.isFinite(after) ? after * 1000 : 1000;
    if (waitMs <= MAX_RETRY_AFTER_MS) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      response = await send(path, token, init);
    }
  }

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
      // Already waited once for whatever `Retry-After` asked.
      throw new Error('Spotify is rate limiting this app. Wait a moment and try again.');
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

// --- Finding music like other music -----------------------------------------

/**
 * How many artists from a genre get their top tracks fetched.
 *
 * Two, because each is a request and this runs only when Last.fm has come up
 * empty twice. Two artists is twenty candidates, which is more than enough for
 * the station to draw a handful from.
 */
const GENRE_ARTISTS = 2;

interface ApiArtist {
  id: string;
  name: string;
  /** Spotify's own labels. Plenty of artists carry none. */
  genres?: string[];
}

interface ArtistSearchResponse {
  artists?: { items: (ApiArtist | null)[] };
}

interface TopTracksResponse {
  tracks?: (ApiTrack | null)[];
}

async function searchArtists(query: string, limit: number): Promise<ApiArtist[]> {
  const params = new URLSearchParams({ q: query, type: 'artist', limit: String(limit) });
  const data = await request<ArtistSearchResponse>(`/search?${params}`);
  return (data?.artists?.items ?? []).filter((a): a is ApiArtist => a !== null && !!a.id);
}

async function artistTopTracks(id: string): Promise<TrackMetadata[]> {
  // `market` is required here. `from_token` reads the country off the session,
  // which needs no scope the app has not already been granted.
  const data = await request<TopTracksResponse>(
    `/artists/${encodeURIComponent(id)}/top-tracks?market=from_token`,
  );
  return (data?.tracks ?? [])
    .filter((track): track is ApiTrack => track !== null && !!track.uri)
    .map(toTrackMetadata);
}

/**
 * Playable tracks by artists Spotify files under the same genre as this one.
 *
 * The station's last source of similarity, for a track Last.fm knows nothing
 * about under an artist it knows nothing about either.
 *
 * Spotify withdrew `/recommendations` and `related-artists` from new apps in
 * November 2024, which is why the station is built on Last.fm at all. Artist
 * genres and `/artists/{id}/top-tracks` survived that cull, and between them
 * they reconstruct enough of the idea: the seed artist's genre, then who else
 * is in it, then what those artists are known for.
 *
 * Three or four requests. Returns tracks rather than names because it has
 * already done the searching the caller would otherwise have to repeat.
 * Deliberately not shuffled here — the station does its own picking, and a
 * second opinion about ordering in this file would only fight it.
 */
export async function tracksLikeArtist(name: string): Promise<TrackMetadata[]> {
  const trimmed = name.trim();
  if (!trimmed) return [];

  const [seed] = await searchArtists(trimmed, 1);
  if (!seed) return [];

  const genre = seed.genres?.[0];
  if (!genre) return [];

  const peers = await searchArtists(`genre:"${genre}"`, SEARCH_LIMIT);
  const found: TrackMetadata[] = [];
  for (const peer of peers.filter((p) => p.id !== seed.id).slice(0, GENRE_ARTISTS)) {
    found.push(...(await artistTopTracks(peer.id)));
  }
  return found;
}

/** Start playback of a track URI on this app's own device. */
/**
 * What Spotify itself says is happening right now.
 *
 * The one source of truth about whether audio is coming out. Everything local
 * is guesswork: the provider's own clock is extrapolated, and so — measured,
 * after two attempts built on the opposite assumption — is the position the
 * Web Playback SDK reports. Both go on counting through a network outage.
 *
 * `answered: false` is Spotify not answering at all, kept apart from its
 * answering "nothing is playing". They are different facts and they deserve
 * different patience: no route to Spotify means the music has already stopped
 * or is about to, while a "not playing" can be a moment between tracks.
 */
export type Playback =
  | { answered: false }
  | { answered: true; isPlaying: boolean; progressMs: number };

export async function currentPlayback(): Promise<Playback> {
  try {
    const state = await request<{ is_playing: boolean; progress_ms: number | null }>('/me/player');
    // 204 means nothing is playing anywhere, and `request` returns null for it.
    if (!state) return { answered: true, isPlaying: false, progressMs: 0 };
    return { answered: true, isPlaying: state.is_playing, progressMs: state.progress_ms ?? 0 };
  } catch {
    return { answered: false };
  }
}

export async function playOnDevice(deviceId: string, trackUri: string): Promise<void> {
  await request(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    body: JSON.stringify({ uris: [trackUri] }),
  });
}
