import { useCurrentTrack, usePlaybackState } from '@/core/store';

const STATE_LABEL: Record<string, string> = {
  IDLE: 'Ready',
  LOADING: 'Loading',
  PLAYING: 'Now Playing',
  PAUSED: 'Paused',
  ERROR: 'Error',
};

export function TrackDisplay() {
  const track = useCurrentTrack();
  const playbackState = usePlaybackState();

  return (
    <div className="px-4 text-center">
      <p className="text-[9px] font-medium tracking-[0.2em] text-brass-400/70 uppercase">
        {STATE_LABEL[playbackState] ?? playbackState}
      </p>

      {/* Nothing sits beside the title on purpose: the block is centred, and a
          control next to it pulls the text off-centre. Saving the current track
          lives in the controls row instead. */}
      <h1 className="mt-1 truncate text-[15px] leading-tight font-semibold text-cream-50">
        {track?.title ?? 'No track loaded'}
      </h1>

      <p className="mt-0.5 truncate text-xs text-cream-400">
        {track ? `${track.artist} — ${track.album}` : 'Add songs to your library to get started'}
      </p>
    </div>
  );
}
