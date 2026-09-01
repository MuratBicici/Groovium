import type { LibraryTrack } from '@/core/library';
import { libraryTrackToMetadata } from '@/core/library';
import type { TrackMetadata } from '@/core/types';
import { artistCandidates, similarTracks, type SimilarTrack } from './lastfm';
import { drawWeighted, orderSeeds, similarityWeight, weightedShuffle } from './sampling';

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
 * Resolution is two-tier. One lookup returns up to fifty candidates; matching
 * them against the library costs no network at all and plays instantly, so the
 * whole list is checked there first. Only what the library cannot supply is
 * resolved through Spotify search, one request per candidate.
 *
 * Spotify limits on a rolling 30-second window rather than a daily budget, and
 * answers a breach with 429 plus `Retry-After`. Development Mode adds its own
 * quota buckets, whose size Spotify does not publish. So the searches here are
 * bounded and sequential — a small, spread-out number rather than a burst —
 * and the transport layer honours `Retry-After` (`spotifyApi.ts`).
 */

/**
 * Searches one fill may spend resolving candidates through Spotify.
 *
 * A bound rather than a budget: Spotify's published limit is a rolling
 * 30-second window, so a handful of sequential requests is unremarkable. This
 * exists so a candidate list full of songs Spotify cannot match cannot turn
 * one fill into fifty requests.
 */
const SPOTIFY_SEARCH_BUDGET = 8;

/**
 * Searches any one artist may consume out of that budget.
 *
 * Without this, one artist can take the whole fill down with it. A narrow pool
 * eventually has a single artist the recent-artist memory has not held back,
 * and its ten tracks are tried first — so if Spotify cannot match the names,
 * all eight searches are spent there and the fill ends with nothing, having
 * never reached the candidates it was going to fall back on. Measured: that is
 * exactly what happened on the fourth return to the same song.
 *
 * Three leaves room for at least three artists to be tried, which is what the
 * spread rule wants anyway.
 */
const SEARCHES_PER_ARTIST = 3;

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
 * Exported so it can be pinned directly: it is the half that actually decides
 * whether two names are the same song, and every judgement call in it is a
 * trade rather than an obvious rule.
 *
 * Tags carry "(Remastered 2011)", " - Live at Wembley", "feat. Someone" and
 * stray punctuation; Last.fm mostly does not. Leaving them in means a track
 * sitting in the library never matches and a Spotify search gets spent instead.
 */
export function normalize(value: string): string {
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
        similarityWeight(p.reduce((best, m) => Math.max(best, m.score), 0)),
      );
      if (!pool) break;
      // Out of the round whether or not it yields — that is what makes this a
      // round rather than a free-for-all the loudest artist would dominate.
      round.splice(round.indexOf(pool), 1);

      const chosen = drawWeighted(pool, (m) => similarityWeight(m.score));
      if (!chosen) continue;
      pool.splice(pool.indexOf(chosen), 1);
      picked.push(chosen.track);
    }
  }
  return picked;
}

export interface ResolveOptions {
  /**
   * The tracks this run is made of, newest first.
   *
   * A run rather than a track, so one song Last.fm has never heard of cannot
   * end fifty that were going fine. The caller is responsible for the boundary:
   * choosing a song by hand starts a new run, and the pool must not reach back
   * across that — otherwise picking a Turkish song after two K-pop songs
   * answers with K-pop.
   */
  seeds: TrackMetadata[];
  library: LibraryTrack[];
  /**
   * Keys of tracks already played in this station run, **oldest first**.
   *
   * An order rather than a set. A set answers "has this been played", which is
   * all that was needed while every pool was wide; a narrow pool eventually
   * needs "how long ago", so the least stale thing can come round again rather
   * than the station falling quiet with songs still on the list.
   */
  played: readonly string[];
  /** Artists heard in the last few tracks, held back so runs do not cluster. */
  excludeArtists: ReadonlySet<string>;
  /** Only true when Spotify is actually connected and able to play. */
  spotifyAvailable: boolean;
  /** Injected so this module does not depend on the Spotify client. */
  searchSpotify: (query: string) => Promise<TrackMetadata[]>;
  /** Injected for the same reason: the last tier's source of similarity. */
  tracksLikeArtist: (artist: string) => Promise<TrackMetadata[]>;
}

