import type { TrackMetadata } from '@/core/types';
import { account } from '@/core/security/spotifyAuth';
import { artistCounts, heard, lastHeard, type Heard } from '@/core/listening/history';
import { artistTags, hasApiKey, tagTracks, type SimilarTrack, type Tag } from '@/core/station/lastfm';
import { artistKey, matchKey, trackKey } from '@/core/station';
import { log } from '@/platform/log';
import { likedTracks, searchTracks, topArtists } from './spotifyApi';
import { played, type Played } from './spotifySpotlight';

/**
 * The shelves on the Spotify drawer's front page that are built from
 * somebody's listening rather than read off a list of theirs.
 *
 * Three of them. What was listened to lately, from the app's own log and
 * Spotify's laid together. A shelf for each of the few genres somebody plays
 * most, made once a day. And the songs they liked.
 *
 * The genre shelves are the expensive ones. The genres are Last.fm's tags,
 * which cost Spotify nothing, and the songs are found on Spotify by name: a
 * few dozen searches on the day a shelf is first made, fewer after, since a
 * song found once is remembered. Once a day, against a quota that runs out in
 * the hundreds.
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
export const GENRE_SHOWN = 12;

/** No more than this many songs by one artist on a genre shelf. */
const PER_ARTIST = 2;

/** How many artists' tags make up somebody's taste. */
const ARTISTS_WEIGHED = 12;

/**
 * Spotify searches one shelf may spend finding its songs.
 *
 * A little over the shelf's length, for the songs Spotify does not have under
 * the name Last.fm gives. Each answer is kept (see `FOUND_KEY`), so a second
 * day under the same tag costs less than the first.
 */
const SEARCHES_PER_SHELF = 16;

/** How many of a tag's pages a day may start on. Fifty songs to a page. */
const PAGES = 4;

/** A tag weaker than this on an artist says little about them. Last.fm weighs from 0 to 100. */
const WEAKEST_TAG = 10;

/**
 * Tags that say how somebody feels about an artist, or where they are from,
 * rather than what the music is. "Daha çok seen live" is not a shelf.
 */
const NOT_A_GENRE = new Set([
  'seen live', 'favorites', 'favourites', 'favorite', 'favourite', 'love', 'loved', 'awesome',
  'beautiful', 'amazing', 'best', 'cool', 'good', 'great', 'my favorite', 'albums i own',
  'female vocalists', 'male vocalists', 'female vocalist', 'male vocalist', 'female', 'male',
  'spotify', 'under 2000 listeners', 'all', 'music', 'british', 'american', 'english', 'uk',
  'usa', 'canadian', 'australian', 'german', 'french', 'swedish', 'norwegian', 'japanese',
  'korean', 'turkish', 'turkey', 'irish', 'scottish', 'italian', 'spanish', 'dutch',
]);

/** Whether a tag names a kind of music rather than an opinion, a place, or the artist. */
export function isGenre(tag: string, artist: string): boolean {
  const name = tag.trim().toLowerCase();
  return name.length > 1 && !NOT_A_GENRE.has(name) && name !== artist.trim().toLowerCase();
}

/**
 * Whose taste this is, as artists with a weight each, heaviest first.
 *
 * Two voices. The app's own log, where an artist counts for how often they
 * were heard against whoever was heard most — weighted double, because it is
 * this app's listening the shelves are meant to be about. And Spotify's top
 * artists, each worth a little less the further down the list it is, which
 * is a few weeks of listening everywhere.
 */
export function weighArtists(
  top: readonly string[],
  counts: ReadonlyMap<string, number>,
  howMany = ARTISTS_WEIGHED,
): [string, number][] {
  const weight = new Map<string, number>();
  const add = (name: string, by: number) => {
    const key = name.trim().toLowerCase();
    if (key) weight.set(key, (weight.get(key) ?? 0) + by);
  };
  const most = Math.max(0, ...counts.values());
  for (const [name, count] of counts) add(name, (2 * count) / most);
  top.forEach((name, rank) => add(name, 1 - rank / (top.length + 1)));
  return [...weight].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, howMany);
}

/**
 * The genres somebody plays most, best first: each artist's tags, by how
 * strongly Last.fm's listeners file them there and how much the artist weighs.
 */
