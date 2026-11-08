import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TrackMetadata } from '@/core/types';
import { useUnplayable, whyUnplayable } from '@/core/spotify/playable';
import { refuse, refuseUnplayable, UNPLAYABLE_LOOK } from './Unplayable';
import type { SpotifyPlaylist } from '@/core/providers/spotifyPlaylists';
import { useSpotifyPlaylistsStore } from '@/core/spotify/store';
import { usePlayerStore } from '@/core/store';
import { useDiscFlight } from '@/components/player/DiscFlight';
import { useCarriedTrack, useDiscHold } from '@/components/player/DiscHold';
import { VinylDisc } from '@/components/player/VinylDisc';
import { readCover } from '@/core/theme/readCover';
import { prefersReducedMotion } from '@/core/utils/motion';
import { formatDuration } from '@/core/utils/time';
import { useT } from '@/core/i18n';
import { pickCoverImage, type CoverPickFailure } from '@/core/spotify/cover';
import { isTauri } from '@/core/utils/env';
import {
  CoverCrop,
  DetailsSheet,
  ListDetailsSheet,
  RemoveSheet,
  SheetPresence,
} from './CrateSheets';
import { backwards, bubbleFrames, flightFrames, hoursAndMinutes, minutesOf, type Box } from './crateMotion';
import { gridGeometry, previewOrder, recordKeys, slotAt } from './reorder';

/** What each reason a picture was refused is called on screen. */
export const COVER_FAILURES = {
  unsupported: 'spotify.coverUnsupported',
  too_large: 'spotify.coverTooLarge',
  unreadable: 'spotify.coverUnreadable',
} as const satisfies Record<CoverPickFailure, string>;

/**
 * A crate, opened: its cover to one side and its records in a list beside it.
 *
 * Covers the drawer and nothing else. That is a requirement rather than a
 * preference — a record is meant to be draggable from here onto the deck, and
 * the deck has to be visible for there to be anywhere to drag it to.
 *
 * The page swells out of the crate that was pressed, a rounded shape filling the
 * drawer short of its edges, and the cover goes with it to its place on the left.
 * The records then come out of that cover one after another, each in an arc to its
 * own row, which appears as it lands, so what you see is a crate emptying rather
 * than a list appearing. Closing, they go back the same way before the page does.
 */

/** How long the page takes to swell into place, and its bounce on arriving. */
const OPEN_MS = 560;
const OPEN_EASING = 'cubic-bezier(.3,1.32,.5,1)';

/** How long the backdrop takes to darken the shelves behind the page. */
const DIM_MS = 360;

/** The heading and the buttons, coming up once the page has nearly arrived. */
const RISE_DELAY_MS = 300;
const RISE_STAGGER_MS = 30;
const RISE_MS = 300;

/** When the first record leaves the cover, from the page starting to open. */
const FLIGHTS_FROM_MS = 470;
/** How long one record takes to reach its row, and the gap to the next. */
const FLIGHT_MS = 440;
const STAGGER_MS = 62;
/** How far through its flight a record's row comes up to meet it, and how fast. */
const ROW_AFTER_MS = 350;
const ROW_MS = 230;

/**
 * How many records fly, one after another, before the rest are simply there.
 *
 * About what the page shows at once. A playlist of two hundred would otherwise take
 * twelve seconds to unpack, nearly all of it below the fold.
 */
const STAGGERED = 9;

/**
 * Going back in is quicker than coming out, and from fewer of them.
 *
 * Unpacking is the thing worth watching; packing is what happens on the way to
 * somewhere else, and a close that takes as long as an open feels like the app
 * arguing about it.
 */
const RETURN_MS = 260;
const RETURN_STAGGER_MS = 30;
/** Into the crate: gathering speed rather than easing off, which is a drop. */
const RETURN_EASING = 'cubic-bezier(0.5, 0, 0.75, 0)';
/** How long the page takes to go back into its crate. */
const SHRINK_MS = 300;
/** How long before the last record is home the page starts to go. */
const SHRINK_OVERLAP_MS = 120;

const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** How far the pointer travels before a press becomes a lift rather than a click. */
const DRAG_THRESHOLD = 5;

/** The gap between rows, which is `gap-0.5`. Measured lists need it as a number. */
const ROW_GAP = 2;

/** Records making room for one being moved, and settling after a removal. */
const MAKE_ROOM_MS = 200;

/** A record leaving when it is taken out of the playlist. */
const REMOVE_MS = 150;

/** How close to the top or bottom of the crate a held record scrolls it, and how fast. */
const EDGE_PX = 40;
const EDGE_STEP_PX = 10;

