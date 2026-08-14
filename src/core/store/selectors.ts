import { usePlayerStore } from './playerStore';

/**
 * Narrow selector hooks.
 *
 * Components subscribe through these rather than pulling the whole store, so a
 * progress tick re-renders the progress bar and nothing else. Each returns a
 * primitive or a stable reference, which is what keeps Zustand's default
 * identity comparison correct here.
 */

export const usePlaybackState = () => usePlayerStore((s) => s.playbackState);
export const useCurrentTrack = () => usePlayerStore((s) => s.currentTrack);
export const usePositionMs = () => usePlayerStore((s) => s.positionMs);
export const useDurationMs = () => usePlayerStore((s) => s.durationMs);
export const useVolume = () => usePlayerStore((s) => s.volume);
export const useMuted = () => usePlayerStore((s) => s.muted);
export const useQueue = () => usePlayerStore((s) => s.queue);
export const useQueueIndex = () => usePlayerStore((s) => s.queueIndex);
export const useRepeatMode = () => usePlayerStore((s) => s.repeat);
export const useShuffle = () => usePlayerStore((s) => s.shuffle);
export const usePlayerError = () => usePlayerStore((s) => s.error);
export const useActiveProviderId = () => usePlayerStore((s) => s.activeProviderId);

/** True while a track is actually producing sound. */
export const useIsPlaying = () => usePlayerStore((s) => s.playbackState === 'PLAYING');

/** 0..1 fraction of the current track elapsed. */
export const useProgressFraction = () =>
  usePlayerStore((s) => (s.durationMs > 0 ? Math.min(s.positionMs / s.durationMs, 1) : 0));

/**
 * Actions are stable for the lifetime of the store, so grabbing them one at a
 * time avoids the object-identity re-render trap of returning a fresh object.
 */
export const usePlayerActions = () => ({
  initialize: usePlayerStore((s) => s.initialize),
  setActiveProvider: usePlayerStore((s) => s.setActiveProvider),
  setQueue: usePlayerStore((s) => s.setQueue),
  enqueue: usePlayerStore((s) => s.enqueue),
  clearQueue: usePlayerStore((s) => s.clearQueue),
  playAt: usePlayerStore((s) => s.playAt),
  togglePlayPause: usePlayerStore((s) => s.togglePlayPause),
  next: usePlayerStore((s) => s.next),
  previous: usePlayerStore((s) => s.previous),
  seek: usePlayerStore((s) => s.seek),
  setVolume: usePlayerStore((s) => s.setVolume),
  toggleMute: usePlayerStore((s) => s.toggleMute),
  cycleRepeat: usePlayerStore((s) => s.cycleRepeat),
  toggleShuffle: usePlayerStore((s) => s.toggleShuffle),
  clearError: usePlayerStore((s) => s.clearError),
});