/**
 * The next few tracks for the station.
 *
 * Not in similarity order. Both paths below draw from the candidates at random
 * with similarity as a weight, because ordering by it made the station play the
 * same sequence after the same song every time — see `sampling.ts`.
 *
 * An empty list is an ordinary outcome, not a failure: Last.fm knows nothing
 * about a great deal of music, and the station should fall quiet rather than
 * raise an error. Only an actual fault — an unreachable API, a rejected key —
 * throws.
 *
 * Library matches all come from the one candidate list already in hand, so
 * finding five costs exactly what finding one did. Anything the library cannot
 * supply is resolved through Spotify, one bounded search per candidate, spread
 * across artists the same way.
 */
/**
 * How long ago each of these was played, oldest first.
 *
 * A set answers "has this been played"; a run that has heard everything needs
 * "how long ago", so the least stale thing can come round again instead of the
 * station going quiet. The caller already keeps its history in this order, so
 * the answer costs one walk of an array of sixty strings.
 */
function playedAt(played: readonly string[]): Map<string, number> {
  const at = new Map<string, number>();
  played.forEach((key, index) => {
    if (!at.has(key)) at.set(key, index);
  });
  return at;
}

/**
 * Resolve candidates the library could not supply through Spotify search.
 *
 * Exported for the same reason `matchKey` is: it decides how wide the pool
 * gets, it costs real requests, and calling it directly is the only way to
 * check either without a live Last.fm key.
 *
 * **It never goes quiet because of its own rules.** It used to. The
 * one-track-per-artist spread was a hard `continue`, so once the recent-artist
 * memory covered every artist a narrow pool had, this returned nothing at all.
 * Its two siblings both relax instead — `findInLibrary` says so in as many
 * words, and `takeSpread` has a second pass — and this was the only path that
 * did not. Simulated, it stopped the station on about the third return to the
 * same song, which is exactly what was reported.
 *
 * So the walk sorts what it finds into three buckets rather than dropping any
 * of it: what passes outright, what a repeated artist turned away, and what has
 * been heard before. The last two are drawn on only when the first comes up
 * short, in that order, and within the third the least recently played leads.
 *
 * One walk and one budget. The order candidates are tried in — unheard with a
 * free artist, then unheard with a busy one, then already heard — is what keeps
 * the searches spent on the answers most likely to be wanted.
 */
