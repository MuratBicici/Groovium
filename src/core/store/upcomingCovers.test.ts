import { describe, expect, it } from 'vitest';
import type { TrackMetadata } from '@/core/types';
import type { PlayerState } from './playerStore';
import { upcomingCovers } from './selectors';

/**
 * Which covers are loaded ahead of their turn.
 *
 * The ones Next and Previous would land on, in the order shuffle and repeat
 * make, what is being started, and what the station has lined up — so a change
 * of song finds its sleeve decoded and its colours read.
 */

const track = (n: number, cover = true): TrackMetadata => ({
  id: `t${n}`,
  title: `Song ${n}`,
  artist: 'Band',
  album: 'Album',
  duration: 180_000,
  source: 'spotify',
  ...(cover ? { coverArtUrl: `cover-${n}` } : {}),
});

const tracks = [0, 1, 2, 3].map((n) => track(n));

function state(over: Partial<PlayerState> = {}): PlayerState {
  return {
    playback: { id: 'library', tracks, index: 1 },
    shuffle: false,
    shuffleOrder: [],
    repeat: 'off',
    starting: null,
    stationQueue: [],
    ...over,
  } as PlayerState;
}

const covers = (s: PlayerState) => upcomingCovers(s).split('\n').filter(Boolean);

describe('covers loaded ahead', () => {
  it('are the next and the previous in the order being played', () => {
    expect(covers(state())).toEqual(['cover-2', 'cover-0']);
  });

  it('follow the shuffled order, not the list', () => {
    const s = state({ shuffle: true, shuffleOrder: [3, 1, 0, 2] });
    expect(covers(s)).toEqual(['cover-0', 'cover-3']);
  });

  it('wrap round the ends only when repeating everything', () => {
    const last = { id: 'library' as const, tracks, index: 3 };
    expect(covers(state({ playback: last }))).toEqual(['cover-2']);
    expect(covers(state({ playback: last, repeat: 'all' }))).toEqual(['cover-0', 'cover-2']);
  });

  it('take in what is being started and what the station has lined up', () => {
    const s = state({ starting: track(9), stationQueue: [track(7), track(8)] });
    expect(covers(s)).toEqual(['cover-9', 'cover-2', 'cover-0', 'cover-7']);
  });

  it('skip tracks with no cover, and say each cover once', () => {
    const s = state({ starting: track(2), stationQueue: [track(5, false)] });
    expect(covers(s)).toEqual(['cover-2', 'cover-0']);
  });

  it('are nothing with nothing queued', () => {
    const s = state({ playback: { id: 'library', tracks: [], index: 0 } });
    expect(upcomingCovers(s)).toBe('');
  });
});
