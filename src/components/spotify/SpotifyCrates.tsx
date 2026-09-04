import { useCallback, useEffect, useRef } from 'react';
import { useSpotifyPlaylistsStore } from '@/core/spotify/store';
import type { SpotifyPlaylist } from '@/core/providers/spotifyPlaylists';
import type { TrackMetadata } from '@/core/types';
import { useDiscFlight } from '@/components/player/DiscFlight';
import { useCarriedTrack, useDiscHold } from '@/components/player/DiscHold';
import { useT } from '@/core/i18n';

/** How far the pointer travels before a press becomes a lift rather than a click. */
const DRAG_THRESHOLD = 5;

/**
 * A crate in the shape the hand carries things in.
 *
 * The hand takes records, and this is not one — it is the box. What it needs
 * from the thing it is holding is an id to tell one carry from another and a
 * picture to draw, and a crate has both. The id is namespaced so it can never
 * collide with a track's, and nothing downstream tries to play it: the crate's
 * own code hears about the drop and starts the crate.
 */
function asCargo(playlist: SpotifyPlaylist): TrackMetadata {
  return {
    id: `crate:${playlist.id}`,
    title: playlist.name,
    artist: playlist.ownerName,
    album: '',
    duration: 0,
    source: 'spotify',
    ...(playlist.coverArtUrl ? { coverArtUrl: playlist.coverArtUrl } : {}),
  };
}

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
  const openCrate = useSpotifyPlaylistsStore((s) => s.openCrate);
  const playCrate = useSpotifyPlaylistsStore((s) => s.playCrate);
  const starting = useSpotifyPlaylistsStore((s) => s.starting);
  const playError = useSpotifyPlaylistsStore((s) => s.playError);

  const { platterEl } = useDiscFlight();
  /**
   * The deck's own carry gesture again, this time holding a crate.
   *
   * There are no buttons on a sleeve. A record is played by taking it to the
   * deck, so a crate is too — the gesture is the one the app already has, and
   * the only difference is what ends up in the hand. Shuffling is not a
   * property of a crate and never was: it is the transport's own switch, and
   * it applies to whatever is on the deck.
   */
  const { grab, moveTo, release, cancel } = useDiscHold();
  const inHand = useCarriedTrack();

  const carry = useCallback(
    (playlist: SpotifyPlaylist, down: React.PointerEvent, sleeve: HTMLElement | null, lift: () => void) => {
      if (down.button !== 0 || !sleeve) return;
      const from = { x: down.clientX, y: down.clientY };
      let holding = false;

      const move = (e: PointerEvent) => {
        if (holding) {
          moveTo(e.clientX, e.clientY);
          return;
        }
        if (Math.hypot(e.clientX - from.x, e.clientY - from.y) < DRAG_THRESHOLD) return;
        holding = true;
        lift();
        grab({
          track: asCargo(playlist),
          look: 'sleeve',
          homeEl: sleeve,
          homeSize: sleeve.getBoundingClientRect().width,
          pointer: { x: e.clientX, y: e.clientY },
          // Straight back to its place on the shelf if it is put down anywhere
          // else. No mouth to come out of and none to go back into: a crate is
          // the sleeve, and there is nothing behind it to be hidden by.
          visiting: {
            deckEl: platterEl(),
            onDelivered: () => void playCrate(playlist.id),
          },
        });
      };

      const drop = (e: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', drop);
        window.removeEventListener('pointercancel', drop);
        if (!holding) return;
        if (e.type === 'pointerup') release();
        else cancel();
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', drop);
      window.addEventListener('pointercancel', drop);
    },
    [cancel, grab, moveTo, platterEl, playCrate, release],
  );

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
      {/* Above the shelf rather than instead of it: failing to play one crate
          says nothing about the others, and taking them off the screen to
          report it would be a worse answer than the one being reported. */}
      {playError && (
        <p className="mb-2 rounded bg-red-950/70 px-2 py-1.5 text-meta leading-snug text-red-200">
          {playError}
        </p>
      )}
      <div
        className="grid gap-3 pt-0.5 pb-2"
        // Sized rather than counted in columns, so the shelf keeps its
        // proportions if the drawer is ever a different width. Smaller than it
        // was: four sleeves across read as four pictures, and five read as a
        // shelf — which is what this is meant to be.
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}
      >
        {playlists.map((playlist) => (
          <Crate
            key={playlist.id}
            playlist={playlist}
            starting={starting === playlist.id}
            away={inHand === `crate:${playlist.id}`}
            onCarry={carry}
            // Measured at the press. By the time the layer renders, the
            // records need somewhere to have come *from*, and that is a
            // rectangle which existed at the moment it was pressed.
            onOpen={(rect) => void openCrate(playlist.id, rect)}
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
  );
}

/**
 * One sleeve, which opens to show what is in it.
 *
 * A single piece of cardboard: the artwork is printed on its top half and the
 * name on its bottom half. That is the whole of the change from what was here
 * before, and it is the whole of the point — the art, the name and the count
 * used to be three separate boxes stacked on the shelf, each a different
 * colour from the shelf and from each other, so the gaps between rows read as
 * bands rather than as space.
 *
 * The record behind it is hidden until the pointer arrives, then slides a
 * little way out of the sleeve. It is what says this is a thing you take out
 * rather than a picture you click, before anything has been clicked.
 */
function Crate({
  playlist,
  starting,
  away,
  onCarry,
  onOpen,
}: {
  playlist: SpotifyPlaylist;
  /** This crate's records are being fetched so the whole thing can play. */
  starting: boolean;
  /** It is in somebody's hand, so its place on the shelf is empty. */
  away: boolean;
  onCarry: (
    playlist: SpotifyPlaylist,
    down: React.PointerEvent,
    sleeve: HTMLElement | null,
    lift: () => void,
  ) => void;
  onOpen: (rect: { x: number; y: number; width: number; height: number }) => void;
}) {
  const t = useT();
  const art = useRef<HTMLSpanElement | null>(null);
  /** Whether the press being finished turned into a lift. */
  const lifted = useRef(false);
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        lifted.current = false;
        onCarry(playlist, e, art.current, () => {
          lifted.current = true;
        });
      }}
      onDragStart={(e) => e.preventDefault()}
      onClick={() => {
        // A press that became a lift has already said what it wanted: the crate
        // went where it was put down, and the click that follows it must not
        // also open it.
        if (lifted.current) return;
        // The artwork, not the card. What comes out of a crate is records, and
        // they have to come out of the square that has a record printed on it
        // — measuring the whole sleeve puts their origin a text-height too low
        // and at the wrong aspect, and the flight shows it.
        const box = art.current?.getBoundingClientRect();
        if (box) onOpen({ x: box.x, y: box.y, width: box.width, height: box.height });
      }}
      className={`groove-sleeve relative flex flex-col rounded-md text-left ${
        away ? 'invisible' : ''
      } ${starting ? 'animate-pulse' : ''}`}
    >
      <span ref={art} className="relative aspect-square w-full">
        {/* The record in the sleeve. Drawn before the print and therefore under
            it, so the only part of it anyone sees is the part in the opening —
            and nothing clips it, so it has somewhere to go when it slides out.
            Flush with the sleeve's right edge, which is where a record sits. */}
        <span aria-hidden="true" className="groove-sleeve-pocket absolute inset-0" />
        <span
          aria-hidden="true"
          className="groove-sleeve-disc pointer-events-none absolute top-[4%] right-0 aspect-square w-[92%] rounded-full"
        />
        <span className="groove-sleeve-art absolute inset-0 overflow-hidden rounded-t-md bg-shell-900">
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
          <span aria-hidden="true" className="groove-sleeve-face absolute inset-0" />
        </span>
      </span>
      <span className="relative flex min-w-0 flex-col px-1.5 py-1 text-center">
        <span className="truncate text-meta text-cream-100" title={playlist.name}>
          {playlist.name}
        </span>
        <span className="truncate text-label text-cream-400">
          {t('spotify.trackCount', { count: playlist.trackCount })}
        </span>
      </span>
    </button>
  );
}
