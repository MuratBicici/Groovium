import type { TrackMetadata } from '@/core/types';
import { usePlaylistPicker } from './PlaylistPicker';

interface AddToPlaylistProps {
  track: TrackMetadata;
  /** Slightly larger and always visible, for the now-playing track. */
  prominent?: boolean;
}

/**
 * Trigger for the shared playlist picker.
 *
 * Only a button: the list of playlists is rendered once at shell level. Keeping
 * the menu out of here is what stopped it being clipped by scrolling lists and
 * reappearing over rows it did not belong to.
 */
export function AddToPlaylist({ track, prominent }: AddToPlaylistProps) {
  const { pick } = usePlaylistPicker();

  return (
    <button
      type="button"
      aria-label={`Add ${track.title} to a playlist`}
      title="Add to playlist"
      onClick={() => pick(track)}
      className={
        prominent
          ? 'flex h-6 w-6 items-center justify-center rounded-full bg-shell-700 text-cream-300 transition-colors hover:bg-brass-600 hover:text-shell-900'
          : 'flex h-5 w-5 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50'
      }
    >
      <svg
        viewBox="0 0 24 24"
        className={prominent ? 'h-3.5 w-3.5' : 'h-3 w-3'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        aria-hidden="true"
      >
        <path d="M12 6v12M6 12h12" strokeLinecap="round" />
      </svg>
    </button>
  );
}
