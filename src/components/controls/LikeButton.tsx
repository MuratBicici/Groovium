import { useEffect } from 'react';
import type { TrackMetadata } from '@/core/types';
import { usePlaylistPicker } from '@/components/playlists/PlaylistPicker';
import { explainHeartOnce, learnLiked, setLiked, useLikes } from '@/core/spotify/likes';
import { useT } from '@/core/i18n';

/**
 * The heart on the deck, where the plus was.
 *
 * Pressed, it likes the song on the deck on Spotify, or takes the like back.
 * Right-clicked, it opens what the plus opened: the playlists to add the song
 * to. The first press says so, once, instead of saying what it did.
 *
 * A song from this computer has no Spotify library to go into, so a press on
 * one opens the playlists, as the plus always did.
 */
export function LikeButton({ track }: { track: TrackMetadata | null }) {
  const t = useT();
  const { pick } = usePlaylistPicker();
  const spotify = track?.source === 'spotify';
  const liked = useLikes((s) => (track ? s.saved[track.id] === true : false));
  const id = track?.id;

  useEffect(() => {
    if (id && spotify) void learnLiked([id]);
  }, [id, spotify]);

  return (
    <button
      type="button"
      aria-pressed={spotify ? liked : undefined}
      aria-label={
        !track
          ? t('like.like')
          : !spotify
            ? t('playlists.addNamed', { title: track.title })
            : liked
              ? t('like.unlikeNamed', { title: track.title })
              : t('like.likeNamed', { title: track.title })
      }
      title={spotify ? t('like.title') : t('playlists.add')}
      disabled={!track}
      onClick={() => {
        if (!track) return;
        if (!spotify) {
          pick(track);
          return;
        }
        const first = explainHeartOnce();
        void setLiked(track.id, !liked, 'song', first);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (track) pick(track);
      }}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-35 ${
        liked ? 'text-brass-400 hover:text-brass-300' : 'text-cream-400 hover:text-cream-200 disabled:hover:text-cream-400'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M12 20s-7.5-4.6-7.5-10.1A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" />
      </svg>
    </button>
  );
}
