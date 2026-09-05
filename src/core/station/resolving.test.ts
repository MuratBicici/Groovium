import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryTrack } from '@/core/library';
import type { TrackMetadata } from '@/core/types';

/**
 * Which source gets asked, about which track, and how often.
 *
 * The reported fault was that infinite play stopped dead on certain songs.
 * There were two reasons and this covers both: only one track was ever asked
 * about, and only one source was ever asked. The lookups are mocked because the
 * real ones need Tauri, a Last.fm key and a Premium account — none of which
 * should stand between a rule and a test of it.
 */

vi.mock('./lastfm', () => ({
  similarTracks: vi.fn(),
  artistCandidates: vi.fn(),
  hasApiKey: vi.fn(),
  setApiKey: vi.fn(),
  clearApiKey: vi.fn(),
  openAccountPage: vi.fn(),
}));

import { artistCandidates, similarTracks, type SimilarTrack } from './lastfm';
import { forgetStationRest, resolveNextTracks } from './index';

const askedAboutTrack = vi.mocked(similarTracks);
const askedAboutArtist = vi.mocked(artistCandidates);

const libraryTrack = (artist: string, title: string): LibraryTrack => ({
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

const playing = (artist: string, title: string): TrackMetadata => ({
  id: `${artist}:${title}`,
  title,
  artist,
  album: '',
  duration: 1000,
  source: 'local',
});

const candidate = (artist: string, title: string): SimilarTrack => ({
  artist,
  title,
  matchScore: 0.8,
});

/** Something the library can supply, so nothing has to reach Spotify. */
const OWNED = libraryTrack('Neu', 'Hallogallo');
const LIBRARY = [OWNED, libraryTrack('Cluster', 'Sowiesoso')];

const SEEDS = [
  playing('Kraftwerk', 'Autobahn'),
  playing('Jarre', 'Oxygene'),
  playing('Tangerine', 'Phaedra'),
  playing('Harmonia', 'Watussi'),
];

let tracksLikeArtist: ReturnType<typeof vi.fn>;
let searchSpotify: ReturnType<typeof vi.fn>;

function resolve(overrides: Partial<Parameters<typeof resolveNextTracks>[0]> = {}) {
  return resolveNextTracks({
    seeds: SEEDS,
    library: LIBRARY,
    played: [],
    excludeArtists: new Set(),
    spotifyAvailable: false,
    searchSpotify: searchSpotify as never,
    tracksLikeArtist: tracksLikeArtist as never,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // A fill that searches and finds nothing puts Spotify out of reach for a
  // while, and that outlives the test that caused it — the rest is module
  // state, because the quota it protects is one account's rather than one
  // caller's.
  forgetStationRest();
  askedAboutTrack.mockResolvedValue([]);
  askedAboutArtist.mockResolvedValue([]);
  tracksLikeArtist = vi.fn().mockResolvedValue([]);
  searchSpotify = vi.fn().mockResolvedValue([]);
});

describe('when the track lookup answers', () => {
  it('costs one request and never reaches the other sources', async () => {
    // The ordinary case, and the one that must not get more expensive.
    askedAboutTrack.mockResolvedValue([candidate('Neu', 'Hallogallo')]);

    const picked = await resolve();

    expect(picked.map((t) => t.title)).toEqual(['Hallogallo']);
    expect(askedAboutTrack).toHaveBeenCalledTimes(1);
    expect(askedAboutArtist).not.toHaveBeenCalled();
    expect(tracksLikeArtist).not.toHaveBeenCalled();
  });
});

describe('when a track is a dead end', () => {
  it('carries on with another track from the run instead of stopping', async () => {
    // The reported fault. One song Last.fm has never heard of used to end a run
    // that was going fine, because only that song was ever asked about.
    askedAboutTrack.mockImplementation(async (_artist: string, title: string) =>
      title === 'Watussi' ? [candidate('Neu', 'Hallogallo')] : [],
    );

    const picked = await resolve();

    expect(picked.map((t) => t.title)).toEqual(['Hallogallo']);
  });

  it('asks Last.fm about the artist when it has nothing on the song', async () => {
    askedAboutArtist.mockResolvedValue([candidate('Cluster', 'Sowiesoso')]);

    const picked = await resolve();

    expect(picked.map((t) => t.title)).toEqual(['Sowiesoso']);
    expect(askedAboutArtist).toHaveBeenCalled();
  });

  it('asks Spotify about the genre when Last.fm has nothing at all', async () => {
    const fromGenre = { ...playing('Harmonia', 'Dino'), source: 'spotify' as const };
    tracksLikeArtist.mockResolvedValue([fromGenre]);

    const picked = await resolve({ spotifyAvailable: true });

    expect(picked.map((t) => t.title)).toEqual(['Dino']);
  });

  it('does not reach for Spotify when it is not connected', async () => {
    await resolve({ spotifyAvailable: false });
    expect(tracksLikeArtist).not.toHaveBeenCalled();
  });

  it('gives up quietly when nothing anywhere knows the music', async () => {
    // An empty answer is an ordinary outcome, not a failure to report.
    await expect(resolve({ spotifyAvailable: true })).resolves.toEqual([]);
  });
});

describe('what one fill is allowed to spend', () => {
  it('gives every seed the cheap look', async () => {
    await resolve();
    expect(askedAboutTrack).toHaveBeenCalledTimes(SEEDS.length);
  });

  it('bounds the expensive one, so a pool of dead ends is not a burst', async () => {
    // The deeper tiers are about nine requests between them. Four seeds all
    // running the full ladder would be forty on one fill, which is enough for
    // Spotify to start answering 429.
    await resolve({ spotifyAvailable: true });

    expect(askedAboutArtist).toHaveBeenCalledTimes(2);
    expect(tracksLikeArtist).toHaveBeenCalledTimes(2);
  });
});

describe('when a source fails rather than coming up empty', () => {
  it('falls through to the next one instead of losing the answer', async () => {
    // A Last.fm outage should not cost a suggestion Spotify could have given.
    askedAboutTrack.mockRejectedValue(new Error('Last.fm is unreachable'));
    askedAboutArtist.mockRejectedValue(new Error('Last.fm is unreachable'));
    const fromGenre = { ...playing('Harmonia', 'Dino'), source: 'spotify' as const };
    tracksLikeArtist.mockResolvedValue([fromGenre]);

    const picked = await resolve({ spotifyAvailable: true });

    expect(picked.map((t) => t.title)).toEqual(['Dino']);
  });
});

describe('what one fill is allowed to spend', () => {
  it('shares one budget across every seed rather than handing each a fresh one', async () => {
    // The fault: the budget was checked inside the candidate loop, and that
    // loop ran once per seed. Four seeds meant four budgets, so a fill that
    // read as eight searches was thirty-two — and the genre lookup below spent
    // four more of its own on top of that.
    askedAboutTrack.mockResolvedValue([
      { artist: 'Nobody', title: 'A', matchScore: 0.9 },
      { artist: 'Nobody', title: 'B', matchScore: 0.8 },
      { artist: 'Someone', title: 'C', matchScore: 0.7 },
      { artist: 'Someone', title: 'D', matchScore: 0.6 },
      { artist: 'Third', title: 'E', matchScore: 0.5 },
      { artist: 'Third', title: 'F', matchScore: 0.4 },
      { artist: 'Fourth', title: 'G', matchScore: 0.3 },
      { artist: 'Fourth', title: 'H', matchScore: 0.2 },
      { artist: 'Fifth', title: 'I', matchScore: 0.15 },
      { artist: 'Fifth', title: 'J', matchScore: 0.1 },
    ]);
    // Nothing Spotify can match, so every seed goes the whole way and the
    // fill ends empty — the case that used to cost forty requests.
    searchSpotify.mockResolvedValue([]);

    const picked = await resolve({ spotifyAvailable: true, library: [] });

    expect(picked).toEqual([]);
    expect(searchSpotify.mock.calls.length).toBeLessThanOrEqual(12);
  });
});

describe('a station that keeps finding nothing', () => {
  /**
   * The budget bounds one fill. Nothing bounded the next one.
   *
   * A library Last.fm does not know is not a rare case, and every song was a
   * fresh seed, a fresh twelve searches and the same nothing — about two
   * hundred and forty searches an hour, spent entirely on establishing that
   * there was still nothing. Which is the shape of how this app walked into a
   * daily quota wall.
   */
  const barren = () =>
    resolve({
      library: [],
      spotifyAvailable: true,
      // Something to search about, so the searches actually happen.
      seeds: [playing('Kraftwerk', 'Autobahn')],
    });

  beforeEach(() => {
    askedAboutTrack.mockResolvedValue([candidate('Nobody', 'Nothing')]);
    searchSpotify = vi.fn().mockResolvedValue([]);
  });

  it('leaves Spotify alone for a while after searching for nothing', async () => {
    expect(await barren()).toEqual([]);
    expect(searchSpotify).toHaveBeenCalled();

    searchSpotify.mockClear();
    expect(await barren()).toEqual([]);
    expect(searchSpotify).not.toHaveBeenCalled();
  });

  it('asks again once the rest is over', async () => {
    vi.useFakeTimers();
    try {
      await barren();
      searchSpotify.mockClear();

      vi.setSystemTime(Date.now() + 6 * 60_000);
      await barren();
      expect(searchSpotify).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rests longer each time the answer is still nothing', async () => {
    vi.useFakeTimers();
    try {
      await barren();
      vi.setSystemTime(Date.now() + 6 * 60_000);
      await barren();

      // The second rest is ten minutes, so six is not enough any more.
      vi.setSystemTime(Date.now() + 6 * 60_000);
      searchSpotify.mockClear();
      await barren();
      expect(searchSpotify).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps answering from the library while it rests', async () => {
    // The tier that costs nothing goes on running. It is also the one most
    // likely to have an answer, which is the point.
    await barren();

    askedAboutTrack.mockResolvedValue([candidate('Neu', 'Hallogallo')]);
    const picked = await resolve({ spotifyAvailable: true });
    expect(picked.map((t) => t.title)).toEqual(['Hallogallo']);
  });

  it('starts asking again the moment something is found', async () => {
    await barren();

    askedAboutTrack.mockResolvedValue([candidate('Neu', 'Hallogallo')]);
    await resolve({ spotifyAvailable: true });

    // Whatever was wrong is not wrong now.
    askedAboutTrack.mockResolvedValue([candidate('Nobody', 'Nothing')]);
    searchSpotify.mockClear();
    await barren();
    expect(searchSpotify).toHaveBeenCalled();
  });

  it('does not put Spotify out of reach over a fill that never searched', async () => {
    // No key, or nothing worth searching about: neither says anything about
    // whether searching would have worked.
    expect(await resolve({ library: [], spotifyAvailable: false })).toEqual([]);

    searchSpotify.mockClear();
    await barren();
    expect(searchSpotify).toHaveBeenCalled();
  });
});
