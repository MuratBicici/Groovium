import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/station', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/station')>()),
  hasApiKey: vi.fn(async () => true),
  resolveNextTracks: vi.fn(async () => []),
}));

import { resolveNextTracks } from '@/core/station';
import { usePlayerStore } from './playerStore';
import { registerProvider } from '@/core/providers/registry';
import type {
  AudioProvider,
  PlaybackState,
  ProviderEventListener,
  TrackMetadata,
} from '@/core/types';

/**
 * What the station costs a listener who has not switched it on.
 *
 * Finding a successor is a Last.fm lookup and up to a dozen Spotify searches,
 * and the queue it fills is emptied on every ordinary track change — that is
 * what keeps one run's suggestions out of the next. Together those two meant
 * every skip, every next track of a playlist and every song picked by hand paid
 * for a suggestion nobody had asked for and nobody would see. It was invisible,
 * it was the largest thing this app spent, and no test held it.
 */

const looked = vi.mocked(resolveNextTracks);

const track = (id: string): TrackMetadata => ({
  id,
  title: id,
  artist: 'Someone',
  album: '',
  duration: 200_000,
  source: 'local',
});

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
  subscribe(_listener: ProviderEventListener): () => void {
    return () => {};
  }
  dispose(): void {}
}

/** The prefetch is deliberately not awaited, so let it run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const COLLECTION = [track('a'), track('b'), track('c')];

describe('looking for a successor', () => {
  beforeEach(async () => {
    looked.mockClear();
    registerProvider(new Silent());
    await usePlayerStore.getState().setActiveProvider('local');
    usePlayerStore.setState({ stationQueue: [], stationSeeds: [], stationHistory: [] });
  });

  it('does not look at all while the station is off', async () => {
    usePlayerStore.setState({ station: false });
    await usePlayerStore.getState().playList('library', COLLECTION);
    await settle();
    expect(looked).not.toHaveBeenCalled();
  });

  it('does not look on every track of a collection either', async () => {
    // The queue is emptied on each ordinary track change, so a guard that only
    // covered the first track would leave the rest of the playlist paying.
    usePlayerStore.setState({ station: false });
    await usePlayerStore.getState().playList('library', COLLECTION);
    await usePlayerStore.getState().next();
    await usePlayerStore.getState().next();
    await settle();
    expect(looked).not.toHaveBeenCalled();
  });

  it('looks once the station is on', async () => {
    usePlayerStore.setState({ station: true });
    await usePlayerStore.getState().playList('library', COLLECTION);
    await settle();
    expect(looked).toHaveBeenCalled();
  });
});