/** How wide a record's row sets its parts: number, sleeve, words, length. */
const ROW_COLUMNS = 'grid-cols-[22px_36px_minmax(0,1fr)_40px]';

/** Where the crate was on screen, so the page can grow out of it. */
type Origin = { x: number; y: number; width: number; height: number };

/**
 * What an opened crate holds, and what can be done to it.
 *
 * The page — the records flying out of the sleeve and back, the grid, taking
 * one to the deck by hand, edit mode — is the same whoever's playlist it is.
 * What differs is where the records come from and what changing them means,
 * and that is this: Spotify's playlists come from its store and are changed
 * through its Web API, Groovium's are the app's own file.
 */
export interface CrateSource {
  name: string;
  trackCount: number;
  tracks: TrackMetadata[];
  loading: boolean;
  /** More records to come, as Spotify hands them over a page at a time. */
  cursor: string | null;
  error: string | null;
  more: () => void;
  editing: boolean;
  /** Edit mode read only the first part of a very long playlist. */
  editCapped: boolean;
  setEditing: (on: boolean) => unknown;
  /** Take out the record at `index`. */
  takeOut: (track: TrackMetadata, index: number) => unknown;
  /** Move a record to a new place, where the order can be changed at all. */
  move?: (from: number, to: number) => unknown;
  /** Play the record at `index`, the way this crate's records play. */
  play: (track: TrackMetadata, index: number) => Promise<unknown>;
  /** Play the whole crate; shuffled, or as the deck is set to when not asked. */
  playAll: (shuffled?: boolean) => unknown;
  writeError: string | null;
  clearWriteError: () => void;
  /** A Spotify playlist, for its details, its cover and its removal. */
  spotify?: SpotifyPlaylist;
  /** A Groovium playlist, deleted from the app. */
  deleteCrate?: () => unknown;
  /** A Groovium playlist, renamed. Its details sheet is there when this is. */
  rename?: (name: string) => unknown;
  /** A Groovium playlist's cover, as base64 JPEG. */
  setCover?: (jpeg: string) => unknown;
  /** The cover the details sheet shows. */
  coverUrl?: string;
}

interface CrateLayerProps {
  source: CrateSource;
  origin: Origin;
  onClose: () => void;
}

interface OpenCrateProps {
  playlist: SpotifyPlaylist;
  origin: Origin;
  onClose: () => void;
}

/** A Spotify playlist opened: the page, fed from Spotify's store. */
export function OpenCrate({ playlist, origin, onClose }: OpenCrateProps) {
  return <CrateLayer source={useSpotifyCrate(playlist)} origin={origin} onClose={onClose} />;
}

function useSpotifyCrate(playlist: SpotifyPlaylist): CrateSource {
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
  const writeError = useSpotifyPlaylistsStore((s) => s.writeError);
  const clearWriteError = useSpotifyPlaylistsStore((s) => s.clearWriteError);
  const playSingle = usePlayerStore((s) => s.playSingle);
  const playCrate = useSpotifyPlaylistsStore((s) => s.playCrate);
  return {
    name: playlist.name,
    trackCount: playlist.trackCount,
    tracks,
    loading,
    cursor,
    error,
    more: moreTracks,
    editing,
    editCapped,
    setEditing,
    // Spotify takes a song out by its address, every copy of it at once.
    takeOut: (track) => removeFromCrate(playlist.id, track.id),
    move: (from, to) => moveInCrate(playlist.id, from, to),
    // One song at a time, as a record taken out of a sleeve is.
    play: (track) => playSingle(track),
    playAll: (shuffled) => playCrate(playlist.id, shuffled),
    writeError,
    clearWriteError,
    spotify: playlist,
  };
}

