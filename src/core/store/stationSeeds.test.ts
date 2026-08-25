import { beforeEach, describe, expect, it } from 'vitest';
import { usePlayerStore } from './playerStore';
import type { TrackMetadata } from '@/core/types';

/**
 * Which tracks the next suggestion is allowed to be about.
 *
 * The station used to ask about exactly one track, so one song Last.fm has
 * never heard of ended a run that was going fine. It now asks about the run —
 * which immediately raises the question this file exists to answer.
 *
 * Play two K-pop songs, then pick a Turkish song out of search. If the pool
 * were simply "the last four tracks", a Turkish song Last.fm knows nothing
 * about would be answered with K-pop. It is not: choosing a song by hand ends
 * the run, and the pool resets to that song rather than reaching back past it.
 *
 * Against the real store rather than an extracted helper, for the reason
 * `stationQueue.test.ts` gives: the rule is about which paths clear the pool,
 * and an extracted predicate stays true while a new call site forgets it.
 */

const track = (id: string, title: string, artist: string): TrackMetadata => ({
  id,
  title,
  artist,
  album: '',
  duration: 200000,
  source: 'local',
});

const KPOP_ONE = track('kp:1', 'Ditto', 'NewJeans');
const KPOP_TWO = track('kp:2', 'Love Dive', 'IVE');
const TURKISH = track('tr:1', 'Gesi Bağları', 'Ahmet Kaya');

const seedTitles = () => usePlayerStore.getState().stationSeeds.map((t) => t.title);

beforeEach(() => {
  usePlayerStore.setState({
    playback: { id: 'single', tracks: [KPOP_ONE], index: 0 },
    currentTrack: KPOP_ONE,
    stationQueue: [],
    // Ditto is playing, and a track that has started is a track the run is
    // about — `rememberPlayed` is what puts it here.
    stationSeeds: [KPOP_ONE],
    stationAdded: [],
    station: true,
    error: null,
  });
});

describe('the run the station asks about', () => {
  it('grows as the station hands over to its own picks', async () => {
    // A station hand-off is the one track change that does not end the run, so
    // it is the only one that lets the pool grow.
    usePlayerStore.setState({ stationQueue: [KPOP_TWO] });
    await usePlayerStore.getState().next();

    expect(usePlayerStore.getState().currentTrack?.title).toBe('Love Dive');
    expect(seedTitles()).toEqual(['Love Dive', 'Ditto']);
  });

  it('resets to the one song when a different song is chosen by hand', async () => {
    // The reported hazard, asserted directly. Two K-pop songs, then a Turkish
    // song out of search: the pool must hold the Turkish song and nothing else,
    // or a dead end there would be answered with K-pop.
    usePlayerStore.setState({ stationQueue: [KPOP_TWO] });
    await usePlayerStore.getState().next();
    expect(seedTitles()).toHaveLength(2);

    await usePlayerStore.getState().playSingle(TURKISH);

    expect(seedTitles()).toEqual(['Gesi Bağları']);
    expect(seedTitles()).not.toContain('Ditto');
    expect(seedTitles()).not.toContain('Love Dive');
  });

  it('holds the newest first, so the lookup can weight by recency', async () => {
    usePlayerStore.setState({ stationQueue: [KPOP_TWO] });
    await usePlayerStore.getState().next();
    expect(seedTitles()[0]).toBe('Love Dive');
  });

  it('never lists the same track twice', async () => {
    // Repeat one plays the same track again. A pool with one song in it four
    // times is a pool of one, dressed up.
    await usePlayerStore.getState().playSingle(TURKISH);
    await usePlayerStore.getState().playSingle(TURKISH);

    expect(seedTitles()).toEqual(['Gesi Bağları']);
  });
});
