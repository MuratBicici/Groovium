import { accessToken } from '@/core/security/spotifyAuth';
import type { TrackMetadata } from '@/core/types';

/**
 * The slice of Spotify's Web API this app touches.
 *
 * Rust holds the credentials and mints access tokens; this only spends them.
 * Every call goes through `request`, so token handling and error shaping live in
 * one place.
 *
 * Shaped around what a Development Mode app can actually reach. Spotify removed
 * a lot in February 2026 — batch fetches, browse, artist top-tracks — and
 * `/recommendations` went earlier still, in November 2024, which is why there is
 * no "play similar tracks" radio here. Search, single-item lookups, album and
 * playlist contents, and the player all remain, and that is enough: everything
 * expands into Groovium's own queue, so the existing transport, repeat, shuffle
 * and removal controls work on Spotify tracks exactly as they do on local files.
 */

const API_BASE = 'https://api.spotify.com/v1';

/** Spotify caps this at 10 for Development Mode apps; it was 50 until Feb 2026. */
export const SEARCH_LIMIT = 10;

/** How many tracks to pull out of an album or playlist. */
const EXPAND_LIMIT = 50;

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
    if (response.status === 403) {
      throw new Error('Spotify refused the request. This usually means the account is not Premium.');
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

interface ApiAlbum {
  id: string;
  uri: string;
  name: string;
  images: ApiImage[];
  artists: { name: string }[];
  total_tracks: number;
  tracks?: { items: ApiTrack[] };
}

interface ApiPlaylist {
  id: string;
  uri: string;
  name: string;
  images: ApiImage[] | null;
  owner: { display_name: string | null };
  tracks: { total: number };
}

// --- Result types the UI works with ----------------------------------------

export type SearchKind = 'track' | 'album' | 'playlist';

export interface SearchResult {
  kind: SearchKind;
  /** Spotify id for albums and playlists, URI for tracks. */
  id: string;
  title: string;
  subtitle: string;
  coverUrl?: string;
  /** Ready to queue directly. Only present for tracks. */
  track?: TrackMetadata;
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
function toTrackMetadata(track: ApiTrack, albumFallback?: ApiAlbum): TrackMetadata {
  const cover = pickCover(track.album?.images ?? albumFallback?.images);
  const metadata: TrackMetadata = {
    // The URI is what `play()` needs, so it doubles as the id.
    id: track.uri,
    title: track.name,
    artist: track.artists.map((a) => a.name).join(', ') || 'Unknown Artist',
    album: track.album?.name ?? albumFallback?.name ?? 'Spotify',
    duration: track.duration_ms,
    source: 'spotify',
  };
  if (cover) metadata.coverArtUrl = cover;
  return metadata;
}

// --- Search -----------------------------------------------------------------

interface SearchResponse {
  tracks?: { items: ApiTrack[] };
  albums?: { items: ApiAlbum[] };
  playlists?: { items: (ApiPlaylist | null)[] };
}

/**
 * Search one category at a time.
 *
 * The panel is 340px wide, so mixing categories into one list would make it
 * impossible to tell what clicking a row will do. A tab per kind keeps the
 * action predictable.
 */
export async function search(query: string, kind: SearchKind): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({
    q: trimmed,
    type: kind,
    limit: String(SEARCH_LIMIT),
  });
  const data = await request<SearchResponse>(`/search?${params}`);
  if (!data) return [];

  if (kind === 'track') {
    return (data.tracks?.items ?? []).map((track) => {
      const metadata = toTrackMetadata(track);
      const result: SearchResult = {
        kind: 'track',
        id: track.uri,
        title: metadata.title,
        subtitle: metadata.artist,
        track: metadata,
      };
      if (metadata.coverArtUrl) result.coverUrl = metadata.coverArtUrl;
      return result;
    });
  }

  if (kind === 'album') {
    return (data.albums?.items ?? []).map((album) => {
      const result: SearchResult = {
        kind: 'album',
        id: album.id,
        title: album.name,
        subtitle: `${album.artists.map((a) => a.name).join(', ')} · ${album.total_tracks} tracks`,
      };
      const cover = pickCover(album.images);
      if (cover) result.coverUrl = cover;
      return result;
    });
  }

  // Spotify occasionally returns nulls in playlist results.
  return (data.playlists?.items ?? []).filter((p): p is ApiPlaylist => p !== null).map((playlist) => {
    const result: SearchResult = {
      kind: 'playlist',
      id: playlist.id,
      title: playlist.name,
      subtitle: `${playlist.owner.display_name ?? 'Spotify'} · ${playlist.tracks.total} tracks`,
    };
    const cover = pickCover(playlist.images);
    if (cover) result.coverUrl = cover;
    return result;
  });
}

// --- Expanding a container into tracks --------------------------------------

/**
 * An album's own response carries its first page of tracks, so one request
 * gets both the artwork and the track list. The simplified tracks it contains
 * have no album object of their own, hence passing the album as a fallback.
 */
export async function expandAlbum(albumId: string): Promise<TrackMetadata[]> {
  const album = await request<ApiAlbum>(`/albums/${albumId}`);
  if (!album?.tracks) return [];
  return album.tracks.items.map((track) => toTrackMetadata(track, album));
}

interface PlaylistItemsResponse {
  items: { track: ApiTrack | null }[];
}

/**
 * Playlist items carry full track objects. Nulls appear for episodes and for
 * tracks unavailable in the user's market, and are dropped.
 */
export async function expandPlaylist(playlistId: string): Promise<TrackMetadata[]> {
  const data = await request<PlaylistItemsResponse>(
    `/playlists/${playlistId}/items?limit=${EXPAND_LIMIT}`,
  );
  return (data?.items ?? [])
    .map((item) => item.track)
    .filter((track): track is ApiTrack => track !== null && !!track.uri)
    .map((track) => toTrackMetadata(track));
}

/** The signed-in user's own playlists, shown before anything is searched. */
export async function myPlaylists(): Promise<SearchResult[]> {
  const data = await request<{ items: ApiPlaylist[] }>(`/me/playlists?limit=${SEARCH_LIMIT}`);
  return (data?.items ?? []).map((playlist) => {
    const result: SearchResult = {
      kind: 'playlist',
      id: playlist.id,
      title: playlist.name,
      subtitle: `${playlist.tracks.total} tracks`,
    };
    const cover = pickCover(playlist.images);
    if (cover) result.coverUrl = cover;
    return result;
  });
}

/** Start playback of a track URI on this app's own device. */
export async function playOnDevice(deviceId: string, trackUri: string): Promise<void> {
  await request(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    body: JSON.stringify({ uris: [trackUri] }),
  });
}
