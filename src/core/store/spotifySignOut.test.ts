import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from './playerStore';
import { registerProvider } from '@/core/providers/registry';
import type {
  AudioProvider,
  PlaybackState,
  ProviderEventListener,
  TrackMetadata,
} from '@/core/types';

// Signing out talks to Rust, which is not here. Everything else in the action
// is what this is about.
vi.mock('@/core/security/spotifyAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/security/spotifyAuth')>()),
  signOut: vi.fn(async () => {}),
  isAuthenticated: vi.fn(async () => false),
}));

/**
 * Signing out of Spotify used to clear the tokens and nothing else. Whatever
 * was playing kept playing until it failed on its own, and the station queue
 * went on holding suggestions that could no longer be reached.
 *
 * The distinction that matters is which side of the line the current track
 * falls on: a Spotify track comes off the deck with an explanation, and local
 * playback is none of Spotify's business.
 */

const track = (id: string, source: 'local' | 'spotify'): TrackMetadata => ({
  id,
  title: `${source} track`,
  artist: 'Someone',
  album: '',
  duration: 200000,
  source,
});

class FakeProvider implements AudioProvider {
  paused = 0;
  constructor(readonly id: 'local' | 'spotify') {}
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

function nowPlaying(source: 'local' | 'spotify') {
  const current = track(`${source}:1`, source);
  usePlayerStore.setState({
    playback: { id: 'single', tracks: [current], index: 0 },
    currentTrack: current,
    activeProviderId: source,
    playbackState: 'PLAYING',
    positionMs: 42000,
    stationQueue: [track('sp:2', 'spotify'), track('sp:3', 'spotify')],
    error: null,
  });
}

describe('signing out of Spotify', () => {
  beforeEach(() => {
    registerProvider(new FakeProvider('local'));
    registerProvider(new FakeProvider('spotify'));
  });

  it('takes a Spotify track off the deck and says why', async () => {
    nowPlaying('spotify');
    await usePlayerStore.getState().signOutOfSpotify();

    const state = usePlayerStore.getState();
    expect(state.playbackState).toBe('IDLE');
    expect(state.positionMs).toBe(0);
    expect(state.error).toMatch(/Connect your account/);
  });

  it('leaves nothing on the deck to press play on', async () => {
    // Stopping it was not enough. The record stayed put and the transport
    // stayed lit, so it read as something that could be started again, and
    // pressing play only produced the same message a second time.
    nowPlaying('spotify');
    await usePlayerStore.getState().signOutOfSpotify();

    const state = usePlayerStore.getState();
    expect(state.currentTrack).toBeNull();
    expect(state.playback.tracks).toEqual([]);
    expect(state.playback.index).toBe(-1);
  });

  it('says why, rather than reporting whatever the provider made of it', async () => {
    // Pausing runs after the tokens are gone, so it can fail on its own and
    // report through the same field. The explanation has to be the one that
    // survives.
    nowPlaying('spotify');
    await usePlayerStore.getState().signOutOfSpotify();

    expect(usePlayerStore.getState().error).toMatch(/Connect your account/);
  });

  it('leaves local playback entirely alone', async () => {
    // The one that would be most annoying to get wrong: nothing about a local
    // file depends on a Spotify account.
    nowPlaying('local');
    await usePlayerStore.getState().signOutOfSpotify();

    const state = usePlayerStore.getState();
    expect(state.playbackState).toBe('PLAYING');
    expect(state.positionMs).toBe(42000);
    expect(state.error).toBeNull();
    // Still on the deck, and still in a collection worth pressing Next in.
    expect(state.currentTrack?.id).toBe('local:1');
    expect(state.playback.tracks).toHaveLength(1);
  });

  it('empties the suggestion queue either way', async () => {
    // Suggestions were found while signed in and some are Spotify tracks.
    // Better none than a queue that fails one entry at a time.
    for (const source of ['spotify', 'local'] as const) {
      nowPlaying(source);
      await usePlayerStore.getState().signOutOfSpotify();
      expect(usePlayerStore.getState().stationQueue, source).toEqual([]);
    }
  });

  it('refuses to start a Spotify track afterwards, with the same explanation', async () => {
    // Signing out does not empty the collections a Spotify track sits in, so
    // stepping onto one later is ordinary — and it used to surface the
    // provider's own "player is not connected", which helps nobody.
    //
    // Exercised through `playSingle` because the guard sits in `startTrack`,
    // which every route funnels through: pressing Next, picking a row in a
    // mixed playlist, and the station handing over all arrive there.
    usePlayerStore.setState({ error: null, playbackState: 'PLAYING' });

    await usePlayerStore.getState().playSingle(track('sp:9', 'spotify'));

    expect(usePlayerStore.getState().error).toMatch(/Connect your account/);
    expect(usePlayerStore.getState().playbackState).toBe('IDLE');
  });
});
