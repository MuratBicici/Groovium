import type { TrackMetadata } from '@/core/types';
import { account } from '@/core/security/spotifyAuth';
import { artistCounts, firstArtist, heard, lastHeard, type Heard } from '@/core/listening/history';
import { genresOf, likedTracks, topArtists, tracksInGenre, type FiledArtist } from './spotifyApi';
import { played, type Played } from './spotifySpotlight';

/**
 * The shelves on the Spotify drawer's front page that are built from
 * somebody's listening rather than read off a list of theirs.
 *
 * Three of them. What was listened to lately, from the app's own log and
 * Spotify's laid together. A shelf for each of the few genres somebody plays
 * most, made once a day. And the songs they liked.
 *
 * The genre shelves are the expensive ones, and are built to be cheap anyway:
 * the genres come from `/me/top/artists`, which is not a search, and from a
 * handful of searches for artists heard here that Spotify's top list does not
 * mention, each remembered for good. Then two searches a shelf, once a day.
 * About ten searches a day in all, against a quota that runs out in the
 * hundreds.
 */

// --- Lately ------------------------------------------------------------------

/** Where a song on the recent shelf was last heard. */
export type Where = 'here' | 'elsewhere';

export interface Recent {
  track: TrackMetadata;
  where: Where;
  at: number;
}

/** How many records the recent shelf holds. */
export const RECENT_SHOWN = 30;

/**
 * How long after a listen here Spotify may log it and still mean the same one.
 *
 * Spotify logs a song when it stops, and this app when it has played for half
 * a minute, so the same listen is two times a song's length apart. Past that
 * and a few minutes more, Spotify's entry is somebody listening again,
 * somewhere else.
 */
const SAME_LISTEN_MS = 5 * 60_000;

/**
 * The app's own listening and Spotify's, as one shelf, newest first.
 *
 * Each song once, where it was last heard. A song in both logs at about the
 * same time is one listen, here — Spotify logs what this app plays as well.
 * Spotify's track is the one kept when it has one, since it was asked about
 * more recently.
 */
export function blendRecent(ours: readonly Heard[], theirs: readonly Played[], limit = RECENT_SHOWN): Recent[] {
  const byId = new Map<string, Recent>();
  for (const entry of lastHeard(ours, 'spotify')) {
    byId.set(entry.track.id, { track: entry.track, where: 'here', at: entry.at });
  }
  for (const entry of theirs) {
    const at = entry.at ?? 0;
    const known = byId.get(entry.track.id);
    if (!known) {
      byId.set(entry.track.id, { track: entry.track, where: 'elsewhere', at });
      continue;
    }
    const later = at - known.at > entry.track.duration + SAME_LISTEN_MS;
    byId.set(entry.track.id, later ? { track: entry.track, where: 'elsewhere', at } : { ...known, track: entry.track });
  }
  return [...byId.values()].sort((a, b) => b.at - a.at).slice(0, limit);
}

/** The recent shelf, asking Spotify no more often than its own row does. */
export async function recentShelf(): Promise<Recent[]> {
  return blendRecent(heard(), await played('recent'));
}

// --- Genres ------------------------------------------------------------------

/** How many genre shelves. */
export const GENRE_SHELVES = 3;

/** How many songs on each. */
export const GENRE_SHOWN = 20;

/** No more than this many songs by one artist on a genre shelf. */
const PER_ARTIST = 2;

/** Artists heard here but missing from Spotify's top list, looked up per day at most. */
const LOOKUPS_PER_DAY = 3;

/** How far into a genre's results a day may start: eight pages of ten. */
const PAGES = 8;

/**
 * The genres somebody plays most, best first.
 *
 * Two voices. Spotify's top artists, each worth a little less the further
 * down the list it is. And the app's own log, where an artist counts for how
 * often they were heard against whoever was heard most — weighted double,
 * because it is this app's listening the shelves are meant to be about, and
 * Spotify's list is a few weeks of everywhere.
 */
export function pickGenres(
  top: readonly FiledArtist[],
  counts: ReadonlyMap<string, number>,
  known: ReadonlyMap<string, readonly string[]>,
  howMany = GENRE_SHELVES,
): string[] {
  const score = new Map<string, number>();
  const add = (genres: readonly string[], weight: number) => {
    for (const genre of genres) score.set(genre, (score.get(genre) ?? 0) + weight);
  };

  top.forEach((artist, rank) => add(artist.genres, 1 - rank / (top.length + 1)));

  const most = Math.max(0, ...counts.values());
  const fromTop = new Map(top.map((artist) => [artist.name.toLowerCase(), artist.genres]));
  for (const [name, count] of counts) {
    add(fromTop.get(name) ?? known.get(name) ?? [], (2 * count) / most);
  }

  return [...score]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, howMany)
    .map(([genre]) => genre);
}

/**
 * The artists worth looking up: heard here, most heard first, with no genres
 * known for them yet from either the top list or an earlier lookup.
 */
export function needLookup(
  top: readonly FiledArtist[],
  counts: ReadonlyMap<string, number>,
  known: ReadonlyMap<string, readonly string[]>,
  howMany = LOOKUPS_PER_DAY,
): string[] {
  const inTop = new Set(top.map((artist) => artist.name.toLowerCase()));
  return [...counts]
    .filter(([name]) => !inTop.has(name) && !known.has(name))
    .sort((a, b) => b[1] - a[1])
    .slice(0, howMany)
    .map(([name]) => name);
}

/**
 * A day, as the shelves count them: the local calendar date.
 *
 * Local rather than UTC, so the shelves change overnight where somebody is
 * and not at some hour of the afternoon.
 */
