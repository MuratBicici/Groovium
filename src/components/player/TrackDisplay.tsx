import { useCurrentTrack, usePlaybackState } from '@/core/store';
import { useT } from '@/core/i18n';

export function TrackDisplay() {
  const t = useT();
  const track = useCurrentTrack();
  const playbackState = usePlaybackState();

  return (
    <div className="px-4 text-center">
      <p className="text-label font-medium tracking-[0.2em] text-brass-400/70 uppercase">
        {t(`status.${playbackState}`)}
      </p>

      {/* Nothing sits beside the title on purpose: the block is centred, and a
          control next to it pulls the text off-centre. Saving the current track
          lives in the controls row instead. */}
      <h1 className="mt-1 truncate text-title leading-tight font-semibold text-cream-50">
        {track?.title ?? t('track.none')}
      </h1>

      <p className="mt-0.5 truncate text-xs text-cream-400">
        {track ? `${track.artist} — ${track.album}` : t('track.hint')}
      </p>
    </div>
  );
}
