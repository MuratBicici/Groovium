import { accessToken } from '@/core/security/spotifyAuth';
import { say } from '@/core/i18n';
import type { TrackMetadata } from '@/core/types';

/**
 * The slice of Spotify's Web API this app touches.
 *
 * Searching, playing, and the request machinery the rest of this folder is
 * built on. Playlists live next door in `spotifyPlaylists.ts`, which imports
 * `request` and `toTrackMetadata` from here.
 *
 * This file used to say that listing someone's playlists never worked, because
 * `/me/playlists` needs `playlist-read-private` and the scope set deliberately
 * excluded it. That was true and is not any more: the drawer asks for the
 * playlist scopes now, and the note stays here as the reason the grant is
 * wider than it was rather than as a warning.
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

/**
 * When Spotify will take another request, per endpoint family.
 *
 * Kept per family rather than for the app as a whole, because that is how the
 * quota is spent. Measured on a real registration that had been searching too
 * much: `/search` answered 429 with `QUOTA_EXCEEDED` while `/me` and
 * `/me/playlists` both answered 200 in the same second. One gate for
 * everything would have taken the shelf and the transport down with the search
 * box, which is a worse app than the one Spotify was refusing.
 *
 * Still shared between callers within a family, because within one the limit
 * really is per registration: the search box and the station's background
 * lookups are the same `/search` quota, and a gate each of them kept
 * separately would be no gate at all.
 *
 * This exists because being throttled used to make it worse. Every keystroke
 * ran a search, every search was refused, and every refusal was politely
 * retried once — so the app answered "you are sending too many requests" by
 * sending twice as many, and stayed refused for as long as anyone kept typing.
 */
const gates = new Map<string, { until: number; blindWait: number }>();

/**
 * How long to wait when Spotify refuses without saying how long.
 *
 * It usually names a number and then this is never used. When it does not, a
 * fixed guess is barely a back-off at all: a second passes, the next request is
 * refused exactly as before, and the wait resets to a second — which is what
 * "always one second, never opens" looks like from the outside, and which keeps
 * the app in the window it is trying to get out of.
 *
 * So each refusal in a row doubles it, and anything that gets through resets
 * it. An app being told to stop rather than to slow down backs off to a minute
 * and stays there quietly, instead of asking sixty times.
 */
const BLIND_WAIT_MS = 1_000;
const BLIND_WAIT_CAP_MS = 60_000;

/**
 * Which quota a path spends, as its first segment.
 *
 * `/search` is its own; everything under `/me` or `/playlists` is that one.
 * Coarse on purpose — Spotify does not publish the shape of this, and the only
 * thing the measurement established is that search is metered apart from the
 * rest.
 */
function family(path: string): string {
  return path.replace(/^\//, '').split(/[/?]/)[0] ?? '';
}

function gateFor(path: string): { until: number; blindWait: number } {
  const key = family(path);
  const gate = gates.get(key) ?? { until: 0, blindWait: BLIND_WAIT_MS };
  gates.set(key, gate);
  return gate;
}

/** Seconds until Spotify will listen again, rounded up, at least one. */
function waitLeft(until: number): number {
  return Math.max(1, Math.ceil((until - Date.now()) / 1000));
}

/**
 * A refusal, with the number Spotify refused by.
 *
 * The status is the part callers act on. "Route not found" and "you may not
 * read this" both arrive as an exception, and treating them the same is how a
 * permission problem turns into a second doomed request whose error is the one
 * that gets shown.
 */
export class SpotifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SpotifyError';
  }
}

/**
 * How long Spotify asked for, in milliseconds.
 *
 * A second when it did not say. Spotify limits on a rolling thirty-second
 * window and usually names a number; a missing header is not permission to
 * carry straight on.
 */
function retryAfterMs(response: Response, gate: { blindWait: number }): number {
  const after = Number(response.headers.get('Retry-After'));
  if (Number.isFinite(after) && after > 0) {
    gate.blindWait = BLIND_WAIT_MS;
    return after * 1000;
  }
  const wait = gate.blindWait;
  gate.blindWait = Math.min(gate.blindWait * 2, BLIND_WAIT_CAP_MS);
  return wait;
}

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

