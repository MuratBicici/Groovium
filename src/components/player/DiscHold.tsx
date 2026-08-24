import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { TrackMetadata } from '@/core/types';
import { usePlayerStore } from '@/core/store';
import { easeInOutCubic, prefersReducedMotion } from '@/core/utils/motion';
import { clamp } from '@/core/utils/time';
import {
  HELD_SCALE,
  PICKUP_MS,
  SEAT_MS,
  THROW_MAX_MS,
  isGone,
  launchVelocity,
  releaseVerdict,
  stepProjectile,
  velocityFrom,
  type Release,
  type Sample,
  type Vector,
} from './discPhysics';
import { DiscLight } from './DiscLight';
import { VinylDisc } from './VinylDisc';

/**
 * Taking the record off the deck.
 *
 * Press on it and drag, and the record comes off: it shrinks into the hand and
 * follows the pointer. Put it back over the deck and it drops onto the spindle
 * and carries on. Let go of it anywhere else and it falls out of the window,
 * which is how the deck gets emptied — there was no other way to do that.
 *
 * The record in the hand is a clone in a window-wide layer, for the reason the
 * flight's is: the deck sits inside a column that panels cover and the shell
 * clips, and anything that has to travel across the whole window cannot be
 * rendered where it started.
 *
 * **Nothing about the carry goes through React.** Position, scale and tumble
 * are written straight to the element's transform from a `requestAnimationFrame`
 * loop, and the pointer's coordinates land in a ref. A drag is a hundred and
 * twenty updates a second and it renders one element; putting that through
 * state would reconcile the tree for each of them.
 */

/** Platter disc diameter — the size this clone is drawn at, always. */
const DISC_SIZE = 152;

/** How high the record hops on its way back down onto the spindle. */
const SEAT_ARC = 22;

/** How long after a throw the platter still treats the record as thrown. */
const JUST_THREW_MS = 400;

/** A keyboard eject is thrown for the user, up and to the right. */
const EJECT_VELOCITY: Vector = { x: 760, y: -420 };
/** Where the record lifts to before a keyboard eject flings it. */
const EJECT_LIFT: Vector = { x: 46, y: -34 };

interface Grab {
  track: TrackMetadata;
  /** The platter's stable wrapper, so the way home can be re-measured. */
  platterEl: HTMLElement;
  /** Pointer position in client coordinates. Absent for a keyboard eject. */
  pointer?: Vector;
}

interface DiscHoldActions {
  /** Lift the record off the deck and into the hand. */
  grab: (grab: Grab) => void;
  /** The pointer moved, in client coordinates. */
  moveTo: (x: number, y: number) => void;
  /** The pointer let go: seat it, drop it, or throw it. */
  release: () => void;
  /** The gesture was interrupted — put the record back, quietly. */
  cancel: () => void;
  /** Take it off and throw it in one go. The keyboard's route. */
  eject: (grab: Grab) => void;
  /**
   * Whether this track's record left the deck by being thrown a moment ago.
   *
   * A ref read rather than state, for the reason `didJustLand` is one: the
   * platter's effect can run in the same commit that empties the deck, and by
   * then anything held in state has already been cleared. A ref is written
   * synchronously, so the effect sees it.
   */
  didJustThrow: (trackId: string) => boolean;
}

const ActionsContext = createContext<DiscHoldActions>({
  grab: () => {
    console.error('[disc-hold] used outside DiscHoldProvider — the record will not lift.');
  },
  moveTo: () => {},
  release: () => {},
  cancel: () => {},
  eject: () => {},
  didJustThrow: () => false,
});

/** The track whose record is off the deck, so the platter can look empty. */
const HeldContext = createContext<string | null>(null);

export function useDiscHold(): DiscHoldActions {
  return useContext(ActionsContext);
}

export function useHeldTrack(): string | null {
  return useContext(HeldContext);
}

type Phase = 'pickup' | 'carry' | 'seat' | 'throw';

