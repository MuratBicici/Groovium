import { beforeEach, describe, expect, it } from 'vitest';
import { usePlayerStore } from './playerStore';
import type { LibraryTrack } from '@/core/library';
import type { TrackMetadata } from '@/core/types';

/**
 * The station queue holds suggestions for one particular track.
 *
 * It used to hold them for the rest of the session. Play a K-pop song, let it
 * stock the queue, then pick a Turkish song from search: the queue was still
 * K-pop, nothing cleared it, and `prefetchStationTrack` skipped its own lookup
 * because a stocked queue reads as "already answered". So the Turkish song
 * ended and a K-pop song followed it.
 *
 * These run against the real store rather than an extracted helper, because the
 * rule being protected is about which paths clear the queue — and an extracted
 * predicate would still be true while a new call site forgot to consult it.
 */

const track = (id: string, title: string, artist: string): TrackMetadata => ({
  id,
  title,
  artist,
  album: '',
  duration: 200000,
  source: 'local',
});

const SEED = track('kp:1', 'Ditto', 'NewJeans');
const SUGGESTIONS = [track('kp:2', 'Hype Boy', 'NewJeans'), track('kp:3', 'Love Dive', 'IVE')];
const ELSEWHERE = track('tr:1', 'Gesi Bağları', 'Ahmet Kaya');

const LIBRARY_SONG: LibraryTrack = {
  id: '1',
  storedFile: 'a.mp3',
  sourcePath: 'C:/a.mp3',
  title: 'Gesi Bağları',
  artist: 'Ahmet Kaya',
  album: '',
  durationMs: 200000,
  hasCoverArt: false,
  addedAt: 0,
};

function stockTheQueue() {
  usePlayerStore.setState({
    playback: { id: 'single', tracks: [SEED], index: 0 },
    currentTrack: SEED,
    stationQueue: [...SUGGESTIONS],
    station: true,
    error: null,
  });
}

const queuedTitles = () => usePlayerStore.getState().stationQueue.map((t) => t.title);

describe('the station queue', () => {
  beforeEach(stockTheQueue);

  it('is emptied when a different song is chosen', async () => {
    await usePlayerStore.getState().playSingle(ELSEWHERE);
    expect(queuedTitles()).toEqual([]);
  });

  it('is emptied when a song is picked out of the library', async () => {
    usePlayerStore.setState({ library: [LIBRARY_SONG] });
    await usePlayerStore.getState().playFrom('library', 0);

    // The context has to actually resolve, or this would pass because
    // `playFrom` returned early and never started anything.
    expect(usePlayerStore.getState().currentTrack?.title).toBe('Gesi Bağları');
    expect(queuedTitles()).toEqual([]);
  });

  it('survives the station handing over to its own next pick', async () => {
    // The one case where the queue outlives a track change: this is the same
    // run, and the entries left are still answers to the seed they came from.
    await usePlayerStore.getState().next();
    expect(usePlayerStore.getState().currentTrack?.title).toBe('Hype Boy');
    expect(queuedTitles()).toEqual(['Love Dive']);
  });
});
