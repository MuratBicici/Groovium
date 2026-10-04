import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/station', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/station')>()),
  hasApiKey: vi.fn(async () => true),
  resolveNextTracks: vi.fn(async () => []),
}));

import { usePlayerStore } from './playerStore';
import { nextUnskipped, upcoming, type OrderState } from './order';
import { registerProvider } from '@/core/providers/registry';
import type {
  AudioProvider,
  PlaybackState,
  ProviderEventListener,
  TrackMetadata,
} from '@/core/types';

/**
 * The queue: songs put on by hand, played before the collection carries on,
 * and the order everything still to come will play in.
 */

const track = (id: string): TrackMetadata => ({
  id,
  title: id,
  artist: `Artist ${id}`,
  album: '',
  duration: 200_000,
  source: 'local',
});

const A = track('a');
const B = track('b');
const C = track('c');
const D = track('d');

const base = (over: Partial<OrderState> = {}): OrderState => ({
  upNext: [],
  playback: { tracks: [A, B, C, D], index: 0 },
  shuffle: false,
  shuffleOrder: [],
  repeat: 'off',
  skipped: [],
  station: false,
  stationQueue: [],
  stationAdded: [],
  ...over,
});

const ids = (s: OrderState) => upcoming(s).map((u) => `${u.kind[0]}:${u.track.id}`);

describe('what is still to come', () => {
  it('is the rest of the collection, in order', () => {
    expect(ids(base())).toEqual(['c:b', 'c:c', 'c:d']);
  });

  it('puts songs queued by hand first', () => {
    const s = base({ upNext: [{ key: 'q1', track: track('x') }, { key: 'q2', track: track('y') }] });
    expect(ids(s)).toEqual(['q:x', 'q:y', 'c:b', 'c:c', 'c:d']);
  });

  it('follows the shuffle order', () => {
    expect(ids(base({ shuffle: true, shuffleOrder: [0, 3, 1, 2] }))).toEqual(['c:d', 'c:b', 'c:c']);
  });

  it('comes round again on repeat-all, once', () => {
    expect(ids(base({ repeat: 'all', playback: { tracks: [A, B, C, D], index: 2 } }))).toEqual([
      'c:d',
      'c:a',
      'c:b',
    ]);
  });

  it('steps over a song skipped this time round', () => {
    expect(ids(base({ skipped: [1] }))).toEqual(['c:c', 'c:d']);
  });

  it('has the station after the collection, only with the station on', () => {
    const found = { stationQueue: [track('s1'), track('s2')] };
    expect(ids(base({ ...found, station: true }))).toEqual(['c:b', 'c:c', 'c:d', 's:s1', 's:s2']);
    expect(ids(base(found))).toEqual(['c:b', 'c:c', 'c:d']);
  });

  it('stops where the station began adding when the station is off', () => {
    const s = base({ stationAdded: ['c'] });
    expect(ids(s)).toEqual(['c:b']);
  });

  it('can hold the same song twice', () => {
    const s = base({ upNext: [{ key: 'q1', track: A }, { key: 'q2', track: A }] });
    expect(upcoming(s).filter((u) => u.kind === 'queued')).toHaveLength(2);
  });

  it('spends a skip once the order has gone past it', () => {
    expect(nextUnskipped([0, 1, 2, 3], 0, false, [1])).toEqual({ index: 2, passed: [1] });
    expect(nextUnskipped([0, 1, 2, 3], 2, false, [3])).toEqual({ index: null, passed: [3] });
  });
});

/** A provider that plays nothing and records what it was asked to play. */
const played: string[] = [];
let tell: ProviderEventListener = () => {};
class Silent implements AudioProvider {
  readonly id = 'local' as const;
  readonly displayName = 'Silent';
  async initialize(): Promise<boolean> {
    return true;
  }
  async authenticate() {
    return { success: true } as const;
  }
  async play(trackId: string): Promise<void> {
    played.push(trackId);
  }
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async seek(): Promise<void> {}
  async setVolume(): Promise<void> {}
  getState(): PlaybackState {
    return 'PLAYING';
  }
  getCurrentTrack(): TrackMetadata | null {
    return null;
  }
  subscribe(listener: ProviderEventListener): () => void {
    tell = listener;
    return () => {};
  }
  dispose(): void {}
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const store = () => usePlayerStore.getState();
const onDeck = () => store().currentTrack?.id;

describe('the queue in play', () => {
  beforeEach(async () => {
    played.length = 0;
    registerProvider(new Silent());
    await store().setActiveProvider('local');
    usePlayerStore.setState({
      station: false,
      stationQueue: [],
      upNext: [],
      skipped: [],
      repeat: 'off',
      shuffle: false,
      positionMs: 0,
      findingNext: false,
    });
    await store().playList('library', [A, B, C], false);
  });

  it('plays a queued song next, then carries on with the collection', async () => {
    store().queueLast(D);
    await store().next();
    expect(onDeck()).toBe('d');
    expect(store().upNext).toEqual([]);
    await store().next();
    expect(onDeck()).toBe('b');
  });

  it('plays what was queued next before what was queued last', async () => {
    store().queueLast(C);
    store().queueNext(D);
    await store().next();
    expect(onDeck()).toBe('d');
    await store().next();
    expect(onDeck()).toBe('c');
  });

  it('plays the queue first when a song ends by itself', async () => {
    store().queueLast(D);
    tell({ type: 'ended', trackId: 'a' });
    await settle();
    expect(onDeck()).toBe('d');
    tell({ type: 'ended', trackId: 'd' });
    await settle();
    expect(onDeck()).toBe('b');
  });

  it('replays a queued song on repeat-one, not the one it interrupted', async () => {
    store().queueLast(D);
    await store().next();
    usePlayerStore.setState({ repeat: 'one' });
    tell({ type: 'ended', trackId: 'd' });
    await settle();
    expect(onDeck()).toBe('d');
    expect(played.slice(-2)).toEqual(['d', 'd']);
  });

  it('goes back from a queued song to the one it interrupted', async () => {
    store().queueLast(D);
    await store().next();
    await store().previous();
    expect(onDeck()).toBe('a');
  });

  it('drops what was queued before a song played from the middle of the queue', async () => {
    store().queueLast(track('x'));
    store().queueLast(track('y'));
    store().queueLast(track('z'));
    const y = store().upNext[1];
    if (!y) throw new Error('no y');
    await store().playUpcoming({ kind: 'queued', key: y.key, track: y.track });
    expect(onDeck()).toBe('y');
    expect(store().upNext.map((q) => q.track.id)).toEqual(['z']);
  });

  it('skips a song of the collection once, leaving it in the collection', async () => {
    store().skipUpcoming({ kind: 'collection', key: 'collection:1', track: B, index: 1 });
    await store().next();
    expect(onDeck()).toBe('c');
    expect(store().skipped).toEqual([]);
    expect(store().playback.tracks.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('brings a song of the collection to the front of the queue', async () => {
    store().promoteUpcoming({ kind: 'collection', key: 'collection:2', track: C, index: 2 });
    await store().next();
    expect(onDeck()).toBe('c');
    await store().next();
    expect(onDeck()).toBe('b');
    await store().next();
    expect(store().playbackState).not.toBe('PLAYING');
  });

  it('is kept when a different collection is chosen, and cleared on request', async () => {
    store().queueLast(D);
    await store().playList('library', [B, C], false);
    expect(store().upNext.map((q) => q.track.id)).toEqual(['d']);
    store().clearQueue();
    expect(store().upNext).toEqual([]);
  });
});