interface Motion {
  phase: Phase;
  /** Whose record this is, so a throw can be reported against it. */
  trackId: string;
  /** Deck centre in layer coordinates — where the record came from and returns to. */
  origin: Vector;
  platterEl: HTMLElement;
  layer: DOMRect;
  /** Where the pointer is, in layer coordinates. */
  pointer: Vector;
  samples: Sample[];
  /** Centre of the record right now, in layer coordinates. */
  pos: Vector;
  scale: number;
  /** Degrees of tumble, on the wrapper rather than on the spinning disc. */
  spin: number;
  phaseAt: number;
  lastAt: number;
  /** Where the record was when the current phase began. */
  from: Vector;
  fromScale: number;
  velocity: Vector;
  /** Set on a keyboard eject: throw with this the moment the lift finishes. */
  flingAfterPickup: Vector | null;
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Switch a hold into its parting shot. */
function beginThrow(m: Motion, velocity: Vector, now: number): void {
  m.phase = 'throw';
  m.velocity = velocity;
  m.phaseAt = now;
  m.lastAt = now;
  m.flingAfterPickup = null;
}

type Outcome = 'carrying' | 'seated' | 'gone';

/**
 * One frame of the hold.
 *
 * Written as a plain function over a mutable record rather than as state: it
 * runs sixty times a second and changes four numbers each time, and a hook is
 * the wrong shape for that — as the compiler's immutability rule points out if
 * you try.
 */
function advance(m: Motion, now: number): Outcome {
  switch (m.phase) {
    case 'pickup': {
      const t = clamp((now - m.phaseAt) / PICKUP_MS, 0, 1);
      const e = easeInOutCubic(t);
      m.pos = { x: lerp(m.from.x, m.pointer.x, e), y: lerp(m.from.y, m.pointer.y, e) };
      m.scale = lerp(m.fromScale, HELD_SCALE, e);
      if (t >= 1) {
        if (m.flingAfterPickup) beginThrow(m, m.flingAfterPickup, now);
        else m.phase = 'carry';
      }
      break;
    }

    case 'carry':
      // Straight onto the pointer, with no lag of its own: the record is being
      // held, and a held thing does not trail behind the hand.
      m.pos = { x: m.pointer.x, y: m.pointer.y };
      break;

    case 'seat': {
      const t = clamp((now - m.phaseAt) / SEAT_MS, 0, 1);
      const e = easeOutCubic(t);
      m.pos = {
        x: lerp(m.from.x, m.origin.x, e),
        // The hop is on linear time while the travel is eased — the same split
        // `arcKeyframes` makes, which keeps the apex in the middle of the move
        // instead of dragging it toward the slow end.
        y: lerp(m.from.y, m.origin.y, e) - SEAT_ARC * Math.sin(Math.PI * t),
      };
      m.scale = lerp(m.fromScale, 1, e);
      // Whatever tumble it picked up on the way unwinds as it settles.
      m.spin = lerp(m.spin, 0, e);
      if (t >= 1) return 'seated';
      break;
    }

    case 'throw': {
      // Capped: a frame the browser spent elsewhere would otherwise teleport
      // the record most of the way across the window.
      const dt = Math.min(now - m.lastAt, 32);
      const next = stepProjectile(
        { x: m.pos.x, y: m.pos.y, vx: m.velocity.x, vy: m.velocity.y, spin: m.spin },
        dt,
      );
      m.pos = { x: next.x, y: next.y };
      m.velocity = { x: next.vx, y: next.vy };
      m.spin = next.spin;
      if (isGone(next, m.layer) || now - m.phaseAt > THROW_MAX_MS) return 'gone';
      break;
    }
  }

  m.lastAt = now;
  return 'carrying';
}

/** Run the hold until it seats or leaves. */
function runLoop(
  motion: React.RefObject<Motion | null>,
  frame: React.RefObject<number>,
  paint: () => void,
  onSeated: () => void,
  onGone: () => void,
): void {
  const step = (now: number) => {
    const m = motion.current;
    if (!m) return;

    const outcome = advance(m, now);
    paint();
    if (outcome === 'seated') return onSeated();
    if (outcome === 'gone') return onGone();
    frame.current = requestAnimationFrame(step);
  };

  cancelAnimationFrame(frame.current);
  frame.current = requestAnimationFrame(step);
}

export function DiscHoldProvider({ children }: { children: React.ReactNode }) {
  const [held, setHeld] = useState<{ key: number; track: TrackMetadata } | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const discRef = useRef<HTMLDivElement | null>(null);
  const spinRef = useRef<HTMLDivElement | null>(null);
  const motion = useRef<Motion | null>(null);
  const frame = useRef<number>(0);
  const nextKey = useRef(0);
  /** trackId → when it was thrown, for `didJustThrow`. */
  const thrownAt = useRef(new Map<string, number>());

  /** Put the record's current pose on the screen. */
  const paint = useCallback(() => {
    const el = discRef.current;
    const m = motion.current;
    if (!el || !m) return;
    const half = DISC_SIZE / 2;
    el.style.transform =
      `translate(${m.pos.x - half}px, ${m.pos.y - half}px) ` +
      `rotate(${m.spin.toFixed(2)}deg) scale(${m.scale.toFixed(4)})`;
  }, []);

  /** Stop the loop and take the clone away. */
  const clear = useCallback(() => {
    cancelAnimationFrame(frame.current);
    motion.current = null;
    setHeld(null);
  }, []);

  const finishSeat = useCallback(() => {
    clear();
    void usePlayerStore.getState().lowerRecord();
  }, [clear]);

  const finishThrow = useCallback(() => {
    const trackId = motion.current?.trackId;
    if (trackId) {
      // Written before the deck is emptied, so the platter's effect can see it
      // in the very commit the track goes away.
      const now = performance.now();
      thrownAt.current.set(trackId, now);
      // Kept from growing across a long session; nothing else prunes it.
      for (const [id, at] of thrownAt.current) {
        if (now - at >= JUST_THREW_MS) thrownAt.current.delete(id);
      }
    }
    clear();
    void usePlayerStore.getState().discardRecord();
  }, [clear]);

  const didJustThrow = useCallback((trackId: string) => {
    const at = thrownAt.current.get(trackId);
    return at !== undefined && performance.now() - at < JUST_THREW_MS;
  }, []);


  /**
   * Copy the platter's rotation onto the clone.
   *
   * Both run the same 4.5s spin, but this element was created a moment ago and
   * starts at zero while the platter's has been turning since the record went
   * on. Without this the record visibly jumps to a different angle in the
   * instant it is picked up.
   */
  const syncSpin = useCallback((platterEl: HTMLElement) => {
    const source = platterEl.querySelector('.groove-platter')?.getAnimations()[0];
    const clone = spinRef.current?.getAnimations()[0];
    if (source && clone && source.currentTime !== null) clone.currentTime = source.currentTime;
  }, []);

  /** Deck centre and layer rect, measured together so they share a frame. */
  const measure = useCallback((platterEl: HTMLElement) => {
    const layer = layerRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0);
    const deck = platterEl.getBoundingClientRect();
    return {
      layer,
      origin: {
        x: deck.left + deck.width / 2 - layer.left,
        y: deck.top + deck.height / 2 - layer.top,
      },
    };
  }, []);

