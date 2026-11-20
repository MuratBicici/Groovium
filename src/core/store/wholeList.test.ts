import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/station', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/station')>()),
  hasApiKey: vi.fn(async () => true),
  resolveNextTracks: vi.fn(async () => []),
}));

import { usePlayerStore } from './playerStore';
import { say } from '@/core/i18n';
import { clearNotice, useNotice } from '@/core/notice';
import { registerProvider } from '@/core/providers/registry';
import type {
  AudioProvider,
  PlaybackState,
  ProviderEventListener,
  TrackMetadata,
} from '@/core/types';

/**
 * A list put on whole and a song picked out of one both play on through the
 * list; with infinite play on, the station follows once it has ended, and a
 * notice says that it has.
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

describe('a list put on whole', () => {
  beforeEach(async () => {
    registerProvider(new Silent());
    await store().setActiveProvider('local');
    clearNotice();
    usePlayerStore.setState({
      station: true,
      stationQueue: [],
      upNext: [],
      skipped: [],
      repeat: 'off',
      shuffle: false,
    });
  });

  it('leaves infinite play as it was', async () => {
    await store().playList('spotify:crate', [A, B], false);
    expect(store().station).toBe(true);
  });

  it('lets infinite play be switched off and on while it plays', async () => {
    await store().playList('spotify:crate', [A, B], false);
    await store().toggleStation();
    expect(store().station).toBe(false);
    expect(await store().toggleStation()).toBe(true);
    expect(store().station).toBe(true);
  });

  it('hands over to the station when it ends, and says so', async () => {
    const { resolveNextTracks } = await import('@/core/station');
    vi.mocked(resolveNextTracks).mockResolvedValue([track('x')]);
    await store().playList('spotify:crate', [A, B], false);
    await store().next();
    tell({ type: 'ended', trackId: 'b' });
    await vi.waitFor(() => expect(store().currentTrack?.id).toBe('x'));
    await vi.waitFor(() => expect(useNotice.getState().message).toBe(say('station.listEnded')));
    expect(useNotice.getState().kind).toBe('info');
    vi.mocked(resolveNextTracks).mockResolvedValue([]);
  });

  it('says an album has ended, not a playlist', async () => {
    const { resolveNextTracks } = await import('@/core/station');
    vi.mocked(resolveNextTracks).mockResolvedValue([track('y')]);
    await store().playList('spotify:album:x', [A, B], false);
    await store().next();
    tell({ type: 'ended', trackId: 'b' });
    await vi.waitFor(() => expect(store().currentTrack?.id).toBe('y'));
    await vi.waitFor(() => expect(useNotice.getState().message).toBe(say('station.albumEnded')));
    vi.mocked(resolveNextTracks).mockResolvedValue([]);
  });

  it('stops at its end with infinite play off, and says nothing', async () => {
    usePlayerStore.setState({ station: false });
    await store().playList('spotify:crate', [A, B], false);
    await store().next();
    tell({ type: 'ended', trackId: 'b' });
    await vi.waitFor(() => expect(store().playbackState).toBe('IDLE'));
    expect(useNotice.getState().message).toBeNull();
  });
});

describe('a song picked out of a list', () => {
  const C = track('c');

  beforeEach(async () => {
    registerProvider(new Silent());
    await store().setActiveProvider('local');
    usePlayerStore.setState({
      station: true,
      stationQueue: [],
      upNext: [],
      skipped: [],
      repeat: 'off',
      shuffle: false,
    });
  });

  it('starts there and leaves the station on', async () => {
    await store().playList('spotify:album:x', [A, B, C], undefined, 1);
    expect(store().currentTrack?.id).toBe('b');
    expect(store().station).toBe(true);
  });

  it('plays on through the rest of the list', async () => {
    await store().playList('spotify:album:x', [A, B, C], undefined, 1);
    tell({ type: 'ended', trackId: 'b' });
    await vi.waitFor(() => expect(store().currentTrack?.id).toBe('c'));
    expect(store().playback.id).toBe('spotify:album:x');
  });

  it('asks the station for what follows once the list has ended', async () => {
    const { resolveNextTracks } = await import('@/core/station');
    vi.mocked(resolveNextTracks).mockClear();
    await store().playList('spotify:album:x', [A, B, C], undefined, 2);
    tell({ type: 'ended', trackId: 'c' });
    await vi.waitFor(() => expect(vi.mocked(resolveNextTracks)).toHaveBeenCalled());
  });

  it('keeps the shuffle switch as it was, and starts on the song picked', async () => {
    usePlayerStore.setState({ shuffle: true });
    await store().playList('spotify:album:x', [A, B, C], undefined, 2);
    expect(store().shuffle).toBe(true);
    expect(store().currentTrack?.id).toBe('c');
  });
});
