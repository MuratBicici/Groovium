import { useCallback, useEffect, useRef, useState } from 'react';
import { spotlight, type Lit } from '@/core/providers/spotifySpotlight';
import { useDiscFlight } from '@/components/player/DiscFlight';
import { useCarriedTrack, useDiscHold } from '@/components/player/DiscHold';
import { VinylDisc } from '@/components/player/VinylDisc';
import { usePlayerStore } from '@/core/store';
import { useT } from '@/core/i18n';
import type { TrackMetadata } from '@/core/types';

/**
 * A shelf of what you have been listening to, above the crates.
 *
 * Everything else in the drawer is a playlist — something somebody made. This
 * is the other half of an account: what was actually played, and what gets
 * played most. One row rather than two, because the drawer's height is the
 * scarce thing here and two rows would cost the crates a second one; the
 * heading is the switch between them.
 *
 * The card is the crate's card, smaller. A bare disc is not a picture of
 * anything — a row of black circles is one drawing repeated — so the cover is
 * printed at full size as the sleeve with the record lying across it, and what
 * it is goes underneath. Same cardboard, same light, same way of reading it.
 *
 * What a card does is what a crate's card does, too: pressing it flies the
 * record to the deck and starts it, and dragging takes the record out and
 * carries it there by hand. Nothing here is a new gesture to learn.
 */

/** The record's diameter. The cell is this wide; the sleeve is square. */
const DISC_SIZE = 84;

/** How far the pointer travels before a press is a drag rather than a click. */
const DRAG_THRESHOLD = 6;

/** The row starts on what was played rather than on what is played most. */
const OPENS_ON: Lit = 'recent';

export function SpotlightStrip() {
  const t = useT();
  const [which, setWhich] = useState<Lit>(OPENS_ON);
  /**
   * The row that came back, and which row it was an answer to.
   *
   * One piece of state rather than three, and it carries the question as well
   * as the answer. That is what lets "still waiting" be read off it — it is
   * the state not yet matching the row being asked for — rather than set at the
   * top of the effect, which is a synchronous render inside an effect and a
   * cascade waiting to happen.
   */
  const [shown, setShown] = useState<{ which: Lit; tracks: TrackMetadata[]; failed: boolean }>();

  useEffect(() => {
    let alive = true;
    spotlight(which).then(
      (row) => {
        if (alive) setShown({ which, tracks: row, failed: false });
      },
      () => {
        // Not remembered as an answer — `spotlight` keeps nothing from a
        // failure — so pressing the heading and coming back tries again.
        if (alive) setShown({ which, tracks: [], failed: true });
      },
    );
    return () => {
      alive = false;
    };
  }, [which]);

  const answer = shown?.which === which ? shown : undefined;
  const loading = answer === undefined;
  const tracks = answer?.tracks ?? [];
  const failed = answer?.failed ?? false;

  const heading = which === 'recent' ? t('spotlight.recent') : t('spotlight.top');

  return (
    <section className="shrink-0" aria-label={heading}>
      {/* The heading is the switch. One control rather than a heading and a
          segmented thing beside it: there are two rows, and the name of the one
          you are not looking at is the whole of what the other button would
          say. */}
      <button
        type="button"
        onClick={() => setWhich((now) => (now === 'recent' ? 'top' : 'recent'))}
        className="flex items-center gap-1 px-0.5 pb-1 text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase transition-colors hover:text-brass-300"
      >
        {heading}
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3 w-3 fill-none stroke-current">
          <path d="M4 6.5 8 10.5 12 6.5" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      <div
        className="flex gap-2.5 overflow-x-auto pb-1"
        // A row of records is read by running along it, so it scrolls sideways
        // and nothing wraps. The height is the card's, which is the disc plus
        // the two lines under it.
        style={{ scrollbarWidth: 'none' }}
      >
        {loading && <Waiting />}
        {!loading && failed && (
          <p className="px-0.5 py-3 text-meta text-cream-400/70">{t('spotlight.failed')}</p>
        )}
        {!loading && !failed && tracks.length === 0 && (
          <p className="px-0.5 py-3 text-meta text-cream-400/70">{t('spotlight.empty')}</p>
        )}
        {!loading &&
          tracks.map((track) => <Card key={track.id} track={track} />)}
      </div>
    </section>
  );
}

/** Empty cells while the row is being fetched, so nothing jumps when it lands. */
function Waiting() {
  return (
    <>
      {Array.from({ length: 7 }, (_, at) => (
        <div key={at} className="shrink-0" style={{ width: DISC_SIZE }}>
          <div
            className="groove-inset w-full rounded-md"
            style={{ height: DISC_SIZE }}
            aria-hidden="true"
          />
        </div>
      ))}
    </>
  );
}

