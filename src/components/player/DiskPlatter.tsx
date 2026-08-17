import { useEffect, useRef, useState } from 'react';
import type { TrackMetadata } from '@/core/types';
import { useCurrentTrack, useIsPlaying } from '@/core/store';
import { prefersReducedMotion } from '@/core/utils/motion';
import { useDiscFlight } from './DiscFlight';
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
 * click, the drop is suppressed — the flight's landing clone IS the entrance,
 * and running both would show two discs arriving.
 */
export function DiskPlatter() {
  const isPlaying = useIsPlaying();
  const track = useCurrentTrack();
  const { registerPlatter, isFlightFor } = useDiscFlight();

  /** Entrance transforms live here — the spin owns the disc's own transform. */
  const dropRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const prevTrackRef = useRef<TrackMetadata | null>(null);
  const [ghost, setGhost] = useState<TrackMetadata | null>(null);

  useEffect(() => {
    const prev = prevTrackRef.current;
    prevTrackRef.current = track;

    // Same identity means a metadata re-emission (cover art arriving, a
    // provider echo), not a transition. Object comparison would be wrong here:
    // the local provider republishes the same track with new fields.
    if ((prev?.id ?? null) === (track?.id ?? null)) return;
    if (prefersReducedMotion()) return;

    // The old record lifts away. Also mid-flight: watching it leave while the
    // new one arcs in is the record-changer read.
    if (prev) setGhost(prev);

    const drop = dropRef.current;
    if (!drop || !track) return;
    drop.getAnimations().forEach((a) => a.cancel());
    if (isFlightFor(track.id)) return;

    drop.animate(
      [
        { transform: 'translateY(-40px) scale(0.92)', opacity: 0 },
        { transform: 'translateY(0) scale(1)', opacity: 1 },
      ],
      // The delay lets the exit read first; `backwards` holds the hidden
      // pose through it.
      { duration: SWAP_MS, delay: 120, easing: 'ease-out', fill: 'backwards' },
    );
  }, [track, isFlightFor]);

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
    <div className="relative mx-auto flex h-[168px] w-[168px] items-center justify-center">
      {/* Well the platter sits in, so the disk reads as recessed into the shell. */}
      <div className="absolute inset-0 rounded-full bg-shell-900 shadow-[inset_0_2px_8px_rgba(0,0,0,0.8)]" />

      <div ref={dropRef} className="relative">
        {/* The spin stays on its own element; entrance and exit transforms
            wrap it rather than fighting the keyframe for `transform`. */}
        <div ref={registerPlatter} className="groove-platter" data-spinning={isPlaying}>
          <VinylDisc size={DISC_SIZE} sheen coverArtUrl={track?.coverArtUrl} />
        </div>
      </div>

      {/* The departing record, drawn over the live one while it lifts away. */}
      {ghost && (
        <div ref={ghostRef} className="pointer-events-none absolute top-2 left-2" aria-hidden="true">
          <div className="groove-platter" data-spinning={true}>
            <VinylDisc size={DISC_SIZE} coverArtUrl={ghost.coverArtUrl} />
          </div>
        </div>
      )}

      <Tonearm engaged={isPlaying} />
    </div>
  );
}

/** Placeholder tonearm. Swings in when playback starts. */
function Tonearm({ engaged }: { engaged: boolean }) {
  return (
    <div
      className="absolute top-2 right-0 origin-top-right transition-transform duration-700 ease-out"
      style={{ transform: `rotate(${engaged ? 22 : 0}deg)` }}
      aria-hidden="true"
    >
      <div className="flex flex-col items-center">
        <div className="h-3 w-3 rounded-full bg-brass-500 shadow-[0_1px_3px_rgba(0,0,0,0.6)]" />
        <div className="h-16 w-[3px] rounded-full bg-gradient-to-b from-brass-400 to-brass-600" />
        <div className="h-2.5 w-1.5 rounded-sm bg-cream-400" />
      </div>
    </div>
  );
}
