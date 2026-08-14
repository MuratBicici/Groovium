import { create } from 'zustand';
import type {
  AudioProvider,
  PlaybackState,
  ProviderEvent,
  SourceType,
  TrackMetadata,
} from '@/core/types';
import {
  LocalAudioProvider,
  SpotifyProvider,
  YTMusicProvider,
  AppleMusicProvider,
  registerProvider,
  getProvider,
} from '@/core/providers';
import { clamp } from '@/core/utils/time';
import { volumeToAmplitude } from '@/core/utils/volume';

export type RepeatMode = 'off' | 'one' | 'all';

/** Treat a `previous` press past this point as "restart the track" instead. */
const RESTART_THRESHOLD_MS = 3000;

export interface PlayerState {
  activeProviderId: SourceType;
  currentTrack: TrackMetadata | null;
  playbackState: PlaybackState;
  positionMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  queue: TrackMetadata[];
  queueIndex: number;
  /** Playback order when shuffle is on. Holds indices into `queue`. */
  shuffleOrder: number[];
  repeat: RepeatMode;
  shuffle: boolean;
  error: string | null;
  initialized: boolean;
}

export interface PlayerActions {
  /** Register providers and attach to the local one. Safe to call twice. */
  initialize: () => Promise<void>;
  setActiveProvider: (id: SourceType) => Promise<void>;

  setQueue: (tracks: TrackMetadata[], startIndex?: number) => Promise<void>;
  enqueue: (tracks: TrackMetadata[]) => void;
  clearQueue: () => void;

  playAt: (index: number) => Promise<void>;
  togglePlayPause: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;

  setVolume: (volume: number) => Promise<void>;
  toggleMute: () => Promise<void>;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  clearError: () => void;
}

export type PlayerStore = PlayerState & PlayerActions;

/**
 * Subscription to the active provider's event stream.
 *
 * Module-level rather than in state: it is a teardown function, not something
 * the UI ever renders.
 */
let unsubscribeFromProvider: (() => void) | null = null;
/**
 * The exact instance the subscription belongs to. Compared by identity rather
 * than by id, so re-registering a provider (hot reload, tests) correctly
 * re-subscribes instead of holding a handle on a disposed instance.
 */
let subscribedProvider: AudioProvider | null = null;

const initialState: PlayerState = {
  activeProviderId: 'local',
  currentTrack: null,
  playbackState: 'IDLE',
  positionMs: 0,
  durationMs: 0,
  volume: 0.8,
  muted: false,
  queue: [],
  queueIndex: -1,
  shuffleOrder: [],
  repeat: 'off',
  shuffle: false,
  error: null,
  initialized: false,
};

