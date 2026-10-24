import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { TrackMetadata } from '@/core/types';
import { usePlayerStore } from '@/core/store';
import { useSettingsStore } from '@/core/settings/store';
import { arcKeyframes, onReducedMotionChange, prefersReducedMotion } from '@/core/utils/motion';
import { clamp } from '@/core/utils/time';
import { readCover } from '@/core/theme/readCover';
import { DiscLight } from './DiscLight';
import { VinylDisc } from './VinylDisc';
import { parseCssColour, type Rgb } from '@/core/utils/colour';
import { FALLING_SPIN, glowing, meteorAt, METEOR_MS, meteorKeyframes } from './meteor';

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
 * what a record waiting for the needle looks like.
 *
 * This is only how often the wait is reconsidered, not how long it lasts. It
 * used to be the whole of it, and on a cold start — the SDK loading, a token,
 * a device to claim — the track takes longer than any number that is not a
 * guess. The clone gave up, the deck had nothing on it yet, and the record
 * somebody had just put on vanished until the music started. Now the store
 * says while a track is on its way (`starting`), and the wait lasts as long as
 * that does; this is the pulse that asks.
 */
const HOLD_MS = 2500;

interface Flight {
  key: number;
  track: TrackMetadata;
  from: DOMRect;
  /** The row's own disc, hidden while its copy is in the air. */
  source: HTMLElement;
  /** Falling like a meteor rather than thrown, as the Song pick animation setting says. */
  meteor?: boolean;
}

/** Where a meteor struck, for the light and sparks it leaves behind. */
interface Impact {
  key: number;
  /** Layer coordinates of the platter's centre when it struck. */
  x: number;
  y: number;
  colour: Rgb;
  /** What was left of its tail, to fade where it was. */
  tail: TailPoint[];
}

interface DiscFlightActions {
  /** DiskPlatter hands over its stable wrapper so flights know where to land. */
  registerPlatter: (el: HTMLElement | null) => void;
  /**
   * Send a clone of `sourceDisc` to the platter: thrown there in an arc, or
   * falling like a meteor, as the Song pick animation setting says.
   */
  flyToPlatter: (sourceDisc: HTMLElement, track: TrackMetadata) => void;
  /**
   * The deck, for anything carrying a record towards it by hand.
   *
   * A function rather than a value: the platter is registered from a callback
   * ref, and anything reading it during render would be asking before the
   * answer exists. Null when no deck is mounted, which is the answer a carry
   * needs in order to refuse rather than guess.
   */
  platterEl: () => HTMLElement | null;
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
  platterEl: () => null,
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
  const [impacts, setImpacts] = useState<Impact[]>([]);
  const meteorLayerRef = useRef<HTMLDivElement | null>(null);
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
    // The record leaves the row rather than duplicating itself — but not yet.
    // Hiding it here hid it before React had committed anything, and the
    // browser painted at least one frame with the record nowhere: gone from the
    // row and not yet in the air. The clone hides it, in the commit that puts
    // the clone on screen (see `FlyingDisc`), so the two swap within one frame.

