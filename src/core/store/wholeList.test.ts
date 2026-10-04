import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/station', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/station')>()),
  hasApiKey: vi.fn(async () => true),
  resolveNextTracks: vi.fn(async () => []),
}));

import { usePlayerStore } from './playerStore';
import { registerProvider } from '@/core/providers/registry';
import type {
  AudioProvider,
  PlaybackState,
  ProviderEventListener,
  TrackMetadata,
} from '@/core/types';

/**
 * A playlist put on whole and a song picked out of one are two different
 * requests. The first is that playlist, as it is, and the station keeps out of
 * it; the second is a starting point, and the station may follow it.
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
  async play(): Promise<void> {}
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

const store = () => usePlayerStore.getState();

describe('the station and a whole playlist', () => {
  beforeEach(async () => {
    registerProvider(new Silent());
    await store().setActiveProvider('local');
    usePlayerStore.setState({
      station: true,
      wholeList: false,
      stationQueue: [],
      upNext: [],
      skipped: [],
      repeat: 'off',
      shuffle: false,
    });
  });

  it('is switched off when a playlist is put on whole', async () => {
    await store().playList('spotify:crate', [A, B], false);
    expect(store().station).toBe(false);
    expect(store().wholeList).toBe(true);
  });

  it('cannot be switched back on while that playlist plays', async () => {
    await store().playList('spotify:crate', [A, B], false);
    // True, not false: false would mean "there is no key", and open the setup.
    expect(await store().toggleStation()).toBe(true);
    expect(store().station).toBe(false);
  });

  it('is left alone when one song is picked out of a playlist', async () => {
    await store().playSingle(A);
    expect(store().station).toBe(true);
    expect(store().wholeList).toBe(false);
  });

  it('can be switched on again once something else is played', async () => {
    await store().playList('spotify:crate', [A, B], false);
    await store().playSingle(B);
    expect(await store().toggleStation()).toBe(true);
    expect(store().station).toBe(true);
  });

  it('can be switched on again once the playlist has played to its end', async () => {
    await store().playList('spotify:crate', [A, B], false);
    await store().next();
    tell({ type: 'ended', trackId: 'b' });
    await vi.waitFor(() => expect(store().wholeList).toBe(false));
    await store().toggleStation();
    expect(store().station).toBe(true);
  });

  it('can be switched on again once the record is thrown away', async () => {
    await store().playList('spotify:crate', [A, B], false);
    await store().discardRecord();
    await store().toggleStation();
    expect(store().station).toBe(true);
  });
});
