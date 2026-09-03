import { useEffect, useLayoutEffect, useRef } from 'react';
import type { TrackMetadata } from '@/core/types';
import type { SpotifyPlaylist } from '@/core/providers/spotifyPlaylists';
import { useSpotifyPlaylistsStore } from '@/core/spotify/store';
import { usePlayerStore } from '@/core/store';
import { useDiscFlight } from '@/components/player/DiscFlight';
import { VinylDisc } from '@/components/player/VinylDisc';
import { prefersReducedMotion } from '@/core/utils/motion';
import { useT } from '@/core/i18n';

/**
 * A crate, opened: its records out of the sleeve and laid on the shelf.
 *
 * Covers the drawer and nothing else. That is a requirement rather than a
 * preference — a record is meant to be draggable from here onto the deck, and
 * the deck has to be visible for there to be anywhere to drag it to.
 *
 * The records come out of the crate. Each one starts at the sleeve's own
 * position and size and travels to its place in the grid, a little after the
 * one before it, so what you see is a crate emptying rather than a grid
 * appearing.
 */

/** How long one record takes to reach its place. */
const FLIGHT_MS = 340;
/** The gap between one record leaving and the next. */
const STAGGER_MS = 26;
/**
 * How many records are staggered before the rest arrive together.
 *
 * A playlist of two hundred would otherwise take five seconds to finish
 * unpacking, and the last record would be a separate event from the first
 * rather than the end of the same one.
 */
const STAGGERED = 14;

const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

interface OpenCrateProps {
  playlist: SpotifyPlaylist;
  /** Where the sleeve was on screen, so the records can come out of it. */
  origin: { x: number; y: number; width: number; height: number };
  onClose: () => void;
}

export function OpenCrate({ playlist, origin, onClose }: OpenCrateProps) {
  const t = useT();
  const tracks = useSpotifyPlaylistsStore((s) => s.tracks);
  const loading = useSpotifyPlaylistsStore((s) => s.tracksLoading);
  const cursor = useSpotifyPlaylistsStore((s) => s.tracksCursor);
  const error = useSpotifyPlaylistsStore((s) => s.tracksError);
  const moreTracks = useSpotifyPlaylistsStore((s) => s.moreTracks);

  const playSingle = usePlayerStore((s) => s.playSingle);
  const { flyToPlatter } = useDiscFlight();

  const gridRef = useRef<HTMLDivElement | null>(null);
  /** How many records have already been played in; the rest are new. */
  const unpacked = useRef(0);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Capture phase and the immediate variant, as every other surface here
      // does: the shell listens on `window` too, and only this stops the one
      // press closing two things.
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  // The unpacking. A layout effect so the first frame is never the finished
  // grid — by the time anything is painted the records are already back at the
  // crate, waiting to leave it.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || prefersReducedMotion()) return;

    const discs = [...grid.querySelectorAll<HTMLElement>('[data-record]')];
    // Only the ones that have just arrived. A second page appended to the grid
    // must not send the first page back into the crate to come out again.
    const arriving = discs.slice(unpacked.current);
    unpacked.current = discs.length;

    for (const [i, el] of arriving.entries()) {
      const to = el.getBoundingClientRect();
      if (to.width === 0) continue;

      // From the sleeve's middle to this record's, at the sleeve's size. The
      // crate is square and so is a record, so one ratio covers both axes.
      const scale = origin.width / to.width;
      const dx = origin.x + origin.width / 2 - (to.left + to.width / 2);
      const dy = origin.y + origin.height / 2 - (to.top + to.height / 2);

      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0 },
          { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
        ],
        {
          duration: FLIGHT_MS,
          delay: Math.min(i, STAGGERED) * STAGGER_MS,
          easing: EASING,
          fill: 'backwards',
        },
      );
    }
  }, [tracks, origin]);

  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const foot = sentinel.current;
    if (!foot || !cursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void moreTracks();
      },
      { rootMargin: '200px' },
    );
    observer.observe(foot);
    return () => observer.disconnect();
  }, [cursor, moreTracks]);

  return (
    <div
      role="dialog"
      aria-label={playlist.name}
      // The whole drawer, and only the drawer. `inset-0` is the drawer's box
      // because this is rendered as its child — which is the point: an opened
      // crate *is* the Spotify side of the window for as long as it is open,
      // and the deck beside it stays visible and reachable, because a record
      // is meant to be dragged from here onto it.
      className="absolute inset-0 z-30 flex flex-col groove-surface backdrop-blur-sm"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
            {playlist.name}
          </p>
          <p className="mt-0.5 truncate text-meta text-cream-400">
            {t('spotify.trackCount', { count: playlist.trackCount })}
          </p>
        </div>
        <button
          type="button"
          aria-label={t('common.close')}
          title={t('common.close')}
          onClick={onClose}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
        >
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
            <path
              d="M1 1l8 8M9 1l-8 8"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {error && (
        <p className="mx-3 shrink-0 rounded bg-red-950/70 px-2 py-1.5 text-meta leading-snug text-red-200">
          {error}
        </p>
      )}

      <div ref={gridRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-2 groove-scroll-fade">
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))' }}
        >
          {tracks.map((track, index) => (
            <Record
              key={`${track.id}:${index}`}
              track={track}
              onPlay={(disc) => {
                if (disc) flyToPlatter(disc, track);
                void playSingle(track);
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
    </div>
  );
}

/** One record, at full size, with what it is written underneath. */
function Record({
  track,
  onPlay,
}: {
  track: TrackMetadata;
  onPlay: (disc: HTMLElement | null) => void;
}) {
  return (
    <button
      type="button"
      data-record
      onClick={(e) => onPlay(e.currentTarget.querySelector<HTMLElement>('[data-disc]'))}
      className="group/record flex flex-col items-center gap-1.5 rounded-md p-1 text-center transition-colors hover:bg-shell-700/50"
    >
      <span data-disc className="block transition-transform group-hover/record:scale-[1.03]">
        <VinylDisc size={112} coverArtUrl={track.coverArtUrl} />
      </span>
      <span className="w-full min-w-0">
        <span className="block truncate text-meta text-cream-100">{track.title}</span>
        <span className="block truncate text-label text-cream-400">{track.artist}</span>
      </span>
    </button>
  );
}
