import { usePlayerStore } from '@/core/store';
import { Ear, noteHeard } from './history';

/**
 * Keep a log of what is listened to, until the returned function is called.
 *
 * Every report the player makes goes to one `Ear`, and a song is written down
 * at the moment it has been heard for long enough — see `Ear` for what counts.
 */
export function keepListening(): () => void {
  const ear = new Ear();
  const feed = () => {
    const s = usePlayerStore.getState();
    const track = s.currentTrack;
    if (ear.hear(track?.id ?? null, s.positionMs, s.durationMs, s.playbackState === 'PLAYING') && track) {
      noteHeard(track);
    }
  };
  feed();
  return usePlayerStore.subscribe(feed);
}