export async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  // Refused here rather than on the network. Sending anyway would be asking a
  // question this app has already been told the answer to, and every one of
  // them counts against the window that has to empty before it can ask again.
  const gate = gateFor(path);
  if (Date.now() < gate.until) {
    throw new SpotifyError(say('spotify.throttled', { seconds: waitLeft(gate.until) }), 429);
  }

  const token = await accessToken();

  let response = await send(path, token, init);

  // Spotify's documented contract for 429 is to wait the number of seconds in
  // `Retry-After` and try again, so one honest retry beats surfacing an error
  // the user can do nothing with. Only once: a second 429 means the window is
  // genuinely full, and stacking retries is how an app gets itself throttled
  // harder.
  if (response.status === 429) {
    const waitMs = retryAfterMs(response, gate);
    gate.until = Date.now() + waitMs;
    if (waitMs <= MAX_RETRY_AFTER_MS) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      response = await send(path, token, init);
      // The retry decides how long the gate stays shut: refused again and the
      // window is genuinely full, answered and there was never a queue.
      gate.until = response.status === 429 ? Date.now() + retryAfterMs(response, gate) : 0;
      if (response.ok) gate.blindWait = BLIND_WAIT_MS;
    }
  } else if (response.ok) {
    gate.until = 0;
    gate.blindWait = BLIND_WAIT_MS;
  }

  // Transport commands answer 204 with no body.
  if (response.status === 204) return null;

  if (!response.ok) {
    const body = await response.text();

    if (response.status === 401) {
      throw new SpotifyError('Spotify rejected the session. Sign out and connect again.', 401);
    }
    // 403 covers a missing scope, a playlist belonging to somebody else, and
    // an account Spotify will not let this registration act for. Guessing which
    // sent debugging the wrong way once already — and the guess it used to make
    // named Premium, which this app stopped being able to detect at all.
    //
    // Spotify says which in the body. Passed through rather than replaced: a
    // sentence from the people who refused beats a sentence from the people who
    // asked.
    if (response.status === 403) {
      throw new SpotifyError(
        `Spotify refused this request. ${spotifyMessage(body) ?? ''}`.trim(),
        403,
      );
    }
    if (response.status === 404) {
      throw new SpotifyError('Spotify has no active device for this app yet.', 404);
    }
    if (response.status === 429) {
      // Already waited once for whatever `Retry-After` asked, and the gate
      // above is now shut for however long the second refusal named.
      throw new SpotifyError(say('spotify.throttled', { seconds: waitLeft(gate.until) }), 429);
    }
    throw new SpotifyError(
      `Spotify API ${response.status}: ${body.slice(0, 160)}`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

/**
 * The human-readable half of a Spotify error body, if there is one.
 *
 * Shaped `{ error: { status, message } }`, and occasionally not JSON at all —
 * so this never throws, and answers null rather than handing back a slice of
 * an HTML error page.
 */
function spotifyMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    return typeof message === 'string' && message.trim() ? message.trim() : null;
  } catch {
    return null;
  }
}

// --- API shapes -------------------------------------------------------------

export interface ApiImage {
  url: string;
  width: number | null;
}

export interface ApiTrack {
  uri: string;
  name: string;
  duration_ms: number;
  /** `id` is what tells two artists with the same name apart. */
  artists: { id: string; name: string }[];
  album?: { name: string; images: ApiImage[] };
}

/**
 * Pick artwork big enough to stay sharp on the 56px platter label without
 * hauling a 640px image around for a list row.
 */
export function pickCover(images: ApiImage[] | null | undefined): string | undefined {
  if (!images?.length) return undefined;
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((i) => (i.width ?? 0) >= 300) ?? sorted[sorted.length - 1])?.url;
}

