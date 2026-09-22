import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from './playerStore';
import { registerProvider } from '@/core/providers/registry';
import type {
  AudioProvider,
  PlaybackState,
  ProviderEventListener,
  TrackMetadata,
} from '@/core/types';

vi.mock('@/core/security/spotifyAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/security/spotifyAuth')>()),
  isAuthenticated: vi.fn(async () => true),
}));

/**
 * A track is on its way long before it is the track playing.
 *
 * `currentTrack` is written once the provider that owns it is ready. On a local
 * file that is the same instant; on a Spotify track on a cold start it is the
 * SDK loading, a token, and a device being claimed. In between there was a
 * record on its way to the deck and nothing in the store saying so — which is
 * what left the record somebody had just put on invisible until the music
 * started, because the thing drawing it had only a timer to go on and the timer
 * ran out first.
 */

const song = (id: string, source: 'local' | 'spotify'): TrackMetadata => ({
  id,
  title: 'A song',
  artist: 'Someone',
  album: '',
  duration: 200000,
  source,
});

class Provider implements AudioProvider {
  /** Held open until the test lets it come up, as a cold start would be. */
  private letIn: (() => void) | null = null;
  constructor(
    readonly id: 'local' | 'spotify',
    private readonly slow = false,
  ) {}
  readonly displayName = 'Fake';
  async initialize(): Promise<boolean> {
    if (this.slow) await new Promise<void>((go) => (this.letIn = go));
    return true;
  }
  comeUp(): void {
    this.letIn?.();
    this.letIn = null;
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

describe('a track on its way', () => {
  let spotify: Provider;

  beforeEach(() => {
    registerProvider(new Provider('local'));
    spotify = new Provider('spotify', true);
    registerProvider(spotify);
    usePlayerStore.setState({ activeProviderId: 'local', currentTrack: null, starting: null });
  });

  it('is named while the provider it belongs to is still coming up', async () => {
    const track = song('sp:1', 'spotify');
    const started = usePlayerStore.getState().playSingle(track);

    // Let the authentication check and the provider switch get as far as the
    // one thing that is holding: the provider coming up.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(usePlayerStore.getState().currentTrack).toBeNull();
    expect(usePlayerStore.getState().starting).toBe('sp:1');

    spotify.comeUp();
    await started;

    expect(usePlayerStore.getState().currentTrack?.id).toBe('sp:1');
    expect(usePlayerStore.getState().starting).toBeNull();
  });

  it('is nothing at all once the track is playing', async () => {
    await usePlayerStore.getState().playSingle(song('local:1', 'local'));
    expect(usePlayerStore.getState().currentTrack?.id).toBe('local:1');
    expect(usePlayerStore.getState().starting).toBeNull();
  });

  it('is cleared even when the track never starts', async () => {
    // Signed out, so the Spotify path refuses at the door. The flag has to go
    // with it, or the deck waits for a record that is not coming.
    const auth = await import('@/core/security/spotifyAuth');
    vi.mocked(auth.isAuthenticated).mockResolvedValueOnce(false);

    await usePlayerStore.getState().playSingle(song('sp:2', 'spotify'));

    expect(usePlayerStore.getState().starting).toBeNull();
    expect(usePlayerStore.getState().error).toBeTruthy();
  });
});