export async function resolveViaSpotify(
  candidates: SimilarTrack[],
  options: {
    /** Keys of what has played, oldest first. */
    played: readonly string[];
    excludeArtists: ReadonlySet<string>;
    searchSpotify: (query: string) => Promise<TrackMetadata[]>;
  },
  limit: number,
): Promise<TrackMetadata[]> {
  const { played, excludeArtists, searchSpotify } = options;

  const heardAt = playedAt(played);
  const takenKeys = new Set<string>();
  const takenArtists = new Set(excludeArtists);

  const weight = (c: SimilarTrack) => similarityWeight(c.matchScore);
  const unheard = (c: SimilarTrack) => !heardAt.has(matchKey(c.artist, c.title));
  const artistFree = (c: SimilarTrack) => !excludeArtists.has(artistKey(c.artist));

  // Shuffled rather than sorted, which was an earlier repair: ordering by
  // similarity and walking down the list meant one song led to the same five
  // songs in the same order, on every launch.
  const fresh = candidates.filter(unheard);
  const heard = candidates
    .filter((c) => !unheard(c))
    // Least recently played first, so a run that has heard everything comes
    // back round in the order it heard them.
    .sort(
      (a, b) =>
        (heardAt.get(matchKey(a.artist, a.title)) ?? 0) -
        (heardAt.get(matchKey(b.artist, b.title)) ?? 0),
    );

  const attempts = [
    ...weightedShuffle(fresh.filter(artistFree), weight),
    ...weightedShuffle(fresh.filter((c) => !artistFree(c)), weight),
    ...heard,
  ];

  const picked: TrackMetadata[] = [];
  /** Resolved, but its artist has already been used this fill. */
  const repeatsAnArtist: TrackMetadata[] = [];
  /** Resolved, but heard before. Already in least-recently-played order. */
  const heardBefore: TrackMetadata[] = [];

  let spent = 0;
  /** Searches already spent on each artist, so none of them can take the lot. */
  const spentOn = new Map<string, number>();

  for (const candidate of attempts) {
    if (picked.length >= limit || spent >= SPOTIFY_SEARCH_BUDGET) break;

    const wanted = matchKey(candidate.artist, candidate.title);
    if (takenKeys.has(wanted)) continue;

    const artist = artistKey(candidate.artist);
    if ((spentOn.get(artist) ?? 0) >= SEARCHES_PER_ARTIST) continue;
    spentOn.set(artist, (spentOn.get(artist) ?? 0) + 1);

    spent++;
    const results = await searchSpotify(`track:${candidate.title} artist:${candidate.artist}`);

    // Spotify's field search is fuzzy; take a result only if it really is the
    // song asked for, otherwise the station drifts somewhere unrelated.
    const exact = results.find((track) => trackKey(track) === wanted);
    if (!exact || takenKeys.has(trackKey(exact))) continue;
    takenKeys.add(trackKey(exact));

    if (heardAt.has(trackKey(exact))) {
      heardBefore.push(exact);
    } else if (takenArtists.has(artistKey(exact.artist))) {
      repeatsAnArtist.push(exact);
    } else {
      picked.push(exact);
      takenArtists.add(artistKey(exact.artist));
    }
  }

  // Only when the strict pass found **nothing at all**, and in order of what
  // it costs to accept: another song by an artist just heard, then a song heard
  // before. Either beats handing back nothing.
  //
  // Not merely when it came up short of the limit. Three good suggestions and
  // two repeats is worse than three good suggestions — the artist spread is
  // there to stop a run clustering, and it should yield only to silence. This
  // is the same line `takeSpread` draws between its passes, and `findInLibrary`
  // between its pools.
  if (picked.length > 0) return picked;

  for (const spare of [repeatsAnArtist, heardBefore]) {
    for (const track of spare) {
      if (picked.length >= limit) return picked;
      picked.push(track);
    }
    if (picked.length > 0) return picked;
  }
  return picked;
}

/**
 * Candidates from whichever source can supply them.
 *
 * Either names to be resolved, or tracks that are already playable — the last
 * tier searches Spotify to find them, so making it hand back names would only
 * mean searching for them twice.
 */
type Candidates =
  | { kind: 'names'; names: SimilarTrack[] }
  | { kind: 'tracks'; tracks: TrackMetadata[] };

const NOTHING: Candidates = { kind: 'names', names: [] };

/**
 * Run a lookup, treating a failure as an empty answer.
 *
 * Every tier here is one of several, so a tier that throws should cost its own
 * suggestions and nothing else: a Last.fm outage must still be able to fall
 * through to Spotify. The tier is named in the warning, because "the station
 * found nothing" and "Last.fm rejected the key" look identical from outside.
 */
async function quietly<T>(tier: string, lookup: () => Promise<T[]>): Promise<T[]> {
  try {
    return await lookup();
  } catch (err) {
    console.warn(`[station] the ${tier} lookup failed`, err);
    return [];
  }
}

/**
 * How many seeds in one fill may go past the track lookup.
 *
 * The deeper tiers cost about nine requests between them, and a pool of four
 * seeds that were all dead ends would otherwise spend forty on a single fill —
 * enough for Spotify's rolling window to start answering 429 and for Last.fm to
 * take an interest. Two is enough for the case this is all for, which is one
 * unknown track among several known ones.
 */
const DEEP_LOOKUPS_PER_FILL = 2;

/**
 * The sources below the track lookup, asked in turn.
 *
 * Reached only when `track.getSimilar` came back empty, which is what keeps the
 * ordinary case at the single request it always was.
 */
async function deeperCandidatesFor(
  seed: TrackMetadata,
  options: ResolveOptions,
): Promise<Candidates> {
  // Last.fm knows far more artists than it knows tracks.
  const byArtist = await quietly('artist', () => artistCandidates(seed.artist));
  if (byArtist.length > 0) return { kind: 'names', names: byArtist };

  if (!options.spotifyAvailable) return NOTHING;

  const byGenre = await quietly('genre', () => options.tracksLikeArtist(seed.artist));
  return byGenre.length > 0 ? { kind: 'tracks', tracks: byGenre } : NOTHING;
}

