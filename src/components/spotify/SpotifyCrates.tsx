import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSpotifyPlaylistsStore } from '@/core/spotify/store';
import type { SpotifyPlaylist } from '@/core/providers/spotifyPlaylists';
import type { TrackMetadata } from '@/core/types';
import { useDiscFlight } from '@/components/player/DiscFlight';
import { useCarriedTrack, useDiscHold } from '@/components/player/DiscHold';
import { VinylDisc } from '@/components/player/VinylDisc';
import type { Vector } from '@/components/player/discPhysics';
import { Shelf } from './Shelf';
import { prefersReducedMotion } from '@/core/utils/motion';
import { useT } from '@/core/i18n';

/** How far the pointer travels before a press becomes a lift rather than a click. */
const DRAG_THRESHOLD = 5;

/**
 * How wide one sleeve is.
 *
 * Smaller than it was, because the shelf is a row now rather than a wall and
 * the drawer's height has two other rows in it. Wide enough that the artwork
 * is still the thing being read and the name under it is still a name.
 */
const CRATE_SIZE = 84;

/**
 * Putting a record into a crate on the shelf.
 *
 * The one gesture in the drawer that interrupts music — lifting the playing
 * record off the deck pauses it — so it is built to be worth the pause. The
 * record eases down to the sleeve's size as it is offered, goes in through the
 * mouth behind the printed face, the sleeve takes it with a squash and a flash
 * of brass while the count ticks up, and the record comes back out and flies
 * home. Starting points, tuned by eye.
 */

/** The record in a sleeve, as the pocket draws it: `w-[92%]`. */
const SLEEVE_RECORD = Math.round(CRATE_SIZE * 0.92);

/** Half the sleeve plus half its record, and a little: the record is clear of the print. */
const MOUTH_CLEAR = Math.ceil(CRATE_SIZE / 2 + SLEEVE_RECORD / 2) + 2;

/** The approach curves out beyond the mouth and turns in, as a hand putting a record away does. */
const MOUTH_APPROACH: Vector = { x: 140, y: -14 };

/** Behind the face and home. Picks up the hand's speed and settles. */
const SLIDE_IN_MS = 170;
const SLIDE_IN_EASING = 'cubic-bezier(0.15, 0.75, 0.35, 1)';

/** The sleeve taking it: down, past where it started, and back. */
const STAMP_MS = 240;

/** The brass rim, which outlasts the squash a little so it is seen. */
const RIM_MS = 420;

/** Back out of the mouth, linear so it is still moving when the hand takes it. */
const PULL_OUT_MS = 110;

/** How long "already here" stays on the sleeve. */
const SAID_MS = 1400;

