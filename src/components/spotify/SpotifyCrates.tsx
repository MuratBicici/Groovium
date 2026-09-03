import { useEffect, useRef } from 'react';
import { useSpotifyPlaylistsStore } from '@/core/spotify/store';
import type { SpotifyPlaylist } from '@/core/providers/spotifyPlaylists';
import { useT } from '@/core/i18n';

/**
 * The shelf: someone's Spotify playlists, as record sleeves.
 *
 * Square, with the playlist's own artwork on the front, because that is what a
 * playlist looks like when it is a physical thing — and the drawer is wide
 * enough for a shelf of them rather than a column of rows.
 *
 * Pages arrive as they are scrolled to. The trigger is a sentinel at the foot
 * of the grid rather than a scroll handler doing arithmetic: the browser
 * already knows when something has come into view, and asking it is both
 * cheaper and immune to the miscounting a hand-rolled threshold invites.
 */
export function SpotifyCrates() {
  const t = useT();
  const playlists = useSpotifyPlaylistsStore((s) => s.playlists);
  const loading = useSpotifyPlaylistsStore((s) => s.loading);
  const started = useSpotifyPlaylistsStore((s) => s.started);
  const cursor = useSpotifyPlaylistsStore((s) => s.cursor);
  const error = useSpotifyPlaylistsStore((s) => s.error);
  const open = useSpotifyPlaylistsStore((s) => s.open);
  const more = useSpotifyPlaylistsStore((s) => s.more);

  useEffect(() => {
    void open();
  }, [open]);

  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const foot = sentinel.current;
    // Nothing to watch for once the list has ended.
    if (!foot || !cursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void more();
      },
      // A page early, so the next crates are usually there by the time the
      // shelf has been scrolled to where they go.
      { rootMargin: '200px' },
    );
    observer.observe(foot);
    return () => observer.disconnect();
  }, [cursor, more]);

  if (error) {
    return (
      <p className="shrink-0 rounded bg-red-950/70 px-2 py-1.5 text-meta leading-snug text-red-200">
        {error}
      </p>
    );
  }

  if (playlists.length === 0) {
    return (
      <p className="shrink-0 px-1 py-2 text-meta leading-snug text-cream-400/70">
        {started && !loading ? t('spotify.noPlaylists') : t('spotify.loadingPlaylists')}
      </p>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto groove-scroll-fade">
      <div
        className="grid gap-2 pb-2"
        // Sized rather than counted in columns, so the shelf keeps its
        // proportions if the drawer is ever a different width.
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}
      >
        {playlists.map((playlist) => (
          <Crate key={playlist.id} playlist={playlist} />
        ))}
      </div>
      <div ref={sentinel} aria-hidden="true" className="h-px" />
      {loading && (
        <p className="py-2 text-center text-meta text-cream-400/70">
          {t('spotify.loadingPlaylists')}
        </p>
      )}
    </div>
  );
}

/**
 * One sleeve.
 *
 * Not a button yet — opening one is the next piece of work, and a square that
 * depresses under the pointer and then does nothing is a worse promise than a
 * square that does not.
 */
function Crate({ playlist }: { playlist: SpotifyPlaylist }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1">
      <div className="relative aspect-square w-full overflow-hidden rounded-md groove-inset ring-1 ring-[var(--color-edge)]">
        {playlist.coverArtUrl ? (
          <img
            src={playlist.coverArtUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          // A sleeve with nothing printed on it. The initial rather than a
          // generic icon: on a shelf of them, the letter is what tells two
          // blank sleeves apart at a glance.
          <span
            aria-hidden="true"
            className="flex h-full w-full items-center justify-center text-title font-medium text-brass-400/50"
          >
            {playlist.name.trim().charAt(0).toUpperCase() || '♪'}
          </span>
        )}
      </div>
      <span className="truncate text-meta text-cream-200" title={playlist.name}>
        {playlist.name}
      </span>
      <span className="truncate text-label text-cream-400">
        {t('spotify.trackCount', { count: playlist.trackCount })}
      </span>
    </div>
  );
}
