import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
 *
 * The clone is not decoration over a platter that has already changed — it
 * *is* the platter's disc until it lands. `pendingTrackId` tells the platter to
 * stay empty until then, so a track change shows one record, not three.
 */

/** Platter disc diameter — the flight's landing size. */
const PLATTER_SIZE = 152;

/** Sits with the tonearm's 700ms swing, the app's established tempo. */
const FLIGHT_MS = 650;

/** Crossfade into the real platter once the track is actually loaded. */
const SETTLE_MS = 150;

/**
 * How long the landed clone waits for the store to catch up.
 *
 * Local tracks are instant, but a Spotify track only becomes `currentTrack`
 * after the provider initialises and the device is claimed — routinely more
 * than a second. The clone rests on the platter through that, which is exactly
 * what a record waiting for the needle looks like. Past this, playback is not
 * coming and the clone bows out.
 */
const HOLD_MS = 2500;

interface Flight {
  key: number;
  track: TrackMetadata;
  from: DOMRect;
  /** The row's own disc, hidden while its copy is in the air. */
  source: HTMLElement;
}

interface DiscFlightActions {
  /** DiskPlatter hands over its stable wrapper so flights know where to land. */
  registerPlatter: (el: HTMLElement | null) => void;
  /** Throw a clone of `sourceDisc` onto the platter. */
  flyToPlatter: (sourceDisc: HTMLElement, track: TrackMetadata) => void;
  /**
   * Whether this track's disc arrived by air a moment ago.
   *
   * Deliberately a ref read, not state: on the slow paths the track becomes
   * current *at the same moment* the flight hands over, and the platter's
   * effect would otherwise see the handoff already done and play an entrance
   * for a record that just landed. A ref is written synchronously, so the
   * effect sees it. Visibility stays on state — that is the half where a
   * missed update would strand the platter invisible.
   */
  didJustLand: (trackId: string) => boolean;
}

/**
 * The default complains, for the same reason the playlist picker's does: a
 * missing provider would otherwise present as clicks that mysteriously do
 * nothing extra, with no clue why.
 */
const ActionsContext = createContext<DiscFlightActions>({
  registerPlatter: () => {},
  flyToPlatter: () => {
    console.error('[disc-flight] used outside DiscFlightProvider — no disc will fly.');
  },
  didJustLand: () => false,
});

/** How long after a handoff the platter still treats an arrival as "landed". */
const JUST_LANDED_MS = 400;

/**
 * Split from the actions on purpose. Every row list calls `flyToPlatter`, and
 * a single context would re-render all of them the instant a flight launches —
 * a full reconcile of the library list on frame one of a 650ms animation. Only
 * the platter cares about this half.
 */
const PendingContext = createContext<string | null>(null);

export function useDiscFlight(): DiscFlightActions {
  return useContext(ActionsContext);
}

/** The track whose disc is still in the air, so the platter can stay empty. */
export function usePendingLanding(): string | null {
  return useContext(PendingContext);
}

