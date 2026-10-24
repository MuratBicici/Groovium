import { useEffect, useState } from 'react';
import { albumTracks, type SpotifyAlbum } from '@/core/providers/spotifyApi';
import type { TrackMetadata } from '@/core/types';
import { usePlayerStore } from '@/core/store';
import { errorText } from '@/core/utils/errorText';
import { useT } from '@/core/i18n';
import { Hint, TrackResult } from './SearchParts';

/**
 * An album opened from the search, inside it: its cover and name, a button to
 * play all of it, and its songs.
 *
 * Laid out as an opened crate is, so an album looks like the other lists of
 * songs in the app — but it is not one of yours, so there is nothing here to
 * edit, and it is not kept on the shelf. The way back is to the results.
 *
 * Played whole, it is the deck's list from its first song, as a crate is; a
 * song pressed on its own plays on its own, as one pressed in a crate does.
 */
export function SearchAlbum({
  album,
  onBack,
  onPlayed,
}: {
  album: SpotifyAlbum;
  onBack: () => void;
  /** Something from it was played: the search can fold away. */
  onPlayed: () => void;
}) {
  const t = useT();
  const playList = usePlayerStore((s) => s.playList);
  const playSingle = usePlayerStore((s) => s.playSingle);
  const [songs, setSongs] = useState<{ for: string; tracks: TrackMetadata[] } | null>(null);
  const [problem, setProblem] = useState<{ for: string; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    albumTracks(album).then(
      (tracks) => {
        if (live) setSongs({ for: album.id, tracks });
      },
      (err: unknown) => {
        if (live) setProblem({ for: album.id, text: errorText(err) });
      },
    );
    return () => {
      live = false;
    };
  }, [album]);

  const tracks = songs?.for === album.id ? songs.tracks : null;
  const failed = problem?.for === album.id ? problem.text : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <button
        data-swap
        type="button"
        onClick={onBack}
        className="flex w-fit items-center gap-1.5 text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase transition-colors hover:text-cream-50"
      >
        <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 shrink-0" aria-hidden="true">
          <path
            d="M6.5 1 2.5 5l4 4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        {t('search.backToResults')}
      </button>

      <div data-swap className="flex shrink-0 items-center gap-3">
        <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-shell-700 text-title font-semibold text-brass-400 ring-1 ring-[var(--color-edge)]">
          {album.coverArtUrl ? (
            <img
              src={album.coverArtUrl}
              crossOrigin="anonymous"
              alt=""
              draggable={false}
              className="h-full w-full object-cover"
            />
          ) : (
            album.name.trim().charAt(0).toUpperCase()
          )}
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
            {t('search.album')}
          </span>
          <span className="truncate text-title font-semibold text-cream-50">{album.name}</span>
          <span className="truncate text-meta text-cream-400">
            {[album.artist, album.year, t('spotify.trackCount', { count: album.trackCount })]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <button
            type="button"
            disabled={!tracks || tracks.length === 0}
            onClick={() => {
              if (!tracks) return;
              onPlayed();
              void playList(`spotify:album:${album.id}`, tracks);
            }}
            className="mt-1 flex w-fit items-center gap-1.5 rounded-full bg-brass-600 px-3 py-1 text-meta font-semibold text-on-accent transition-colors hover:bg-brass-500 disabled:opacity-50"
          >
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
              <path d="M2.5 1.5v7l6-3.5z" fill="currentColor" />
            </svg>
            {t('search.playAlbum')}
          </button>
        </span>
      </div>

      <ul className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {failed && <Hint>{failed}</Hint>}
        {!failed && !tracks && <Hint>{t('search.openingAlbum')}</Hint>}
        {tracks?.map((track) => (
          <TrackResult
            key={track.id}
            track={track}
            onPlay={() => {
              onPlayed();
              void playSingle(track);
            }}
          />
        ))}
      </ul>
    </div>
  );
}