export function pickGenres(
  artists: readonly (readonly [string, number])[],
  tags: ReadonlyMap<string, readonly Tag[]>,
  howMany = GENRE_SHELVES,
): string[] {
  const score = new Map<string, number>();
  for (const [artist, weight] of artists) {
    for (const tag of tags.get(artist) ?? []) {
      if (tag.count < WEAKEST_TAG || !isGenre(tag.name, artist)) continue;
      const name = tag.name.trim().toLowerCase();
      score.set(name, (score.get(name) ?? 0) + (weight * tag.count) / 100);
    }
  }
  return [...score]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, howMany)
    .map(([genre]) => genre);
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

/** A number from a string, the same every time. */
function seedOf(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

/**
 * Which page of a tag today's shelf is taken from.
 *
 * The same all day, and different from one day to the next, so the shelf is
 * new each morning without being new each time the drawer opens.
 */
export function pageFor(genre: string, day: string): number {
  return (seedOf(`${genre}|${day}`) % PAGES) + 1;
}

/** The same list in an order that holds for the day and changes with it. */
export function dayOrder<T>(items: readonly T[], seed: string): T[] {
  let state = seedOf(seed) || 1;
  const next = () => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return state / 0x80000000;
  };
  const out = [...items];
  for (let at = out.length - 1; at > 0; at--) {
    const other = Math.floor(next() * (at + 1));
    [out[at], out[other]] = [out[other] as T, out[at] as T];
  }
  return out;
}

/**
 * What to look for on Spotify, in order: nothing already heard here, nothing
 * twice, and no artist more than twice.
 */
export function worthLooking(
  candidates: readonly SimilarTrack[],
  heardKeys: ReadonlySet<string>,
): SimilarTrack[] {
  const perArtist = new Map<string, number>();
  const seen = new Set<string>();
  const kept: SimilarTrack[] = [];
  for (const candidate of candidates) {
    const key = matchKey(candidate.artist, candidate.title);
    if (heardKeys.has(key) || seen.has(key)) continue;
    const artist = artistKey(candidate.artist);
    const already = perArtist.get(artist) ?? 0;
    if (already >= PER_ARTIST) continue;
    perArtist.set(artist, already + 1);
    seen.add(key);
    kept.push(candidate);
  }
  return kept;
}

export interface GenreShelf {
  genre: string;
  tracks: TrackMetadata[];
}

/** Why there are no genre shelves, when there are none. */
export type NoShelves = 'no-key' | 'nothing-yet' | null;

interface Saved {
  account: string | null;
  day: string;
  shelves: GenreShelf[];
}

const SHELVES_KEY = 'groovium.genreShelves';
const TAGS_KEY = 'groovium.artistTags';
const FOUND_KEY = 'groovium.foundOnSpotify';

/** An artist's tags move over months; a month is plenty. */
const TAGS_KEPT_FOR_MS = 30 * 24 * 60 * 60_000;
/** A song Spotify did not have under a name may arrive; asked again after a week. */
const MISSING_KEPT_FOR_MS = 7 * 24 * 60 * 60_000;
/** Songs found by name, kept. Past this the oldest go. */
const FOUND_KEPT = 400;

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

/** Answers kept between launches, each with when it was had. */
type Kept<T> = Record<string, { at: number; value: T }>;

function readKept<T>(key: string): Kept<T> {
  const value = readJson(key);
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Kept<T>) : {};
}

/** Counted up by signing out, so an answer in the air for the last person is not kept. */
let era = 0;
let building: Promise<GenreAnswer> | null = null;

export interface GenreAnswer {
  shelves: GenreShelf[];
  none: NoShelves;
}

/**
 * Today's genre shelves: made once a day and kept, or made now.
 *
 * The genres are Last.fm's tags for the artists somebody plays most — Spotify
 * still has a field for genres and leaves it empty for most artists — and the
 * songs are the ones most listened to under each tag, found on Spotify by
 * name. Without a Last.fm key there are none, and the answer says why.
 *
 * A day on which a search was refused is not saved, so the next opening tries
 * again rather than the drawer being a shelf short until tomorrow.
 */
export function genreShelves(now = Date.now()): Promise<GenreAnswer> {
  building ??= make(now, era).finally(() => {
    building = null;
  });
  return building;
}

