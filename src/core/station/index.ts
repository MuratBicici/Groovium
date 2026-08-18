import type { LibraryTrack } from '@/core/library';
import { libraryTrackToMetadata } from '@/core/library';
import type { TrackMetadata } from '@/core/types';
import { similarTracks, type SimilarTrack } from './lastfm';

export { hasApiKey, setApiKey, clearApiKey, openAccountPage } from './lastfm';
export type { SimilarTrack } from './lastfm';

/**
 * Picking what plays next when a collection runs out.
 *
 * The whole design turns on one property of Last.fm: it is queried by **artist
 * and title**, not by a platform id. That is what lets a station started from a
 * local mp3 continue into a Spotify track and back again — no other similarity
 * API this app can reach works by name.
 *
 * Resolution is deliberately two-tier. One lookup returns up to fifty
 * candidates; matching them against the library costs nothing and plays
 * instantly, so that is tried first, and the whole list is checked before a
 * single Spotify search is spent. Spotify's search quota is 100 calls a day for
 * a Development Mode app, which a station left running would otherwise eat in
 * an evening.
 */

/** How many candidates to try on Spotify before giving up on this seed. */
const SPOTIFY_ATTEMPTS = 3;

/**
 * How many suggestions one lookup tries to bring back.
 *
 * A single Last.fm call returns fifty candidates and this used to keep one,
 * discarding the rest — so every press of Next paid for another round trip.
 * Filling a short queue from the same answer makes the following presses
 * instant and costs nothing extra, because the extra depth comes only from
 * library matches.
 */
const SUGGESTION_DEPTH = 5;

/**
 * Written as an escape on purpose.
 *
 * Keys are compared as opaque strings, so any separator works and a wrong one
 * is invisible — a stray control byte sat here for a while doing no harm and
 * leaving no trace. A character that cannot occur in a normalized name, spelled
 * so it is visible in the source, removes both problems.
 */
const KEY_SEPARATOR = '\u0001';

/**
 * A comparable form of "artist — title".
 *
 * Exported because it is the part most likely to be wrong, and being able to
 * call it directly is how it gets checked.
 */
export function matchKey(artist: string, title: string): string {
  return `${normalize(artist)}${KEY_SEPARATOR}${normalize(title)}`;
}

/**
 * Strip the things that differ between a file's tags and a database entry
 * without meaning a different song.
 *
 * Tags carry "(Remastered 2011)", " - Live at Wembley", "feat. Someone" and
 * stray punctuation; Last.fm mostly does not. Leaving them in means a track
 * sitting in the library never matches and a Spotify search gets spent instead.
 */
function normalize(value: string): string {
  return (
    value
      .toLowerCase()
      // Decompose accents, then drop the combining marks.
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Parenthesised and bracketed qualifiers: (Remastered), [Live], etc.
      .replace(/\s*[([{][^)\]}]*[)\]}]/g, '')
      // A trailing " - Something" qualifier, the unbracketed form of the above.
      .replace(/\s+-\s+.*$/, '')
      // Collaboration markers, up to the end of the string.
      .replace(/\s+(feat|ft|featuring|with|w\/)\.?\s+.*$/, '')
      .replace(/&/g, ' and ')
      // Everything that is not a letter, digit or space.
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      // Spacing goes last, and goes entirely. Dropping punctuation without it
      // makes "T.N.T." match "TNT" but leaves "Rock'n'Roll" apart from
      // "Rock n Roll"; substituting a space instead reverses which of the two
      // works. Removing both settles it, and two different songs whose letters
      // run together identically under the same artist is not a real risk.
      .replace(/\s+/g, '')
  );
}

/**
 * A track's own key, for excluding what has already played.
 *
 * Name-based on purpose: the same song reached once from the library and once
 * from Spotify has two different ids but should still count as already played.
 */
export function trackKey(track: TrackMetadata): string {
  return matchKey(track.artist, track.title);
}

/**
 * Candidates that are already in the library, most similar first.
 *
 * Scanning for several costs no more than scanning for one — the candidate
 * list is already in hand — which is why the queue can be deep for free.
 */
export function findInLibrary(
  candidates: SimilarTrack[],
  library: LibraryTrack[],
  exclude: ReadonlySet<string>,
  limit = 1,
): TrackMetadata[] {
  if (library.length === 0) return [];

  const byKey = new Map<string, LibraryTrack>();
  for (const track of library) {
    const key = matchKey(track.artist, track.title);
    // First wins, so a duplicate import does not shadow the original.
    if (!byKey.has(key)) byKey.set(key, track);
  }

  const found: TrackMetadata[] = [];
  const taken = new Set<string>();
  for (const candidate of candidates) {
    if (found.length >= limit) break;

    const key = matchKey(candidate.artist, candidate.title);
    // `taken` stops one library entry filling two slots when Last.fm lists the
    // same song twice under different spellings.
    if (exclude.has(key) || taken.has(key)) continue;

    const match = byKey.get(key);
    if (match) {
      taken.add(key);
      found.push(libraryTrackToMetadata(match));
    }
  }
  return found;
}

export interface ResolveOptions {
  /** The track the station is continuing from. */
  seed: TrackMetadata;
  library: LibraryTrack[];
  /** Keys of tracks already played in this station run. */
  exclude: ReadonlySet<string>;
  /** Only true when Spotify is actually connected and able to play. */
  spotifyAvailable: boolean;
  /** Injected so this module does not depend on the Spotify client. */
  searchSpotify: (query: string) => Promise<TrackMetadata[]>;
}

/**
 * The next few tracks for the station, most similar first.
 *
 * An empty list is an ordinary outcome, not a failure: Last.fm knows nothing
 * about a great deal of music, and the station should fall quiet rather than
 * raise an error. Only an actual fault — an unreachable API, a rejected key —
 * throws.
 *
 * The queue only runs deep when it is free. Library matches all come from the
 * one candidate list, so finding five costs exactly what finding one did. A
 * Spotify resolution costs a search out of 100 a day, so that path still
 * yields a single track — depth there would burn the quota in an evening.
 */
export async function resolveNextTracks(
  options: ResolveOptions,
  limit = SUGGESTION_DEPTH,
): Promise<TrackMetadata[]> {
  const { seed, library, exclude, spotifyAvailable, searchSpotify } = options;

  const candidates = await similarTracks(seed.artist, seed.title);
  if (candidates.length === 0) return [];

  const local = findInLibrary(candidates, library, exclude, limit);
  if (local.length > 0) return local;

  if (!spotifyAvailable) return [];

  // Only now spend the quota, and on a few candidates at most.
  const fresh = candidates.filter((c) => !exclude.has(matchKey(c.artist, c.title)));

  for (const candidate of fresh.slice(0, SPOTIFY_ATTEMPTS)) {
    const results = await searchSpotify(`track:${candidate.title} artist:${candidate.artist}`);
    const wanted = matchKey(candidate.artist, candidate.title);

    // Spotify's field search is fuzzy; take a result only if it really is the
    // song asked for, otherwise the station drifts somewhere unrelated.
    const exact = results.find((track) => trackKey(track) === wanted);
    if (exact && !exclude.has(trackKey(exact))) return [exact];
  }
  return [];
}
