import type { TrackMetadata } from '@/core/types';
import { usePlaylistPicker } from './PlaylistPicker';
import { useT } from '@/core/i18n';

interface AddToPlaylistProps {
  /**
   * Null renders the button disabled rather than absent.
   *
   * Only the transport row passes null, and it matters there: the control has
   * to hold its place with nothing playing, or the row loses its symmetry every
   * time playback stops.
   */
  track: TrackMetadata | null;
  /** `transport` matches the sibling toggles in the transport row. */
  variant?: 'row' | 'transport';
}

/**
 * Trigger for the shared playlist picker.
 *
 * Only a button: the list of playlists is rendered once at shell level. Keeping
 * the menu out of here is what stopped it being clipped by scrolling lists and
 * reappearing over rows it did not belong to.
 */
export function AddToPlaylist({ track, variant = 'row' }: AddToPlaylistProps) {
  const t = useT();
  const { pick } = usePlaylistPicker();
  const inTransport = variant === 'transport';

  return (
    <button
      type="button"
      aria-label={track ? t('playlists.addNamed', { title: track.title }) : t('playlists.add')}
      title={t('playlists.add')}
      disabled={!track}
      onClick={() => track && pick(track)}
      className={
        inTransport
          ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-cream-400 transition-colors hover:text-cream-200 disabled:opacity-35 disabled:hover:text-cream-400'
          : 'flex h-5 w-5 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50'
      }
    >
      <svg
        viewBox="0 0 24 24"
        className={inTransport ? 'h-4 w-4' : 'h-3 w-3'}
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