  const start = useCallback(
    (grab: Grab, flingAfterPickup: Vector | null) => {
      if (motion.current) return;
      const { layer, origin } = measure(grab.platterEl);

      const target: Vector = grab.pointer
        ? { x: grab.pointer.x - layer.left, y: grab.pointer.y - layer.top }
        : { x: origin.x + EJECT_LIFT.x, y: origin.y + EJECT_LIFT.y };

      const now = performance.now();
      motion.current = {
        phase: 'pickup',
        trackId: grab.track.id,
        origin,
        platterEl: grab.platterEl,
        layer,
        pointer: target,
        samples: [{ x: target.x, y: target.y, t: now }],
        pos: { ...origin },
        scale: 1,
        spin: 0,
        phaseAt: now,
        lastAt: now,
        from: { ...origin },
        fromScale: 1,
        velocity: { x: 0, y: 0 },
        flingAfterPickup,
      };

      // The music stops before the record is off the deck, not after.
      void usePlayerStore.getState().liftRecord();
      setHeld({ key: nextKey.current++, track: grab.track });
    },
    [measure],
  );

  const grab = useCallback((g: Grab) => start(g, null), [start]);
  const eject = useCallback(
    (g: Grab) => {
      if (prefersReducedMotion()) {
        void usePlayerStore.getState().discardRecord();
        return;
      }
      start(g, EJECT_VELOCITY);
    },
    [start],
  );

