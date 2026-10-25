import { useCallback, useRef } from 'react';
import { useDiscFlight } from '@/components/player/DiscFlight';
import { useCarriedTrack, useDiscHold } from '@/components/player/DiscHold';
import { VinylDisc } from '@/components/player/VinylDisc';
import { usePlayerStore } from '@/core/store';
import { useT } from '@/core/i18n';
import type { TrackMetadata } from '@/core/types';
import { useUnplayable, whyUnplayable } from '@/core/spotify/playable';
import { refuseUnplayable, UNPLAYABLE_LOOK, UnplayableTag } from './Unplayable';

/** The sleeve's side. The cell is this wide; the sleeve is square. */
export const RECORD_SIZE = 78;
/** The record in it, as a playlist's sleeve holds its own: `w-[92%]`. */
const DISC_SIZE = Math.round(RECORD_SIZE * 0.92);

/** How far the pointer travels before a press is a drag rather than a click. */
const DRAG_THRESHOLD = 6;

/**
 * One record on the shelf: its sleeve, the record in the sleeve's opening, and
 * what it is underneath.
 *
 * The same sleeve a playlist is on. The record used to lie across the sleeve,
 * which covered all of the cover but its corners, and a row of them read as a
 * row of black circles; and the playlists beside them were a different card
 * altogether. Now the cover is the whole sleeve, the record shows in the cut
 * at its edge and slides out a little when the pointer comes, and every card
 * in the drawer is the same object with its name under it.
 */
export function RecordCard({
  track,
  onPlay,
  heard,
}: {
  track: TrackMetadata;
  /** Where it was last heard, on a shelf of what was heard lately. */
  heard?: 'here' | 'elsewhere';
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
  /** Why Spotify will not play it here, if it will not: it stays, greyed, and says so when pressed. */
  const refused = useUnplayable(track);

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
      style={{ width: RECORD_SIZE }}
      title={refused ? whyUnplayable(refused) : `${track.title} — ${track.artist}`}
      aria-label={away ? t('spotify.onDeck') : `${track.title} — ${track.artist}`}
      aria-disabled={refused ? true : undefined}
      onPointerDown={refused ? undefined : carry}
      onClick={(e) => {
        if (refused) {
          refuseUnplayable(e.currentTarget, refused);
          return;
        }
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
        className={`groove-sleeve-body relative block w-full transition-transform duration-200 ${
          refused ? UNPLAYABLE_LOOK : 'group-hover:-translate-y-0.5'
        }`}
        style={{ height: RECORD_SIZE }}
      >
        {/* The record, behind the sleeve and flush with its opening edge, so
            all anyone sees of it is the crescent in the cut — until the
            pointer comes, when it slides out a little. `data-disc` is what the
            flight picks up and scales. */}
        <span
          ref={disc}
          data-disc
          className={`absolute right-0 transition-transform duration-200 ${away ? 'invisible' : ''} ${
            refused ? '' : 'group-hover:translate-x-3'
          }`}
          style={{ top: (RECORD_SIZE - DISC_SIZE) / 2, width: DISC_SIZE, height: DISC_SIZE }}
        >
          <VinylDisc size={DISC_SIZE} coverArtUrl={track.coverArtUrl} />
        </span>
        <span className="groove-sleeve-art absolute inset-0 overflow-hidden rounded-md bg-shell-900">
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
        {refused && <UnplayableTag />}
        {heard && !refused && <HeardMark where={heard} />}
      </span>
      <span className={`relative mt-1.5 flex min-w-0 flex-col ${refused ? UNPLAYABLE_LOOK : ''}`}>
        <span className="truncate text-body font-medium text-cream-50">{track.title}</span>
        <span className="truncate text-meta text-cream-400">{track.artist}</span>
      </span>
    </button>
  );
}

/**
 * Where a song on the recent shelf was heard: a record for this app, a phone
 * for anywhere else Spotify plays.
 *
 * In the sleeve's lower corner on the side away from the record, so it never
 * sits on the part that slides out, and small: it answers a question somebody
 * might have, and is not the thing they are looking at.
 */
function HeardMark({ where }: { where: 'here' | 'elsewhere' }) {
  const t = useT();
  const label = where === 'here' ? t('home.heardHere') : t('home.heardElsewhere');
  return (
    <span
      title={label}
      className="absolute bottom-1 left-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-shell-900/85 text-brass-400"
    >
      {where === 'here' ? (
        <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true" fill="none" stroke="currentColor">
          <circle cx="5" cy="5" r="4" strokeWidth="1.2" />
          <circle cx="5" cy="5" r="1" fill="currentColor" stroke="none" />
        </svg>
      ) : (
        <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
          <rect x="2.8" y="1" width="4.4" height="8" rx="1" />
          <path d="M4.4 7.4h1.2" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}
