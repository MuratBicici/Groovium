import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { TrackMetadata } from '@/core/types';
import { usePlayerStore } from '@/core/store';
import { arcKeyframes, prefersReducedMotion } from '@/core/utils/motion';
import { clamp } from '@/core/utils/time';
import { VinylDisc } from './VinylDisc';

/**
 * The flying disc: click a row, its record arcs up out of the list and lands
 * on the platter.
 *
 * One layer for the whole window, for the same reason the playlist picker is
 * one sheet: rows live in `overflow-y-auto` lists inside panels, and anything
 * rendered among them gets clipped the moment it moves. The clone flies in a
 * shell-level layer that nothing scrolls and nothing overlaps.
 */

/** Platter disc diameter — the flight's landing size. */
const PLATTER_SIZE = 152;

/** Sits with the tonearm's 700ms swing, the app's established tempo. */
const FLIGHT_MS = 650;

/** How long the landed clone lingers while fading into the real platter. */
const SETTLE_MS = 150;

/**
 * How long after landing `isFlightFor` keeps answering true. The platter's
 * track-change effect runs when React flushes, which may be after the clone
 * is already gone; the grace period keeps the two from double-animating.
 */
const LANDED_GRACE_MS = 300;

interface Flight {
  key: number;
  track: TrackMetadata;
  from: DOMRect;
}

interface DiscFlightApi {
  /** DiskPlatter hands over its disc element so flights know where to land. */
  registerPlatter: (el: HTMLElement | null) => void;
  /** Throw a clone of `sourceDisc` onto the platter. */
  flyToPlatter: (sourceDisc: HTMLElement, track: TrackMetadata) => void;
  /**
   * Whether a flight for this track is airborne or freshly landed. The platter
   * consults it to skip its own entrance animation — the landing clone IS that
   * entrance. Reads a ref, so it is safe to call from effects mid-flight.
   */
  isFlightFor: (trackId: string) => boolean;
}

/**
 * The default complains, for the same reason the playlist picker's does: a
 * missing provider would otherwise present as clicks that mysteriously do
 * nothing extra, with no clue why.
 */
const Context = createContext<DiscFlightApi>({
  registerPlatter: () => {},
  flyToPlatter: () => {
    console.error('[disc-flight] used outside DiscFlightProvider — no disc will fly.');
  },
  isFlightFor: () => false,
});

export function useDiscFlight(): DiscFlightApi {
  return useContext(Context);
}

