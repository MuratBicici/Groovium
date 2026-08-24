import { beforeEach, describe, expect, it } from 'vitest';
import { rememberedCollection, usePlayerStore } from './playerStore';
import { registerProvider } from '@/core/providers/registry';
import type {
  AudioProvider,
  PlaybackState,
  ProviderEventListener,
  TrackMetadata,
} from '@/core/types';

/**
 * Taking the record off the deck and either putting it back or throwing it.
 *
 * The animation is not what these are about. What they are about is that the
 * music stops while the record is in the air, that putting it back does not
 * *start* a record that was paused, and that throwing it away empties the deck
 * without also emptying the collection the next launch is supposed to restore.
 */

const track = (id: string): TrackMetadata => ({
  id,
  title: 'Something',
  artist: 'Someone',
  album: '',
  duration: 200000,
  source: 'local',
});

class FakeProvider implements AudioProvider {
  paused = 0;
  resumed = 0;
  readonly id = 'local' as const;
  readonly displayName = 'Fake';
  async initialize(): Promise<boolean> {
    return true;
  }
  async authenticate() {
    return { success: true } as const;
  }
  async play(): Promise<void> {}
  async pause(): Promise<void> {
    this.paused += 1;
  }
  async resume(): Promise<void> {
    this.resumed += 1;
  }
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

let provider: FakeProvider;

function onTheDeck(state: 'PLAYING' | 'PAUSED') {
  const current = track('one');
  usePlayerStore.setState({
    playback: { id: 'library', tracks: [current, track('two')], index: 0 },
    currentTrack: current,
    activeProviderId: 'local',
    playbackState: state,
    positionMs: 42000,
    durationMs: 200000,
    stationQueue: [track('suggested')],
    holdingRecord: false,
    error: null,
  });
}

describe('lifting the record off the deck', () => {
  beforeEach(() => {
    provider = new FakeProvider();
    registerProvider(provider);
  });

  it('stops the music while it is off', async () => {
    onTheDeck('PLAYING');
    await usePlayerStore.getState().liftRecord();

    expect(usePlayerStore.getState().holdingRecord).toBe(true);
    expect(provider.paused).toBe(1);
    // Said outright rather than waited for. The provider's own state event does
    // arrive, but a frame or two later, and until it did the widget read "Now
    // Playing" over an empty deck with the record visibly in someone's hand.
    expect(usePlayerStore.getState().playbackState).toBe('PAUSED');
  });

  it('carries on where it left off when it goes back', async () => {
    onTheDeck('PLAYING');
    await usePlayerStore.getState().liftRecord();
    await usePlayerStore.getState().lowerRecord();

    expect(usePlayerStore.getState().holdingRecord).toBe(false);
    expect(provider.resumed).toBe(1);
    // Nothing seeks: the provider was paused, so it is still where it was.
    expect(usePlayerStore.getState().positionMs).toBe(42000);
  });

  it('leaves a paused record paused', async () => {
    // The distinction that matters, and the one most annoying to get wrong:
    // picking up a record that was not playing and putting it back is not a
    // request to play it.
    onTheDeck('PAUSED');
    await usePlayerStore.getState().liftRecord();
    expect(provider.paused).toBe(0);

    await usePlayerStore.getState().lowerRecord();
    expect(provider.resumed).toBe(0);
    expect(usePlayerStore.getState().holdingRecord).toBe(false);
  });

  it('does nothing with an empty deck', async () => {
    usePlayerStore.setState({ currentTrack: null, holdingRecord: false });
    await usePlayerStore.getState().liftRecord();
    expect(usePlayerStore.getState().holdingRecord).toBe(false);
  });
});

describe('throwing the record away', () => {
  beforeEach(() => {
    provider = new FakeProvider();
    registerProvider(provider);
  });

  it('empties the deck and stops', async () => {
    onTheDeck('PLAYING');
    await usePlayerStore.getState().liftRecord();
    await usePlayerStore.getState().discardRecord();

    const state = usePlayerStore.getState();
    expect(state.currentTrack).toBeNull();
    expect(state.playbackState).toBe('IDLE');
    expect(state.positionMs).toBe(0);
    expect(state.holdingRecord).toBe(false);
  });

  it('leaves the transport nothing to act on', async () => {
    // An empty deck with a working Next button would put a record back on that
    // nobody asked for.
    onTheDeck('PLAYING');
    await usePlayerStore.getState().discardRecord();

    expect(usePlayerStore.getState().playback.tracks).toEqual([]);
    expect(usePlayerStore.getState().playback.index).toBe(-1);
  });

  it('does not cost the next launch its library', async () => {
    // Emptying `playback` leaves its id as `single`, which is exactly the shape
    // `rememberedCollection` is built to survive — it keeps the collection
    // already saved rather than overwriting it with nothing. Throwing a record
    // away must not do what playing a search result once used to do.
    onTheDeck('PLAYING');
    await usePlayerStore.getState().discardRecord();

    expect(rememberedCollection({ context: 'library', contextIndex: 3 }, usePlayerStore.getState().playback)).toEqual({
      context: 'library',
      contextIndex: 3,
    });
  });

  it('forgets the suggestions that were lined up behind it', async () => {
    onTheDeck('PLAYING');
    await usePlayerStore.getState().discardRecord();

    expect(usePlayerStore.getState().stationQueue).toEqual([]);
  });

  it('works straight off the deck, without a lift first', async () => {
    // The keyboard route takes the record off and throws it in one gesture.
    onTheDeck('PLAYING');
    await usePlayerStore.getState().discardRecord();

    expect(usePlayerStore.getState().currentTrack).toBeNull();
    expect(provider.paused).toBe(1);
  });

  it('does nothing when the deck is already empty', async () => {
    usePlayerStore.setState({ currentTrack: null, playbackState: 'IDLE' });
    await usePlayerStore.getState().discardRecord();
    expect(provider.paused).toBe(0);
  });
});