    airborne.current.add(track.id);
    setPendingTrackId(track.id);
    const flight: Flight = { key: nextKey.current++, track, from, source: sourceDisc };
    // Read at the press, so a change of the setting is the next flight's.
    if (useSettingsStore.getState().pickAnimation === 'meteor') flight.meteor = true;
    setFlights((current) => [...current, flight]);
  }, []);

  /** A meteor struck the platter: its light and sparks outlive the record's flight. */
  const strike = useCallback((impact: Omit<Impact, 'key'>) => {
    setImpacts((current) => [...current, { ...impact, key: nextKey.current++ }]);
  }, []);
  const faded = useCallback((key: number) => {
    setImpacts((current) => current.filter((i) => i.key !== key));
  }, []);

  const platterEl = useCallback(() => platterRef.current, []);

  const didJustLand = useCallback((trackId: string) => {
    const at = landedAt.current.get(trackId);
    return at !== undefined && performance.now() - at < JUST_LANDED_MS;
  }, []);

  /**
   * The clone is on screen, so the row's record can go.
   *
   * Here rather than in the clone, which only knows the element as a prop, and
   * in `flyToPlatter`, where it used to be, it ran before React had committed
   * anything — so the browser painted a frame with the record gone from the row
   * and not yet in the air.
   */
  const takeSource = useCallback((flight: Flight) => {
    flight.source.style.visibility = 'hidden';
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

  // Turning the setting on mid-flight should stop what is moving, not let it
  // finish. The CSS spin already reacts on its own.
  useEffect(
    () =>
      onReducedMotionChange((reduced) => {
        if (reduced) {
          setFlights([]);
          setImpacts([]);
        }
      }),
    [],
  );

  const actions = useMemo(
    () => ({ registerPlatter, flyToPlatter, platterEl, didJustLand }),
    [registerPlatter, flyToPlatter, platterEl, didJustLand],
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
          {flights
            .filter((flight) => !flight.meteor)
            .map((flight) => (
              <FlyingDisc
                key={flight.key}
                flight={flight}
                platterRef={platterRef}
                layerRef={layerRef}
                onAirborne={takeSource}
                onHandOff={handOff}
                onDone={endFlight}
              />
            ))}
        </div>

        {/* z-40 — a meteor falls over everything but the window's edge, for
            the second it is in the air: out of a panel, over the deck, and out
            of the search, which is a sheet at z-30 folding away as it goes —
            under it, the record would leave its card behind the very dimming
            that is clearing. */}
        <div
          ref={meteorLayerRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-40 overflow-hidden rounded-[var(--radius-widget)]"
        >
          {impacts.map((impact) => (
            <MeteorImpact key={impact.key} impact={impact} layerRef={meteorLayerRef} onFaded={faded} />
          ))}
          {flights
            .filter((flight) => flight.meteor)
            .map((flight) => (
              <FlyingDisc
                key={flight.key}
                flight={flight}
                platterRef={platterRef}
                layerRef={meteorLayerRef}
                onAirborne={takeSource}
                onHandOff={handOff}
                onDone={endFlight}
                onStrike={strike}
              />
            ))}
        </div>
      </PendingContext.Provider>
    </ActionsContext.Provider>
  );
}

interface FlyingDiscProps {
  flight: Flight;
  /**
   * Passed as refs rather than elements. Reading `.current` during render is
   * not guaranteed to see what the latest commit wrote; the effect below runs
   * after commit, which is exactly when the answer is reliable.
   */
  platterRef: React.RefObject<HTMLElement | null>;
  layerRef: React.RefObject<HTMLDivElement | null>;
  /** The clone is up: take the row's own record away. */
  onAirborne: (flight: Flight) => void;
  onHandOff: (flight: Flight) => void;
  onDone: (flight: Flight) => void;
  /** A meteor reached the platter. */
  onStrike?: (impact: Omit<Impact, 'key'>) => void;
}

/**
 * One airborne clone. Renders at the platter's position at full size; the
 * animation carries it backwards from the row, so landing is the identity
 * transform and cannot miss.
 */
function FlyingDisc({
  flight,
  platterRef,
  layerRef,
  onAirborne,
  onHandOff,
  onDone,
  onStrike,
}: FlyingDiscProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const spinRef = useRef<HTMLDivElement | null>(null);
  const tailRef = useRef<HTMLCanvasElement | null>(null);
  const isPlaying = usePlayerStore((s) => s.playbackState === 'PLAYING');

  /**
   * A layout effect, and the placement written straight to the element.
   *
   * The row's own disc is hidden the instant the flight is launched, and this
   * is what replaces it. Through `useEffect` and a piece of state, the replacing
   * happened a frame later than the hiding: the clone was committed still
   * `visibility: hidden`, the browser painted that frame with the record
   * nowhere, and only then did the effect place it and start the arc. One blank
   * frame in the middle of a record leaving a sleeve reads as the animation
   * being cut, which is exactly what it is.
   *
   * Before paint, and imperatively, the clone appears in the same frame the
   * original disappears — and they are the same pixels in the same place, so
   * there is nothing to see.
   */
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const platterEl = platterRef.current;
    const layerEl = layerRef.current;
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

    /** Where the clone sits before its transform carries it back to the source. */
    const place = (centre: { x: number; y: number }) => {
      wrapper.style.left = `${centre.x - PLATTER_SIZE / 2}px`;
      wrapper.style.top = `${centre.y - PLATTER_SIZE / 2}px`;
    };
    place(start);
    wrapper.style.visibility = 'visible';
    // Now, and not a moment earlier: this element is what replaces the row's
    // own record, and it is only here from this line on.
    onAirborne(flight);

    /**
     * Keep the clone on the platter for as long as it exists.
     *
     * Everything here is in layer coordinates, and the layer is the shell — so
     * the numbers mean nothing the moment the shell moves under them. Closing
     * the drawer on the left is exactly that: the window stays where it is and
     * the shell shrinks against its right edge, so the layer's origin travels
     * the drawer's whole width while the deck does not move at all. A record
     * pinned to a layer coordinate slides sideways with it, over the quarter of
     * a second the drawer takes, which is what it looks like: a record flying
     * off to one side instead of onto the deck.
     *
     * The destination was already known to move — the landing re-measured it
     * once, for a banner or the import strip appearing mid-flight. One instant
     * was not enough. The arc is six hundred and fifty milliseconds and the
     * rest on the platter waiting for the track to load is up to two and a
     * half seconds more, and the drawer can shut in any of it. So the platter
     * is followed rather than sampled.
     *
     * `place` writes `left`/`top` and the animation writes `transform`, so this
     * moves the arc's destination without touching where along the arc the
     * record is. A destination that moves takes the whole flight with it, which
     * on screen is the record holding still while the shell slides out from
     * under it.
     */
    const meteor = !!flight.meteor;
    const duration = meteor ? METEOR_MS : FLIGHT_MS;
    const meteorFrom = { x: srcX - start.x, y: srcY - start.y, r: flight.from.width / 2 };
    /** The tail: where the head has been, in layer coordinates, oldest first. */
    const tail: TailPoint[] = [];
    // The cover's own colour for the light it trails, once the cover has been
    // looked at; the theme's until then.
    let colour = accentColour();
    if (meteor && flight.track.coverArtUrl) {
      void readCover(flight.track.coverArtUrl).then((seen) => {
        const hue = seen.read ? seen.palette?.hues?.[0] : undefined;
        const rgb = hue ? parseCssColour(hue) : null;
        if (rgb) colour = glowing(rgb);
      });
    }
    const tailCanvas = tailRef.current;
    const tailContext = tailCanvas ? sizeToLayer(tailCanvas, layerEl) : null;

    let tracking = 0;
    let falling = meteor;
    // Declared here, made below: the first frame of `follow` comes after both.
    let animation: Animation | null = null;
    const follow = () => {
      tracking = requestAnimationFrame(follow);
      const centre = platterCentre();
      place(centre);
      if (!falling || !tailContext || !tailCanvas || !animation) return;
      const head = meteorAt(Number(animation.currentTime ?? 0), meteorFrom);
      const now = performance.now();
      const at = { x: centre.x + head.x, y: centre.y + head.y, r: head.r, t: now };
      // Not a new point for every frame of a slow lift: drawn over each other,
      // they gathered into a bright blot under the record.
      const newest = tail.at(-1);
      if (!newest || Math.hypot(at.x - newest.x, at.y - newest.y) >= TAIL_STEP) tail.push(at);
      while (tail.length > 2 && now - (tail[0]?.t ?? now) > TAIL_MS) tail.shift();
      drawTail(tailContext, tailCanvas, tail, colour, { ...at, glow: head.glow });
    };
    tracking = requestAnimationFrame(follow);

    // Lift scales with the throw. A fixed clamp made every row below the
    // platter arc identically — a hop straight up rather than a throw — because
    // the old formula pinned itself to the ceiling for all of them. The upper
    // bound keeps the apex inside the widget.
    const distance = Math.hypot(srcX - start.x, srcY - start.y);
    const arcHeight = clamp(distance * 0.32, 18, Math.max(18, (srcY + start.y) / 2 - 24));

    const flying = wrapper.animate(
      meteor
        ? meteorKeyframes(meteorFrom)
        : arcKeyframes(
            { x: srcX - start.x, y: srcY - start.y, scale: flight.from.width / PLATTER_SIZE },
            { x: 0, y: 0, scale: 1 },
            arcHeight,
          ),
      { duration, easing: 'linear', fill: 'forwards' },
    );
    animation = flying;

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
    // Spinning fast as it falls, and back to the deck's own pace as it lands.
    if (meteor) spinRef.current?.getAnimations()[0]?.updatePlaybackRate(FALLING_SPIN);

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
      flying.cancel();
      onDone(flight);
    };

    /**
     * Rest on the platter while the track is still on its way.
     *
     * Asked again every `HOLD_MS` rather than waited out once: what decides
     * this is whether the store is still starting this track, and that has no
     * length anybody can name. Giving up fades out rather than snapping, so a
     * load that never arrives ends quietly.
     */
    const rest = () => {
      if (arrived || usePlayerStore.getState().starting?.id !== flight.track.id) {
        commit();
        return;
      }
      holdTimer = setTimeout(rest, HOLD_MS);
    };

    const land = () => {
      // `onfinish` and the failsafe can both arrive; a second hold timer would
      // outlive the first and fire after the flight is gone.
      if (landed) return;
      landed = true;
      if (meteor) {
        falling = false;
        spinRef.current?.getAnimations()[0]?.updatePlaybackRate(1);
        const centre = platterCentre();
        tailContext?.clearRect(0, 0, tailCanvas?.width ?? 0, tailCanvas?.height ?? 0);
        onStrike?.({ x: centre.x, y: centre.y, colour, tail: [...tail] });
        // The deck takes the hit.
        platterEl.animate(
          [
            { transform: 'translate(0, 0)' },
            { transform: 'translate(-5px, 2px)' },
            { transform: 'translate(4px, -1px)' },
            { transform: 'translate(-2px, 1px)' },
            { transform: 'translate(0, 0)' },
          ],
          { duration: SHAKE_MS, easing: 'ease-out' },
        );
      }
      // No re-measure here any more. This used to be the one moment the
      // destination was checked again; `follow` above has been keeping it right
      // every frame since the clone appeared, which is the same correction made
      // continuously rather than once.
      syncSpin();

      if (arrived) commit();
      else holdTimer = setTimeout(rest, HOLD_MS);
    };

    flying.onfinish = land;
    // Belt and braces: `finish` events have gone missing under heavy load.
    const failsafe = setTimeout(land, duration + 400);

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
        if (flying.playState === 'finished') {
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
      cancelAnimationFrame(tracking);
      clearTimeout(failsafe);
      clearTimeout(settleTimer);
      clearTimeout(holdTimer);
      unsubscribe();
      flying.cancel();
    };
    // A flight is immutable once launched; everything it needs is captured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hidden until the layout effect has put it where it belongs: one frame at
  // the layer's top left corner would be a record appearing in the wrong place,
  // which is worse than one frame of nothing. The effect runs before this is
  // ever painted, so neither happens.
  return (
    <>
      {flight.meteor && <canvas ref={tailRef} className="absolute inset-0 h-full w-full" />}
      <div ref={wrapperRef} className="absolute" style={{ visibility: 'hidden' }}>
        {/* The spin lives on its own element so it cannot fight the WAAPI
            transform on the wrapper — same separation the platter uses. */}
        <div ref={spinRef} className="groove-platter" data-spinning={isPlaying}>
          <VinylDisc size={PLATTER_SIZE} eager coverArtUrl={flight.track.coverArtUrl} />
        </div>
        {/* The clone crossfades into the platter, so it has to be lit the same
            way — same sibling, same fixed reflection. */}
        <DiscLight size={PLATTER_SIZE} />
      </div>
    </>
  );
}

// --- Meteors -------------------------------------------------------------------

/**
 * How long a stretch of its path the tail is, in milliseconds. By time, not by
 * a count of frames: counted, it was a quarter as long on a screen that draws
 * four times as often.
 *
 * This and the three below are the listener's, set with a tuner after the
 * first tail was far too much: a faint, thin streak, not a beam.
 */
const TAIL_MS = 170;
/** How wide the tail is at the head, against the record's width there. */
const TAIL_WIDTH = 0.45;
/** How bright the tail is at the head. */
const TAIL_ALPHA = 0.35;
/** How bright the glow round the head is. */
const HEAD_GLOW = 0.15;
/** How far the head moves before its tail gets another point, in CSS pixels. */
const TAIL_STEP = 3;

/** A place the head has been: where, how big the record was there, and when. */
interface TailPoint {
  x: number;
  y: number;
  r: number;
  t: number;
}
/** How long the deck shakes when a meteor strikes it. */
const SHAKE_MS = 260;
/** How long the light and sparks of a strike last. */
const IMPACT_MS = 900;
/** The dust a strike throws off the deck: the colour of the dust in the room. */
const DUST: Rgb = { r: 240, g: 225, b: 200 };
/** How many specks of it. */
const SPARKS = 40;

/** The theme's accent, made to glow, for a tail whose cover has not been looked at yet. */
function accentColour(): Rgb {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-brass-400');
  return glowing(parseCssColour(accent.trim()) ?? { r: 224, g: 176, b: 113 });
}

/** A canvas over the whole layer, at the screen's own pixels. */
function sizeToLayer(canvas: HTMLCanvasElement, layer: HTMLElement): CanvasRenderingContext2D | null {
  const box = layer.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(box.width * dpr));
  canvas.height = Math.max(1, Math.round(box.height * dpr));
  const context = canvas.getContext('2d');
  context?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return context;
}