/**
 * One record on the shelf: sleeve, disc across it, and what it is underneath.
 *
 * The disc sits on the sleeve rather than in it. In a crate a record is
 * *inside* its cover and has to be pulled out, which is the crate's whole
 * gesture; there is no crate here, so there is nothing to pull it from and the
 * record simply lies on its sleeve the way one does on a shelf.
 */
function Card({ track }: { track: TrackMetadata }) {
  const t = useT();
  const { flyToPlatter, platterEl } = useDiscFlight();
  const { grab, moveTo, release, cancel } = useDiscHold();
  const playSingle = usePlayerStore((s) => s.playSingle);
  const onDeck = usePlayerStore((s) => s.currentTrack?.id);
  const carried = useCarriedTrack();

  const disc = useRef<HTMLSpanElement | null>(null);
  /** Whether the press that is ending turned into a drag. */
  const dragged = useRef(false);

  /** The record is not on the shelf: it is on the deck or in somebody's hand. */
  const away = onDeck === track.id || carried === track.id;

  const deliver = useCallback(
    (taken: TrackMetadata) => {
      void playSingle(taken);
    },
    [playSingle],
  );

  /**
   * Carry the record off the shelf.
   *
   * Nothing happens until the pointer has travelled: a press that does not move
   * is a click, and lifting on `pointerdown` makes every click look like a
   * fumble. The listeners go on the window because where the record is set down
   * is the other half of it, and this card is not involved in that.
   */
  const carry = useCallback(
    (down: React.PointerEvent) => {
      const homeEl = disc.current;
      if (down.button !== 0 || !homeEl) return;
      const from = { x: down.clientX, y: down.clientY };
      let at = from;
      let holding = false;
      let letGo: 'up' | 'cancel' | null = null;

      const move = (e: PointerEvent) => {
        at = { x: e.clientX, y: e.clientY };
        if (holding) {
          moveTo(at.x, at.y);
          return;
        }
        if (Math.hypot(at.x - from.x, at.y - from.y) < DRAG_THRESHOLD) return;
        holding = true;
        // The click still to come from this same press is told it was a drag,
        // so the track is not also started where the record was let go.
        dragged.current = true;
        grab({
          track,
          homeEl,
          homeSize: DISC_SIZE,
          pointer: at,
          visiting: { deckEl: platterEl(), onDelivered: deliver },
        });
        if (letGo === 'up') release();
        else if (letGo === 'cancel') cancel();
      };

      const drop = (e: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', drop);
        window.removeEventListener('pointercancel', stop);
        if (!holding) {
          letGo = 'up';
          return;
        }
        moveTo(e.clientX, e.clientY);
        release();
      };

      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', drop);
        window.removeEventListener('pointercancel', stop);
        if (holding) cancel();
        else letGo = 'cancel';
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', drop);
      window.addEventListener('pointercancel', stop);
    },
    [track, grab, moveTo, release, cancel, platterEl, deliver],
  );

  return (
    <button
      type="button"
      className="group relative shrink-0 text-left"
      style={{ width: DISC_SIZE }}
      title={`${track.title} — ${track.artist}`}
      aria-label={away ? t('spotify.onDeck') : `${track.title} — ${track.artist}`}
      onPointerDown={carry}
      onClick={() => {
        // The drag already put it somewhere; the click that follows the same
        // press has nothing left to do.
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        if (away) return;
        if (disc.current) flyToPlatter(disc.current, track);
        deliver(track);
      }}
    >
      <span
        className="relative block w-full overflow-hidden rounded-md bg-shell-900"
        style={{ height: DISC_SIZE }}
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
      {/* Outside the sleeve's clip, so the record has somewhere to go when it
          is lifted. `data-disc` is what the flight picks up and scales. */}
      <span
        ref={disc}
        data-disc
        className={`absolute top-0 left-0 transition-transform group-hover:-translate-y-0.5 ${
          away ? 'invisible' : ''
        }`}
        style={{ width: DISC_SIZE, height: DISC_SIZE }}
      >
        <VinylDisc size={DISC_SIZE} coverArtUrl={track.coverArtUrl} />
      </span>
      <span className="relative mt-1 flex min-w-0 flex-col text-center">
        <span className="truncate text-meta text-cream-100">{track.title}</span>
        <span className="truncate text-label text-cream-400">{track.artist}</span>
      </span>
    </button>
  );
}
