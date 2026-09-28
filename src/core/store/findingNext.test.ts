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
 * Next, pressed at the end of what there is to play.
 *
 * The station has to go and find a song, which is a Last.fm lookup and some
 * Spotify searches — seconds, sometimes. The press has to be seen to have been
 * heard for all of that, and nothing else that happens meanwhile may be
 * trampled by the answer when it finally comes.
 */

const looked = vi.mocked(resolveNextTracks);

const track = (id: string): TrackMetadata => ({
  id,
  title: id,
  artist: `Artist ${id}`,
  album: '',
  duration: 200_000,
  source: 'local',
});

/** Every song the provider was told to play, in order. */
const played: string[] = [];

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
  subscribe(_listener: ProviderEventListener): () => void {
    return () => {};
  }
  dispose(): void {}
}

/** A lookup that answers only when told to. */
function slowLookup(): (found: TrackMetadata[]) => void {
  let answer: (found: TrackMetadata[]) => void = () => {};
  looked.mockImplementationOnce(
    () =>
      new Promise<TrackMetadata[]>((resolve) => {
        answer = resolve;
      }),
  );
  return (found) => answer(found);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const onDeck = () => usePlayerStore.getState().currentTrack?.id;

describe('pressing Next with nothing lined up', () => {
  beforeEach(async () => {
    looked.mockReset();
    looked.mockImplementation(async () => []);
    registerProvider(new Silent());
    await usePlayerStore.getState().setActiveProvider('local');
    usePlayerStore.setState({
      station: false,
      stationQueue: [],
      stationSeeds: [],
      stationHistory: [],
      findingNext: false,
    });
    // One song, so Next has nowhere to go but the station.
    await usePlayerStore.getState().playList('library', [track('a')]);
    await settle();
  });

  it('says it is searching until the next song is found, and plays it', async () => {
    const answer = slowLookup();
    const pressed = usePlayerStore.getState().next();
    await settle();
    expect(usePlayerStore.getState().findingNext).toBe(true);

    answer([track('b')]);
    await pressed;
    expect(usePlayerStore.getState().findingNext).toBe(false);
    expect(onDeck()).toBe('b');
  });

  it('stops saying so when nothing was found', async () => {
    const answer = slowLookup();
    const pressed = usePlayerStore.getState().next();
    await settle();
    answer([]);
    await pressed;
    expect(usePlayerStore.getState().findingNext).toBe(false);
    expect(onDeck()).toBe('a');
  });

  it('does not skip twice for a second press while it looks', async () => {
    const answer = slowLookup();
    const first = usePlayerStore.getState().next();
    await settle();
    const second = usePlayerStore.getState().next();
    answer([track('b'), track('c')]);
    await Promise.all([first, second]);
    expect(onDeck()).toBe('b');
  });

  it('leaves alone a playlist somebody started while it looked', async () => {
    // Choosing throws the station's lookup away, so it comes back with nothing
    // — and nothing used to mean "start the collection over", which was now
    // the playlist just chosen: its first song, from the top, a second time.
    const answer = slowLookup();
    const pressed = usePlayerStore.getState().next();
    await settle();
    await usePlayerStore.getState().playList('library', [track('x'), track('y')], false);
    played.length = 0;
    answer([track('b')]);
    await pressed;
    expect(onDeck()).toBe('x');
    expect(played).toEqual([]);
    expect(usePlayerStore.getState().findingNext).toBe(false);
  });
});
