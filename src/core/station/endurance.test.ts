import { describe, expect, it, vi } from 'vitest';
import type { TrackMetadata } from '@/core/types';

/**
 * Does infinite play actually go on for ever?
 *
 * Every other test here asks whether one rule behaves. This one asks the
 * question a listener asks: switch it on, walk away, and does it still be
 * playing an hour later. It drives the real `resolveNextTracks` against a
 * fabricated Last.fm and Spotify, and keeps the store's own memory rules in
 * step — the sixty-track history, the three-artist hold-back, the four seeds,
 * the queue of five — because those are half of what decides the answer.
 *
 * A stall is `resolveNextTracks` handing back nothing: `playStationTrack`
 * returns false and playback goes idle with a record still on the deck.
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
import { artistKey, resolveNextTracks, trackKey } from './index';

/** The store's own limits, mirrored so the simulation drifts with them. */
const HISTORY = 60;
const ARTIST_MEMORY = 3;
const SEEDS = 4;
const QUEUE_DEPTH = 5;

interface World {
  /** Artists in the fabricated catalogue, each with this many tracks. */
  artists: number;
  tracksPerArtist: number;
  /** Chance Last.fm has anything to say about a given track. */
  knownFraction: number;
  /** Chance Spotify's search returns the exact song it was asked for. */
  spotifyHitRate: number;
  spotifyAvailable: boolean;
}

/** Deterministic per string, so a song that cannot be found never can be. */
const hashOf = (text: string) =>
  [...text].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);

const chance = (text: string, probability: number) => (hashOf(text) % 1000) / 1000 < probability;

function buildWorld(world: World) {
  const name = (a: number, t: number) => ({ artist: `Band${a}`, title: `t${a}-${t}` });
  const every: SimilarTrack[] = [];
  for (let a = 0; a < world.artists; a++) {
    for (let t = 0; t < world.tracksPerArtist; t++) {
      const { artist, title } = name(a, t);
      every.push({ artist, title, matchScore: 0 });
    }
  }

  /** A hundred candidates around a seed, the way `track.getSimilar` answers. */
  const similarTo = (artist: string, title: string): SimilarTrack[] => {
    if (!chance(`known:${artist}:${title}`, world.knownFraction)) return [];
    const start = hashOf(artist + title) % every.length;
    return Array.from({ length: Math.min(100, every.length) }, (_, i) => {
      const entry = every[(start + i * 7) % every.length] as SimilarTrack;
      return { ...entry, matchScore: Math.max(0, 1 - i * 0.011) };
    });
  };

  /** Eight similar artists, five tracks each — what the artist tier returns. */
  const byArtist = (artist: string): SimilarTrack[] => {
    const start = hashOf('artistof:' + artist) % world.artists;
    const out: SimilarTrack[] = [];
    for (let n = 1; n <= 8; n++) {
      const a = (start + n) % world.artists;
      for (let t = 0; t < 5; t++) {
        const { artist: band, title } = name(a, t % world.tracksPerArtist);
        out.push({ artist: band, title, matchScore: 0.9 - n * 0.05 - t * 0.004 });
      }
    }
    return out;
  };

  /** Two artists' top tracks, already playable — what the genre tier returns. */
  const byGenre = async (artist: string): Promise<TrackMetadata[]> => {
    const start = hashOf('genreof:' + artist) % world.artists;
    const out: TrackMetadata[] = [];
    for (let n = 1; n <= 2; n++) {
      const a = (start + n * 3) % world.artists;
      for (let t = 0; t < 10; t++) {
        const { artist: band, title } = name(a, t % world.tracksPerArtist);
        out.push({
          id: `sp:${band}:${title}`,
          title,
          artist: band,
          album: '',
          duration: 200000,
          source: 'spotify',
        });
      }
    }
    return out;
  };

  const searchSpotify = async (query: string): Promise<TrackMetadata[]> => {
    const m = /^track:(.+) artist:(.+)$/.exec(query);
    if (!m) return [];
    const [, title, artist] = m as unknown as [string, string, string];
    if (!chance(`spotify:${artist}:${title}`, world.spotifyHitRate)) return [];
    return [
      { id: `sp:${artist}:${title}`, title, artist, album: '', duration: 200000, source: 'spotify' },
    ];
  };

  return { every, similarTo, byArtist, byGenre, searchSpotify, name };
}