  const moveTo = useCallback((x: number, y: number) => {
    const m = motion.current;
    if (!m || m.phase === 'seat' || m.phase === 'throw') return;
    m.pointer = { x: x - m.layer.left, y: y - m.layer.top };
    m.samples.push({ ...m.pointer, t: performance.now() });
    // The velocity window is 80ms; a handful of samples covers it at any
    // sensible report rate, and the rest would only grow for the length of
    // the drag.
    if (m.samples.length > 12) m.samples.shift();
  }, []);

  const release = useCallback(() => {
    const m = motion.current;
    if (!m || m.phase === 'seat' || m.phase === 'throw') return;

    const now = performance.now();
    const pointerVelocity = velocityFrom(m.samples, now);
    const speed = Math.hypot(pointerVelocity.x, pointerVelocity.y);
    const distance = Math.hypot(m.pos.x - m.origin.x, m.pos.y - m.origin.y);
    const verdict: Release = releaseVerdict(speed, distance);

    if (verdict === 'seat') {
      // Re-measured: the stage moves under a hold the same way it moves under
      // a flight, and the deck may not be where it was when the record left it.
      m.origin = measure(m.platterEl).origin;
      m.phase = 'seat';
      m.phaseAt = now;
      m.from = { ...m.pos };
      m.fromScale = m.scale;
      if (prefersReducedMotion()) {
        m.pos = { ...m.origin };
        m.scale = 1;
        m.spin = 0;
        paint();
        finishSeat();
      }
      return;
    }

    if (prefersReducedMotion()) {
      finishThrow();
      return;
    }
    beginThrow(m, launchVelocity(verdict, pointerVelocity), now);
  }, [finishSeat, finishThrow, measure, paint]);

  /** A cancelled gesture is not a decision: the record goes back. */
  const cancel = useCallback(() => {
    const m = motion.current;
    if (!m || m.phase === 'seat' || m.phase === 'throw') return;
    m.origin = measure(m.platterEl).origin;
    m.phase = 'seat';
    m.phaseAt = performance.now();
    m.from = { ...m.pos };
    m.fromScale = m.scale;
    if (prefersReducedMotion()) {
      m.pos = { ...m.origin };
      m.scale = 1;
      paint();
      finishSeat();
    }
  }, [finishSeat, measure, paint]);

  /**
   * The loop starts from the callback ref rather than an effect, so the first
   * frame is painted in the same tick the element exists — an effect would let
   * one frame through at the untransformed origin, full size and top left.
   */
  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      discRef.current = el;
      const m = motion.current;
      if (!el || !m) return;

      syncSpin(m.platterEl);
      if (prefersReducedMotion() && m.phase === 'pickup' && !m.flingAfterPickup) {
        m.phase = 'carry';
        m.scale = HELD_SCALE;
        m.pos = { ...m.pointer };
      }
      paint();
      runLoop(motion, frame, paint, finishSeat, finishThrow);
    },
    [finishSeat, finishThrow, paint, syncSpin],
  );

  const actions = useMemo(
    () => ({ grab, moveTo, release, cancel, eject, didJustThrow }),
    [grab, moveTo, release, cancel, eject, didJustThrow],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <HeldContext.Provider value={held?.track.id ?? null}>
        {children}

        {/* z-10, the disc-motion layer — the same one the flight uses, for the
            same reason (see the layer table in App.tsx). A record in the hand
            is still part of the deck, so a panel covers it. `overflow-hidden`
            is what makes a thrown record leave along the widget's own
            silhouette rather than float over the desktop. */}
        <div
          ref={layerRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-[var(--radius-widget)]"
        >
          {held && (
            <div
              key={held.key}
              ref={attach}
              className="absolute top-0 left-0 will-change-transform"
              // A record held above the deck casts onto it. Written large
              // because a filter is applied in the element's own coordinates
              // and the transform shrinks the result afterwards — at the held
              // scale these land as roughly a 6px offset and a 10px blur.
              style={{ filter: 'drop-shadow(0 14px 24px rgba(0,0,0,0.6))' }}
            >
              {/* Paused, and set to the platter's angle: the record stopped
                  turning the moment it came off the deck, because the music
                  stopped with it. */}
              <div ref={spinRef} className="groove-platter" data-spinning="false">
                <VinylDisc size={DISC_SIZE} eager coverArtUrl={held.track.coverArtUrl} />
              </div>
              <DiscLight size={DISC_SIZE} />
            </div>
          )}
        </div>
      </HeldContext.Provider>
    </ActionsContext.Provider>
  );
}
