import { describe, expect, it } from 'vitest';
import type { LibraryTrack } from '@/core/library';
import type { TrackMetadata } from '@/core/types';
import { artistKey, findInLibrary, matchKey, resolveViaSpotify, type SimilarTrack } from './index';

const track = (artist: string, title: string): LibraryTrack => ({
  id: `${artist}:${title}`,
  storedFile: 'x.mp3',
  sourcePath: '',
  title,
  artist,
  album: '',
  durationMs: 1000,
  hasCoverArt: false,
  addedAt: 0,
});

const candidate = (artist: string, title: string, matchScore: number): SimilarTrack => ({
  artist,
  title,
  matchScore,
});

/** A personal library shape: several artists, several tracks each. */
const ARTISTS = ['Kraftwerk', 'Jarre', 'Tangerine', 'Cluster', 'Neu', 'Harmonia'];
const library = ARTISTS.flatMap((a) => [1, 2, 3, 4, 5].map((n) => track(a, `${a}-${n}`)));

/** What `track.getSimilar` actually returns: the seed's own artist on top. */
const candidatesFor = (seed: string): SimilarTrack[] => [
  ...library.filter((t) => t.artist === seed).map((t, i) => candidate(t.artist, t.title, 1 - i * 0.01)),
  ...library.filter((t) => t.artist !== seed).map((t, i) => candidate(t.artist, t.title, 0.6 - i * 0.005)),
];

describe('findInLibrary', () => {
  it('spreads a fill across artists instead of down one album', () => {
    // The bug this exists for: taking the closest five gave five tracks by the
    // artist that just played, because that is what heads the candidate list.
    for (let run = 0; run < 50; run++) {
      const picked = findInLibrary(candidatesFor('Kraftwerk'), library, new Set(), 5);
      expect(picked).toHaveLength(5);
      expect(new Set(picked.map((t) => t.artist)).size).toBe(5);
    }
  });

  it('holds back artists heard recently', () => {
    const rested = new Set([artistKey('Kraftwerk'), artistKey('Jarre')]);
    for (let run = 0; run < 50; run++) {
      const picked = findInLibrary(candidatesFor('Kraftwerk'), library, new Set(), 4, rested);
      expect(picked.map((t) => t.artist)).not.toContain('Kraftwerk');
      expect(picked.map((t) => t.artist)).not.toContain('Jarre');
    }
  });

  it('repeats an artist rather than returning short when that is all there is', () => {
    // A library where one band holds everything: going quiet would be worse.
    const solo = [1, 2, 3, 4, 5, 6].map((n) => track('OnlyBand', `T${n}`));
    const picked = findInLibrary(
      solo.map((t, i) => candidate(t.artist, t.title, 1 - i * 0.05)),
      solo,
      new Set(),
      5,
      new Set([artistKey('OnlyBand')]),
    );
    expect(picked).toHaveLength(5);
    expect(new Set(picked.map((t) => t.title)).size).toBe(5);
  });

  it('never offers something already played', () => {
    const exclude = new Set([matchKey('Jarre', 'Jarre-1'), matchKey('Neu', 'Neu-1')]);
    for (let run = 0; run < 30; run++) {
      const picked = findInLibrary(candidatesFor('Kraftwerk'), library, exclude, 6);
      for (const t of picked) expect(exclude.has(matchKey(t.artist, t.title))).toBe(false);
    }
  });

  it('favours a closer match without making the order fixed', () => {
    const solo = [1, 2, 3, 4, 5, 6].map((n) => track('OnlyBand', `T${n}`));
    const cands = solo.map((t, i) => candidate(t.artist, t.title, 1 - i * 0.18));

    const firsts = new Map<string, number>();
    for (let run = 0; run < 400; run++) {
      const first = findInLibrary(cands, solo, new Set(), 1)[0]?.title as string;
      firsts.set(first, (firsts.get(first) ?? 0) + 1);
    }
    // The closest leads most often; the furthest still turns up sometimes.
    expect(firsts.get('T1') ?? 0).toBeGreaterThan(firsts.get('T6') ?? 0);
    expect(firsts.size).toBeGreaterThan(2);
  });

  it('returns nothing when the library holds nothing that matches', () => {
    expect(findInLibrary([candidate('Nobody', 'Nothing', 1)], library, new Set(), 5)).toEqual([]);
    expect(findInLibrary(candidatesFor('Kraftwerk'), [], new Set(), 5)).toEqual([]);
  });
});

