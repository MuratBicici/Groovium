import { useCurrentTrack, useIsPlaying, usePlaybackState } from '@/core/store';
import { useT } from '@/core/i18n';
import { VinylDisc } from './VinylDisc';

/**
 * What is playing.
 *
 * Two shapes for two window sizes. Expanded, the record is on the platter above
 * and this is a centred block of text. Collapsed, the platter is gone, so the
 * record comes down here at 28px — the same `VinylDisc` the row lists use, at a
 * third size. It spins with `.groove-spin` rather than `.groove-platter`; see
 * the note in `styles.css` for why those are two names.
 */
export function TrackDisplay({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const track = useCurrentTrack();
  const playbackState = usePlaybackState();
  const isPlaying = useIsPlaying();

  if (compact) {
    return (
      <div className="flex items-center gap-2.5 px-4">
        {/* The `data-morph` wrapper does not spin; see the note in
            `DiskPlatter` for why that matters to the measurement. */}
        <span data-morph="disc" className="shrink-0">
          <span className="groove-spin block" data-spinning={isPlaying}>
            <VinylDisc size={28} coverArtUrl={track?.coverArtUrl} />
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span data-morph="title" className="block truncate text-body font-semibold text-cream-50">
            {track?.title ?? t('track.none')}
          </span>
          <span data-morph="artist" className="block truncate text-meta text-cream-400">
            {track ? track.artist : t('status.IDLE')}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="px-4 text-center">
      <p className="text-label font-medium tracking-[0.2em] text-brass-400/70 uppercase">
        {t(`status.${playbackState}`)}
      </p>

      {/* Nothing sits beside the title on purpose: the block is centred, and a
          control next to it pulls the text off-centre. Saving the current track
          lives in the controls row instead. */}
      <h1
        data-morph="title"
        className="mt-1 truncate text-title leading-tight font-semibold text-cream-50"
      >
        {track?.title ?? t('track.none')}
      </h1>

      <p data-morph="artist" className="mt-0.5 truncate text-xs text-cream-400">
        {track ? `${track.artist} — ${track.album}` : t('track.hint')}
      </p>
    </div>
  );
}