export function DiscFlightProvider({ children }: { children: React.ReactNode }) {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [pendingTrackId, setPendingTrackId] = useState<string | null>(null);
  const platterRef = useRef<HTMLElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const nextKey = useRef(0);
  /** Airborne track ids, so a double click does not launch two clones. */
  const airborne = useRef(new Set<string>());
  /** trackId → handoff timestamp, for `didJustLand`. */
  const landedAt = useRef(new Map<string, number>());

  const registerPlatter = useCallback((el: HTMLElement | null) => {
    platterRef.current = el;
  }, []);

  const flyToPlatter = useCallback((sourceDisc: HTMLElement, track: TrackMetadata) => {
    // Without a destination or with motion reduced, the click still plays the
    // track — the flight is garnish, never a gate.
    if (prefersReducedMotion() || !platterRef.current) return;
    // A second click on the row whose disc is already on its way would launch a
    // duplicate and, when the first landed, uncover the platter mid-flight.
    if (airborne.current.has(track.id)) return;

    // Measured now, synchronously: the caller is about to close the panel, and
    // the rect must describe the row as the user saw it, not mid-dissolve.
    const from = sourceDisc.getBoundingClientRect();
    // The record leaves the row rather than duplicating itself.
    sourceDisc.style.visibility = 'hidden';

    airborne.current.add(track.id);
    setPendingTrackId(track.id);
    setFlights((current) => [...current, { key: nextKey.current++, track, from, source: sourceDisc }]);
  }, []);

  const didJustLand = useCallback((trackId: string) => {
    const at = landedAt.current.get(trackId);
    return at !== undefined && performance.now() - at < JUST_LANDED_MS;
  }, []);

  /** Reveal the platter now; the clone crossfades into it. */
  const handOff = useCallback((flight: Flight) => {
    // Written before the state update so the platter's effect, which may run in
    // the very same commit, can see that this record arrived by air.
    landedAt.current.set(flight.track.id, performance.now());
    setPendingTrackId((current) => (current === flight.track.id ? null : current));
  }, []);

  const endFlight = useCallback((flight: Flight) => {
    airborne.current.delete(flight.track.id);
    // Keep only entries still inside the window, so this cannot grow unbounded
    // across a long listening session.
    const now = performance.now();
    for (const [id, at] of landedAt.current) {
      if (now - at >= JUST_LANDED_MS) landedAt.current.delete(id);
    }
    flight.source.style.visibility = '';
    // Only clear if this flight still owns the slot — a newer flight may have
    // claimed it while this one was finishing.
    setPendingTrackId((current) => (current === flight.track.id ? null : current));
    setFlights((current) => current.filter((f) => f !== flight));
  }, []);

  const actions = useMemo(
    () => ({ registerPlatter, flyToPlatter, didJustLand }),
    [registerPlatter, flyToPlatter, didJustLand],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <PendingContext.Provider value={pendingTrackId}>
        {children}

        {/* z-10 — the disc-motion layer, above the stage and below the panels
            (see the layer table in App.tsx). A record is part of the deck, and
            the deck is what a panel covers. Rounded to match the shell, so a
            clipped edge follows the widget's corner. */}
        <div
          ref={layerRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-[var(--radius-widget)]"
        >
          {flights.map((flight) => (
            <FlyingDisc
              key={flight.key}
              flight={flight}
              platterEl={platterRef.current}
              layerEl={layerRef.current}
              onHandOff={handOff}
              onDone={endFlight}
            />
          ))}
        </div>
      </PendingContext.Provider>
    </ActionsContext.Provider>
  );
}

interface FlyingDiscProps {
  flight: Flight;
  platterEl: HTMLElement | null;
  layerEl: HTMLElement | null;
  onHandOff: (flight: Flight) => void;
  onDone: (flight: Flight) => void;
}

/**
 * One airborne clone. Renders at the platter's position at full size; the
 * animation carries it backwards from the row, so landing is the identity
 * transform and cannot miss.
 */
function FlyingDisc({ flight, platterEl, layerEl, onHandOff, onDone }: FlyingDiscProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const spinRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties | null>(null);
  const isPlaying = usePlayerStore((s) => s.playbackState === 'PLAYING');

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !platterEl || !layerEl) {
      onDone(flight);
      return;
    }

    /** Platter centre relative to the layer, which is the positioning parent. */
    const platterCentre = () => {
      const layer = layerEl.getBoundingClientRect();
      const dst = platterEl.getBoundingClientRect();
      return {
        x: dst.left + dst.width / 2 - layer.left,
        y: dst.top + dst.height / 2 - layer.top,
        layer,
      };
    };

    const start = platterCentre();
    const srcX = flight.from.left + flight.from.width / 2 - start.layer.left;
    const srcY = flight.from.top + flight.from.height / 2 - start.layer.top;

    setStyle({ left: start.x - PLATTER_SIZE / 2, top: start.y - PLATTER_SIZE / 2 });

    // Lift scales with the throw. A fixed clamp made every row below the
    // platter arc identically — a hop straight up rather than a throw — because
    // the old formula pinned itself to the ceiling for all of them. The upper
    // bound keeps the apex inside the widget.
    const distance = Math.hypot(srcX - start.x, srcY - start.y);
    const arcHeight = clamp(distance * 0.32, 18, Math.max(18, (srcY + start.y) / 2 - 24));

    const animation = wrapper.animate(
      arcKeyframes(
        { x: srcX - start.x, y: srcY - start.y, scale: flight.from.width / PLATTER_SIZE },
        { x: 0, y: 0, scale: 1 },
        arcHeight,
      ),
      { duration: FLIGHT_MS, easing: 'linear', fill: 'forwards' },
    );

    // Match the platter's rotation. Both run the same 4.5s linear spin, but a
    // freshly created element starts at 0deg while the platter's has been
    // turning since mount — without this the crossfade dissolves the same cover
    // between two different angles and the record visibly snaps.
    //
    // The registered element is the untransformed wrapper, so the spinning
    // child is what to read. First in document order is the live disc; a ghost
    // renders after it.
    const syncSpin = () => {
      const platterSpin = platterEl.querySelector('.groove-platter')?.getAnimations()[0];
      const cloneSpin = spinRef.current?.getAnimations()[0];
      if (platterSpin && cloneSpin && platterSpin.currentTime !== null) {
        cloneSpin.currentTime = platterSpin.currentTime;
      }
    };
    syncSpin();

    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let landed = false;
    let arrived = usePlayerStore.getState().currentTrack?.id === flight.track.id;

    /** Reveal the platter and crossfade into it. */
    const commit = () => {
      if (settled) return;
      settled = true;
      // The platter appears underneath first; the two are pixel-identical and
      // co-located, so the fade is a handoff rather than a dissolve.
      onHandOff(flight);
      wrapper.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SETTLE_MS, fill: 'forwards' });
      settleTimer = setTimeout(() => onDone(flight), SETTLE_MS);
    };

    /** The player went elsewhere: take the disc away without showing it land. */
    const abort = () => {
      if (settled) return;
      settled = true;
      // Hide before cancelling. `cancel()` drops the forwards fill, which would
      // snap the clone to full size dead centre on the platter for a frame.
      wrapper.style.opacity = '0';
      animation.cancel();
      onDone(flight);
    };

    const land = () => {
      // `onfinish` and the failsafe can both arrive; a second hold timer would
      // outlive the first and fire after the flight is gone.
      if (landed) return;
      landed = true;
      // The stage can move under a flight — an error banner or the import strip
      // appearing shrinks it. The destination was measured 650ms ago.
      const now = platterCentre();
      if (Math.abs(now.x - start.x) > 1 || Math.abs(now.y - start.y) > 1) {
        setStyle({ left: now.x - PLATTER_SIZE / 2, top: now.y - PLATTER_SIZE / 2 });
      }
      syncSpin();

      if (arrived) commit();
      // Otherwise rest on the platter until the track actually loads. Giving up
      // fades out rather than snapping, so a failed load ends quietly.
      else holdTimer = setTimeout(commit, HOLD_MS);
    };

    animation.onfinish = land;
    // Belt and braces: `finish` events have gone missing under heavy load.
    const failsafe = setTimeout(land, FLIGHT_MS + 400);

    // The cancellation rule. `startTrack` writes `currentTrack` synchronously,
    // so a second click, a track ending mid-flight or a station advance all
    // arrive here within a tick. A transient null is the provider-switch window
    // on the way to a different source, not a contradiction.
    const startId = usePlayerStore.getState().currentTrack?.id ?? null;
    const unsubscribe = usePlayerStore.subscribe((state) => {
      const nowId = state.currentTrack?.id ?? null;

      if (nowId === flight.track.id) {
        arrived = true;
        // Already resting on the platter and waiting for exactly this.
        if (animation.playState === 'finished') {
          clearTimeout(holdTimer);
          commit();
        }
        return;
      }
      // A failed provider leaves `currentTrack` null forever, so the id rule
      // alone would never fire and the disc would land on an empty deck.
      if (state.error && !arrived) {
        abort();
        return;
      }
      if (nowId === null) return;
      if (arrived || nowId !== startId) abort();
    });

    return () => {
      clearTimeout(failsafe);
      clearTimeout(settleTimer);
      clearTimeout(holdTimer);
      unsubscribe();
      animation.cancel();
    };
    // A flight is immutable once launched; everything it needs is captured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrapperRef} className="absolute" style={style ?? { visibility: 'hidden' }}>
      {/* The spin lives on its own element so it cannot fight the WAAPI
          transform on the wrapper — same separation the platter uses. */}
      <div ref={spinRef} className="groove-platter" data-spinning={isPlaying}>
        <VinylDisc size={PLATTER_SIZE} sheen eager coverArtUrl={flight.track.coverArtUrl} />
      </div>
    </div>
  );
}
