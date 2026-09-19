import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TrackMetadata } from '@/core/types';
import type { SpotifyPlaylist } from '@/core/providers/spotifyPlaylists';
import { useSpotifyPlaylistsStore } from '@/core/spotify/store';
import { usePlayerStore } from '@/core/store';
import { useDiscFlight } from '@/components/player/DiscFlight';
import { useCarriedTrack, useDiscHold } from '@/components/player/DiscHold';
import { VinylDisc } from '@/components/player/VinylDisc';
import { prefersReducedMotion } from '@/core/utils/motion';
import { useT } from '@/core/i18n';
import { pickCoverImage, type CoverPickFailure } from '@/core/spotify/cover';
import { isTauri } from '@/core/utils/env';
import { CoverCrop, DetailsSheet, RemoveSheet, SheetPresence } from './CrateSheets';
import { gridGeometry, previewOrder, recordKeys, slotAt } from './reorder';

/** What each reason a picture was refused is called on screen. */
const COVER_FAILURES = {
  unsupported: 'spotify.coverUnsupported',
  too_large: 'spotify.coverTooLarge',
  unreadable: 'spotify.coverUnreadable',
} as const satisfies Record<CoverPickFailure, string>;

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

/**
 * The narrowest a card may be, and so the smallest a record in the grid is.
 *
 * The record is as wide as its card, whatever the columns come to; see
 * `useCardWidth`.
 */
const MIN_CARD = 132;

/** How far the pointer travels before a press becomes a lift rather than a click. */
const DRAG_THRESHOLD = 5;

/** An empty sleeve saying so. */
const SHAKE_MS = 360;

/** The gap between cards, which is `gap-3`. Measured grids need it as a number. */
const GRID_GAP = 12;

/** Records making room for one being moved, and settling after a removal. */
const MAKE_ROOM_MS = 200;

/** A record leaving when it is taken out of the playlist. */
const REMOVE_MS = 150;

/** How close to the top or bottom of the crate a held record scrolls it, and how fast. */
const EDGE_PX = 40;
const EDGE_STEP_PX = 10;

/**
 * A sleeve refusing, because the record it would give you is on the deck.
 *
 * On `translate` rather than `transform`: the card's hover lift is a
 * `transform`, and an animation on the same property would win over it for as
 * long as it ran, so the card would drop two pixels the moment it shook.
 * These are separate properties and compose, so the lift stays put.
 */
