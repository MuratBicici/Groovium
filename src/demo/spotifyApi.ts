import type { TrackMetadata } from '@/core/types';
import { crates, mostPlayed, recentlyPlayed, tracks } from './catalogue';

/**
 * Spotify's Web API, answered from the demo's collection.
 *
 * Only what the drawer reads: the account's playlists, what is in each, the
 * two spotlight rows, and search. Writes are agreed to and forgotten. Anything
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
    return json({ items: recentlyPlayed().map((track) => ({ track: apiTrack(track) })) });
  }
  if (path === '/me/top/tracks') {
    // Asked without a country, as the real one has to be.
    return json({ items: mostPlayed().map((track) => apiTrack(track)) });
  }

  if (path === '/search') {
    const words = (url.searchParams.get('q') ?? '')
      .toLowerCase()
      .replace(/\b(track|artist|album):/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    const found = tracks().filter((track) => {
      const text = `${track.title} ${track.artist} ${track.album}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
    return json({ tracks: page(found.map((track) => apiTrack(track, market)), url), artists: { items: [] } });
  }

  return json({ error: { status: 404, message: 'Not in the demo' } }, 404);
}
