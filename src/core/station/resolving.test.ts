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
import { resolveNextTracks } from './index';

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
    exclude: new Set(),
    excludeArtists: new Set(),
    spotifyAvailable: false,
    searchSpotify: searchSpotify as never,
    tracksLikeArtist: tracksLikeArtist as never,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
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