/**
 * Take tracks that are already playable, one per artist.
 *
 * The short version of what `findInLibrary` and `resolveViaSpotify` each do,
 * for candidates that need no resolving. A second pass drops the one-per-artist
 * rule if the first came up empty-handed: these arrive from two artists at
 * most, and repeating one of them beats going silent — the same trade the
 * library path makes.
 */
function takeSpread(
  tracks: TrackMetadata[],
  played: readonly string[],
  excludeArtists: ReadonlySet<string>,
  limit: number,
): TrackMetadata[] {
  const heardAt = playedAt(played);
  const takenKeys = new Set<string>();
  const takenArtists = new Set(excludeArtists);
  const picked: TrackMetadata[] = [];

  // Uniform: these carry no similarity score of their own, only Spotify's idea
  // of how well known they are, which is not what the station is asking about.
  const unheard = weightedShuffle(
    tracks.filter((t) => !heardAt.has(trackKey(t))),
    () => 1,
  );
  // Least recently played first, for the pass that has to reach for them.
  const heard = tracks
    .filter((t) => heardAt.has(trackKey(t)))
    .sort((a, b) => (heardAt.get(trackKey(a)) ?? 0) - (heardAt.get(trackKey(b)) ?? 0));

  // Three passes, each giving up one rule: spread the artists, then repeat an
  // artist, then repeat a song. Every one of them beats handing back nothing,
  // and the order is what keeps the cheapest concession the first one made.
  const passes: [TrackMetadata[], boolean][] = [
    [unheard, true],
    [unheard, false],
    [heard, false],
  ];

  for (const [source, spreading] of passes) {
    for (const track of source) {
      if (picked.length >= limit) return picked;
      const key = trackKey(track);
      if (takenKeys.has(key)) continue;
      if (spreading && takenArtists.has(artistKey(track.artist))) continue;

      picked.push(track);
      takenKeys.add(key);
      takenArtists.add(artistKey(track.artist));
    }
    if (picked.length > 0) return picked;
  }
  return picked;
}

/** Turn one source's answer into tracks that can be played. */
async function pickFrom(
  candidates: Candidates,
  options: ResolveOptions,
  limit: number,
): Promise<TrackMetadata[]> {
  const { library, played, excludeArtists, spotifyAvailable, searchSpotify } = options;

  if (candidates.kind === 'tracks') {
    return takeSpread(candidates.tracks, played, excludeArtists, limit);
  }

  const picked = findInLibrary(candidates.names, library, new Set(played), limit, excludeArtists);
  if (picked.length >= limit || !spotifyAvailable) return picked;

  // Top up whatever the library could not supply. This used to stop at a single
  // track, on the belief that each search came out of a hundred a day — a limit
  // Spotify does not actually impose. Stopping at one made the pool feel like a
  // choice between two songs, which is the real cost of the mistake.
  const fromSpotify = await quietly('spotify search', () =>
    resolveViaSpotify(
      candidates.names,
      {
        // What this fill has already taken counts as played for the rest of
        // it, and counts as the most recent thing there is.
        played: [...played, ...picked.map(trackKey)],
        excludeArtists: new Set([...excludeArtists, ...picked.map((t) => artistKey(t.artist))]),
        searchSpotify,
      },
      limit - picked.length,
    ),
  );
  return [...picked, ...fromSpotify];
}

export async function resolveNextTracks(
  options: ResolveOptions,
  limit = SUGGESTION_DEPTH,
): Promise<TrackMetadata[]> {
  // Seeds are tried in a weighted order rather than one being chosen, so a
  // dead end costs a request instead of the run. In the ordinary case the
  // first seed answers and the rest are never asked about.
  let deepBudget = DEEP_LOOKUPS_PER_FILL;

  for (const seed of orderSeeds(options.seeds)) {
    const bySong = await quietly('track', () => similarTracks(seed.artist, seed.title));

    let candidates: Candidates = { kind: 'names', names: bySong };
    if (bySong.length === 0) {
      // Every seed gets the cheap look. Only the first couple are worth the
      // expensive one, or a pool of dead ends turns one fill into a burst.
      if (deepBudget <= 0) continue;
      deepBudget--;
      candidates = await deeperCandidatesFor(seed, options);
    }

    const picked = await pickFrom(candidates, options, limit);
    if (picked.length > 0) return picked;
  }
  return [];
}
