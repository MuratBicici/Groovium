import { useCallback, useRef } from 'react';
import { useDiscFlight } from '@/components/player/DiscFlight';
import { useCarriedTrack, useDiscHold } from '@/components/player/DiscHold';
import { VinylDisc } from '@/components/player/VinylDisc';
import { usePlayerStore } from '@/core/store';
import { useT } from '@/core/i18n';
import type { TrackMetadata } from '@/core/types';

/** The record's diameter. The cell is this wide; the sleeve is square. */
export const RECORD_SIZE = 70;
const DISC_SIZE = RECORD_SIZE;

/** How far the pointer travels before a press is a drag rather than a click. */
const DRAG_THRESHOLD = 6;

/**
 * One record on the shelf: sleeve, disc across it, and what it is underneath.
 *
 * The disc sits on the sleeve rather than in it. In a crate a record is
 * *inside* its cover and has to be pulled out, which is the crate's whole
 * gesture; there is no crate here, so there is nothing to pull it from and the
 * record simply lies on its sleeve the way one does on a shelf.
 */
export function RecordCard({
  track,
  onPlay,
}: {
  track: TrackMetadata;
  /**
   * What starting it means where it lies: one song on its own from a
   * spotlight row, or a place in the library that playing carries on through.
   */
  onPlay: (track: TrackMetadata) => unknown;
}) {
  const t = useT();
  const { flyToPlatter, platterEl } = useDiscFlight();
  const { grab, moveTo, release, cancel } = useDiscHold();
  const onDeck = usePlayerStore((s) => s.currentTrack?.id);
  const carried = useCarriedTrack();

  const disc = useRef<HTMLSpanElement | null>(null);
  /** Whether the press that is ending turned into a drag. */
  const dragged = useRef(false);

  /** The record is not on the shelf: it is on the deck or in somebody's hand. */
  const away = onDeck === track.id || carried === track.id;

  const deliver = useCallback(
    (taken: TrackMetadata) => {
      void onPlay(taken);
    },
    [onPlay],
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
            // Asked the way every cover is — see `Sleeve` in VinylDisc.
            crossOrigin="anonymous"
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
