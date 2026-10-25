import type { TrackMetadata } from '@/core/types';
import { crates, mostPlayed, recentlyPlayed, tracks } from './catalogue';

/**
 * Spotify's Web API, answered from the demo's collection.
 *
 * Only what the drawer reads: the account's playlists, what is in each, the
 * spotlight rows, liked songs, the top artists and their genres, search, and
 * an album opened from it. Writes are agreed to and forgotten. Anything
 * else is a 404, which every caller already knows how to take.
 */

export const DEMO_USER = { id: 'demo-listener', displayName: 'Alex' };

const API = 'https://api.spotify.com/v1';

/**
 * The one song in the collection not sold where the demo is listened to, so a
 * song that will not play here can be seen: said so when asked with a country.
 */
function notSoldHere(): string | undefined {
  return tracks().filter((track) => track.source === 'spotify')[2]?.id;
}

/** A track as the Web API spells it; asked with a country, saying whether it plays there. */
function apiTrack(track: TrackMetadata, market: string | null = null) {
  const images = track.coverArtUrl
    ? [
        { url: track.coverArtUrl, width: 300, height: 300 },
        { url: track.coverArtUrl, width: 64, height: 64 },
      ]
    : [];
  const refused = track.id === notSoldHere();
  return {
    uri: track.id,
    name: track.title,
    duration_ms: track.duration,
    artists: [{ id: `artist-${track.artist}`, name: track.artist }],
    album: { name: track.album, images },
    ...(market && { is_playable: !refused, ...(refused && { restrictions: { reason: 'market' } }) }),
  };
}

/**
 * The collection's Spotify songs gathered by album, as the search finds albums
 * and opens them. The id is made from the album's name, which is unique here.
 */