export function dayOf(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Where in a genre's results today's shelf starts.
 *
 * The same all day, and different from one day to the next, so the shelf is
 * new each morning without being new each time the drawer opens.
 */
export function startFor(genre: string, day: string): number {
  let hash = 0;
  for (const char of `${genre}|${day}`) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return (Math.abs(hash) % PAGES) * 10;
}

/**
 * A genre shelf from what the search found: nothing heard here already,
 * nothing already on another shelf, and no artist taking over.
 */
export function fillShelf(
  found: readonly TrackMetadata[],
  skip: ReadonlySet<string>,
  howMany = GENRE_SHOWN,
): TrackMetadata[] {
  const perArtist = new Map<string, number>();
  const kept: TrackMetadata[] = [];
  for (const track of found) {
    if (kept.length >= howMany) break;
    if (skip.has(track.id) || kept.some((k) => k.id === track.id)) continue;
    const artist = firstArtist(track.artist);
    const already = perArtist.get(artist) ?? 0;
    if (already >= PER_ARTIST) continue;
    perArtist.set(artist, already + 1);
    kept.push(track);
  }
  return kept;
}

export interface GenreShelf {
  genre: string;
  tracks: TrackMetadata[];
}

interface Saved {
  account: string | null;
  day: string;
  shelves: GenreShelf[];
}

const SHELVES_KEY = 'groovium.genreShelves';
const GENRES_KEY = 'groovium.artistGenres';

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Refused: asked again tomorrow, which costs a few searches and nothing else.
  }
}

function readSaved(): Saved | null {
  const value = readJson(SHELVES_KEY) as Partial<Saved> | null;
  if (!value || typeof value.day !== 'string' || !Array.isArray(value.shelves)) return null;
  const shelves = value.shelves.filter(
    (shelf): shelf is GenreShelf =>
      typeof shelf?.genre === 'string' && Array.isArray(shelf.tracks) && shelf.tracks.length > 0,
  );
  return { account: typeof value.account === 'string' ? value.account : null, day: value.day, shelves };
}

/** Genres learned for artists by looking them up, kept for good: an artist's genres barely move. */
function readKnown(): Map<string, string[]> {
  const value = readJson(GENRES_KEY);
  if (!value || typeof value !== 'object') return new Map();
  return new Map(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string[]] =>
      Array.isArray(entry[1]),
    ),
  );
}

/** Counted up by signing out, so an answer in the air for the last person is not kept. */
let era = 0;
let building: Promise<GenreShelf[]> | null = null;

/**
 * Today's genre shelves: made once a day and kept, or made now.
 *
 * A shelf whose searches failed is left off rather than kept empty, and a day
 * on which any failed is not saved, so the next opening tries again rather
 * than the drawer being a shelf short until tomorrow.
 */
export function genreShelves(now = Date.now()): Promise<GenreShelf[]> {
  building ??= make(now, era).finally(() => {
    building = null;
  });
  return building;
}

async function make(now: number, asked: number): Promise<GenreShelf[]> {
  const who = await account()
    .then((found) => found?.id ?? null)
    .catch(() => null);
  const day = dayOf(now);
  const saved = readSaved();
  if (saved && saved.day === day && saved.account === who && saved.shelves.length > 0) return saved.shelves;

  const log = heard();
  const counts = artistCounts(log, 'spotify');
  const top = await topArtists();
  const known = readKnown();
  for (const name of needLookup(top, counts, known)) {
    try {
      known.set(name, await genresOf(name));
    } catch {
      // Not known, and not remembered as having none: asked again tomorrow.
    }
  }
  if (asked === era) writeJson(GENRES_KEY, Object.fromEntries(known));

  const skip = new Set(log.map((entry) => entry.track.id));
  const shelves: GenreShelf[] = [];
  let whole = true;
  for (const genre of pickGenres(top, counts, known)) {
    const start = startFor(genre, day);
    try {
      let found = [...(await tracksInGenre(genre, start)), ...(await tracksInGenre(genre, start + 10))];
      // A small genre may not run to the page today starts on.
      if (found.length === 0 && start > 0) found = await tracksInGenre(genre, 0);
      const tracks = fillShelf(found, skip);
      for (const track of tracks) skip.add(track.id);
      if (tracks.length > 0) shelves.push({ genre, tracks });
    } catch {
      whole = false;
    }
  }

  if (asked === era && whole) writeJson(SHELVES_KEY, { account: who, day, shelves } satisfies Saved);
  return shelves;
}

// --- Liked -------------------------------------------------------------------

/** How many liked songs go on the shelf. The count beside it is all of them. */
export const LIKED_SHOWN = 30;

/** Liked songs change when somebody likes one, which a few minutes covers. */
const LIKED_KEEPS_FOR = 5 * 60_000;

let liked: { at: number; answer: { tracks: TrackMetadata[]; total: number } } | null = null;
let liking: Promise<{ tracks: TrackMetadata[]; total: number }> | null = null;

export function likedShelf(): Promise<{ tracks: TrackMetadata[]; total: number }> {
  if (liked && Date.now() - liked.at < LIKED_KEEPS_FOR) return Promise.resolve(liked.answer);
  const asked = era;
  liking ??= likedTracks(LIKED_SHOWN)
    .then((answer) => {
      if (asked === era) liked = { at: Date.now(), answer };
      return answer;
    })
    .finally(() => {
      liking = null;
    });
  return liking;
}

/** Forget everything here about the account that is signing out, saved and in memory. */
export function forgetHome(): void {
  era += 1;
  building = null;
  liked = null;
  liking = null;
  try {
    localStorage.removeItem(SHELVES_KEY);
    // The artists looked up as well. Genres are no secret, but which artists
    // were worth looking up says who was being listened to.
    localStorage.removeItem(GENRES_KEY);
  } catch {
    // Nothing to remove, or nowhere to remove it from.
  }
}
