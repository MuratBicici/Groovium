import { useEffect, useRef, useState } from 'react';
import { useSpotifyPlaylistsStore } from '@/core/spotify/store';
import type { SpotifyPlaylist } from '@/core/providers/spotifyPlaylists';
import { useT } from '@/core/i18n';
import { OpenCrate } from './OpenCrate';

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
  const openId = useSpotifyPlaylistsStore((s) => s.openId);
  const openCrate = useSpotifyPlaylistsStore((s) => s.openCrate);
  const closeCrate = useSpotifyPlaylistsStore((s) => s.closeCrate);

  /**
   * Where the sleeve was when it was opened.
   *
   * Measured at the click rather than looked up afterwards: by the time the
   * layer renders the records need somewhere to have come *from*, and that is
   * a rectangle which existed at the moment of the press.
   */
  const [origin, setOrigin] = useState<DOMRect | null>(null);
  const opened = playlists.find((p) => p.id === openId) ?? null;

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
    // `relative` is load-bearing: the open crate is `absolute inset-0` and
    // positions against the nearest positioned ancestor. Without it that is the
    // shell, and the layer would cover the deck — the one thing it must not do,
    // because a record is meant to be dragged from it onto the deck and there
    // would be nowhere to drop one.
    <div className="relative min-h-0 flex-1">
      <div className="h-full overflow-y-auto groove-scroll-fade">
      <div
        className="grid gap-2 pb-2"
        // Sized rather than counted in columns, so the shelf keeps its
        // proportions if the drawer is ever a different width.
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}
      >
        {playlists.map((playlist) => (
          <Crate
            key={playlist.id}
            playlist={playlist}
            onOpen={(rect) => {
              setOrigin(rect);
              void openCrate(playlist.id);
            }}
          />
        ))}
      </div>
      <div ref={sentinel} aria-hidden="true" className="h-px" />
      {loading && (
        <p className="py-2 text-center text-meta text-cream-400/70">
          {t('spotify.loadingPlaylists')}
        </p>
      )}
      </div>

      {opened && origin && <OpenCrate playlist={opened} origin={origin} onClose={closeCrate} />}
    </div>
  );
}

/** One sleeve, which opens to show what is in it. */
function Crate({
  playlist,
  onOpen,
}: {
  playlist: SpotifyPlaylist;
  onOpen: (rect: DOMRect) => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}
      className="flex flex-col gap-1 rounded-md text-left transition-transform hover:scale-[1.02]"
    >
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
    </button>
  );
}