function albums(): { id: string; name: string; artist: string; tracks: TrackMetadata[] }[] {
  const byName = new Map<string, { id: string; name: string; artist: string; tracks: TrackMetadata[] }>();
  for (const track of tracks().filter((t) => t.source === 'spotify')) {
    const found = byName.get(track.album) ?? {
      id: `demo-album-${track.album.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: track.album,
      artist: track.artist,
      tracks: [],
    };
    found.tracks.push(track);
    byName.set(track.album, found);
  }
  return [...byName.values()];
}

/** An album as the Web API spells it in a search. */
function apiAlbum(album: ReturnType<typeof albums>[number]) {
  const cover = album.tracks[0]?.coverArtUrl;
  return {
    id: album.id,
    name: album.name,
    artists: [{ name: album.artist }],
    images: cover ? [{ url: cover, width: 300, height: 300 }] : [],
    release_date: '2021-05-14',
    total_tracks: album.tracks.length,
  };
}

/**
 * The genres Spotify would file the demo's artists under, so the front page's
 * genre shelves have something to be made of. Invented, like the artists.
 */
const GENRES: Record<string, string[]> = {
  'Harbor Lights': ['indie pop', 'dream pop'],
  'The Velvet Almanac': ['dream pop', 'shoegaze'],
  'Mira Solenne': ['indie pop', 'art pop'],
  'Cold Cartography': ['shoegaze', 'post-rock'],
  'June Parade': ['indie pop'],
  'Otis Fernwood': ['folk', 'indie folk'],
  'Nova Delacroix': ['synthwave', 'dream pop'],
  'The Quiet Arcade': ['shoegaze', 'dream pop'],
  'Lumen Choir': ['indie folk', 'art pop'],
  'Del Mar Social Club': ['indie pop', 'synthwave'],
  'Wren & the Weathervanes': ['indie folk', 'folk'],
  'Sable Harbour': ['post-rock', 'shoegaze'],
};

const genresOf = (artist: string) => GENRES[artist] ?? [];

/** An artist as the Web API spells it, genres and all. */
function apiArtist(name: string) {
  return { id: `artist-${name}`, name, genres: genresOf(name) };
}

/** The songs somebody "liked": most of the collection, newest first. */
function liked(): TrackMetadata[] {
  return tracks()
    .filter((track) => track.source === 'spotify')
    .filter((_, at) => at % 3 !== 1)
    .reverse();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** One page of a list, with Spotify's offset paging. */
function page<T>(all: T[], url: URL) {
  const limit = Number(url.searchParams.get('limit') ?? 50);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const items = all.slice(offset, offset + limit);
  const more = offset + limit < all.length;
  return {
    items,
    total: all.length,
    next: more ? `${url.origin}${url.pathname}?offset=${offset + limit}&limit=${limit}` : null,
  };
}

/** Answer a request to the Web API, or null if it is not one. */
export function answerSpotify(input: RequestInfo | URL, init?: RequestInit): Response | null {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!raw.startsWith(API)) return null;
  const url = new URL(raw);
  const path = url.pathname.replace('/v1', '');
  const method = (init?.method ?? 'GET').toUpperCase();
  const market = url.searchParams.get('market');

  if (method !== 'GET') return json({ snapshot_id: `demo-${Date.now()}` }, 200);

  const one = /^\/tracks\/([^/]+)$/.exec(path);
  if (one) {
    const track = tracks().find((t) => t.id === `spotify:track:${decodeURIComponent(one[1] ?? '')}`);
    return track ? json(apiTrack(track, market)) : json({ error: { status: 404, message: 'Not found' } }, 404);
  }

  if (path === '/me') return json({ id: DEMO_USER.id, display_name: DEMO_USER.displayName });

  if (path === '/me/playlists') {
    const all = crates().map((crate) => ({
      id: crate.id,
      name: crate.name,
      description: crate.description,
      public: false,
      snapshot_id: `snapshot-${crate.id}`,
      owner: { id: DEMO_USER.id, display_name: DEMO_USER.displayName },
      images: [{ url: crate.coverArtUrl, width: 300, height: 300 }],
      items: { total: crate.tracks.length },
    }));
    return json(page(all, url));
  }

  const inCrate = /^\/playlists\/([^/]+)\/(items|tracks)$/.exec(path);
  if (inCrate) {
    const crate = crates().find((c) => c.id === decodeURIComponent(inCrate[1] ?? ''));
    if (!crate) return json({ error: { status: 404, message: 'Not found' } }, 404);
    const entries = crate.tracks.map((track) => ({
      item: apiTrack(track, market),
      track: apiTrack(track, market),
    }));
    return json(page(entries, url));
  }

  if (path === '/me/player/recently-played') {
    // Twenty minutes apart, going back from now, as if heard on a phone today.
    const now = Date.now();
    return json({
      items: recentlyPlayed().map((track, at) => ({
        track: apiTrack(track),
        played_at: new Date(now - (at + 1) * 20 * 60_000).toISOString(),
      })),
    });
  }
  if (path === '/me/top/artists') {
    const names = [...new Set(mostPlayed().map((track) => track.artist))];
    return json({ items: names.map(apiArtist) });
  }
  if (path === '/me/tracks') {
    return json(page(liked().map((track) => ({ track: apiTrack(track, market) })), url));
  }
  if (path === '/me/top/tracks') {
    // Asked without a country, as the real one has to be.
    return json({ items: mostPlayed().map((track) => apiTrack(track)) });
  }

  if (path === '/search') {
    const q = url.searchParams.get('q') ?? '';
    const types = (url.searchParams.get('type') ?? 'track').split(',');
    const genre = /^genre:"([^"]*)"$/.exec(q)?.[1];
    if (genre !== undefined) {
      const filed = tracks().filter((track) => track.source === 'spotify' && genresOf(track.artist).includes(genre));
      return json({ tracks: page(filed.map((track) => apiTrack(track, market)), url) });
    }
    const named = /^artist:"([^"]*)"$/.exec(q)?.[1];
    if (named !== undefined && types.includes('artist')) {
      const found = Object.keys(GENRES).filter((name) => name.toLowerCase() === named.toLowerCase());
      return json({ artists: { items: found.map(apiArtist) } });
    }
    const words = q
      .toLowerCase()
      .replace(/\b(track|artist|album):/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    const found = tracks().filter((track) => {
      const text = `${track.title} ${track.artist} ${track.album}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
    const shelved = types.includes('album')
      ? albums().filter((album) => words.every((word) => `${album.name} ${album.artist}`.toLowerCase().includes(word)))
      : [];
    return json({
      tracks: page(found.map((track) => apiTrack(track, market)), url),
      artists: { items: [] },
      ...(types.includes('album') && { albums: page(shelved.map(apiAlbum), url) }),
    });
  }

  const onAlbum = /^\/albums\/([^/]+)\/tracks$/.exec(path);
  if (onAlbum) {
    const album = albums().find((a) => a.id === decodeURIComponent(onAlbum[1] ?? ''));
    if (!album) return json({ error: { status: 404, message: 'Not found' } }, 404);
    // Without the album on each song, as the real one sends them.
    return json(page(album.tracks.map((track) => ({ ...apiTrack(track, market), album: undefined })), url));
  }

  return json({ error: { status: 404, message: 'Not in the demo' } }, 404);
}
