import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackMetadata } from '@/core/types';

vi.mock('./lastfm', () => ({
  similarTracks: vi.fn(),
  artistCandidates: vi.fn(),
  hasApiKey: vi.fn(),
  setApiKey: vi.fn(),
  clearApiKey: vi.fn(),
  openAccountPage: vi.fn(),
}));

import { artistCandidates, similarTracks } from './lastfm';
import { SPOTIFY_SEARCH_BUDGET, forgetStationRest, resolveNextTracks } from './index';

/**
 * When the station is allowed to stop asking, and when it is not.
 *
 * The rest exists for a pool with nothing in it: a library Last.fm does not
 * know, a taste Spotify's search cannot match. Asking the same nothing twelve
 * times per song is two hundred and forty requests an hour to be told the same
 * thing, so a fill that spends its searches and comes back empty buys a quiet
 * spell, and consecutive ones buy longer spells — five minutes, doubling to
 * thirty.
 *
 * What it must not do is arm on a refusal. Being rate-limited, timing out or
 * losing the network establishes nothing whatever about the pool, and the
 * transport already holds a gate per endpoint family for as long as Spotify
 * asked. A rest stacked on top of that is backing off twice, and it is the one
 * that escalates to half an hour — which from the outside is a feature that has
 * quietly switched itself off.
 */

const seed: TrackMetadata = {
  id: 'seed',
  title: 'A Song',
  artist: 'An Artist',
  album: '',
  duration: 1000,
  source: 'spotify',
};

const asked = vi.mocked(similarTracks);
const askedArtist = vi.mocked(artistCandidates);

/** One fill, with Spotify answering however the test says. */
function fill(searchSpotify: (query: string) => Promise<TrackMetadata[]>) {
  return resolveNextTracks({
    seeds: [seed],
    library: [],
    played: [],
    excludeArtists: new Set(),
    spotifyAvailable: true,
    searchSpotify,
    tracksLikeArtist: async () => [],
  });
}

beforeEach(() => {
  forgetStationRest();
  asked.mockReset();
  askedArtist.mockReset();
  // Last.fm names something Spotify then has to resolve, which is what puts
  // the fill on the path that spends searches.
  asked.mockResolvedValue([{ artist: 'Someone', title: 'Something', matchScore: 1 }]);
  askedArtist.mockResolvedValue([]);
});

describe('a search that is refused part way through', () => {
  it('keeps what was already resolved', async () => {
    // The rejection used to come straight out of the candidate loop, taking
    // everything resolved above it: a rate limit on the third candidate threw
    // away the two songs in front of it and the fill handed back nothing.
    asked.mockResolvedValue([
      { artist: 'A', title: 'One', matchScore: 1 },
      { artist: 'B', title: 'Two', matchScore: 0.9 },
      { artist: 'C', title: 'Three', matchScore: 0.8 },
    ]);

    let asks = 0;
    const searchSpotify = vi.fn(async (query: string) => {
      asks += 1;
      if (asks > 1) throw new Error('Spotify did not answer in time.');
      const match = /track:(.+) artist:(.+)/.exec(query);
      const title = match?.[1] ?? '';
      const artist = match?.[2] ?? '';
      return [{ ...seed, id: `${artist}:${title}`, title, artist }];
    });

    const found = await fill(searchSpotify);
    expect(found).toHaveLength(1);
    expect(asks).toBeGreaterThan(1);
  });

  it('is still bounded by the purse when every search is refused', async () => {
    // A refusal usually costs no request — the transport's gate refuses before
    // the network — so it is tempting to hand the budget back. That is how a
    // shut gate turns one fill into a walk through every candidate Last.fm
    // named. The purse is what bounds it, and a refused search spends from it.
    asked.mockResolvedValue(
      Array.from({ length: 30 }, (_, at) => ({
        artist: `Artist${at}`,
        title: `Song${at}`,
        matchScore: 1 - at * 0.01,
      })),
    );
    const searchSpotify = vi.fn(async () => {
      throw new Error('Spotify is asking this app to slow down.');
    });

    await fill(searchSpotify);
    expect(searchSpotify.mock.calls.length).toBeLessThanOrEqual(SPOTIFY_SEARCH_BUDGET);
  });
});

describe('resting after a fill that found nothing', () => {
  it('stops asking Spotify once a fill has spent its searches for nothing', async () => {
    // The case the rest is for. Spotify answers, and has nothing to offer.
    const searchSpotify = vi.fn(async () => []);
    expect(await fill(searchSpotify)).toEqual([]);
    const spent = searchSpotify.mock.calls.length;
    expect(spent).toBeGreaterThan(0);

    // The next fill is inside the quiet spell, so it must not reach Spotify.
    expect(await fill(searchSpotify)).toEqual([]);
    expect(searchSpotify).toHaveBeenCalledTimes(spent);
  });

  it('does not rest when Spotify refused rather than answered', async () => {
    // A refusal — 429, a timed-out request, a dead network — says nothing
    // about whether the pool has anything in it. Resting for it is how one
    // moment's trouble silenced the station for half an hour.
    const searchSpotify = vi.fn(async () => {
      throw new Error('Spotify did not answer in time.');
    });
    expect(await fill(searchSpotify)).toEqual([]);
    const spent = searchSpotify.mock.calls.length;
    expect(spent).toBeGreaterThan(0);

    // The trouble has passed, and the very next song gets a real attempt.
    const answers = vi.fn(async () => [
      { ...seed, id: 'found', title: 'Something', artist: 'Someone' },
    ]);
    expect(await fill(answers)).toHaveLength(1);
    expect(answers).toHaveBeenCalled();
  });

  it('does not rest when it was Last.fm that refused', async () => {
    // The same reasoning one tier up. A lookup that never produced a name to
    // search for has established nothing about Spotify either.
    asked.mockRejectedValue(new Error('Last.fm returned 429'));
    const searchSpotify = vi.fn(async () => []);
    expect(await fill(searchSpotify)).toEqual([]);

    asked.mockResolvedValue([{ artist: 'Someone', title: 'Something', matchScore: 1 }]);
    const answers = vi.fn(async () => [
      { ...seed, id: 'found', title: 'Something', artist: 'Someone' },
    ]);
    expect(await fill(answers)).toHaveLength(1);
    expect(answers).toHaveBeenCalled();
  });

  it('forgets the rest as soon as anything is found', async () => {
    const nothing = vi.fn(async () => []);
    await fill(nothing);

    forgetStationRest();
    const answers = vi.fn(async () => [
      { ...seed, id: 'found', title: 'Something', artist: 'Someone' },
    ]);
    expect(await fill(answers)).toHaveLength(1);

    // Whatever was wrong is not wrong now, so the next fill searches again.
    const again = vi.fn(async () => [
      { ...seed, id: 'found2', title: 'Something', artist: 'Someone' },
    ]);
    expect(await fill(again)).toHaveLength(1);
    expect(again).toHaveBeenCalled();
  });
});
