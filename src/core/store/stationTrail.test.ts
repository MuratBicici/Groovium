import { beforeEach, describe, expect, it } from 'vitest';
import { usePlayerStore } from './playerStore';
import { registerProvider } from '@/core/providers/registry';
import type {
  AudioProvider,
  PlaybackState,
  ProviderEvent,
  ProviderEventListener,
  TrackMetadata,
} from '@/core/types';

/**
 * The station appends its picks to the collection, and the toggle governs them.
 *
 * Appending is deliberate — it is what keeps `previous` working, so a run reads
 * back as one growing collection. The cost is that once a pick is in
 * `playback.tracks` nothing tells it apart from a song someone chose. Search for
 * a track, press next twice, walk back to the first, switch infinite play off,
 * and let it end: it carried on into the trail, because by then "the next
 * track" was all there was to go on.
 */

const track = (id: string, title: string): TrackMetadata => ({
  id,
  title,
  artist: 'Someone',
  album: '',
  duration: 200000,
  source: 'local',
});

const CHOSEN = track('l:1', 'The one that was searched for');
const TRAIL = [track('l:2', 'Station pick one'), track('l:3', 'Station pick two')];

/** A provider that does nothing but let a test say "the track finished". */
class FakeProvider implements AudioProvider {
  readonly id = 'local' as const;
  readonly displayName = 'Fake';
  private listeners = new Set<ProviderEventListener>();

  emit(event: ProviderEvent): void {
    for (const listener of this.listeners) listener(event);
  }

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
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  dispose(): void {
    this.listeners.clear();
  }
}

const provider = new FakeProvider();

/** `handleTrackEnded` is async and fired from a listener, so let it finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Playing the first track of a collection the station has extended by two. */
function atTheStartOfAnExtendedRun(station: boolean) {
  usePlayerStore.setState({
    playback: { id: 'single', tracks: [CHOSEN, ...TRAIL], index: 0 },
    currentTrack: CHOSEN,
    stationAdded: TRAIL.map((t) => t.id),
    playbackState: 'PLAYING',
    repeat: 'off',
    shuffle: false,
    shuffleOrder: [],
    station,
    stationQueue: [],
    error: null,
  });
}

describe('a track ending inside a station trail', () => {
  beforeEach(async () => {
    registerProvider(provider);
    await usePlayerStore.getState().setActiveProvider('local');
  });

  it('stops when infinite play is off', async () => {
    atTheStartOfAnExtendedRun(false);

    provider.emit({ type: 'ended', trackId: CHOSEN.id });
    await settle();

    expect(usePlayerStore.getState().currentTrack?.title).toBe(CHOSEN.title);
    expect(usePlayerStore.getState().playbackState).toBe('IDLE');
  });

  it('carries on when infinite play is on', async () => {
    atTheStartOfAnExtendedRun(true);

    provider.emit({ type: 'ended', trackId: CHOSEN.id });
    await settle();

    expect(usePlayerStore.getState().currentTrack?.title).toBe('Station pick one');
  });

  it('still plays through a collection someone chose, with the toggle off', async () => {
    // The toggle was never about these. A playlist plays to its end whether or
    // not the station is armed, and this is what keeps that true.
    atTheStartOfAnExtendedRun(false);
    usePlayerStore.setState({ stationAdded: [] });

    provider.emit({ type: 'ended', trackId: CHOSEN.id });
    await settle();

    expect(usePlayerStore.getState().currentTrack?.title).toBe('Station pick one');
  });
});