/** A sleeve saying no: a short shake, on `translate` so a lift on `transform` keeps. */
function shake(el: HTMLElement | null): void {
  if (!el || prefersReducedMotion()) return;
  el.animate(
    [
      { translate: '0px' },
      { translate: '-5px' },
      { translate: '4px' },
      { translate: '-2px' },
      { translate: '0px' },
    ],
    { duration: 320, easing: 'ease-out' },
  );
}

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
 * playlist looks like when it is a physical thing.
 *
 * A shelf rather than the wall of them it used to be. The wall was the only
 * thing in the drawer with height to spare, so it took all of it, and the two
 * rows above it were squeezed into whatever was left — which is backwards for
 * a drawer where every row is the same kind of thing. One row each, all three
 * read the same way, and the arrows on each are the way along it.
 *
 * Pages arrive as they are scrolled to. The trigger is a sentinel at the end of
 * the row rather than a scroll handler doing arithmetic: the browser already
 * knows when something has come into view, and asking it is both cheaper and
 * immune to the miscounting a hand-rolled threshold invites.
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
  const createPlaylist = useSpotifyPlaylistsStore((s) => s.createPlaylist);
  const writeError = useSpotifyPlaylistsStore((s) => s.writeError);
  const clearWriteError = useSpotifyPlaylistsStore((s) => s.clearWriteError);
  /** A crate made a moment ago, which arrives on the shelf rather than just being there. */
  const [justMade, setJustMade] = useState<string | null>(null);
  // Stable, because the arriving crate's animation depends on it: a new function
  // on every render would restart the arrival each time the shelf re-rendered.
  const arrived = useCallback(() => setJustMade(null), []);
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
            // A crate does not land on the deck. It opens out over it and is
            // gone, and what it was carrying starts playing.
            dissolves: true,
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

  return (
    <>
      {/* Above the shelf rather than instead of it: failing to play one crate
          says nothing about the others, and taking them off the screen to
          report it would be a worse answer than the one being reported. */}
      {playError && (
        <p className="shrink-0 rounded bg-red-950/70 px-2 py-1.5 text-meta leading-snug text-red-200">
          {playError}
        </p>
      )}
      {/* A change to a playlist that Spotify refused, from here or from the sheet.
          The crate has its own place to say so when it is open. */}
      {writeError && (
        <div className="flex shrink-0 items-start gap-2 rounded bg-red-950/70 px-2 py-1.5">
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
      <Shelf heading={t('panel.playlists')}>
        {!error && (
          <NewCrate
            onCreate={async (name) => {
              const created = await createPlaylist(name);
              if (created) setJustMade(created.id);
              return created !== null;
            }}
          />
        )}
        {error && (
          <p className="rounded bg-red-950/70 px-2 py-1.5 text-meta leading-snug text-red-200">
            {error}
          </p>
        )}
        {!error && playlists.length === 0 && (
          <p className="px-0.5 py-3 text-meta leading-snug text-cream-400/70">
            {started && !loading ? t('spotify.noPlaylists') : t('spotify.loadingPlaylists')}
          </p>
        )}
        {!error &&
          playlists.map((playlist) => (
            <Crate
              key={playlist.id}
              playlist={playlist}
              arriving={justMade === playlist.id}
              onArrived={arrived}
              starting={starting === playlist.id}
              away={inHand === `crate:${playlist.id}`}
              onCarry={carry}
              // Measured at the press. By the time the layer renders, the
              // records need somewhere to have come *from*, and that is a
              // rectangle which existed at the moment it was pressed.
              onOpen={(rect) => void openCrate(playlist.id, rect)}
            />
          ))}
        {/* The end of the row, which is where the next page is asked for. It
            has to be a cell of the row rather than a mark after it, or the
            flex line would not carry it out to where the scrolling ends. */}
        <div ref={sentinel} aria-hidden="true" className="w-px shrink-0" />
        {loading && playlists.length > 0 && (
          <div className="shrink-0" style={{ width: CRATE_SIZE }}>
            <div
              className="groove-inset w-full rounded-md"
              style={{ height: CRATE_SIZE }}
              aria-hidden="true"
            />
          </div>
        )}
      </Shelf>
    </>
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
/**
 * An empty sleeve at the start of the shelf, for making a playlist.
 *
 * On the shelf rather than behind a button somewhere else, because a new
 * playlist is a new crate and this is where crates are. Pressing it turns its
 * label into a name field; Enter makes the playlist, private, and the new crate
 * arrives beside it. Escape puts the label back — and keeps the key to itself,
 * or the shell would close the whole drawer with it.
 */
function NewCrate({ onCreate }: { onCreate: (name: string) => Promise<boolean> }) {
  const t = useT();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [working, setWorking] = useState(false);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || working) return;
    setWorking(true);
    const made = await onCreate(trimmed);
    setWorking(false);
    if (made) {
      setName('');
      setNaming(false);
    }
  }

  return (
    <div
      className={`relative flex shrink-0 flex-col rounded-md ${working ? 'animate-pulse' : ''}`}
      style={{ width: CRATE_SIZE }}
    >
      <button
        type="button"
        aria-label={t('spotify.newPlaylist')}
        title={t('spotify.newPlaylist')}
        onClick={() => setNaming(true)}
        className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-cream-400/40 text-cream-400 transition-colors hover:border-brass-400 hover:text-brass-400"
      >
        <svg viewBox="0 0 16 16" className="h-6 w-6" aria-hidden="true">
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <span className="flex min-w-0 flex-col px-0.5 py-1 text-center">
        {naming ? (
          <input
            type="text"
            value={name}
            autoFocus
            maxLength={100}
            placeholder={t('spotify.newPlaylist')}
            aria-label={t('spotify.playlistName')}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (!name.trim() && !working) setNaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
              if (e.key === 'Escape') {
                e.stopPropagation();
                setName('');
                setNaming(false);
              }
            }}
            className="w-full groove-inset rounded px-1 py-0.5 text-center text-meta text-cream-50 outline-none ring-1 ring-[var(--color-edge)] focus:ring-brass-500"
          />
        ) : (
          <span className="truncate text-meta text-cream-400">{t('spotify.newPlaylist')}</span>
        )}
      </span>
    </div>
  );
}

