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
      { exclude: new Set(), excludeArtists: new Set(), searchSpotify: s.search },
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
        exclude: new Set(),
        excludeArtists: new Set([artistKey('Kraftwerk'), artistKey('Jarre')]),
        searchSpotify: s.search,
      },
      5,
    );
    expect(picked.map((t) => t.artist)).not.toContain('Kraftwerk');
    expect(picked.map((t) => t.artist)).not.toContain('Jarre');
  });

  it('bounds how many searches one fill can spend', async () => {
    // Spotify limits on a rolling window and Development Mode adds quota
    // buckets of undisclosed size, so a candidate list it cannot match must not
    // turn one fill into fifty requests.
    const many = Array.from({ length: 40 }, (_, i) => candidate(`Band${i}`, `T${i}`, 0.5));
    const s = searcher(() => []);
    const picked = await resolveViaSpotify(
      many,
      { exclude: new Set(), excludeArtists: new Set(), searchSpotify: s.search },
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
        { exclude: new Set(), excludeArtists: new Set(), searchSpotify: s.search },
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
        { exclude: new Set(), excludeArtists: new Set(), searchSpotify: s.search },
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
      { exclude: new Set(), excludeArtists: new Set(), searchSpotify: s.search },
      5,
    );
    expect(picked).toEqual([]);
  });
});