export const usePlayerStore = create<PlayerStore>()((set, get) => {
  /**
   * Amplitude to hand a provider for the current volume/mute state.
   *
   * `state.volume` is what the control shows — a perceptual position. Providers
   * take linear amplitude, so the curve is applied once, here, at the boundary.
   */
  function outputAmplitude(): number {
    const { muted, volume } = get();
    return muted ? 0 : volumeToAmplitude(volume);
  }

  /** Playback order: shuffled indices, or plain 0..n-1. */
  function playbackOrder(): number[] {
    const { shuffle, shuffleOrder, queue } = get();
    if (shuffle && shuffleOrder.length === queue.length) return shuffleOrder;
    return queue.map((_, index) => index);
  }

  /**
   * Resolve the queue index `step` positions away from the current one.
   * Returns null when that would run off the end and repeat is not 'all'.
   */
  function neighborIndex(step: number): number | null {
    const { queue, queueIndex, repeat } = get();
    if (queue.length === 0) return null;

    const order = playbackOrder();
    const current = order.indexOf(queueIndex);
    const position = current === -1 ? 0 : current + step;

    if (position < 0 || position >= order.length) {
      if (repeat !== 'all') return null;
      const wrapped = ((position % order.length) + order.length) % order.length;
      return order[wrapped] ?? null;
    }
    return order[position] ?? null;
  }

  /** Called when the provider reports the current track finished. */
  async function handleTrackEnded(): Promise<void> {
    const { repeat, queueIndex } = get();

    if (repeat === 'one' && queueIndex >= 0) {
      await get().playAt(queueIndex);
      return;
    }

    const nextIndex = neighborIndex(1);
    if (nextIndex === null) {
      // End of queue: stop cleanly rather than leaving a stale PLAYING state.
      set({ playbackState: 'IDLE', positionMs: 0 });
      return;
    }
    await get().playAt(nextIndex);
  }

  function handleProviderEvent(event: ProviderEvent): void {
    switch (event.type) {
      case 'state':
        set({ playbackState: event.state });
        break;
      case 'progress':
        set({
          positionMs: event.positionMs,
          // Providers report 0 before metadata lands; keep the known duration.
          durationMs: event.durationMs > 0 ? event.durationMs : get().durationMs,
        });
        break;
      case 'track':
        set({ currentTrack: event.track });
        break;
      case 'error':
        set({ error: event.error });
        break;
      case 'ended':
        void handleTrackEnded();
        break;
    }
  }

  /** Run a provider command, routing failures into `error` instead of throwing. */
  async function withProvider(
    action: (provider: NonNullable<ReturnType<typeof getProvider>>) => Promise<void>,
  ): Promise<void> {
    const provider = getProvider(get().activeProviderId);
    if (!provider) {
      set({ error: `No provider registered for "${get().activeProviderId}".` });
      return;
    }
    try {
      await action(provider);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    ...initialState,

    async initialize() {
      if (get().initialized) return;

      registerProvider(new LocalAudioProvider());
      registerProvider(new SpotifyProvider());
      registerProvider(new YTMusicProvider());
      registerProvider(new AppleMusicProvider());

      set({ initialized: true });
      await get().setActiveProvider('local');
    },

    async setActiveProvider(id) {
      const provider = getProvider(id);
      if (!provider) {
        set({ error: `No provider registered for "${id}".` });
        return;
      }
      if (subscribedProvider === provider) return;

      unsubscribeFromProvider?.();
      unsubscribeFromProvider = provider.subscribe(handleProviderEvent);
      subscribedProvider = provider;
      set({
        activeProviderId: id,
        currentTrack: null,
        playbackState: 'IDLE',
        positionMs: 0,
        durationMs: 0,
        error: null,
      });

      const ready = await provider.initialize();
      if (!ready) {
        set({ error: `${provider.displayName} is unavailable.` });
        return;
      }
      await provider.setVolume(outputAmplitude());
    },

    async setQueue(tracks, startIndex) {
      set({
        queue: tracks,
        queueIndex: -1,
        shuffleOrder: get().shuffle ? shuffledIndices(tracks.length) : [],
      });
      if (startIndex !== undefined && tracks.length > 0) {
        await get().playAt(startIndex);
      }
    },

    enqueue(tracks) {
      if (tracks.length === 0) return;
      const queue = [...get().queue, ...tracks];
      set({
        queue,
        shuffleOrder: get().shuffle ? shuffledIndices(queue.length) : [],
      });
    },

    clearQueue() {
      void withProvider((provider) => provider.pause());
      set({
        queue: [],
        queueIndex: -1,
        shuffleOrder: [],
        currentTrack: null,
        playbackState: 'IDLE',
        positionMs: 0,
        durationMs: 0,
      });
    },

    async playAt(index) {
      const track = get().queue[index];
      if (!track) return;

      set({ queueIndex: index, positionMs: 0, durationMs: track.duration, error: null });
      await withProvider((provider) => provider.play(track.id));
    },

    async togglePlayPause() {
      const { playbackState, queue, queueIndex } = get();

      if (playbackState === 'PLAYING') {
        await withProvider((provider) => provider.pause());
        return;
      }
      if (playbackState === 'PAUSED') {
        await withProvider((provider) => provider.resume());
        return;
      }
      // IDLE or ERROR: start from where the queue left off, or the top.
      if (queue.length > 0) {
        await get().playAt(queueIndex >= 0 ? queueIndex : 0);
      }
    },

    async next() {
      const index = neighborIndex(1);
      if (index === null) return;
      await get().playAt(index);
    },

    async previous() {
      // Matches every other player: a first press restarts the current track.
      if (get().positionMs > RESTART_THRESHOLD_MS) {
        await get().seek(0);
        return;
      }
      const index = neighborIndex(-1);
      if (index === null) {
        await get().seek(0);
        return;
      }
      await get().playAt(index);
    },

    async seek(positionMs) {
      const target = clamp(positionMs, 0, get().durationMs || positionMs);
      set({ positionMs: target });
      await withProvider((provider) => provider.seek(target));
    },

    async setVolume(volume) {
      const next = clamp(volume, 0, 1);
      // Nudging the slider is an implicit unmute.
      set({ volume: next, muted: next === 0 ? get().muted : false });
      await withProvider((provider) => provider.setVolume(outputAmplitude()));
    },

    async toggleMute() {
      set({ muted: !get().muted });
      await withProvider((provider) => provider.setVolume(outputAmplitude()));
    },

    cycleRepeat() {
      const order: RepeatMode[] = ['off', 'all', 'one'];
      const nextMode = order[(order.indexOf(get().repeat) + 1) % order.length];
      set({ repeat: nextMode ?? 'off' });
    },

    toggleShuffle() {
      const shuffle = !get().shuffle;
      set({
        shuffle,
        shuffleOrder: shuffle ? shuffledIndices(get().queue.length, get().queueIndex) : [],
      });
    },

    clearError() {
      set({ error: null });
    },
  };
});

/**
 * Fisher-Yates over queue indices.
 *
 * When a track is already playing it is pinned to the front, so toggling shuffle
 * mid-track reorders what comes next without interrupting what is playing.
 */
function shuffledIndices(length: number, pinnedIndex = -1): number[] {
  const indices = Array.from({ length }, (_, i) => i);

  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = indices[i] as number;
    const b = indices[j] as number;
    indices[i] = b;
    indices[j] = a;
  }

  if (pinnedIndex >= 0) {
    const at = indices.indexOf(pinnedIndex);
    if (at > 0) {
      indices.splice(at, 1);
      indices.unshift(pinnedIndex);
    }
  }
  return indices;
}