export function DiscFlightProvider({ children }: { children: React.ReactNode }) {
  const [flights, setFlights] = useState<Flight[]>([]);
  const platterRef = useRef<HTMLElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  /** trackId → landing timestamp, or Infinity while airborne. */
  const liveFlights = useRef(new Map<string, number>());
  const nextKey = useRef(0);

  const registerPlatter = useCallback((el: HTMLElement | null) => {
    platterRef.current = el;
  }, []);

  const isFlightFor = useCallback((trackId: string) => {
    const landedAt = liveFlights.current.get(trackId);
    if (landedAt === undefined) return false;
    return landedAt === Infinity || performance.now() - landedAt < LANDED_GRACE_MS;
  }, []);

  const flyToPlatter = useCallback((sourceDisc: HTMLElement, track: TrackMetadata) => {
    // Without a destination or with motion reduced, the click still plays the
    // track — the flight is garnish, never a gate.
    if (prefersReducedMotion() || !platterRef.current) return;

    // Measured now, synchronously: the caller is about to close the panel, and
    // the rect must describe the row as the user saw it, not mid-dissolve.
    const from = sourceDisc.getBoundingClientRect();

    liveFlights.current.set(track.id, Infinity);
    setFlights((current) => [...current, { key: nextKey.current++, track, from }]);
  }, []);

  const endFlight = useCallback((flight: Flight, landed: boolean) => {
    if (landed) liveFlights.current.set(flight.track.id, performance.now());
    else liveFlights.current.delete(flight.track.id);
    setFlights((current) => current.filter((f) => f !== flight));
  }, []);

  return (
    <Context.Provider value={{ registerPlatter, flyToPlatter, isFlightFor }}>
      {children}

      {/* z-40: above the panels (unlayered), the picker sheet (z-20) and its
          toast (z-30). Nothing may occlude a disc in flight. */}
      <div
        ref={layerRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-40 overflow-hidden"
      >
        {flights.map((flight) => (
          <FlyingDisc
            key={flight.key}
            flight={flight}
            platterEl={platterRef.current}
            layerEl={layerRef.current}
            onDone={endFlight}
          />
        ))}
      </div>
    </Context.Provider>
  );
}

interface FlyingDiscProps {
  flight: Flight;
  platterEl: HTMLElement | null;
  layerEl: HTMLElement | null;
  onDone: (flight: Flight, landed: boolean) => void;
}

/**
 * One airborne clone. Renders at the platter's position at full size; the
 * animation carries it backwards from the row, so landing is the identity
 * transform and cannot miss.
 */
function FlyingDisc({ flight, platterEl, layerEl, onDone }: FlyingDiscProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !platterEl || !layerEl) {
      onDone(flight, false);
      return;
    }

    // All geometry relative to the layer, not the viewport — they coincide in
    // this window, but the layer is the positioning parent, so it is the truth.
    const layer = layerEl.getBoundingClientRect();
    const dst = platterEl.getBoundingClientRect();
    const dstX = dst.left + dst.width / 2 - layer.left;
    const dstY = dst.top + dst.height / 2 - layer.top;
    const srcX = flight.from.left + flight.from.width / 2 - layer.left;
    const srcY = flight.from.top + flight.from.height / 2 - layer.top;

    setStyle({ left: dstX - PLATTER_SIZE / 2, top: dstY - PLATTER_SIZE / 2 });

    // Lift above the higher endpoint, clamped so the apex stays inside the
    // widget instead of vanishing behind the window chrome.
    const arcHeight = clamp(Math.min(srcY, dstY) - 86, 24, 72);

    const animation = wrapper.animate(
      arcKeyframes(
        { x: srcX - dstX, y: srcY - dstY, scale: flight.from.width / PLATTER_SIZE },
        { x: 0, y: 0, scale: 1 },
        arcHeight,
      ),
      { duration: FLIGHT_MS, easing: 'linear', fill: 'forwards' },
    );

    let finished = false;
    const finish = (landed: boolean) => {
      if (finished) return;
      finished = true;
      if (landed) {
        // Linger briefly while fading: underneath, the real platter already
        // shows this track, so the crossfade is the handoff.
        wrapper.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: SETTLE_MS,
          fill: 'forwards',
        });
        setTimeout(() => onDone(flight, true), SETTLE_MS);
      } else {
        animation.cancel();
        onDone(flight, false);
      }
    };

    animation.onfinish = () => finish(true);
    // Belt and braces: `finish` events have gone missing under heavy load.
    const failsafe = setTimeout(() => finish(true), FLIGHT_MS + 400);

    // The one cancellation rule: the flight dies the moment the player commits
    // to some other track. `startTrack` writes `currentTrack` synchronously,
    // so a second click, a track ending mid-flight, or a station advance all
    // land here within a tick. The transient null from a provider switch is
    // "not yet contradicted" and keeps the flight alive.
    const startId = usePlayerStore.getState().currentTrack?.id ?? null;
    const unsubscribe = usePlayerStore.subscribe((state) => {
      const nowId = state.currentTrack?.id ?? null;
      if (nowId !== null && nowId !== startId && nowId !== flight.track.id) {
        finish(false);
      }
    });

    return () => {
      clearTimeout(failsafe);
      unsubscribe();
      animation.cancel();
    };
    // A flight is immutable once launched; everything it needs is captured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrapperRef} className="absolute" style={style ?? { visibility: 'hidden' }}>
      {/* The spin lives on this inner element so it cannot fight the WAAPI
          transform on the wrapper — same separation the platter uses. */}
      <div className="groove-platter" data-spinning={true}>
        <VinylDisc size={PLATTER_SIZE} coverArtUrl={flight.track.coverArtUrl} />
      </div>
    </div>
  );
}
