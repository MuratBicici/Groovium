import { useEffect, useRef, useState } from 'react';
import type { TrackMetadata } from '@/core/types';
import { useCurrentTrack, useIsPlaying } from '@/core/store';
import { prefersReducedMotion } from '@/core/utils/motion';
import { useDiscFlight, usePendingLanding } from './DiscFlight';
import { DiscLight } from './DiscLight';
import { Tonearm } from './Tonearm';
import { VinylDisc } from './VinylDisc';

/** Disc diameter. The flight layer lands on exactly this size. */
const DISC_SIZE = 152;

/** Tempo of the record swap — a shade quicker than the tonearm's 700ms. */
const SWAP_MS = 450;

/**
 * The record deck. The disc itself is the shared `VinylDisc`, so the platter,
 * the row thumbnails and the flying clone are all the same drawing.
 *
 * Track changes are staged like a record changer: the old disc lifts up and
 * away, the new one drops onto the spindle. When the change came from a row
 * click the platter stays *empty* instead — the disc is still in the air, and
 * the flying clone is the record until it lands.
 */
export function DiskPlatter({ stowed = false }: { stowed?: boolean }) {
  const isPlaying = useIsPlaying();
  const track = useCurrentTrack();
  const { registerPlatter, didJustLand } = useDiscFlight();
  const pendingTrackId = usePendingLanding();

  /** Entrance transforms live here — the spin owns the disc's own transform. */
  const dropRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const prevTrackRef = useRef<TrackMetadata | null>(null);
  const [ghost, setGhost] = useState<TrackMetadata | null>(null);

  /** This track's disc is still flying; the deck must look empty. */
  const awaitingLanding = pendingTrackId !== null && track?.id === pendingTrackId;

  useEffect(() => {
    const prev = prevTrackRef.current;
    prevTrackRef.current = track;

    // Same identity means a metadata re-emission (cover art arriving, a
    // provider echo), not a transition. Object comparison would be wrong here:
    // the local provider republishes the same track with new fields.
    if ((prev?.id ?? null) === (track?.id ?? null)) return;
    if (prefersReducedMotion()) return;

    // Cancel first, unconditionally: a provider switch nulls the track on its
    // way to another source, and an entrance left running would keep animating
    // an empty deck through that window.
    dropRef.current?.getAnimations().forEach((a) => a.cancel());

    // The old record lifts away. Also during a flight: watching it leave while
    // the new one arcs in is the record-changer read.
    if (prev) setGhost(prev);

    const drop = dropRef.current;
    if (!drop || !track) return;
    // A landing clone is the entrance; running both shows two discs arriving.
    // `didJustLand` covers the slow paths, where the track becomes current in
    // the same commit that hands the disc over — by then `pendingTrackId` has
    // already cleared, and without this the record would drop in a second time.
    if (pendingTrackId === track.id || didJustLand(track.id)) return;

    drop.animate(
      [
        { transform: 'translateY(-40px) scale(0.92)', opacity: 0 },
        { transform: 'translateY(0) scale(1)', opacity: 1 },
      ],
      // The delay lets the exit read first; `backwards` holds the hidden
      // pose through it.
      { duration: SWAP_MS, delay: 120, easing: 'ease-out', fill: 'backwards' },
    );
    // `pendingTrackId` is read, not depended on: a flight landing must not
    // retrigger the entrance the landing was meant to replace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

  useEffect(() => {
    if (!ghost) return;
    const el = ghostRef.current;
    if (!el) {
      setGhost(null);
      return;
    }

    const animation = el.animate(
      [
        { transform: 'translateY(0)', opacity: 1 },
        { transform: 'translateY(-190px)', opacity: 0 },
      ],
      // ease-in: it accelerates away, like a record being lifted off.
      { duration: SWAP_MS, easing: 'ease-in', fill: 'forwards' },
    );

    let done = false;
    const clear = () => {
      if (done) return;
      done = true;
      setGhost(null);
    };
    animation.onfinish = clear;
    const failsafe = setTimeout(clear, SWAP_MS + 300);

    return () => {
      clearTimeout(failsafe);
      animation.cancel();
    };
  }, [ghost]);

  return (
    <div
      ref={registerPlatter}
      className="relative mx-auto flex h-[168px] w-[168px] items-center justify-center"
    >
      {/* Well the platter sits in, so the disk reads as recessed into the
          shell. Inset rather than filling the wrapper: at the full 168 it left
          an 8px ring of near-black around a 152px record, which with the
          disc's own shadow on top read as a halo rather than as a recess. */}
      <div
        className={`groove-inset absolute inset-[4px] rounded-full transition-opacity duration-150 ${
          stowed ? 'opacity-0' : 'opacity-100'
        }`}
      />

      {/* Opacity, never transform: the spin below owns `transform`, and the
          flight measures this wrapper's centre, which must not move. */}
      {/* `data-morph` marks what the collapse animation measures. It sits on
          this wrapper rather than on the spinning element because a rotating
          square's bounding box grows toward its diagonal, and the measurement
          would come back up to 1.41x too large depending on the angle. */}
      {/* The spindle, which a record hides and an empty deck does not. Without
          it the well is just a dark circle; with it the deck is a deck, waiting
          for something to be put on it. A flex child rather than an absolute
          one, so the same centring that holds the record holds this. */}
      {!track && (
        <div
          aria-hidden="true"
          // `relative` so it paints above the well: the well is absolutely
          // positioned, and a positioned element covers a static sibling
          // whatever the order in the markup. The record's wrapper carries
          // `relative` for the same reason.
          className="relative h-[7px] w-[7px] rounded-full"
          style={{
            background:
              'linear-gradient(155deg, var(--color-brass-400), var(--color-brass-600))',
            boxShadow:
              '0 1px 3px rgba(0,0,0,0.7), inset 0 1px 0 rgb(var(--sheen) / 0.5)',
          }}
        />
      )}

      {/* No track, no record — the deck sits empty, the way a turntable does
          before you put something on it. The well and the arm stay: those are
          the machine, and the machine is there whether or not a record is. */}
      {track && (
        <div
          ref={dropRef}
          data-morph="disc"
          className="relative"
          // No fade when the deck is stowed. The record arriving in the
          // collapsed bar begins its travel at exactly this size and position,
          // so this one can go at once and nothing shows the seam — where a
          // fade left a second record sitting in the old place for the length
          // of it.
          style={{ opacity: awaitingLanding || stowed ? 0 : 1 }}
        >
          {/* The spin stays on its own element; entrance and exit transforms
              wrap it rather than fighting the keyframe for `transform`. */}
          <div className="groove-platter" data-spinning={isPlaying}>
            <VinylDisc size={DISC_SIZE} coverArtUrl={track.coverArtUrl} />
          </div>
          {/* Sibling, not child: the light stays where it is while the record
              turns under it. Inside the spinning element it orbited the room. */}
          <DiscLight size={DISC_SIZE} />
        </div>
      )}

      {/* The departing record, drawn over the live one while it lifts away.
          `z-10` puts it alongside the flight layer, so the two halves of one
          record change share a depth. Both stay under the panels: pressing
          Next with a menu open should not throw a disc over it. Keyed by track
          so a rapid second change restarts cleanly instead of sliding the
          outgoing disc back down. */}
      {ghost && !stowed && (
        <div
          key={ghost.id}
          ref={ghostRef}
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
          aria-hidden="true"
        >
          <div className="relative">
            <div className="groove-platter" data-spinning={isPlaying}>
              <VinylDisc size={DISC_SIZE} coverArtUrl={ghost.coverArtUrl} />
            </div>
            <DiscLight size={DISC_SIZE} />
          </div>
        </div>
      )}

      <Tonearm stowed={stowed} />
    </div>
  );
}
