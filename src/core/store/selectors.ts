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
export const useRepeatMode = () => usePlayerStore((s) => s.repeat);
export const useShuffle = () => usePlayerStore((s) => s.shuffle);
export const usePlayerError = () => usePlayerStore((s) => s.error);
export const useActiveProviderId = () => usePlayerStore((s) => s.activeProviderId);

export const useLibrary = () => usePlayerStore((s) => s.library);
export const usePlaylists = () => usePlayerStore((s) => s.playlists);
export const usePlayback = () => usePlayerStore((s) => s.playback);
export const useImporting = () => usePlayerStore((s) => s.importing);

export const useStation = () => usePlayerStore((s) => s.station);
export const useStationSearching = () => usePlayerStore((s) => s.stationSearching);

/** True while a track is actually producing sound. */
export const useIsPlaying = () => usePlayerStore((s) => s.playbackState === 'PLAYING');

/** True when there is something to press play on. */
export const useHasPlayback = () => usePlayerStore((s) => s.playback.tracks.length > 0);

/** 0..1 fraction of the current track elapsed. */
export const useProgressFraction = () =>
  usePlayerStore((s) => (s.durationMs > 0 ? Math.min(s.positionMs / s.durationMs, 1) : 0));