function Crate({
  playlist,
  arriving,
  onArrived,
  starting,
  away,
  onCarry,
  onOpen,
}: {
  playlist: SpotifyPlaylist;
  /** Just made: it arrives on the shelf instead of simply appearing. */
  arriving: boolean;
  onArrived: () => void;
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
  const card = useRef<HTMLButtonElement | null>(null);
  /** Whether the press being finished turned into a lift. */
  const lifted = useRef(false);

  const { registerReceiver } = useDiscHold();
  /** A record is held over this sleeve, and would go in or be refused. */
  const [offered, setOffered] = useState<'accept' | 'refuse' | null>(null);
  /** The record going in, drawn in the pocket behind the print while it does. */
  const [incoming, setIncoming] = useState<{ track: TrackMetadata; key: number } | null>(null);
  const takeInJob = useRef<{
    track: TrackMetadata;
    from: Vector;
    handBack: (outAt: Vector) => void;
  } | null>(null);
  const incomingEl = useRef<HTMLSpanElement | null>(null);
  const rim = useRef<HTMLSpanElement | null>(null);
  const countEl = useRef<HTMLSpanElement | null>(null);
  const shownCount = useRef(playlist.trackCount);
  const [said, setSaid] = useState<string | null>(null);

  // Somewhere a record can be put. Only a Spotify song: a file on this computer
  // has nothing to add, and a crate is not a record.
  useEffect(() => {
    const el = art.current;
    if (!el) return;
    let key = 0;
    return registerReceiver({
      el,
      accepts: (track) => track.source === 'spotify' && !track.id.startsWith('crate:'),
      onHover: setOffered,
      refuse: () => shake(card.current),
      approach: MOUTH_APPROACH,
      handOverAt: MOUTH_CLEAR,
      takeIn: (track, from, handBack) => {
        takeInJob.current = { track, from, handBack };
        key += 1;
        setIncoming({ track, key });
      },
    });
  }, [registerReceiver]);

  /**
   * In, taken, and back out.
   *
   * Runs once the record is drawn in the pocket. The song is added at the moment
   * the sleeve takes it, and the hand never waits for Spotify: the record goes
   * home and the music resumes whatever Spotify says. If it says the song is
   * already there, the sleeve says so; if it refuses, the sleeve shakes and the
   * change has been undone on the shelf.
   *
   * The record is always handed back, even if this sleeve is unmounted part way
   * — the drawer closing, say. A hold that never got its record back would leave
   * the deck's record hidden in mid-air.
   */
  useLayoutEffect(() => {
    const job = takeInJob.current;
    const disc = incomingEl.current;
    const sleeve = card.current;
    if (!incoming || !job || !disc || !sleeve) return;
    takeInJob.current = null;

    let handedBack = false;
    const handBack = () => {
      if (handedBack) return;
      handedBack = true;
      job.handBack({ x: MOUTH_CLEAR, y: 0 });
      setIncoming(null);
    };
    const add = () => {
      void useSpotifyPlaylistsStore
        .getState()
        .addToCrate(playlist.id, job.track)
        .then((outcome) => {
          if (outcome === 'already') {
            setSaid(t('spotify.alreadyHere'));
            setTimeout(() => setSaid(null), SAID_MS);
          } else if (outcome !== 'added') {
            shake(card.current);
          }
        });
    };
    const flash = () =>
      rim.current?.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], {
        duration: RIM_MS,
        easing: 'ease-out',
      });

    if (prefersReducedMotion()) {
      add();
      flash();
      handBack();
      return;
    }

    sleeve.classList.add('groove-taking');
    disc
      .animate([{ transform: `translate(${job.from.x}px, ${job.from.y}px)` }, { transform: 'none' }], {
        duration: SLIDE_IN_MS,
        easing: SLIDE_IN_EASING,
        fill: 'forwards',
      })
      .finished.then(() => {
        add();
        flash();
        // `scale`, not `transform`: a lift on the sleeve's transform keeps.
        return sleeve.animate(
          [
            { scale: '1' },
            { scale: '0.95', offset: 0.3 },
            { scale: '1.03', offset: 0.68 },
            { scale: '1' },
          ],
          { duration: STAMP_MS, easing: 'ease-out' },
        ).finished;
      })
      .then(
        () =>
          disc.animate([{ transform: 'none' }, { transform: `translateX(${MOUTH_CLEAR}px)` }], {
            duration: PULL_OUT_MS,
            easing: 'linear',
            fill: 'forwards',
          }).finished,
      )
      .catch(() => undefined)
      .finally(() => {
        sleeve.classList.remove('groove-taking');
        handBack();
      });

    return () => handBack();
  }, [incoming, playlist.id, t]);

  /** The count ticks over when it changes, rather than simply being a different number. */
  useLayoutEffect(() => {
    const el = countEl.current;
    if (el && shownCount.current !== playlist.trackCount && !prefersReducedMotion()) {
      el.animate([{ transform: 'translateY(70%)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
        duration: 260,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      });
    }
    shownCount.current = playlist.trackCount;
  }, [playlist.trackCount]);

  /**
   * A crate that has just been made settles onto the shelf.
   *
   * From a little smaller and further left — out of the empty sleeve that made
   * it — to its place, with a slight overshoot so it lands rather than stops.
   */
  useLayoutEffect(() => {
    const el = card.current;
    if (!arriving || !el) return;
    const done = () => onArrived();
    if (prefersReducedMotion()) {
      done();
      return;
    }
    const run = el.animate(
      [
        { transform: 'translateX(-40px) scale(0.7)', opacity: 0 },
        { transform: 'translateX(4px) scale(1.03)', opacity: 1, offset: 0.7 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 360, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    run.finished.then(done, done);
  }, [arriving, onArrived]);

  return (
    <button
      ref={card}
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
      // Not `invisible` on the card. What the hand carries is the printed
      // square, so that is what goes at once — swapped for a copy of itself in
      // the same place, which is a swap nobody can see. The name underneath is
      // not carried, and taking it away in the same instant was the one thing
      // that popped; it fades instead, over about as long as the crate takes
      // to leave.
      className={`groove-sleeve relative flex shrink-0 flex-col rounded-md text-left ${
        starting ? 'animate-pulse' : ''
      } ${offered === 'accept' ? 'groove-offered' : ''} ${offered === 'refuse' ? 'groove-refused' : ''}`}
      style={{ width: CRATE_SIZE }}
    >
      {/* The brass the sleeve lights with as it takes a record. */}
      <span ref={rim} aria-hidden="true" className="groove-rim absolute inset-0 rounded-md" />
      <span
        ref={art}
        className={`relative aspect-square w-full ${away ? 'invisible' : ''}`}
      >
        {/* The record in the sleeve. Drawn before the print and therefore under
            it, so the only part of it anyone sees is the part in the opening —
            and nothing clips it, so it has somewhere to go when it slides out.
            Flush with the sleeve's right edge, which is where a record sits. */}
        <span aria-hidden="true" className="groove-sleeve-pocket absolute inset-0" />
        <span
          aria-hidden="true"
          className="groove-sleeve-disc pointer-events-none absolute top-[4%] right-0 aspect-square w-[92%] rounded-full"
        />
        {/* The record being put in, in the pocket with the sleeve's own, and so
            behind the print on its way through the mouth. */}
        {incoming && (
          <span
            key={incoming.key}
            ref={incomingEl}
            aria-hidden="true"
            className="pointer-events-none absolute top-[4%] right-0"
            style={{ width: SLEEVE_RECORD, height: SLEEVE_RECORD }}
          >
            <VinylDisc size={SLEEVE_RECORD} coverArtUrl={incoming.track.coverArtUrl} />
          </span>
        )}
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
        {said && (
          <span className="pointer-events-none absolute inset-x-1 bottom-1 rounded bg-shell-900/90 px-1 py-0.5 text-center text-label text-brass-400">
            {said}
          </span>
        )}
      </span>
      <span
        className={`relative flex min-w-0 flex-col px-1.5 py-1 text-center transition-opacity duration-150 ${
          away ? 'opacity-0' : ''
        }`}
      >
        <span className="truncate text-meta text-cream-100" title={playlist.name}>
          {playlist.name}
        </span>
        <span ref={countEl} className="truncate text-label text-cream-400">
          {t('spotify.trackCount', { count: playlist.trackCount })}
        </span>
      </span>
    </button>
  );
}