/** Map a Spotify track onto the shared metadata shape. */
export function toTrackMetadata(track: ApiTrack): TrackMetadata {
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
 * Searches already answered, and searches still being answered.
 *
 * Searching is the quota this app runs out of, and a great deal of what it
 * spends is the same question twice. Typing a word and backspacing asks for
 * every prefix on the way down as well as on the way up; the station looks up
 * "this artist — this title" and may well want the same one again a few tracks
 * later. None of those answers change in the minutes between.
 *
 * The second map is the same idea for requests that have not landed yet, so two
 * callers wanting the same thing at the same moment make one request rather
 * than two — the search box and the station can easily overlap.
 */
const searched = new Map<string, { at: number; tracks: TrackMetadata[] }>();
const searching = new Map<string, Promise<TrackMetadata[]>>();

/** Long enough to cover typing and a station's run, short enough to stay true. */
const SEARCH_CACHE_MS = 10 * 60_000;

/** Beyond this the oldest go. A few hundred results is nothing; unbounded is. */
const SEARCH_CACHE_MAX = 120;

function remember(key: string, tracks: TrackMetadata[]): void {
  searched.set(key, { at: Date.now(), tracks });
  if (searched.size <= SEARCH_CACHE_MAX) return;
  // Insertion order, so the first key is the oldest.
  const oldest = searched.keys().next().value;
  if (oldest !== undefined) searched.delete(oldest);
}

/**
 * Find tracks. Results come back as ordinary `TrackMetadata`, so they can be
 * played or added to a playlist without any Spotify-shaped type leaking further
 * into the app.
 *
 * Answered from memory when the same thing has been asked recently. Not an
 * optimisation: this is the endpoint whose quota runs out, and the cheapest
 * request is the one that is not made.
 */
export async function searchTracks(query: string): Promise<TrackMetadata[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const key = trimmed.toLowerCase();
  const known = searched.get(key);
  if (known && Date.now() - known.at < SEARCH_CACHE_MS) return known.tracks;

  const already = searching.get(key);
  if (already) return already;

  const pending = fetchTracks(trimmed).then(
    (tracks) => {
      searching.delete(key);
      remember(key, tracks);
      return tracks;
    },
    (err: unknown) => {
      // Not remembered. A refusal is about this moment rather than about the
      // question, and caching one would keep answering with it after the quota
      // came back.
      searching.delete(key);
      throw err;
    },
  );
  searching.set(key, pending);
  return pending;
}

async function fetchTracks(trimmed: string): Promise<TrackMetadata[]> {
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

async function searchArtists(query: string, limit: number): Promise<ApiArtist[]> {
  const params = new URLSearchParams({ q: query, type: 'artist', limit: String(limit) });
  const data = await request<ArtistSearchResponse>(`/search?${params}`);
  return (data?.artists?.items ?? []).filter((a): a is ApiArtist => a !== null && !!a.id);
}

/**
 * One artist's tracks, found by searching rather than by asking for them.
 *
 * `/artists/{id}/top-tracks` did this until February 2026, when Spotify removed
 * it with nothing in its place. Search survives, so the question changes from
 * "what is this artist known for" to "what does Spotify return for this
 * artist" — relevance order rather than popularity order. The station does not
 * depend on the difference: it does its own picking and deliberately ignores
 * any ordering this file might suggest.
 *
 * The `artist:` filter matches on the *name*, not the id, so a common name
 * returns somebody else's music. Hence the check against the id we already
 * hold: without it the tier would quietly recommend the wrong artist, which is
 * worse than recommending nothing. The name is stripped of quotes because one
 * inside the term would close the filter early.
 */
async function tracksByArtist(artist: ApiArtist): Promise<TrackMetadata[]> {
  const params = new URLSearchParams({
    q: `artist:"${artist.name.replace(/"/g, '')}"`,
    type: 'track',
    limit: String(SEARCH_LIMIT),
  });
  const data = await request<SearchResponse>(`/search?${params}`);
  return (data?.tracks?.items ?? [])
    .filter((track): track is ApiTrack => track !== null && !!track.uri)
    .filter((track) => track.artists.some((a) => a.id === artist.id))
    .map(toTrackMetadata);
}

/**
 * Playable tracks by artists Spotify files under the same genre as this one.
 *
 * The station's last source of similarity, for a track Last.fm knows nothing
 * about under an artist it knows nothing about either.
 *
 * Spotify withdrew `/recommendations` and `related-artists` from new apps in
 * November 2024, which is why the station is built on Last.fm at all. This tier
 * reconstructs enough of the idea out of what is left: the seed artist's genre,
 * then who else is in it, then what those artists have.
 *
 * February 2026 took another piece — `/artists/{id}/top-tracks`, the last step
 * — so that step is a search now (see `tracksByArtist`). Only the last step
 * changed: everything above it was always `/search`, which is still here.
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
    found.push(...(await tracksByArtist(peer)));
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
