import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TrackMetadata } from '@/core/types';
import type { SpotifyPlaylist } from '@/core/providers/spotifyPlaylists';
import { useSpotifyPlaylistsStore } from '@/core/spotify/store';
import { usePlayerStore } from '@/core/store';
import { useDiscFlight } from '@/components/player/DiscFlight';
import { useCarriedTrack, useDiscHold } from '@/components/player/DiscHold';
import { VinylDisc } from '@/components/player/VinylDisc';
import { prefersReducedMotion } from '@/core/utils/motion';
import { useT } from '@/core/i18n';

/**
 * A crate, opened: its records out of the sleeves and laid on the shelf.
 *
 * Covers the drawer and nothing else. That is a requirement rather than a
 * preference — a record is meant to be draggable from here onto the deck, and
 * the deck has to be visible for there to be anywhere to drag it to.
 *
 * The records come out of the crate and, when it is shut, go back into it.
 * Each one starts at the sleeve's own position and size and travels to its
 * place in the grid, a little after the one before it, so what you see is a
 * crate emptying rather than a grid appearing.
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

/**
 * Going back in is quicker than coming out, and from fewer of them.
 *
 * Unpacking is the thing worth watching; packing is what happens on the way to
 * somewhere else, and a close that takes as long as an open feels like the app
 * arguing about it. Ten staggered is still plainly a sequence.
 */
const RETURN_MS = 260;
const RETURN_STAGGER_MS = 18;
const RETURN_STAGGERED = 10;
/** The layer goes once the records are nearly home, not before. */
const LAYER_FADE_MS = 180;

const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** Into the crate: gathering speed rather than easing off, which is a drop. */
const RETURN_EASING = 'cubic-bezier(0.5, 0, 0.75, 0)';

/** Diameter of a record in the grid. The cells are wider than this on purpose. */
const DISC_SIZE = 140;

/** How far the pointer travels before a press becomes a lift rather than a click. */
const DRAG_THRESHOLD = 5;

/** How long a record takes to slide back into its sleeve when it leaves the deck. */
const RESHELVE_MS = 380;
/**
 * How far out of the mouth a record starts when it slides back in.
 *
 * Also where the hand lets go of one it is putting back, so that the carry
 * ends exactly where this begins and the two read as a single move. They did
 * not: the hand used to put the record all the way in, and then it came out
 * and went in again.
 */
const RESHELVE_FROM = 74;

interface OpenCrateProps {
  playlist: SpotifyPlaylist;
  /** Where the sleeve was on screen, so the records can come out of it. */
  origin: { x: number; y: number; width: number; height: number };
  onClose: () => void;
}