/** The transform that takes this element's box onto the crate's. */
function ontoCrate(el: HTMLElement, origin: Origin): string | null {
  const box = el.getBoundingClientRect();
  if (box.width === 0) return null;
  // The crate is square and so is a record, so one ratio covers both axes.
  const scale = origin.width / box.width;
  const dx = origin.x + origin.width / 2 - (box.left + box.width / 2);
  const dy = origin.y + origin.height / 2 - (box.top + box.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${scale})`;
}

/** Send a copy of a row's record along a path, over everything, and clear it up after. */
function flyRecord(
  row: HTMLElement,
  over: HTMLElement,
  frames: Keyframe[],
  timing: KeyframeAnimationOptions,
): void {
  const disc = row.querySelector<HTMLElement>('[data-disc]');
  if (!disc) return;
  const copy = disc.cloneNode(true) as HTMLElement;
  copy.removeAttribute('data-disc');
  copy.className = 'absolute top-0 left-0';
  over.appendChild(copy);
  const flight = copy.animate(frames, { fill: 'both', ...timing });
  const gone = () => copy.remove();
  flight.finished.then(gone, gone);
}

/** Where a box is, measured from another's corner. */
function within(box: DOMRect, outer: DOMRect): Box {
  return { left: box.left - outer.left, top: box.top - outer.top, width: box.width, height: box.height };
}

/**
 * A crate opened: its records out of the sleeve and laid out on a page.
 *
 * Whose crate it is comes in as `source`; everything the page does with its
 * records — the flight out and back, carrying one to the deck, edit mode — is
 * the same for Spotify's playlists and Groovium's.
 */
export function CrateLayer({ source, origin, onClose }: CrateLayerProps) {
  const t = useT();
  const { tracks, loading, cursor, error, editing, editCapped, writeError, spotify } = source;
  const {
    more: moreTracks,
    setEditing,
    clearWriteError,
    takeOut: takeOutOf,
    move: moveRecord,
    play,
    deleteCrate: deleteOwn,
    rename,
    setCover,
  } = source;
  /** Whether the pencil opens anything: Spotify's details, or a Groovium playlist's. */
  const hasDetails = spotify !== undefined || rename !== undefined;
  const setCrateDetails = useSpotifyPlaylistsStore((s) => s.setCrateDetails);
  const deleteCrate = useSpotifyPlaylistsStore((s) => s.deleteCrate);
  const setCrateCover = useSpotifyPlaylistsStore((s) => s.setCrateCover);

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
  /** A colour from the cover, for the wash behind it. */
  const [tint, setTint] = useState<string | null>(null);
  const tintFrom = source.coverUrl ?? spotify?.coverArtUrl ?? tracks[0]?.coverArtUrl;
  useEffect(() => {
    if (!tintFrom) return;
    let alive = true;
    void readCover(tintFrom).then((seen) => {
      if (alive && seen.read && seen.palette) setTint(seen.palette.accent);
    });
    return () => {
      alive = false;
    };
  }, [tintFrom]);

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

  const keys = useMemo(() => recordKeys(tracks.map((track) => track.id)), [tracks]);
  const copies = useMemo(() => {
    const counted = new Map<string, number>();
    for (const track of tracks) counted.set(track.id, (counted.get(track.id) ?? 0) + 1);
    return counted;
  }, [tracks]);

  /**
   * What is on the deck, so its sleeve here can be empty.
   *
   * The id and not the track: this re-renders every record in the crate, and a
   * new object identity for the same song would do it for nothing.
   */
  const onDeck = usePlayerStore((s) => s.currentTrack?.id ?? null);
  const sounding = usePlayerStore((s) => s.playbackState === 'PLAYING');
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
      void play(taken, Math.max(0, tracks.indexOf(taken))).then(done, done);
    },
    [play, tracks],
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
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const coverRef = useRef<HTMLDivElement | null>(null);
  const flyingRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  /** When the page began to open, so records that arrive late still wait for it. */
  const openedAt = useRef(0);
  /** Latched, so a second Escape or a double click cannot start a second close. */
  const shutting = useRef(false);
  /** How many records have already been played in; the rest are new. */
  const unpacked = useRef(0);
  const [closing, setClosing] = useState(false);

  /**
   * Put the records back in the cover, then let the page go.
   *
   * The records fly back one after another, last row first, and as the last of them
   * gets there the page shrinks into the crate it came from and the cover goes with
   * it. The state is only here to stop anything being pressed while it runs. It never
   * blocks the close: with motion turned down the layer goes immediately.
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
    const page = pageRef.current;
    const bubble = bubbleRef.current;
    const backdrop = backdropRef.current;
    const cover = coverRef.current;
    const flying = flyingRef.current;
    if (!grid || !layer || !page || !bubble || !backdrop || !cover || !flying || prefersReducedMotion()) {
      finish();
      return;
    }

    // A close straight after opening turns the page round rather than letting its
    // entrance finish on top of the exit.
    for (const running of layer.getAnimations({ subtree: true })) {
      if (!(running instanceof CSSAnimation) && !(running instanceof CSSTransition)) running.cancel();
    }
    flying.replaceChildren();
    setClosing(true);

    // Only what can be seen. Below the fold a record may not have been laid out
    // at all, and animating a hundred of them off screen is work nobody watches.
    const view = grid.getBoundingClientRect();
    const seen = [...grid.querySelectorAll<HTMLElement>('[data-record]')].filter((el) => {
      const box = el.getBoundingClientRect();
      return box.bottom > view.top && box.top < view.bottom;
    });
    const going = seen.slice(0, STAGGERED).reverse();
    const pageBox = page.getBoundingClientRect();
    const coverBox = within(cover.getBoundingClientRect(), pageBox);
    const mouth = { x: coverBox.left + coverBox.width * 1.02 - 18, y: coverBox.top + coverBox.height / 2 - 18 };

    for (const el of seen.slice(STAGGERED)) {
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' });
    }
    for (const [i, el] of going.entries()) {
      const delay = i * RETURN_STAGGER_MS;
      const sleeve = el.querySelector<HTMLElement>('[data-sleeve]');
      if (sleeve) {
        const box = within(sleeve.getBoundingClientRect(), pageBox);
        flyRecord(el, flying, backwards(flightFrames(mouth, { x: box.left, y: box.top })), {
          duration: RETURN_MS,
          delay,
          easing: RETURN_EASING,
        });
      }
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, delay, fill: 'forwards' });
    }
    for (const el of page.querySelectorAll<HTMLElement>('[data-crate-rise], [data-crate-tint]')) {
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
    }

    // The page waits for the last record and then goes. Going any earlier would
    // take the flight with it, and the flight is the whole point.
    const last = going.length * RETURN_STAGGER_MS + RETURN_MS;
    const shrink = { duration: SHRINK_MS, delay: Math.max(0, last - SHRINK_OVERLAP_MS), easing: EASING, fill: 'forwards' } as const;
    const layerBox = layer.getBoundingClientRect();
    const crate = { left: origin.x - layerBox.left, top: origin.y - layerBox.top, width: origin.width, height: origin.height };
    const to = ontoCrate(cover, origin);
    if (to) cover.animate([{ transform: 'none' }, { transform: to }], shrink);
    backdrop.animate([{ opacity: 1 }, { opacity: 0 }], shrink);
    const out = bubble.animate(backwards(bubbleFrames(crate, within(bubble.getBoundingClientRect(), layerBox))), shrink);
    // Either way — finished or cancelled by an unmount — the crate closes.
    out.finished.then(finish, finish);
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
        // Spotify's removal is asked from its details; a Groovium crate's is
        // asked straight from the header.
        setSurface(hasDetails ? 'details' : null);
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
  }, [requestClose, surface, coverImage, editing, setEditing, hasDetails]);

  // Opening. A layout effect so the first frame painted is already the start of
  // it, never the finished page followed by a jump back.
  useLayoutEffect(() => {
    // Once. React runs this twice in development, and the second time everything is
    // already sitting on the crate: measured there, the page and the cover were
    // told to go from the crate to the crate, and only jumped into place at the end.
    if (openedAt.current !== 0) return;
    openedAt.current = performance.now();
    const layer = layerRef.current;
    const page = pageRef.current;
    const bubble = bubbleRef.current;
    const backdrop = backdropRef.current;
    const cover = coverRef.current;
    if (!layer || !page || !bubble || !backdrop || !cover || prefersReducedMotion()) return;

    const layerBox = layer.getBoundingClientRect();
    const crate = { left: origin.x - layerBox.left, top: origin.y - layerBox.top, width: origin.width, height: origin.height };
    bubble.animate(bubbleFrames(crate, within(bubble.getBoundingClientRect(), layerBox)), {
      duration: OPEN_MS,
      easing: OPEN_EASING,
    });
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DIM_MS, easing: 'ease-out' });
    const from = ontoCrate(cover, origin);
    if (from) {
      cover.animate([{ transform: from }, { transform: 'none' }], { duration: OPEN_MS, easing: OPEN_EASING });
    }
    for (const [i, el] of [...page.querySelectorAll<HTMLElement>('[data-crate-rise]')].entries()) {
      el.animate(
        [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: RISE_MS, delay: RISE_DELAY_MS + i * RISE_STAGGER_MS, easing: EASING, fill: 'backwards' },
      );
    }
    // Once, for the page arriving. The crate it came from does not move while it
    // is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The unpacking. A layout effect so the first frame is never the finished list:
  // by the time anything is painted the rows are hidden, waiting for their records.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    const page = pageRef.current;
    const cover = coverRef.current;
    const flying = flyingRef.current;
    if (!grid || !page || !cover || !flying || prefersReducedMotion() || shutting.current) return;

    const rows = [...grid.querySelectorAll<HTMLElement>('[data-record]')];
    // Only ever the first lot to arrive. A second page appended to the list is
    // below the fold, and must not send the first back into the crate.
    const first = unpacked.current === 0;
    unpacked.current = rows.length;
    // Not while editing. Edit mode reads the rest of the crate at once, and up to
    // three hundred records out of a sleeve together is the window stopping.
    if (editing || !first || rows.length === 0) return;

    const view = grid.getBoundingClientRect();
    const seen = rows.filter((el) => el.getBoundingClientRect().top < view.bottom);
    const pageBox = page.getBoundingClientRect();
    const coverBox = within(cover.getBoundingClientRect(), pageBox);
    const mouth = { x: coverBox.left + coverBox.width * 1.02 - 18, y: coverBox.top + coverBox.height / 2 - 18 };
    // A playlist that took a while to arrive has no page to wait for.
    const waited = performance.now() - openedAt.current;
    const from = Math.max(0, FLIGHTS_FROM_MS - waited);

    for (const [i, el] of seen.slice(0, STAGGERED).entries()) {
      const sleeve = el.querySelector<HTMLElement>('[data-sleeve]');
      if (!sleeve) continue;
      const delay = from + i * STAGGER_MS;
      const box = within(sleeve.getBoundingClientRect(), pageBox);
      flyRecord(el, flying, flightFrames(mouth, { x: box.left, y: box.top }), {
        duration: FLIGHT_MS,
        delay,
        easing: EASING,
      });
      el.animate(
        [
          { opacity: 0, transform: 'translateX(14px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: ROW_MS, delay: delay + ROW_AFTER_MS, easing: EASING, fill: 'backwards' },
      );
    }
    for (const el of seen.slice(STAGGERED)) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: ROW_MS,
        delay: from + STAGGERED * STAGGER_MS,
        easing: 'ease-out',
        fill: 'backwards',
      });
    }
  }, [tracks, editing]);

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
      // Not in a crate whose order cannot be changed.
      if (!moveRecord || down.button !== 0 || !inner || !scroller || loading) return;

      const count = tracks.length;
      const start = { x: down.clientX, y: down.clientY };
      const grabbedAt = {
        x: down.clientX - card.getBoundingClientRect().left,
        y: down.clientY - card.getBoundingClientRect().top,
      };
      const geometry = gridGeometry(
        { width: card.offsetWidth, height: card.offsetHeight },
        inner.clientWidth,
        ROW_GAP,
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
        const dy = inGrid.y - grabbedAt.y - card.offsetTop;
        card.style.transform = `translate(0px, ${dy}px) scale(1.02)`;
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
        if (commit && to !== from) void moveRecord(from, to);
      };
      const up = () => end(true);
      const cancelled = () => end(false);

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancelled);
    },
    [loading, moveRecord, tracks.length],
  );

  /** Take a record out of the playlist: it leaves, then the others close up. */
  const takeOut = useCallback(
    async (track: TrackMetadata, index: number, card: HTMLElement | null) => {
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
      void takeOutOf(track, index);
    },
    [takeOutOf],
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

  const coverUrl = source.coverUrl ?? spotify?.coverArtUrl ?? tracks[0]?.coverArtUrl;
  const length = cursor === null && !loading && tracks.length > 0 ? minutesOf(tracks) : null;
  const lengthWords =
    length === null
      ? null
      : length >= 60
        ? t('crate.hours', hoursAndMinutes(length))
        : t('crate.minutes', { minutes: length });

  return (
    <div
      ref={layerRef}
      role="dialog"
      aria-label={source.name}
      // The whole drawer, and only the drawer: rendered as its child, which is the
      // point. The deck beside it stays visible and reachable, because a record is
      // meant to be dragged from here onto it. `z-10` inside the drawer's own stacking
      // context: over everything else in the drawer, under a record in the air.
      className={`absolute inset-0 z-10 ${closing ? 'pointer-events-none' : ''}`}
    >
      <div ref={backdropRef} aria-hidden="true" className="absolute inset-0 bg-shell-900/55" />
      {/* The page's ground, on its own, as it is the part that swells. What is on it
          stays where it will end up, and comes up once this has got there. */}
      <div
        ref={bubbleRef}
        aria-hidden="true"
        className="absolute inset-2 rounded-[24px] bg-gradient-to-b from-shell-700 to-shell-900 shadow-[0_10px_30px_rgba(0,0,0,.55),inset_0_1px_0_rgba(255,255,255,.07)]"
      />
      <div ref={pageRef} className="absolute inset-2 flex overflow-hidden rounded-[24px]">
        <div className="relative flex w-[232px] shrink-0 flex-col px-[22px] pt-3 pb-4">
          {tint && (
            // Wider than its column and fading out across it, so that it has no edge.
            <div
              aria-hidden="true"
              data-crate-tint
              className="groove-crate-tint pointer-events-none absolute inset-y-0 left-0 w-[340px]"
              style={{ background: `linear-gradient(165deg, color-mix(in srgb, ${tint} 42%, transparent), transparent 72%)` }}
            />
          )}
          <button
            type="button"
            data-crate-rise
            aria-label={t('common.back')}
            title={t('common.back')}
            onClick={() => requestClose()}
            className="relative -ml-1.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-cream-50/[.07] text-cream-200 transition-colors hover:bg-shell-600 hover:text-cream-50"
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
          <div ref={coverRef} className="relative mt-2.5 h-[152px] w-[152px] shrink-0">
            <span aria-hidden="true" className="absolute top-[4%] right-0 translate-x-[26%]">
              <VinylDisc size={140} coverArtUrl={coverUrl} />
            </span>
            <span className="absolute inset-0 overflow-hidden rounded-md bg-shell-900 shadow-[0_3px_8px_rgba(0,0,0,.45)]">
              {coverUrl && (
                <img
                  src={coverUrl}
                  crossOrigin="anonymous"
                  alt=""
                  draggable={false}
                  className="h-full w-full object-cover"
                />
              )}
            </span>
          </div>
          <div data-crate-rise className="relative mt-3.5 min-w-0">
            <p className="text-label font-medium tracking-[0.16em] text-brass-400 uppercase">{t('crate.label')}</p>
            <h2 className="mt-0.5 line-clamp-2 text-[22px] leading-[1.12] font-medium text-cream-50" title={source.name}>
              {source.name}
            </h2>
            <p className="mt-1 truncate text-meta text-cream-400">
              {[spotify?.ownerName, t('spotify.trackCount', { count: source.trackCount }), lengthWords]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {!editing && (
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  aria-label={t('transport.play')}
                  title={t('transport.play')}
                  disabled={tracks.length === 0}
                  onClick={() => void source.playAll()}
                  className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-brass-500 text-shell-900 transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
                >
                  <svg viewBox="0 0 16 16" className="ml-0.5 h-4 w-4" aria-hidden="true" fill="currentColor">
                    <path d="M4 2.6v10.8c0 .5.5.8.9.5l8.4-5.4c.4-.2.4-.8 0-1L4.9 2.1c-.4-.3-.9 0-.9.5z" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label={t('transport.shuffle')}
                  title={t('transport.shuffle')}
                  disabled={tracks.length === 0}
                  onClick={() => void source.playAll(true)}
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-shell-700 text-cream-200 transition-colors hover:bg-shell-600 hover:text-cream-50 disabled:opacity-50"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="h-3.5 w-3.5"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2 4.500h2.300c1 0 1.900.5 2.400 1.300l2.600 4.400c.5.800 1.400 1.300 2.400 1.300H14M2 11.500h2.300c1 0 1.900-.5 2.400-1.300M9.300 5.800c.5-.8 1.400-1.300 2.400-1.300H14M12.200 2.700L14 4.500l-1.800 1.800M12.200 9.700l1.8 1.8-1.8 1.8" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="relative flex min-w-0 flex-1 flex-col">
          <div data-crate-rise className="flex h-11 shrink-0 items-center justify-end gap-1 pr-3.5 pl-1">
            {editing ? (
              <>
                <span className="min-w-0 flex-1 truncate text-meta text-cream-400">{t('spotify.editSongs')}</span>
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
                {hasDetails && (
                  <HeaderIcon label={t('spotify.details')} onPress={() => setSurface('details')}>
                    {/* A pencil: the playlist itself — name, cover, description. */}
                    <path d="M8.6 1.9l1.5 1.5-6 6-2 .5.5-2z" />
                    <path d="M7.5 3l1.5 1.5" />
                  </HeaderIcon>
                )}
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
                {deleteOwn && !hasDetails && (
                  <HeaderIcon label={t('playlists.deleteTitle')} onPress={() => setSurface('remove')}>
                    {/* A bin: the playlist, not the songs in it. */}
                    <path d="M2 3.5h8M4.5 3.5V2.3h3v1.2M3.2 3.5l.6 6.2h4.4l.6-6.2" />
                  </HeaderIcon>
                )}
                <HeaderIcon label={t('common.close')} onPress={() => requestClose()}>
                  <path d="M2 2l8 8M10 2l-8 8" />
                </HeaderIcon>
              </>
            )}
          </div>

          {error && (
            <p className="mr-3 mb-1 shrink-0 rounded bg-red-950/70 px-2 py-1.5 text-meta leading-snug text-red-200">
              {error}
            </p>
          )}
          {/* Why the last change did not happen. It has already been undone on
              screen; this says so, and goes when dismissed or when editing starts
              again. */}
          {writeError && (
            <div className="mr-3 mb-1 flex shrink-0 items-start gap-2 rounded bg-red-950/70 px-2 py-1.5">
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
            <p className="mr-3 mb-1 shrink-0 text-meta leading-snug text-cream-400">{t('spotify.editCapped')}</p>
          )}

          <div
            data-crate-rise
            className={`mr-3 grid shrink-0 ${ROW_COLUMNS} gap-2.5 border-b border-cream-50/[.08] pr-2 pb-1.5 pl-1.5 text-label text-cream-400`}
          >
            <span className="text-right">#</span>
            <span />
            <span>{t('crate.song')}</span>
            <span className="text-right" title={t('crate.length')}>
              <svg
                viewBox="0 0 12 12"
                role="img"
                aria-label={t('crate.length')}
                className="ml-auto h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinecap="round"
              >
                <circle cx="6" cy="6" r="4.5" />
                <path d="M6 3.5V6l1.6 1" />
              </svg>
            </span>
          </div>

          <div ref={gridRef} className="groove-drawer-list min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-1 pr-3 pb-5">
            <div
              ref={gridInnerRef}
              // Positioned, so each row's `offsetLeft` and `offsetTop` are measured
              // from here — the list's content, which scrolls with the rows.
              className="relative flex flex-col gap-0.5"
            >
              {(order ?? tracks.map((_, at) => at)).map((index, place) => {
                const track = tracks[index];
                const key = keys[index];
                if (!track || !key) return null;
                return (
                  <Record
                    key={key}
                    recordKey={key}
                    track={track}
                    number={place + 1}
                    editing={editing}
                    copies={copies.get(track.id) ?? 1}
                    onReorder={(down, card) => reorder(down, index, key, card)}
                    onTakeOut={(card) => void takeOut(track, index, card)}
                    onDeck={track.id === onDeck}
                    sounding={sounding}
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
              <p className="py-2 text-center text-meta text-cream-400/70">{t('spotify.loadingPlaylists')}</p>
            )}
          </div>
        </div>

      {/* Under the removal question too, so Cancel there comes back to it
          with nothing lost. */}
      <SheetPresence show={rename !== undefined && !spotify && surface !== null}>
        {rename && !spotify && surface && (
          <ListDetailsSheet
            name={source.name}
            coverUrl={source.coverUrl}
            onRemove={() => setSurface('remove')}
            {...(isTauri() && setCover && { onCover: chooseCover })}
            coverProblem={coverNotice}
            onClose={() => {
              setSurface(null);
              setCoverNotice(null);
            }}
            onSave={(name) => {
              setSurface(null);
              setCoverNotice(null);
              void rename(name);
            }}
          />
        )}
      </SheetPresence>
      <SheetPresence show={spotify !== undefined && surface !== null}>
        {spotify && surface && (
          <DetailsSheet
            playlist={spotify}
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
              void setCrateDetails(spotify.id, details);
            }}
          />
        )}
      </SheetPresence>
      {/* Over the details sheet, and back to it: the new cover shows there at
          once, beside whatever else is being changed. */}
      <SheetPresence show={hasDetails && surface === 'details' && coverImage !== null}>
        {hasDetails && surface === 'details' && coverImage && (
          <CoverCrop
            image={coverImage}
            onClose={() => setCoverImage(null)}
            onFailed={(message) => {
              setCoverImage(null);
              setCoverNotice(message);
            }}
            onUpload={(base64, preview) => {
              setCoverImage(null);
              if (spotify) void setCrateCover(spotify.id, base64, preview);
              else void setCover?.(base64);
            }}
          />
        )}
      </SheetPresence>
      <SheetPresence show={surface === 'remove'}>
        {surface === 'remove' && (
          <RemoveSheet
            label={spotify ? t('spotify.removeFromLibrary') : t('playlists.deleteTitle')}
            title={
              spotify
                ? t('spotify.removeConfirmTitle', { name: source.name })
                : t('library.deleteListTitle', { name: source.name })
            }
            body={spotify ? t('spotify.removeConfirmBody') : t('library.deleteListBody')}
            onClose={() => setSurface(hasDetails ? 'details' : null)}
            onRemove={() => {
              setSurface(null);
              // The records go back into the crate first, and only then does the
              // crate leave the shelf. Removing it at once would unmount this
              // layer mid-thought, with nothing to show where it went.
              requestClose(() => {
                if (spotify) void deleteCrate(spotify.id);
                else void deleteOwn?.();
              });
            }}
          />
        )}
      </SheetPresence>
      <div ref={flyingRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-20" />
      </div>
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
 * One song in the list: its place, its sleeve with the record showing at the side,
 * what it is, and how long.
 *
 * The whole row is what is pressed and carried. The record is behind the sleeve and
 * comes further out when the pointer is on the row, and it is that record which is
 * lifted to the deck, by the same code that takes one off the platter.
 */
function Record({
  track,
  recordKey,
  number,
  editing,
  copies,
  onReorder,
  onTakeOut,
  onDeck,
  sounding,
  absent,
  onCarry,
  onPlay,
}: {
  track: TrackMetadata;
  /** Stable across moves, so the row is not remounted by one. */
  recordKey: string;
  /** Its place in the list, from one. */
  number: number;
  /** Edit mode: a press moves the record, and it can be taken out. */
  editing: boolean;
  /** How many times this song is in the playlist — all of which taking it out removes. */
  copies: number;
  onReorder: (down: React.PointerEvent, card: HTMLElement) => void;
  onTakeOut: (card: HTMLElement | null) => void;
  /** This is the song on the deck. */
  onDeck: boolean;
  /** Whether the deck is making a sound, so its bars can move. */
  sounding: boolean;
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
  /** Why Spotify will not play it here, if it will not. It can still be moved and taken out. */
  const refused = useUnplayable(track);
  const takeOutLabel = copies > 1 ? t('spotify.removeCopies', { count: copies }) : t('spotify.removeSong');

  return (
    <button
      ref={button}
      type="button"
      data-record
      // Not `disabled`. An empty sleeve is still worth pressing — pressing it
      // is how you find out it is empty — and a disabled button receives no
      // pointer events at all, so it could not answer.
      data-key={recordKey}
      aria-disabled={(absent || !!refused) && !editing}
      title={
        editing ? undefined : refused ? whyUnplayable(refused) : absent ? t('spotify.onDeck') : undefined
      }
      onPointerDown={(e) => {
        if (editing) {
          onReorder(e, e.currentTarget);
          return;
        }
        if (refused) {
          refuseUnplayable(e.currentTarget, refused);
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
        if (editing || absent || refused || lifted.current) return;
        if (disc.current) onPlay(disc.current);
      }}
      className={`groove-record groove-crate-row group relative grid w-full shrink-0 ${ROW_COLUMNS} items-center gap-2.5 rounded-lg py-[5px] pr-2 pl-1.5 text-left transition-colors hover:bg-shell-600/40 ${
        editing ? 'cursor-grab' : ''
      }`}
    >
      <span className="flex justify-end text-meta text-cream-400 tabular-nums">
        {editing ? (
          // Its own control, and it keeps the press to itself: a press here that
          // also started a move would take the record out from under the hand.
          <span
            role="button"
            tabIndex={0}
            aria-label={takeOutLabel}
            title={takeOutLabel}
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
            className="flex h-5 w-5 items-center justify-center rounded-full bg-shell-900/85 text-cream-200 ring-1 ring-[var(--color-edge)] transition-colors hover:bg-red-800 hover:text-white"
          >
            <svg viewBox="0 0 10 10" className="h-2 w-2" aria-hidden="true">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
        ) : onDeck ? (
          <span
            aria-hidden="true"
            className={`groove-crate-bars inline-flex h-[11px] items-end gap-[1.5px] ${sounding ? 'is-sounding' : ''}`}
          >
            <i />
            <i />
            <i />
          </span>
        ) : (
          number
        )}
      </span>
      <span data-sleeve className={`relative h-9 w-9 ${refused ? UNPLAYABLE_LOOK : ''}`}>
        {/* Behind the sleeve, showing at its side. `data-disc` is what the flight to
            the platter picks up and scales, so it is the disc alone. */}
        <span
          ref={disc}
          data-disc
          className={`absolute top-0 left-0 h-9 w-9 translate-x-[26%] scale-[.92] transition-transform duration-200 motion-reduce:transition-none ${
            absent ? 'groove-sleeve-empty' : ''
          } ${refused ? '' : 'group-hover:translate-x-[46%]'}`}
        >
          <VinylDisc size={36} coverArtUrl={track.coverArtUrl} />
        </span>
        <span className="absolute inset-0 overflow-hidden rounded bg-shell-900 shadow-[0_2px_5px_rgba(0,0,0,.4)]">
          {track.coverArtUrl && (
            <img
              src={track.coverArtUrl}
              // Asked the way every cover is — see `Sleeve` in VinylDisc.
              crossOrigin="anonymous"
              alt=""
              loading="lazy"
              draggable={false}
              className="h-full w-full object-cover"
            />
          )}
        </span>
      </span>
      <span className={`flex min-w-0 flex-col ${refused ? UNPLAYABLE_LOOK : ''}`}>
        <span
          className={`truncate text-[13px] leading-tight font-medium ${onDeck ? 'text-brass-400' : 'text-cream-50'}`}
          title={track.title}
        >
          {track.title}
        </span>
        <span className="truncate text-label text-cream-400">
          {refused ? t('spotify.unplayable') : track.artist}
        </span>
      </span>
      <span className="text-right text-label text-cream-400 tabular-nums">{formatDuration(track.duration)}</span>
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
