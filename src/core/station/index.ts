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

/** An artist's comparable form, for keeping the same band off the next slot. */
export function artistKey(artist: string): string {
  return normalize(artist);
}

/** One library track that a candidate matched, with the score it matched at. */
interface Match {
  track: TrackMetadata;
  artistKey: string;
  score: number;
}

/**
 * Draw one entry, favouring a higher weight but never guaranteeing it.
 *
 * Roulette-wheel selection: the chance of being picked is the entry's share of
 * the total weight. That keeps close matches likely without making the order
 * fixed, which is what stops the same suggestion arriving every time.
 */
function drawWeighted<T>(entries: T[], weightOf: (entry: T) => number): T | undefined {
  if (entries.length === 0) return undefined;

  // A floor, so a candidate Last.fm scored at zero can still come up.
  const weights = entries.map((entry) => Math.max(weightOf(entry), 0.01));
  const total = weights.reduce((sum, w) => sum + w, 0);

  let ticket = Math.random() * total;
  for (let i = 0; i < entries.length; i++) {
    ticket -= weights[i] as number;
    if (ticket <= 0) return entries[i];
  }
  return entries[entries.length - 1];
}

/**
 * Candidates that are already in the library, spread across artists.
 *
 * Taking the most similar few sounds right and plays wrong: the top of a
 * `track.getSimilar` answer is mostly *other songs by the same artist*, so a
 * library holding that album filled every slot from it and the station became
 * one record on repeat.
 *
 * So artists are drawn one at a time — weighted by their best match, so a close
 * artist is likelier to come up first — and each contributes a single track
 * before any artist is asked for a second. A library too thin to fill the
 * request that way doubles up rather than returning short.
 */
export function findInLibrary(
  candidates: SimilarTrack[],
  library: LibraryTrack[],
  exclude: ReadonlySet<string>,
  limit = 1,
  recentArtists: ReadonlySet<string> = new Set(),
): TrackMetadata[] {
  if (library.length === 0 || limit <= 0) return [];

  const byKey = new Map<string, LibraryTrack>();
  for (const track of library) {
    const key = matchKey(track.artist, track.title);
    // First wins, so a duplicate import does not shadow the original.
    if (!byKey.has(key)) byKey.set(key, track);
  }

  // Collect every match first. Cheap — the candidate list is already in hand —
  // and a spread cannot be chosen from a list truncated at the top.
  const byArtist = new Map<string, Match[]>();
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = matchKey(candidate.artist, candidate.title);
    // `seen` stops one library entry appearing twice when Last.fm lists the
    // same song under different spellings.
    if (exclude.has(key) || seen.has(key)) continue;

    const match = byKey.get(key);
    if (!match) continue;
    seen.add(key);

    const artistKey = normalize(match.artist);
    const group = byArtist.get(artistKey) ?? [];
    group.push({ track: libraryTrackToMetadata(match), artistKey, score: candidate.matchScore });
    byArtist.set(artistKey, group);
  }

  const picked: TrackMetadata[] = [];
  // Artists heard in the last few tracks step aside. Spreading within one fill
  // was not enough on its own: the next lookup is seeded from the track that
  // just played, and its own artist sits at the top of what Last.fm returns, so
  // the same band kept coming back around the moment a queue ran out.
  const rested = [...byArtist.entries()]
    .filter(([artist]) => !recentArtists.has(artist))
    .map(([, group]) => group);
  // Falling back to everyone matters for a library where one band holds most of
  // the tracks — with nothing else to offer, repeating beats going silent.
  const pools = rested.length > 0 ? rested : [...byArtist.values()];

  // One pass per round: every artist offers a track before any offers a second.
  while (picked.length < limit) {
    // Artists still holding something, each allowed one turn this round.
    const round = pools.filter((p) => p.length > 0);
    if (round.length === 0) break;

    while (picked.length < limit && round.length > 0) {
      // Rank an artist by its best remaining match, then let chance decide.
      const pool = drawWeighted(round, (p) =>
        p.reduce((best, m) => Math.max(best, m.score), 0),
      );
      if (!pool) break;
      // Out of the round whether or not it yields — that is what makes this a
      // round rather than a free-for-all the loudest artist would dominate.
      round.splice(round.indexOf(pool), 1);

      const chosen = drawWeighted(pool, (m) => m.score);
      if (!chosen) continue;
      pool.splice(pool.indexOf(chosen), 1);
      picked.push(chosen.track);
    }
  }
  return picked;
}

export interface ResolveOptions {
  /** The track the station is continuing from. */
  seed: TrackMetadata;
  library: LibraryTrack[];
  /** Keys of tracks already played in this station run. */
  exclude: ReadonlySet<string>;
  /** Artists heard in the last few tracks, held back so runs do not cluster. */
  excludeArtists: ReadonlySet<string>;
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
  const { seed, library, exclude, excludeArtists, spotifyAvailable, searchSpotify } = options;

  const candidates = await similarTracks(seed.artist, seed.title);
  if (candidates.length === 0) return [];

  const local = findInLibrary(candidates, library, exclude, limit, excludeArtists);
  if (local.length > 0) return local;

  if (!spotifyAvailable) return [];

  // Only now spend the quota, and on a few candidates at most. Candidates by an
  // artist that just played go to the back: this path resolves a single track,
  // so without the reordering every Spotify-fed suggestion would be seeded from
  // the previous one and stay on the same band indefinitely.
  const fresh = candidates
    .filter((c) => !exclude.has(matchKey(c.artist, c.title)))
    .sort((a, b) => {
      const aRested = excludeArtists.has(artistKey(a.artist)) ? 1 : 0;
      const bRested = excludeArtists.has(artistKey(b.artist)) ? 1 : 0;
      // Similarity still orders within each half; only the split is imposed.
      return aRested - bRested || b.matchScore - a.matchScore;
    });

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