function refuse(card: HTMLElement | null): void {
  if (!card || prefersReducedMotion()) return;
  card.animate(
    [
      { translate: '0px' },
      { translate: '-6px' },
      { translate: '5px' },
      { translate: '-3px' },
      { translate: '2px' },
      { translate: '0px' },
    ],
    { duration: SHAKE_MS, easing: 'ease-out' },
  );
}

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
  const editing = useSpotifyPlaylistsStore((s) => s.editing);
  const editCapped = useSpotifyPlaylistsStore((s) => s.editCapped);
  const setEditing = useSpotifyPlaylistsStore((s) => s.setEditing);
  const removeFromCrate = useSpotifyPlaylistsStore((s) => s.removeFromCrate);
  const moveInCrate = useSpotifyPlaylistsStore((s) => s.moveInCrate);
  const setCrateDetails = useSpotifyPlaylistsStore((s) => s.setCrateDetails);
  const deleteCrate = useSpotifyPlaylistsStore((s) => s.deleteCrate);
  const setCrateCover = useSpotifyPlaylistsStore((s) => s.setCrateCover);
  const writeError = useSpotifyPlaylistsStore((s) => s.writeError);
  const clearWriteError = useSpotifyPlaylistsStore((s) => s.clearWriteError);

  /** The ⋯ menu, or one of the sheets it opens. One at a time. */
  const [surface, setSurface] = useState<'details' | 'remove' | null>(null);
  /**
   * The picture chosen for a new cover, while its square is being chosen.
   *
   * Not a `surface`: the crop opens over the details sheet, which stays open
   * underneath with whatever was typed in it, and is where it returns to.
   */
  const [coverImage, setCoverImage] = useState<string | null>(null);
  /** Why a picture could not be used, said in the details sheet. Nothing was sent. */
  const [coverNotice, setCoverNotice] = useState<string | null>(null);
  /** The name as it is being typed in edit mode. */

  /**
   * The order shown while a record is held, as indices into `tracks`.
   *
   * Null when nothing is held. The store is only told once the record is let
   * go — one move, not one per slot it passed over on the way.
   */
  const [order, setOrder] = useState<number[] | null>(null);
  /** The record being held, by key, which the settling animation leaves alone. */
  const held = useRef<string | null>(null);
  /** Where each record was laid out last time, by key, for the settling animation. */
  const laidOut = useRef(new Map<string, { x: number; y: number }>());
  const gridInnerRef = useRef<HTMLDivElement | null>(null);
  const cardWidth = useCardWidth(gridInnerRef);

  const keys = useMemo(() => recordKeys(tracks.map((track) => track.id)), [tracks]);
  const copies = useMemo(() => {
    const counted = new Map<string, number>();
    for (const track of tracks) counted.set(track.id, (counted.get(track.id) ?? 0) + 1);
    return counted;
  }, [tracks]);

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
   * later. In that gap the sleeve believed its record was back, showed it, and
   * hid it again the moment playback began. This holds the
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
   * Pick a record up off its sleeve.
   *
   * Nothing happens until the pointer has actually travelled: a press that
   * does not move is a click, and lifting the record on `pointerdown` would
   * make every click look like a fumble.
   *
   * The record lies on top of its sleeve, so it is simply lifted from where it
   * is — the same as on the spotlight shelves — and put back the same way.
   *
   * The listeners go on the window rather than on the card. Pointer capture
   * would do as well for the moving, but where the record is set down is in
   * the other half of the window, and the card is not involved in that.
   */
  const carry = useCallback(
    (track: TrackMetadata, down: React.PointerEvent, sleeve: Sleeve) => {
      const homeEl = sleeve.disc;
      if (down.button !== 0 || !homeEl) return;
      const from = { x: down.clientX, y: down.clientY };
      let holding = false;

      const move = (e: PointerEvent) => {
        const at = { x: e.clientX, y: e.clientY };
        if (holding) {
          moveTo(at.x, at.y);
          return;
        }
        if (Math.hypot(at.x - from.x, at.y - from.y) < DRAG_THRESHOLD) return;
        holding = true;
        // The card that was pressed is told, so the `click` still to come from
        // this same press knows it was a drag and does not also play the track.
        sleeve.lifted();
        grab({
          track,
          homeEl,
          // A record is smaller here than on the deck and the hand draws it at
          // the deck's size, so it starts scaled to the card and grows from
          // there — rather than jumping to full size.
          homeSize: homeEl.getBoundingClientRect().width,
          pointer: at,
          visiting: { deckEl: platterEl(), onDelivered: deliver },
        });
      };

      const drop = (e: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', drop);
        window.removeEventListener('pointercancel', drop);
        if (!holding) return;
        if (e.type === 'pointerup') {
          moveTo(e.clientX, e.clientY);
          release();
        } else {
          cancel();
        }
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
  const requestClose = useCallback((after?: () => void) => {
    if (shutting.current) return;
    shutting.current = true;
    const finish = () => {
      onClose();
      after?.();
    };

    const grid = gridRef.current;
    const layer = layerRef.current;
    if (!grid || !layer || prefersReducedMotion()) {
      finish();
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
    fade.finished.then(finish, finish);
  }, [onClose, origin]);

  /**
   * The details sheet's "Change cover": the file dialog, then the crop.
   */
  const chooseCover = useCallback(() => {
    setCoverNotice(null);
    pickCoverImage().then(
      (picked) => {
        if (picked) setCoverImage(picked);
      },
      (failure: CoverPickFailure) => setCoverNotice(t(COVER_FAILURES[failure])),
    );
  }, [t]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Capture phase and the immediate variant, as every other surface here
      // does: the shell listens on `window` too, and only this stops the one
      // press closing two things.
      e.stopImmediatePropagation();
      // The topmost thing, one press at a time: the crop or the removal
      // question, then the details under them, then edit mode, and only then
      // the crate. The sheets do not listen themselves — registered after this
      // one, they would never hear the key.
      if (coverImage) {
        setCoverImage(null);
        return;
      }
      if (surface === 'remove') {
        setSurface('details');
        return;
      }
      if (surface) {
        setSurface(null);
        setCoverNotice(null);
        return;
      }
      if (editing) {
        void setEditing(false);
        return;
      }
      requestClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [requestClose, surface, coverImage, editing, setEditing]);

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
    // Not while editing. Edit mode reads the rest of the crate at once, and up
    // to three hundred records flying out of a sleeve together is not an
    // unpacking, it is the window stopping.
    if (editing) return;

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
  }, [tracks, origin, editing]);

  /**
   * Records sliding to where they now are, in edit mode.
   *
   * After a move, a removal, or a record held over a new slot, every record
   * whose place changed animates there from where it was. Positions are taken
   * from `offsetLeft`/`offsetTop`, which are the layout and ignore both the
   * animation's own transforms and the crate's scroll.
   */
  useLayoutEffect(() => {
    const inner = gridInnerRef.current;
    if (!inner || !editing) {
      laidOut.current.clear();
      return;
    }
    const reduced = prefersReducedMotion();
    for (const el of inner.querySelectorAll<HTMLElement>('[data-key]')) {
      const key = el.dataset.key ?? '';
      const now = { x: el.offsetLeft, y: el.offsetTop };
      const was = laidOut.current.get(key);
      laidOut.current.set(key, now);
      if (key === held.current || !was || reduced) continue;
      if (was.x === now.x && was.y === now.y) continue;
      el.animate(
        [{ transform: `translate(${was.x - now.x}px, ${was.y - now.y}px)` }, { transform: 'none' }],
        { duration: MAKE_ROOM_MS, easing: EASING },
      );
    }
  });

  /**
   * Hold a record in edit mode and move it to a new place.
   *
   * The card follows the pointer from where it was grabbed, the others make
   * room as it passes over their slots, and letting go sends one move. Near the
   * top or bottom of the crate it scrolls, so a record can be taken past what
   * is on screen. Nothing happens until the pointer has travelled, so a press
   * that does not move is only a press.
   */
  const reorder = useCallback(
    (down: React.PointerEvent, from: number, key: string, card: HTMLElement) => {
      const inner = gridInnerRef.current;
      const scroller = gridRef.current;
      if (down.button !== 0 || !inner || !scroller || loading) return;

      const count = tracks.length;
      const start = { x: down.clientX, y: down.clientY };
      const grabbedAt = {
        x: down.clientX - card.getBoundingClientRect().left,
        y: down.clientY - card.getBoundingClientRect().top,
      };
      const geometry = gridGeometry(
        { width: card.offsetWidth, height: card.offsetHeight },
        inner.clientWidth,
        GRID_GAP,
      );
      let pointer = start;
      let dragging = false;
      let to = from;
      let frame = 0;

      /** Where the card is drawn, relative to its slot, and the scroll near the edges. */
      const follow = () => {
        frame = requestAnimationFrame(follow);
        const edges = scroller.getBoundingClientRect();
        if (pointer.y < edges.top + EDGE_PX) scroller.scrollTop -= EDGE_STEP_PX;
        else if (pointer.y > edges.bottom - EDGE_PX) scroller.scrollTop += EDGE_STEP_PX;

        const box = inner.getBoundingClientRect();
        const inGrid = { x: pointer.x - box.left, y: pointer.y - box.top };
        const next = slotAt(inGrid, geometry, count);
        if (next !== to) {
          to = next;
          setOrder(previewOrder(count, from, to));
        }
        const dx = inGrid.x - grabbedAt.x - card.offsetLeft;
        const dy = inGrid.y - grabbedAt.y - card.offsetTop;
        card.style.transform = `translate(${dx}px, ${dy}px) scale(1.04)`;
      };

      const move = (e: PointerEvent) => {
        pointer = { x: e.clientX, y: e.clientY };
        if (dragging || Math.hypot(pointer.x - start.x, pointer.y - start.y) < DRAG_THRESHOLD) return;
        dragging = true;
        held.current = key;
        card.classList.add('groove-held');
        frame = requestAnimationFrame(follow);
      };

      const end = (commit: boolean) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancelled);
        cancelAnimationFrame(frame);
        if (!dragging) return;

        // Settle from where it was let go of, not from its old slot: the card
        // is drawn at its slot plus the drag, so that is where it starts from.
        const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(card.style.transform);
        const offset = match ? { x: Number(match[1]), y: Number(match[2]) } : { x: 0, y: 0 };
        laidOut.current.set(key, { x: card.offsetLeft + offset.x, y: card.offsetTop + offset.y });
        card.style.transform = '';
        card.classList.remove('groove-held');
        held.current = null;

        setOrder(null);
        if (commit && to !== from) void moveInCrate(playlist.id, from, to);
      };
      const up = () => end(true);
      const cancelled = () => end(false);

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancelled);
    },
    [loading, moveInCrate, playlist.id, tracks.length],
  );

  /** Take a record out of the playlist: it leaves, then the others close up. */
  const takeOut = useCallback(
    async (track: TrackMetadata, card: HTMLElement | null) => {
      if (card && !prefersReducedMotion()) {
        await card
          .animate(
            [
              { opacity: 1, transform: 'scale(1)' },
              { opacity: 0, transform: 'scale(0.85)' },
            ],
            { duration: REMOVE_MS, easing: 'ease-in', fill: 'forwards' },
          )
          .finished.catch(() => undefined);
      }
      void removeFromCrate(playlist.id, track.id);
    },
    [playlist.id, removeFromCrate],
  );

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
      <div className="relative flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        {editing ? (
          <>
            <button
              type="button"
              aria-label={t('common.back')}
              title={t('common.back')}
              onClick={() => requestClose()}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
            >
              <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
                <path
                  d="M6.5 1L2.5 5l4 4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
                {playlist.name}
              </span>
              <span className="block truncate text-meta text-cream-400">
                {t('spotify.editSongs')}
              </span>
            </span>
            <button
              type="button"
              onClick={() => void setEditing(false)}
              className="shrink-0 rounded-full bg-brass-600 px-3 py-1 text-label font-medium tracking-wide text-on-accent uppercase transition-colors hover:bg-brass-500"
            >
              {t('spotify.done')}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => requestClose()}
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
            <div className="flex shrink-0 items-center gap-1">
              <HeaderIcon label={t('spotify.details')} onPress={() => setSurface('details')}>
                {/* A pencil: the playlist itself — name, cover, description. */}
                <path d="M8.6 1.9l1.5 1.5-6 6-2 .5.5-2z" />
                <path d="M7.5 3l1.5 1.5" />
              </HeaderIcon>
              <HeaderIcon
                label={t('spotify.editSongs')}
                onPress={() => {
                  clearWriteError();
                  void setEditing(true);
                }}
              >
                {/* A list with arrows: the songs in it, moved and taken out. */}
                <path d="M1.5 3h5M1.5 6h5M1.5 9h3.5" />
                <path d="M9.5 2v7.5M8 8l1.5 1.5L11 8" />
              </HeaderIcon>
              <button
                type="button"
                aria-label={t('common.close')}
                title={t('common.close')}
                onClick={() => requestClose()}
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
          </>
        )}
      </div>

      {error && (
        <p className="mx-3 shrink-0 rounded bg-red-950/70 px-2 py-1.5 text-meta leading-snug text-red-200">
          {error}
        </p>
      )}
      {/* Why the last change did not happen. It has already been undone on
          screen; this says so, and goes when dismissed or when editing starts
          again. */}
      {writeError && (
        <div className="mx-3 mb-1 flex shrink-0 items-start gap-2 rounded bg-red-950/70 px-2 py-1.5">
          <p className="min-w-0 flex-1 text-meta leading-snug text-red-200">{writeError}</p>
          <button
            type="button"
            aria-label={t('common.dismiss')}
            onClick={clearWriteError}
            className="shrink-0 text-red-200/70 transition-colors hover:text-red-100"
          >
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}
      {editing && editCapped && (
        <p className="mx-3 mb-1 shrink-0 text-meta leading-snug text-cream-400">
          {t('spotify.editCapped')}
        </p>
      )}

      <div ref={gridRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-2 groove-scroll-fade">
        <div
          ref={gridInnerRef}
          // Positioned, so each card's `offsetLeft` and `offsetTop` are measured
          // from here — the grid's content, which scrolls with the cards.
          className="relative grid gap-3 pt-0.5"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${MIN_CARD}px, 1fr))` }}
        >
          {(order ?? tracks.map((_, at) => at)).map((index) => {
            const track = tracks[index];
            const key = keys[index];
            if (!track || !key) return null;
            return (
              <Record
                key={key}
                recordKey={key}
                track={track}
                editing={editing}
                copies={copies.get(track.id) ?? 1}
                onReorder={(down, card) => reorder(down, index, key, card)}
                onTakeOut={(card) => void takeOut(track, card)}
                discSize={cardWidth}
                absent={track.id === onDeck || track.id === handedOver || track.id === inHand}
                onCarry={carry}
                onPlay={(disc) => {
                  flyToPlatter(disc, track);
                  deliver(track);
                }}
              />
            );
          })}
        </div>
        <div ref={sentinel} aria-hidden="true" className="h-px" />
        {loading && (
          <p className="py-2 text-center text-meta text-cream-400/70">
            {t('spotify.loadingPlaylists')}
          </p>
        )}
      </div>

      {/* Under the removal question too, so Cancel there comes back to it
          with nothing lost. */}
      <SheetPresence show={surface !== null}>
        {surface && (
          <DetailsSheet
            playlist={playlist}
            onRemove={() => setSurface('remove')}
            {...(isTauri() && { onCover: chooseCover })}
            coverProblem={coverNotice}
            onClose={() => {
              setSurface(null);
              setCoverNotice(null);
            }}
            onSave={(details) => {
              setSurface(null);
              setCoverNotice(null);
              void setCrateDetails(playlist.id, details);
            }}
          />
        )}
      </SheetPresence>
      {/* Over the details sheet, and back to it: the new cover shows there at
          once, beside whatever else is being changed. */}
      <SheetPresence show={surface === 'details' && coverImage !== null}>
        {surface === 'details' && coverImage && (
          <CoverCrop
            image={coverImage}
            onClose={() => setCoverImage(null)}
            onFailed={(message) => {
              setCoverImage(null);
              setCoverNotice(message);
            }}
            onUpload={(base64, preview) => {
              setCoverImage(null);
              void setCrateCover(playlist.id, base64, preview);
            }}
          />
        )}
      </SheetPresence>
      <SheetPresence show={surface === 'remove'}>
        {surface === 'remove' && (
          <RemoveSheet
            playlist={playlist}
            onClose={() => setSurface('details')}
            onRemove={() => {
              setSurface(null);
              // The records go back into the crate first, and only then does the
              // crate leave the shelf. Removing it at once would unmount this
              // layer mid-thought, with nothing to show where it went.
              requestClose(() => void deleteCrate(playlist.id));
            }}
          />
        )}
      </SheetPresence>
    </div>
  );
}

/** A small round button in the crate's header, drawn with a 12px stroke icon. */
function HeaderIcon({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onPress}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
    >
      <svg
        viewBox="0 0 12 12"
        className="h-3 w-3"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  );
}

/**
 * How wide a card in the grid is, kept up to date as the drawer resizes.
 *
 * Measured off the first card rather than worked out from the columns, so it
 * is what the browser actually laid out. The record is drawn at exactly that,
 * which is what lets it cover its sleeve the way it does on the shelves.
 */
function useCardWidth(grid: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(MIN_CARD);
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const measure = () => {
      const card = el.querySelector<HTMLElement>('[data-record]');
      if (card) setWidth(Math.floor(card.offsetWidth));
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [grid]);
  return width;
}

/**
 * One record lying on its sleeve, with what it is written underneath.
 *
 * The same card as the spotlight shelves: the cover printed at full size as the
 * sleeve, and the record on top of it at the same size, so the cover shows in
 * the corners and on the label. A record in a sleeve had to be drawn out of the
 * mouth before anything could take it and slid back in when it came home, and
 * that in-and-out on every play was more motion than a list of songs wants.
 * Lying on top, it is simply lifted off and set back down.
 */
function Record({
  track,
  recordKey,
  editing,
  copies,
  onReorder,
  onTakeOut,
  discSize,
  absent,
  onCarry,
  onPlay,
}: {
  track: TrackMetadata;
  /** Stable across moves, so the card is not remounted by one. */
  recordKey: string;
  /** Edit mode: a press moves the record, and it can be taken out. */
  editing: boolean;
  /** How many times this song is in the playlist — all of which taking it out removes. */
  copies: number;
  onReorder: (down: React.PointerEvent, card: HTMLElement) => void;
  onTakeOut: (card: HTMLElement | null) => void;
  /** The record's diameter: the card's width. */
  discSize: number;
  /** The record is not on its sleeve — on the deck, or in somebody's hand. */
  absent: boolean;
  onCarry: (track: TrackMetadata, down: React.PointerEvent, sleeve: Sleeve) => void;
  onPlay: (disc: HTMLElement) => void;
}) {
  const t = useT();
  const disc = useRef<HTMLSpanElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  /** Whether the press being finished turned into a lift. */
  const lifted = useRef(false);

  return (
    <button
      ref={button}
      type="button"
      data-record
      // Not `disabled`. An empty sleeve is still worth pressing — pressing it
      // is how you find out it is empty — and a disabled button receives no
      // pointer events at all, so it could not answer.
      data-key={recordKey}
      aria-disabled={absent && !editing}
      title={absent && !editing ? t('spotify.onDeck') : undefined}
      onPointerDown={(e) => {
        if (editing) {
          onReorder(e, e.currentTarget);
          return;
        }
        if (absent) {
          refuse(e.currentTarget);
          return;
        }
        lifted.current = false;
        onCarry(track, e, {
          disc: disc.current,
          lifted: () => {
            lifted.current = true;
          },
        });
      }}
      onDragStart={(e) => e.preventDefault()}
      onClick={() => {
        // Answered on the press already, and once is enough. A press that
        // became a lift has had its say too — the record went where it was
        // dropped, and the `click` that follows it must not send it again.
        // In edit mode a press is for moving, never for playing.
        if (editing || absent || lifted.current) return;
        if (disc.current) onPlay(disc.current);
      }}
      className={`groove-record groove-sleeve group relative flex flex-col rounded-md text-left ${
        editing ? 'cursor-grab' : ''
      }`}
    >
      {editing && (
        // Its own control, and it keeps the press to itself: a press here that
        // also started a move would take the record out from under the hand.
        <span
          role="button"
          tabIndex={0}
          aria-label={copies > 1 ? t('spotify.removeCopies', { count: copies }) : t('spotify.removeSong')}
          title={copies > 1 ? t('spotify.removeCopies', { count: copies }) : t('spotify.removeSong')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onTakeOut(button.current);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            onTakeOut(button.current);
          }}
          className="absolute top-1.5 left-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-shell-900/85 text-cream-200 shadow ring-1 ring-[var(--color-edge)] transition-colors hover:bg-red-800 hover:text-white"
        >
          <svg viewBox="0 0 10 10" className="h-2 w-2" aria-hidden="true">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
      )}
      <span className="relative aspect-square w-full">
        <span
          className="groove-sleeve-art absolute inset-0 overflow-hidden rounded-t-md bg-shell-900"
          // No cut: nothing goes in or out of this sleeve.
          style={{ ['--notch' as string]: '0px' }}
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
        {/* On the sleeve, over it. `data-disc` is what the flight to the
            platter picks up and scales, so it is the disc alone with nothing
            around it. */}
        <span
          ref={disc}
          data-disc
          className={`absolute top-0 left-0 transition-transform duration-200 group-hover:-translate-y-0.5 motion-reduce:transition-none ${
            absent ? 'groove-sleeve-empty' : ''
          }`}
          style={{ width: discSize, height: discSize }}
        >
          <VinylDisc size={discSize} coverArtUrl={track.coverArtUrl} />
        </span>
      </span>
      <span className="relative flex min-w-0 flex-col px-1.5 py-1 text-center">
        <span className="truncate text-meta text-cream-100" title={track.title}>
          {track.title}
        </span>
        <span className="truncate text-label text-cream-400">{track.artist}</span>
      </span>
    </button>
  );
}

/**
 * What a card lends out so its record can be taken from it.
 *
 * The crate drives the press — the listeners have to be on the window, because
 * where a record is put down is nowhere near the card — but only the card can
 * draw its own record out of its own sleeve, so it passes down the doing of it.
 */
interface Sleeve {
  /** The record where it sits, for measuring and for the flight to clone. */
  disc: HTMLElement | null;
  /** This press has become a lift; the click that follows is not a play. */
  lifted: () => void;
}