/** The transform that takes this element's box onto the crate's. */
function ontoCrate(
  el: HTMLElement,
  origin: { x: number; y: number; width: number; height: number },
): string | null {
  const box = el.getBoundingClientRect();
  if (box.width === 0) return null;
  // The crate is square and so is a record, so one ratio covers both axes.
  const scale = origin.width / box.width;
  const dx = origin.x + origin.width / 2 - (box.left + box.width / 2);
  const dy = origin.y + origin.height / 2 - (box.top + box.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${scale})`;
}

export function OpenCrate({ playlist, origin, onClose }: OpenCrateProps) {
  const t = useT();
  const tracks = useSpotifyPlaylistsStore((s) => s.tracks);
  const loading = useSpotifyPlaylistsStore((s) => s.tracksLoading);
  const cursor = useSpotifyPlaylistsStore((s) => s.tracksCursor);
  const error = useSpotifyPlaylistsStore((s) => s.tracksError);
  const moreTracks = useSpotifyPlaylistsStore((s) => s.moreTracks);

  const playSingle = usePlayerStore((s) => s.playSingle);
  /**
   * What is on the deck, so its sleeve here can be empty.
   *
   * The id and not the track: this re-renders every record in the crate, and a
   * new object identity for the same song would do it for nothing.
   */
  const onDeck = usePlayerStore((s) => s.currentTrack?.id ?? null);
  const { flyToPlatter, platterEl } = useDiscFlight();
  /**
   * The deck's own carry gesture, borrowed.
   *
   * A record taken out of a sleeve is picked up, held and set down by exactly
   * the code that takes one off the platter — the same shrink into the hand,
   * the same tempo, the same clone in the same layer. There was briefly a
   * second, simpler drag written here, and it looked like a different app.
   */
  const { grab, moveTo, release, cancel } = useDiscHold();
  /** The record in the hand, so its sleeve here is empty while it is out. */
  const inHand = useCarriedTrack();
  /**
   * A record set down on the deck, until the deck admits to having it.
   *
   * The hand lets go the instant the record lands, and a Spotify track is not
   * `currentTrack` until the provider has started it — routinely a second
   * later. In that gap the sleeve believed its record was back, slid it in
   * from the mouth, and hid it again the moment playback began. This holds the
   * sleeve empty across the gap, and lets go if the track never starts, which
   * is the one case where the record really should come back.
   */
  const [handedOver, setHandedOver] = useState<string | null>(null);
  const deliver = useCallback(
    (taken: TrackMetadata) => {
      setHandedOver(taken.id);
      const done = () => setHandedOver((id) => (id === taken.id ? null : id));
      void playSingle(taken).then(done, done);
    },
    [playSingle],
  );

  /**
   * Whether the press that is finishing was a drag.
   *
   * A `click` still fires after a drag's `pointerup`, and without this every
   * drop would also play whatever was underneath the finger at the start.
   */
  const dragged = useRef(false);

  /**
   * Take a record out of its sleeve.
   *
   * Nothing happens until the pointer has actually travelled: a press that
   * does not move is a click, and lifting the record on `pointerdown` would
   * make every click look like a fumble.
   *
   * The listeners go on the window rather than on the card. Pointer capture
   * would do as well for the moving, but where the record is set down is in
   * the other half of the window, and the card is not involved in that.
   */
  const carry = useCallback(
    (track: TrackMetadata, down: React.PointerEvent, homeEl: HTMLElement | null) => {
      if (down.button !== 0 || !homeEl) return;
      const from = { x: down.clientX, y: down.clientY };
      let lifted = false;

      const move = (e: PointerEvent) => {
        if (lifted) {
          moveTo(e.clientX, e.clientY);
          return;
        }
        if (Math.hypot(e.clientX - from.x, e.clientY - from.y) < DRAG_THRESHOLD) return;
        lifted = true;
        dragged.current = true;
        grab({
          track,
          homeEl,
          // A record is smaller in a sleeve than on the deck and the hand draws
          // it at the deck's size, so it starts scaled to the sleeve and shrinks
          // from there — rather than jumping to full size and then shrinking.
          homeSize: DISC_SIZE,
          pointer: { x: e.clientX, y: e.clientY },
          visiting: {
            deckEl: platterEl(),
            onDelivered: deliver,
            // Put back at the mouth, not the middle: the sleeve's own record
            // takes it from there.
            homeOffset: { x: RESHELVE_FROM, y: 0 },
          },
        });
      };

      const drop = (e: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', drop);
        window.removeEventListener('pointercancel', drop);
        if (!lifted) return;
        if (e.type === 'pointerup') release();
        else cancel();
        // After the click this press is still going to fire, not before it.
        window.setTimeout(() => {
          dragged.current = false;
        }, 0);
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', drop);
      window.addEventListener('pointercancel', drop);
    },
    [cancel, deliver, grab, moveTo, platterEl, release],
  );

  const layerRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  /** How many records have already been played in; the rest are new. */
  const unpacked = useRef(0);
  /** Latched, so a second Escape or a double click cannot start a second close. */
  const shutting = useRef(false);
  const [closing, setClosing] = useState(false);

  /**
   * Put the records back in the crate, then let the drawer take the layer away.
   *
   * The state is only here to stop anything being pressed while it runs; the
   * animation is driven straight off the elements, because the thing that has
   * to be measured — where each record is *now* — is not something React
   * knows. And it never blocks the close: if there is nothing to animate, or
   * motion is turned down, the layer goes immediately.
   */
  const requestClose = useCallback(() => {
    if (shutting.current) return;
    shutting.current = true;

    const grid = gridRef.current;
    const layer = layerRef.current;
    if (!grid || !layer || prefersReducedMotion()) {
      onClose();
      return;
    }

    // Only what can be seen. Below the fold a record may not have been laid out
    // at all — `content-visibility` is allowed to skip it — and animating a
    // hundred of them off screen is work nobody watches.
    const view = grid.getBoundingClientRect();
    const going = [...grid.querySelectorAll<HTMLElement>('[data-record]')].filter((el) => {
      const box = el.getBoundingClientRect();
      return box.bottom > view.top && box.top < view.bottom;
    });

    setClosing(true);
    for (const [i, el] of going.entries()) {
      const to = ontoCrate(el, origin);
      if (!to) continue;
      el.animate(
        [
          { transform: 'none', opacity: 1 },
          { transform: to, opacity: 0 },
        ],
        {
          duration: RETURN_MS,
          delay: Math.min(i, RETURN_STAGGERED) * RETURN_STAGGER_MS,
          easing: RETURN_EASING,
          fill: 'forwards',
        },
      );
    }

    // The layer waits for the last record and then goes. Fading it any earlier
    // would take the flight with it, and the flight is the whole point.
    const last = Math.min(going.length, RETURN_STAGGERED) * RETURN_STAGGER_MS + RETURN_MS;
    const fade = layer.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: LAYER_FADE_MS,
      delay: Math.max(0, last - LAYER_FADE_MS),
      easing: 'ease-in',
      fill: 'forwards',
    });
    // Either way — finished or cancelled by an unmount — the crate closes.
    fade.finished.then(onClose, onClose);
  }, [onClose, origin]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Capture phase and the immediate variant, as every other surface here
      // does: the shell listens on `window` too, and only this stops the one
      // press closing two things.
      e.stopImmediatePropagation();
      requestClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [requestClose]);

  // The unpacking. A layout effect so the first frame is never the finished
  // grid — by the time anything is painted the records are already back at the
  // crate, waiting to leave it.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || prefersReducedMotion() || shutting.current) return;

    const discs = [...grid.querySelectorAll<HTMLElement>('[data-record]')];
    // Only the ones that have just arrived. A second page appended to the grid
    // must not send the first page back into the crate to come out again.
    const arriving = discs.slice(unpacked.current);
    unpacked.current = discs.length;

    for (const [i, el] of arriving.entries()) {
      const from = ontoCrate(el, origin);
      if (!from) continue;
      el.animate(
        [
          { transform: from, opacity: 0 },
          { transform: 'none', opacity: 1 },
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
    // Nothing more is wanted from Spotify once this is on its way out.
    if (!foot || !cursor || closing) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void moreTracks();
      },
      { rootMargin: '200px' },
    );
    observer.observe(foot);
    return () => observer.disconnect();
  }, [cursor, moreTracks, closing]);

  return (
    <div
      ref={layerRef}
      role="dialog"
      aria-label={playlist.name}
      // The whole drawer, and only the drawer. `inset-0` is the drawer's box
      // because this is rendered as its child — which is the point: an opened
      // crate *is* the Spotify side of the window for as long as it is open,
      // and the deck beside it stays visible and reachable, because a record
      // is meant to be dragged from here onto it.
      //
      // Opaque, and the shell's own gradient rather than a flat panel or a
      // blur. A blur leaves half-seen sleeves behind a grid of records, which
      // is two shelves at once and the eye keeps trying to read the one it
      // cannot; a flat fill makes this half of the window a different material
      // from the deck beside it. Repeating the gradient keeps the drawer one
      // piece of the window whether a crate is open in it or not — and it
      // means the fade at the foot of the list, which the drawer sets to where
      // this gradient ends, is still the right colour here.
      // `z-10` inside the drawer's own stacking context, not the window's: over
      // everything else in the drawer, under a record in the air.
      className={`absolute inset-0 z-10 flex flex-col bg-gradient-to-b from-shell-700 to-shell-900 ${
        closing ? 'pointer-events-none' : ''
      }`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          onClick={requestClose}
          // The heading is the way back, not just the cross in the corner.
          // This is a place you went into, so the way out is where you came in.
          className="flex min-w-0 items-center gap-1.5 text-left transition-colors hover:text-cream-50"
        >
          <svg
            viewBox="0 0 10 10"
            className="h-2.5 w-2.5 shrink-0 text-cream-400"
            aria-hidden="true"
          >
            <path
              d="M6.5 1L2.5 5l4 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="min-w-0">
            <span className="block truncate text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
              {playlist.name}
            </span>
            <span className="block truncate text-meta text-cream-400">
              {t('spotify.trackCount', { count: playlist.trackCount })}
            </span>
          </span>
        </button>
        <button
          type="button"
          aria-label={t('common.close')}
          title={t('common.close')}
          onClick={requestClose}
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
          className="grid gap-3 pt-0.5"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))' }}
        >
          {tracks.map((track, index) => (
            <Record
              key={`${track.id}:${index}`}
              track={track}
              onDeck={track.id === onDeck || track.id === inHand || track.id === handedOver}
              onCarry={carry}
              onPlay={(disc) => {
                if (dragged.current) return;
                if (disc) flyToPlatter(disc, track);
                deliver(track);
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

/**
 * One record, half out of its sleeve, with what it is written underneath.
 *
 * The sleeve is here because a bare disc is not a picture of anything. Forty
 * records drawn as forty black circles are forty copies of one drawing — the
 * cover is the only thing that tells them apart, and on a record the cover is
 * a label an inch across. So the cover is printed at full size as the sleeve,
 * the record lies across it, and the two together fill a square cell instead
 * of leaving its four corners empty, which is what a grid of circles does.
 *
 * It is also the shelf's own object one step further on: out there a sleeve
 * keeps its record hidden until you reach for it, and in here the record has
 * been taken out. Same card, same cardboard, same light.
 */
function Record({
  track,
  onDeck,
  onCarry,
  onPlay,
}: {
  track: TrackMetadata;
  /** This record is on the platter, so its sleeve here is empty. */
  onDeck: boolean;
  onCarry: (track: TrackMetadata, down: React.PointerEvent, homeEl: HTMLElement | null) => void;
  onPlay: (disc: HTMLElement | null) => void;
}) {
  const disc = useRef<HTMLSpanElement | null>(null);
  const was = useRef(onDeck);

  /**
   * Coming back off the deck, the record slides into its sleeve.
   *
   * Only that direction is animated here. Going the other way it is either
   * flying to the platter or being carried there by hand, and in both cases
   * something else is already drawing the record in transit — an entrance for
   * the sleeve's own copy on top of that would be two of the same record.
   */
  useLayoutEffect(() => {
    const leaving = was.current;
    if (leaving === onDeck) return;
    was.current = onDeck;
    const el = disc.current;
    if (onDeck || !el || prefersReducedMotion()) return;
    el.animate(
      [
        { transform: `translateX(${RESHELVE_FROM}px)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: RESHELVE_MS, easing: EASING },
    );
  }, [onDeck]);

  return (
    <button
      type="button"
      data-record
      onPointerDown={(e) => onCarry(track, e, disc.current)}
      onDragStart={(e) => e.preventDefault()}
      onClick={(e) => onPlay(e.currentTarget.querySelector<HTMLElement>('[data-disc]'))}
      className="groove-record groove-sleeve relative flex flex-col rounded-md text-left"
    >
      <span className="relative aspect-square w-full">
        {/* In the sleeve, not on it. Drawn before the print and therefore under
            it, so the only part of it anyone sees is the crescent in the
            opening; nothing clips it, so it has somewhere to go when it slides
            out. `data-disc` is what the flight to the platter picks up and
            scales, so it is the disc alone with nothing around it.
            Centred by arithmetic rather than `top-1/2 -translate-y-1/2`: that
            utility writes the `translate` property and the nudge on hover
            writes `transform`, and both would apply. */}
        <span aria-hidden="true" className="groove-sleeve-pocket absolute inset-0" />
        <span
          ref={disc}
          data-disc
          className={`groove-taken absolute right-0 ${onDeck ? 'groove-sleeve-empty' : ''}`}
          style={{ width: DISC_SIZE, height: DISC_SIZE, top: `calc(50% - ${DISC_SIZE / 2}px)` }}
        >
          <VinylDisc size={DISC_SIZE} coverArtUrl={track.coverArtUrl} />
        </span>
        <span
          className="groove-sleeve-art absolute inset-0 overflow-hidden rounded-t-md bg-shell-900"
          // A wider cell than the shelf's wants a wider cut, or the opening
          // reads as a chip in the corner rather than somewhere a hand goes.
          style={{ ['--notch' as string]: '42px' }}
        >
          {track.coverArtUrl && (
            <img
              src={track.coverArtUrl}
              alt=""
              loading="lazy"
              draggable={false}
              className="h-full w-full object-cover"
            />
          )}
          <span aria-hidden="true" className="groove-sleeve-face absolute inset-0" />
        </span>
      </span>
      <span className="relative flex min-w-0 flex-col px-1.5 py-1">
        <span className="truncate text-meta text-cream-100" title={track.title}>
          {track.title}
        </span>
        <span className="truncate text-label text-cream-400">{track.artist}</span>
      </span>
    </button>
  );
}