async function make(now: number, asked: number): Promise<GenreAnswer> {
  const who = await account()
    .then((found) => found?.id ?? null)
    .catch(() => null);
  const day = dayOf(now);
  const saved = readSaved();
  if (saved && saved.day === day && saved.account === who && saved.shelves.length > 0) {
    return { shelves: saved.shelves, none: null };
  }

  const listened = heard();
  const top = await topArtists()
    .then((artists) => artists.map((artist) => artist.name))
    // Spotify's half of the taste is a help, not a need.
    .catch(() => [] as string[]);
  const artists = weighArtists(top, artistCounts(listened, 'spotify'));
  if (artists.length === 0) return { shelves: [], none: 'nothing-yet' };

  // Each artist's tags, from what was kept or from Last.fm.
  const keptTags = readKept<Tag[]>(TAGS_KEY);
  const tags = new Map<string, Tag[]>();
  for (const [artist] of artists) {
    const kept = keptTags[artist];
    if (kept && now - kept.at < TAGS_KEPT_FOR_MS) {
      tags.set(artist, kept.value);
      continue;
    }
    try {
      const found = await artistTags(artist);
      tags.set(artist, found);
      keptTags[artist] = { at: now, value: found };
    } catch (err) {
      // Without a key every artist fails the same way; asking the other
      // eleven would only fail eleven more times.
      if (!(await hasApiKey().catch(() => false))) return { shelves: [], none: 'no-key' };
      log('warn', 'home', 'could not read an artist’s tags', err);
    }
  }
  if (asked === era) writeJson(TAGS_KEY, keptTags);

  const genres = pickGenres(artists, tags);
  log('info', 'home', `genres: ${genres.join(', ') || 'none'}, from ${artists.length} artists`);
  if (genres.length === 0) return { shelves: [], none: 'nothing-yet' };

  const found = readKept<TrackMetadata | null>(FOUND_KEY);
  const taken = new Set(listened.map((entry) => trackKey(entry.track)));
  const shelves: GenreShelf[] = [];
  let whole = true;
  for (const genre of genres) {
    let candidates: SimilarTrack[];
    try {
      candidates = await tagTracks(genre, pageFor(genre, day));
      // A small tag may not run to the page today starts on.
      if (candidates.length === 0) candidates = await tagTracks(genre, 1);
    } catch (err) {
      log('warn', 'home', `could not read the songs under ${genre}`, err);
      whole = false;
      continue;
    }

    const tracks: TrackMetadata[] = [];
    let searches = SEARCHES_PER_SHELF;
    for (const candidate of worthLooking(dayOrder(candidates, `${genre}|${day}`), taken)) {
      if (tracks.length >= GENRE_SHOWN) break;
      const key = matchKey(candidate.artist, candidate.title);
      const known = found[key];
      let track: TrackMetadata | null;
      if (known && (known.value !== null || now - known.at < MISSING_KEPT_FOR_MS)) {
        track = known.value;
      } else {
        if (searches <= 0) continue;
        searches -= 1;
        try {
          const results = await searchTracks(`track:${candidate.title} artist:${candidate.artist}`);
          // Spotify's field search is fuzzy: only the song asked for will do.
          track = results.find((result) => trackKey(result) === key && !result.unplayable) ?? null;
        } catch (err) {
          // Refused: no more searching today, and the day is not saved.
          log('warn', 'home', 'a search was refused', err);
          whole = false;
          break;
        }
        found[key] = { at: now, value: track };
      }
      if (track) {
        tracks.push(track);
        taken.add(key);
      }
    }
    if (tracks.length > 0) shelves.push({ genre, tracks });
    if (!whole) break;
  }

  if (asked === era) {
    const newest = Object.entries(found)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, FOUND_KEPT);
    writeJson(FOUND_KEY, Object.fromEntries(newest));
    if (whole) writeJson(SHELVES_KEY, { account: who, day, shelves } satisfies Saved);
  }
  return { shelves, none: shelves.length === 0 ? 'nothing-yet' : null };
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
    localStorage.removeItem(TAGS_KEY);
    localStorage.removeItem(FOUND_KEY);
  } catch {
    // Nothing to remove, or nowhere to remove it from.
  }
}