/** A colour at `alpha`, as the canvas takes it. */
function withAlpha({ r, g, b }: Rgb, alpha: number): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;
}

/**
 * The light a falling record trails: thin and faint where it has been, its
 * width at the head a share of the record's own there, and a soft glow round
 * the head while it is in the air.
 */
function drawTail(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  tail: readonly TailPoint[],
  colour: Rgb,
  head?: { x: number; y: number; r: number; glow: number },
): void {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.lineCap = 'round';
  for (let k = 1; k < tail.length; k++) {
    const a = tail[k - 1];
    const b = tail[k];
    if (!a || !b) continue;
    const along = k / tail.length;
    context.strokeStyle = withAlpha(colour, along * along * TAIL_ALPHA);
    context.lineWidth = b.r * 2 * TAIL_WIDTH * along;
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  }
  if (head && head.glow > 0) {
    // The glow added to what is under it, as light is.
    context.globalCompositeOperation = 'lighter';
    const halo = context.createRadialGradient(head.x, head.y, head.r * 0.6, head.x, head.y, head.r * 1.8);
    halo.addColorStop(0, withAlpha(colour, HEAD_GLOW * head.glow));
    halo.addColorStop(1, withAlpha(colour, 0));
    context.fillStyle = halo;
    context.beginPath();
    context.arc(head.x, head.y, head.r * 1.8, 0, Math.PI * 2);
    context.fill();
  }
  context.globalCompositeOperation = 'source-over';
}

