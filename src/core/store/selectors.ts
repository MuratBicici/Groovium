import { stepWithin, usePlayerStore, type PlayerState } from './playerStore';

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

/** True while the record is off the deck, in someone's hand. */
export const useHoldingRecord = () => usePlayerStore((s) => s.holdingRecord);

/** True when there is something to press play on. */
export const useHasPlayback = () => usePlayerStore((s) => s.playback.tracks.length > 0);

/**
 * Whether a song has been asked for and nothing is playing it yet.
 *
 * The provider saying it is loading is only half of it. Before a song gets
 * that far there can be a provider to bring up — on the first Spotify song of
 * a launch that is the SDK loading, a token and a device to claim, seconds of
 * it — and the store says IDLE through all of that, because no provider is
 * doing anything yet. The track was already on its way: `starting` said so.
 * Read from the state alone, the window said "Ready" over a record it had just
 * been handed and drew no light on the bar.
 *
 * A song still playing while the next is fetched is not a wait: the music has
 * not stopped, and saying "Loading" over it would be wrong for those seconds.
 */
export function awaitingSound(s: Pick<PlayerState, 'playbackState' | 'starting'>): boolean {
  if (s.playbackState === 'LOADING') return true;
  return s.starting !== null && s.playbackState !== 'PLAYING';
}

export const useAwaitingSound = () => usePlayerStore(awaitingSound);

/** 0..1 fraction of the current track elapsed. */
export const useProgressFraction = () =>
  usePlayerStore((s) => (s.durationMs > 0 ? Math.min(s.positionMs / s.durationMs, 1) : 0));

/**
 * The covers likely to be on the deck next, one address a line.
 *
 * What is being started, what Next and Previous would land on — in the order
 * shuffle and repeat make — and what the station would play when this ends.
 * Loaded ahead of their turn, so a record arrives with its sleeve on and its
 * colours already read. A string rather than a list so that it only changes
 * when one of them does.
 */
export function upcomingCovers(s: PlayerState): string {
  const { playback, shuffle, shuffleOrder, repeat } = s;
  const order =
    shuffle && shuffleOrder.length === playback.tracks.length
      ? shuffleOrder
      : playback.tracks.map((_, index) => index);
  const wrap = repeat === 'all';
  const near = [
    s.starting,
    ...[1, -1].map((step) => {
      const index = stepWithin(order, playback.index, step, wrap);
      return index === null ? null : playback.tracks[index];
    }),
    s.stationQueue[0],
  ];
  const covers = near.map((track) => track?.coverArtUrl).filter((url): url is string => !!url);
  return [...new Set(covers)].join('\n');
}