/**
 * Play one run for up to `tracks` songs, returning how far it got.
 *
 * Mirrors `playerStore`: the queue is filled to five and drained one at a
 * time, and every track played updates the three memories the resolver reads.
 */
async function runFor(world: World, tracks: number): Promise<number> {
  const built = buildWorld(world);
  vi.mocked(similarTracks).mockImplementation(async (artist: string, title: string) =>
    built.similarTo(artist, title),
  );
  vi.mocked(artistCandidates).mockImplementation(async (artist: string) => built.byArtist(artist));

  const first = built.name(0, 0);
  const current: TrackMetadata = {
    id: `sp:${first.artist}:${first.title}`,
    title: first.title,
    artist: first.artist,
    album: '',
    duration: 200000,
    source: 'spotify',
  };

  let history: string[] = [trackKey(current)];
  let artists: string[] = [artistKey(current.artist)];
  let seeds: TrackMetadata[] = [current];
  let queue: TrackMetadata[] = [];

  for (let played = 0; played < tracks; played++) {
    if (queue.length === 0) {
      queue = await resolveNextTracks(
        {
          seeds,
          library: [],
          played: [...history, ...queue.map(trackKey)],
          excludeArtists: new Set([...artists, artistKey(seeds[0]?.artist ?? '')]),
          spotifyAvailable: world.spotifyAvailable,
          searchSpotify: built.searchSpotify,
          tracksLikeArtist: built.byGenre,
        },
        QUEUE_DEPTH,
      );
      // Nothing to play next. This is the stall.
      if (queue.length === 0) return played;
    }

    const next = queue.shift() as TrackMetadata;
    history = [...history.filter((k) => k !== trackKey(next)), trackKey(next)].slice(-HISTORY);
    artists = [...artists.filter((a) => a !== artistKey(next.artist)), artistKey(next.artist)].slice(
      -ARTIST_MEMORY,
    );
    seeds = [next, ...seeds.filter((s) => s.id !== next.id)].slice(0, SEEDS);
  }
  return tracks;
}

describe('how far infinite play gets before it stops', () => {
  /** Roughly four hours of music, which is longer than anyone leaves it on. */
  const LONG_RUN = 80;

  it('runs out the clock on a catalogue Last.fm mostly knows', async () => {
    const reached = await runFor(
      {
        artists: 40,
        tracksPerArtist: 10,
        knownFraction: 0.9,
        spotifyHitRate: 0.8,
        spotifyAvailable: true,
      },
      LONG_RUN,
    );
    expect(reached).toBe(LONG_RUN);
  });

  it('runs out the clock when Last.fm knows barely half of it', async () => {
    // The dead-end case, sustained rather than hit once.
    const reached = await runFor(
      {
        artists: 40,
        tracksPerArtist: 10,
        knownFraction: 0.5,
        spotifyHitRate: 0.8,
        spotifyAvailable: true,
      },
      LONG_RUN,
    );
    expect(reached).toBe(LONG_RUN);
  });

  it('runs out the clock on a small catalogue, where everything repeats', async () => {
    // Eight artists is fewer than the memory plus a seed can hold back, so this
    // only survives because the resolver reaches for what it heard longest ago
    // rather than falling silent.
    const reached = await runFor(
      {
        artists: 8,
        tracksPerArtist: 6,
        knownFraction: 0.8,
        spotifyHitRate: 0.9,
        spotifyAvailable: true,
      },
      LONG_RUN,
    );
    expect(reached).toBe(LONG_RUN);
  });

  it('stops when Spotify cannot find anything and there is no library', async () => {
    // The honest limit. Nothing resolves, so there is nothing to fall back on
    // — a search failing, not a rule silencing us.
    const reached = await runFor(
      {
        artists: 40,
        tracksPerArtist: 10,
        knownFraction: 0.9,
        spotifyHitRate: 0,
        spotifyAvailable: true,
      },
      LONG_RUN,
    );
    expect(reached).toBeLessThan(LONG_RUN);
  });
});
