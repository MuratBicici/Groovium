import { usePlayerStore } from '@/core/store';
import { LyricsClock } from './clock';

/**
 * The one clock the lyrics are read against.
 *
 * Shared by both views for the reason the lookup is: while lyrics move between
 * the player and the drawer both are on screen, and two clocks fed from the
 * same reports would still disagree by however far apart they happened to be
 * read. Fed only while lyrics are on — see `followPlayer`.
 */
export const playhead = new LyricsClock();

/** Where the song is now, to the millisecond. */
export function playheadMs(): number {
  return playhead.at(performance.now());
}

/**
 * Feed the clock from the player's reports until the returned function is
 * called. Every change to the player store is a report: the position is read
 * each time, and the clock only moves when it disagrees by enough to be a
 * seek — see `LyricsClock.observe`.
 */
export function followPlayer(): () => void {
  const feed = () => {
    const s = usePlayerStore.getState();
    playhead.observe(s.positionMs, s.playbackState === 'PLAYING', performance.now());
  };
  feed();
  return usePlayerStore.subscribe(feed);
}

/** Go to a line: the clock jumps at once, and the player follows. */
export function seekLyrics(ms: number): void {
  playhead.seekTo(ms, performance.now());
  void usePlayerStore.getState().seek(ms);
}