describe('resolveViaSpotify', () => {
  const found = (artist: string, title: string): TrackMetadata => ({
    id: `spotify:${artist}:${title}`,
    title,
    artist,
    album: '',
    duration: 1000,
    source: 'spotify',
  });

  const searcher = (answer: (artist: string, title: string) => TrackMetadata[]) => {
    let calls = 0;
    return {
      get calls() {
        return calls;
      },
      search: async (query: string) => {
        calls++;
        const m = query.match(/^track:(.+) artist:(.+)$/);
        return answer(m?.[2] ?? '', m?.[1] ?? '');
      },
    };
  };

  const cands = [
    candidate('Kraftwerk', 'K1', 0.99),
    candidate('Kraftwerk', 'K2', 0.98),
    candidate('Jarre', 'J1', 0.8),
    candidate('Neu', 'N1', 0.75),
    candidate('Cluster', 'C1', 0.7),
    candidate('Harmonia', 'H1', 0.65),
  ];

  it('fills to the limit, one track per artist', async () => {
    const s = searcher((a, t) => [found(a, t)]);
    const picked = await resolveViaSpotify(
      cands,
      { played: [], excludeArtists: new Set(), searchSpotify: s.search },
      5,
    );
    expect(picked).toHaveLength(5);
    expect(new Set(picked.map((t) => t.artist)).size).toBe(5);
  });

  it('skips artists that just played', async () => {
    const s = searcher((a, t) => [found(a, t)]);
    const picked = await resolveViaSpotify(
      cands,
      {
        played: [],
        excludeArtists: new Set([artistKey('Kraftwerk'), artistKey('Jarre')]),
        searchSpotify: s.search,
      },
      5,
    );
    expect(picked.map((t) => t.artist)).not.toContain('Kraftwerk');
    expect(picked.map((t) => t.artist)).not.toContain('Jarre');
  });

  describe('coming back to the same song again and again', () => {
    /**
     * The reported fault, as a loop.
     *
     * Play a song, move to another, come back, repeat. Each round the recent-
     * artist memory covers one more of the pool's artists, and the artist tier
     * only ever offered a handful. The spread rule was a hard skip with nothing
     * behind it, so on about the third return the station had nothing to say.
     */
    const narrowPool = (artists: number, tracksEach: number) =>
      Array.from({ length: artists }, (_, a) =>
        Array.from({ length: tracksEach }, (_, t) =>
          candidate(`Band${a}`, `t${a}-${t}`, 0.9 - a * 0.1 - t * 0.004),
        ),
      ).flat();

    /** Runs the loop, returning how many were found each round. */
    const cycle = async (pool: SimilarTrack[], rounds: number, hitRate = 1) => {
      const played: string[] = [];
      let recentArtists: string[] = [];
      const perRound: number[] = [];

      for (let round = 0; round < rounds; round++) {
        const s = searcher((artist, title) => {
          // Deterministic per candidate, so a miss stays a miss all the way
          // through — which is what makes a thin pool thin.
          const h = [...(artist + title)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
          return (h % 100) / 100 < hitRate ? [found(artist, title)] : [];
        });
        const picked = await resolveViaSpotify(
          pool,
          { played, excludeArtists: new Set(recentArtists), searchSpotify: s.search },
          5,
        );
        perRound.push(picked.length);
        if (picked.length === 0) break;

        const heard = picked[0] as TrackMetadata;
        played.push(matchKey(heard.artist, heard.title));
        recentArtists = [artistKey(heard.artist), ...recentArtists].slice(0, 3);
      }
      return perRound;
    };

    it('still has something to say on the sixth return', async () => {
      // Four artists and three held back was the shape that failed. Measured
      // against the old implementation this reached zero on the third round.
      const perRound = await cycle(narrowPool(4, 10), 6);
      expect(perRound).toHaveLength(6);
      for (const [round, found] of perRound.entries()) {
        expect(found, `round ${round + 1}`).toBeGreaterThan(0);
      }
    });

    it('holds up when Spotify only matches some of what it is asked for', async () => {
      // The real hit rate is not one. At 60% the old code stopped on the third.
      for (const hitRate of [0.8, 0.6]) {
        const perRound = await cycle(narrowPool(4, 10), 6, hitRate);
        expect(perRound, `hit rate ${hitRate}`).toHaveLength(6);
        expect(Math.min(...perRound), `hit rate ${hitRate}`).toBeGreaterThan(0);
      }
    });

    it('keeps going even when every artist has been heard', async () => {
      // Two artists is what the genre tier can offer, and the memory holds
      // three. There is no unheard artist left to find; repeating the least
      // stale one is the only thing left that is not silence.
      const perRound = await cycle(narrowPool(2, 4), 8);
      expect(perRound).toHaveLength(8);
      expect(Math.min(...perRound)).toBeGreaterThan(0);
    });

    it('reaches for the least recently played, not just any of them', async () => {
      const pool = narrowPool(1, 3);
      const s = searcher((a, t) => [found(a, t)]);
      // All three heard; the first in the list is the longest ago.
      const played = ['band0t02', 'band0t01', 'band0t00'];

      const picked = await resolveViaSpotify(
        pool,
        { played, excludeArtists: new Set([artistKey('Band0')]), searchSpotify: s.search },
        1,
      );
      expect(picked.map((t) => t.title)).toEqual(['t0-2']);
    });
  });

  it('bounds how many searches one fill can spend', async () => {
    // Spotify limits on a rolling window and Development Mode adds quota
    // buckets of undisclosed size, so a candidate list it cannot match must not
    // turn one fill into fifty requests.
    const many = Array.from({ length: 40 }, (_, i) => candidate(`Band${i}`, `T${i}`, 0.5));
    const s = searcher(() => []);
    const picked = await resolveViaSpotify(
      many,
      { played: [], excludeArtists: new Set(), searchSpotify: s.search },
      5,
    );
    expect(picked).toEqual([]);
    expect(s.calls).toBe(8);
  });

  it('does not hand back the same song after the same song every time', async () => {
    // The reported fault, and the one assertion the old implementation fails.
    // It sorted by similarity and walked down the list, so a listener whose
    // library does not overlap Last.fm's answer heard one fixed sequence for
    // the life of the app — the same five songs, in the same order, on every
    // launch.
    const firsts = new Set<string>();
    for (let run = 0; run < 100; run++) {
      const s = searcher((a, t) => [found(a, t)]);
      const picked = await resolveViaSpotify(
        cands,
        { played: [], excludeArtists: new Set(), searchSpotify: s.search },
        5,
      );
      const first = picked[0];
      if (first) firsts.add(`${first.artist}-${first.title}`);
    }
    expect(firsts.size).toBeGreaterThan(1);
  });

  it('still lets a closer match lead more often than a distant one', async () => {
    // The other half: a shuffle nobody can steer is a shuffle, not a station.
    const counts = new Map<string, number>();
    for (let run = 0; run < 300; run++) {
      const s = searcher((a, t) => [found(a, t)]);
      const picked = await resolveViaSpotify(
        cands,
        { played: [], excludeArtists: new Set(), searchSpotify: s.search },
        1,
      );
      const artist = picked[0]?.artist;
      if (artist) counts.set(artist, (counts.get(artist) ?? 0) + 1);
    }
    // Kraftwerk holds the two closest candidates; Harmonia the furthest.
    expect(counts.get('Kraftwerk') ?? 0).toBeGreaterThan(counts.get('Harmonia') ?? 0);
  });

  it('rejects a result that is not the song it asked for', async () => {
    // Spotify's field search is fuzzy; taking whatever comes back would drift
    // the station into unrelated music.
    const s = searcher(() => [found('Someone Else', 'A Different Song')]);
    const picked = await resolveViaSpotify(
      cands,
      { played: [], excludeArtists: new Set(), searchSpotify: s.search },
      5,
    );
    expect(picked).toEqual([]);
  });
});