/**
 * What a meteor leaves where it struck: a ring of light running out from the
 * platter, dust thrown off it, and the last of its tail fading where it was.
 * Its own element, because it outlives the record's flight — the record may
 * hand over to the deck a moment after it lands.
 */
function MeteorImpact({
  impact,
  layerRef,
  onFaded,
}: {
  impact: Impact;
  layerRef: React.RefObject<HTMLDivElement | null>;
  onFaded: (key: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const layer = layerRef.current;
    const context = canvas && layer ? sizeToLayer(canvas, layer) : null;
    if (!canvas || !context) {
      onFaded(impact.key);
      return;
    }
    const sparks = Array.from({ length: SPARKS }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 120 + Math.random() * 260;
      return { x: impact.x, y: impact.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 60 };
    });
    const tail = [...impact.tail];
    const began = performance.now();
    let last = began;
    let frame = 0;
    const draw = (now: number) => {
      const seconds = Math.min(0.05, (now - last) / 1000);
      last = now;
      const k = (now - began) / IMPACT_MS;
      if (k >= 1) {
        onFaded(impact.key);
        return;
      }
      frame = requestAnimationFrame(draw);
      context.clearRect(0, 0, canvas.width, canvas.height);
      // The tail drains into the platter.
      if (tail.length > 1) tail.shift();
      // At the width it had where it was, not at the deck's record's: drawn
      // at that, it was a great band across the window as it went.
      if (tail.length > 1) drawTail(context, canvas, tail, impact.colour);
      // The ring.
      const ring = Math.min(1, k / 0.66);
      if (ring < 1) {
        context.strokeStyle = withAlpha(impact.colour, (1 - ring) * 0.8);
        context.lineWidth = 5 * (1 - ring) + 1;
        context.beginPath();
        context.arc(impact.x, impact.y, PLATTER_SIZE / 2 + 10 + ring * 90, 0, Math.PI * 2);
        context.stroke();
      }
      // The sparks, falling as they fly.
      const life = 1 - k;
      context.fillStyle = withAlpha(DUST, life);
      for (const spark of sparks) {
        spark.x += spark.vx * seconds;
        spark.y += spark.vy * seconds;
        spark.vy += 420 * seconds;
        context.beginPath();
        context.arc(spark.x, spark.y, 2.2 * life + 0.6, 0, Math.PI * 2);
        context.fill();
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
    // An impact is immutable once struck.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />;
}
