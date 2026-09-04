import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { TrackMetadata } from '@/core/types';
import { usePlayerStore } from '@/core/store';
import { easeInOutCubic, prefersReducedMotion } from '@/core/utils/motion';
import { clamp } from '@/core/utils/time';
import {
  HELD_SCALE,
  HAND_SPEED,
  PICKUP_MS,
  SEAT_MS,
  seatPoint,
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
 * Taking a record out of where it is.
 *
 * Press on it and drag, and the record comes off: it shrinks into the hand and
 * follows the pointer. Put it back over the deck and it drops onto the spindle
 * and carries on. Let go of it anywhere else and it falls out of the window,
 * which is how the deck gets emptied — there was no other way to do that.
 *
 * That is the deck's own gesture, and it is now also the crate's. A record
 * lifted out of a sleeve is picked up, carried and set down by this same code:
 * the same shrink, the same tempo, the same hand. It was briefly not — the
 * crate grew a second, simpler drag of its own — and two ways of holding the
 * same object is one too many. A visiting record differs from the deck's in
 * two respects and no others: it is never thrown away, because a record in a
 * crate is not the deck's to discard, and setting it down on the deck means
 * playing it rather than resuming it.
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

/**
 * How big a crate gets as it opens out over the deck.
 *
 * Enough to be plainly growing rather than merely fading, and not so much that
 * it fills the window on the way out.
 */
const DISSOLVE_SCALE = 1.5;

/**
 * How long it takes to do it.
 *
 * Longer than a seat, because a seat is arriving somewhere and this is going
 * away, and going away has to be watchable or it is a flash.
 */
const DISSOLVE_MS = 380;

/**
 * How much of a curved seat is spent getting the record down to size.
 *
 * It has to be the size it will be *inside* before the hand can let go of it
 * at the mouth, or it changes size at the seam. So the sizing finishes in the
 * first half and the second half is only travel.
 */
const SIZED_BY = 0.5;

/** How long after a throw the platter still treats the record as thrown. */
const JUST_THREW_MS = 400;

/**
 * How long a record set down by hand suppresses the platter's entrance.
 *
 * Far longer than a throw's window, because this one waits on a provider
 * rather than on a render: a Spotify track does not become the current one
 * until Spotify says it is playing, routinely a second after the record
 * landed. Until then the deck is empty and the entrance is still pending.
 */
const JUST_SEATED_MS = 3000;

/** A keyboard eject is thrown for the user, up and to the right. */
const EJECT_VELOCITY: Vector = { x: 760, y: -420 };
/** Where the record lifts to before a keyboard eject flings it. */
const EJECT_LIFT: Vector = { x: 46, y: -34 };

/**
 * A record that lives somewhere other than the deck.
 *
 * Its presence is what makes this a loan rather than an ejection: the record
 * goes back where it came from unless it is put down on the deck, and it is
 * never thrown out of the window.
 */
interface Visiting {
  /** The deck, if there is one to offer the record to. */
  deckEl: HTMLElement | null;
  /** Called once it has settled onto the deck. */
  onDelivered: (track: TrackMetadata) => void;
  /**
   * Reaching the deck ends by growing out of sight rather than settling on it.
   *
   * For a record, landing is the whole point: it comes to rest at the
   * platter's own size and the platter takes over the same pixels. A crate is
   * not a thing that sits on a platter — what it does there is give up its
   * records — so it opens out over the deck and is gone, and the music it was
   * carrying starts.
   */
  dissolves?: boolean;
  /**
   * How home is approached, relative to its centre — a control point, not a
   * destination.
   *
   * Home may not take a record head-on. A sleeve is entered through the mouth
   * on its right, so the way back curves out to that side and turns in. The
   * first attempt stopped at the mouth and let the sleeve finish the last leg,
   * which was two moves with a full stop between them however exactly they
   * met. One curve, one deceleration, and the record is still moving inwards
   * when it disappears into the sleeve.
   */
  homeApproach?: Vector;
  /**
   * How far to the right of home the hand lets go, in px. The seat ends there
   * rather than at home.
   *
   * The hand carries a record in a layer above the whole window, which is
   * right while it is in the air and wrong the moment it starts going in: a
   * record entering a sleeve passes *behind* the printed face, and a clone
   * drawn over everything cannot. So the hand stops short and whatever lives
   * there covers the last stretch, occluded properly on the way.
   *
   * Far enough out that the record is completely clear of what it is going
   * into. Anywhere closer and the clone would already be overlapping the face
   * it is meant to pass behind, and the handover would show as the record
   * jumping from in front of the sleeve to inside it — which is the whole
   * complaint. Clear of it, the two are the same picture and the swap cannot
   * be seen.
   *
   * The record is still travelling when it happens: this leg is linear and
   * the curve's control point is out beyond the handover, so it arrives
   * moving inwards and the last stretch carries straight on.
   */
  handOverAt?: number;
  /**
   * Where the hand let go, relative to home's centre, so the last leg can
   * start from exactly there.
   */
  onReturned?: (offset: Vector) => void;
}

interface Grab {
  /**
   * What is being carried.
   *
   * Usually a record, and then this is that record. For a crate it is a
   * carrier: the crate's own id and cover, in the shape this needs, because
   * what the hand does with a thing does not depend on what the thing is. The
   * only place it goes is back out through `onDelivered`, and the crate's own
   * code knows what to do with it there.
   */
  track: TrackMetadata;
  /**
   * What to draw in the hand. A record by default.
   *
   * A crate is a sleeve, not a record — dragging the box that holds twenty
   * songs and having one record follow the pointer would be a picture of the
   * wrong thing.
   */
  look?: 'record' | 'sleeve';
  /**
   * Where the record is now, and where it goes back to. The platter's stable
   * wrapper for the deck's own record; the sleeve's disc for a crate's.
   * Re-measured on the way home, because the stage moves under a hold.
   */
  homeEl: HTMLElement;
  /**
   * How big the record is there, in px. The clone is always drawn at the
   * platter's size, so this is what it starts scaled to — without it a record
   * lifted from a sleeve would jump to platter size before it shrank.
   */
  homeSize?: number;
  /** Pointer position in client coordinates. Absent for a keyboard eject. */
  pointer?: Vector;
  /**
   * The record is already travelling when the hand takes it.
   *
   * A record on the deck is sitting still, so the lift eases in from nothing.
   * One being drawn out of a sleeve is not: something else has already pulled
   * it clear and is handing it over mid-move. Easing in from a standstill
   * there puts a full stop in the middle of one continuous gesture, which is
   * exactly what it feels like — two stages with a hitch between them.
   */
  alreadyMoving?: boolean;
  /**
   * Where the lift bends towards, relative to where it starts.
   *
   * A record drawn out of a sleeve is already travelling sideways when the
   * hand takes it; going straight to the pointer from there is a corner. With
   * this it carries on out and turns, which is one curve from the sleeve to
   * the hand — and the same shape the way back already had.
   */
  liftVia?: Vector;
  visiting?: Visiting;
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
  /**
   * Whether this record was set down on the deck by hand a moment ago.
   *
   * The platter plays an entrance whenever a new track becomes current, and a
   * record placed there by hand has already arrived, in front of the user —
   * running the entrance on top of that dropped a second copy in from above.
   * The window is generous because the gap it covers is: a Spotify track is
   * not the current one until the provider has actually started it.
   */
  didJustSeat: (trackId: string) => boolean;
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
  didJustSeat: () => false,
});

/** The track whose record is off the deck, so the platter can look empty. */
const HeldContext = createContext<string | null>(null);

/**
 * The track being carried, wherever it came from.
 *
 * Separate from `HeldContext` on purpose: the platter must look empty only
 * when it is the deck's record in the hand, and a sleeve must look empty when
 * it is its own. One context answering both questions would blank the deck
 * every time somebody picked a record out of a crate.
 */
const CarriedContext = createContext<string | null>(null);

export function useDiscHold(): DiscHoldActions {
  return useContext(ActionsContext);
}

export function useHeldTrack(): string | null {
  return useContext(HeldContext);
}

export function useCarriedTrack(): string | null {
  return useContext(CarriedContext);
}

type Phase = 'pickup' | 'carry' | 'seat' | 'throw';

interface Motion {
  phase: Phase;
  /** Whose record this is, so a throw can be reported against it. */
  track: TrackMetadata;
  /** Where the record settles, in layer coordinates. Home, or the deck. */
  origin: Vector;
  homeEl: HTMLElement;
  /** The scale it rests at where it lives — 1 on the deck, less in a sleeve. */
  homeScale: number;
  /** What it is easing towards while seating: home's scale, or the deck's 1. */
  seatScale: number;
  /** How long that takes. A curved way home is a longer way. */
  seatMs: number;
  /** The curve's control point in layer coordinates, when home wants one. */
  approach: Vector | null;
  /** Whether this seat ends by growing out of sight instead of landing. */
  dissolving: boolean;
  /** What the hand is drawn at. Only ever less than one while dissolving. */
  opacity: number;
  /** The lift's control point in layer coordinates, when it curves. */
  liftVia: Vector | null;
  /** Whether the lift continues something already in motion. */
  taking: boolean;
  /** How long that lift takes. Paced by distance when it is a continuation. */
  liftMs: number;
  /** Whether this seat ends short of home, to be finished by something else. */
  handingOver: boolean;
  /**
   * Home's own centre, which `origin` is not when the seat ends short of it.
   *
   * The last stretch is measured from here. Reporting the offset against
   * `origin` instead would report zero every time — the seat always finishes
   * exactly on its target — and the slide would have nothing to travel.
   */
  homeCentre: Vector;
  visiting: Visiting | null;
  /** Whether the seat now running ends on the deck rather than back home. */
  delivering: boolean;
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
      const t = clamp((now - m.phaseAt) / m.liftMs, 0, 1);
      // Off the deck the record is sitting still, so the lift eases in and out
      // of nothing. Out of a sleeve it arrives already travelling, at a rate
      // this leg is timed to match, so it simply carries on — and there is
      // nothing to ease into, because the carry that follows is the hand's own
      // speed rather than a stop.
      const e = m.taking ? t : easeInOutCubic(t);
      // Curved when the thing it is lifting came out of somewhere: it carries
      // on the way it was already going — out to the side — and turns to the
      // hand from there, rather than setting off straight across the sleeve it
      // has just been drawn out of. The endpoint is read fresh every frame
      // because the pointer does not wait.
      m.pos = seatPoint(m.from, m.pointer, m.liftVia, e);
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
      const t = clamp((now - m.phaseAt) / m.seatMs, 0, 1);
      // Linear when there is a last stretch to come, so the record is still
      // moving at the seam. Every easing that settles on its target arrives at
      // a standstill, and a standstill in the middle is what makes one move
      // read as two.
      //
      // Linear for a dissolve too, for the opposite reason: `easeOutCubic` is
      // most of the way there in the first quarter, which on something growing
      // and fading means it is gone before it has visibly grown. Nothing is
      // settling here, so nothing needs to ease into it.
      const e = m.handingOver || m.dissolving ? t : easeOutCubic(t);
      // The hop is the deck's, and only the deck's — a record dropped onto a
      // spindle. A crate was hopping on the way back to the shelf, which read
      // as it bouncing off the place it was settling into.
      m.pos = seatPoint(
        m.from,
        m.origin,
        m.approach,
        e,
        m.visiting ? undefined : { height: SEAT_ARC, at: t },
      );
      // Sized before it is lined up, when a handover is coming: the record has
      // to already be the size it will be inside before the hand can let go.
      m.scale = lerp(m.fromScale, m.seatScale, m.handingOver ? Math.min(1, e / SIZED_BY) : e);
      // Opening out over the deck: the fade is held back so that most of the
      // growth happens while the crate can still be seen, and the last of it
      // goes quickly. A fade that starts at full rate is a crate being rubbed
      // out rather than one opening.
      if (m.dissolving) m.opacity = 1 - e * e;
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
  const [held, setHeld] = useState<{
    key: number;
    track: TrackMetadata;
    visiting: boolean;
    look: 'record' | 'sleeve';
  } | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const discRef = useRef<HTMLDivElement | null>(null);
  const spinRef = useRef<HTMLDivElement | null>(null);
  const motion = useRef<Motion | null>(null);
  const frame = useRef<number>(0);
  const nextKey = useRef(0);
  /** trackId → when it was thrown, for `didJustThrow`. */
  const thrownAt = useRef(new Map<string, number>());
  /** trackId → when it was set down on the deck by hand, for `didJustSeat`. */
  const seatedAt = useRef(new Map<string, number>());

  /** Put the record's current pose on the screen. */
  const paint = useCallback(() => {
    const el = discRef.current;
    const m = motion.current;
    if (!el || !m) return;
    const half = DISC_SIZE / 2;
    el.style.opacity = m.opacity === 1 ? '' : m.opacity.toFixed(3);
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
    // Read before `clear`, which is what takes the motion away.
    const m = motion.current;
    const visiting = m?.visiting ?? null;
    const delivered = m?.delivering === true ? m.track : null;
    // Exactly where the hand let go, so the last leg starts from there rather
    // than from a number that only usually matches.
    const handedBackAt =
      m && visiting && !delivered
        ? { x: m.pos.x - m.homeCentre.x, y: m.pos.y - m.homeCentre.y }
        : null;
    clear();
    // The deck's own record went back onto the deck; the music resumes.
    if (!visiting) {
      void usePlayerStore.getState().lowerRecord();
      return;
    }
    // A visiting record that reached the deck is not resumed, it is played:
    // nothing was ever paused for it. One that went home is passed back to
    // wherever it lives, which finishes putting it away.
    if (!delivered) {
      if (handedBackAt) visiting.onReturned?.(handedBackAt);
      return;
    }
    // Noted before the track is asked for, so the platter can already know
    // this record arrived by hand when it becomes the current one.
    const now = performance.now();
    seatedAt.current.set(delivered.id, now);
    // Kept from growing across a long session; nothing else prunes it.
    for (const [id, at] of seatedAt.current) {
      if (now - at >= JUST_SEATED_MS) seatedAt.current.delete(id);
    }
    visiting.onDelivered(delivered);
  }, [clear]);

  const finishThrow = useCallback(() => {
    const trackId = motion.current?.track.id;
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

  const didJustSeat = useCallback((trackId: string) => {
    const at = seatedAt.current.get(trackId);
    return at !== undefined && performance.now() - at < JUST_SEATED_MS;
  }, []);


  /**
   * Copy the platter's rotation onto the clone.
   *
   * Both run the same 4.5s spin, but this element was created a moment ago and
   * starts at zero while the platter's has been turning since the record went
   * on. Without this the record visibly jumps to a different angle in the
   * instant it is picked up.
   */
  const syncSpin = useCallback((homeEl: HTMLElement) => {
    // A sleeve has no turning platter in it, so this finds nothing and the
    // clone starts where it is — which is right: a record in a crate is not
    // already spinning.
    const source = homeEl.querySelector('.groove-platter')?.getAnimations()[0];
    const clone = spinRef.current?.getAnimations()[0];
    if (source && clone && source.currentTime !== null) clone.currentTime = source.currentTime;
  }, []);

  /** An element's centre and the layer rect, measured together so they share a frame. */
  const measure = useCallback((el: HTMLElement) => {
    const layer = layerRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0);
    const box = el.getBoundingClientRect();
    return {
      layer,
      origin: {
        x: box.left + box.width / 2 - layer.left,
        y: box.top + box.height / 2 - layer.top,
      },
    };
  }, []);

  const start = useCallback(
    (grab: Grab, flingAfterPickup: Vector | null) => {
      if (motion.current) return;
      const { layer, origin } = measure(grab.homeEl);
      const homeScale = (grab.homeSize ?? DISC_SIZE) / DISC_SIZE;
      const taking = grab.alreadyMoving === true;

      const target: Vector = grab.pointer
        ? { x: grab.pointer.x - layer.left, y: grab.pointer.y - layer.top }
        : { x: origin.x + EJECT_LIFT.x, y: origin.y + EJECT_LIFT.y };

      const now = performance.now();
      motion.current = {
        phase: 'pickup',
        track: grab.track,
        origin,
        homeEl: grab.homeEl,
        homeScale,
        seatScale: homeScale,
        seatMs: SEAT_MS,
        approach: null,
        dissolving: false,
        opacity: 1,
        liftVia: grab.liftVia
          ? { x: origin.x + grab.liftVia.x, y: origin.y + grab.liftVia.y }
          : null,
        taking,
        // Paced by distance either way, and only the floor differs. A record
        // comes off the deck into a hand that is already on it, so that one is
        // always at the floor and is the same 180ms it always was. A crate is
        // lifted out of a shelf on the other side of the window, and a fixed
        // clock made that a blur — the same distance a record covers in a
        // third of a second was being crossed in a fifth.
        liftMs: clamp(
          Math.hypot(target.x - origin.x, target.y - origin.y) / HAND_SPEED,
          taking ? 80 : PICKUP_MS,
          300,
        ),
        handingOver: false,
        homeCentre: { ...origin },
        visiting: grab.visiting ?? null,
        delivering: false,
        layer,
        pointer: target,
        samples: [{ x: target.x, y: target.y, t: now }],
        pos: { ...origin },
        scale: homeScale,
        spin: 0,
        phaseAt: now,
        lastAt: now,
        from: { ...origin },
        fromScale: homeScale,
        velocity: { x: 0, y: 0 },
        flingAfterPickup,
      };

      // The music stops before the record is off the deck, not after — but
      // only when it is the deck's record. Taking one out of a crate must not
      // interrupt what is already playing.
      if (!grab.visiting) void usePlayerStore.getState().liftRecord();
      setHeld({
        key: nextKey.current++,
        track: grab.track,
        visiting: !!grab.visiting,
        look: grab.look ?? 'record',
      });
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

  /** Begin setting the record down on `onto`, at `scale`. */
  const beginSeat = useCallback(
    (m: Motion, onto: HTMLElement, scale: number, now: number, home?: Visiting) => {
      // Re-measured: the stage moves under a hold the same way it moves under
      // a flight, and neither the deck nor a sleeve need still be where it was.
      const centre = measure(onto).origin;
      const approach = home?.homeApproach;
      const short = home?.handOverAt;
      // Short of home when something else is finishing the job.
      m.origin = short === undefined ? centre : { x: centre.x + short, y: centre.y };
      m.handingOver = short !== undefined;
      m.homeCentre = centre;
      m.approach = approach ? { x: centre.x + approach.x, y: centre.y + approach.y } : null;
      // A dissolve is timed by how long it takes to watch rather than by how
      // far it goes; it is not arriving anywhere. A handover is timed by
      // distance so the leg travels at one speed however near or far it was
      // let go of, which is the speed the last stretch has to pick up at.
      if (m.dissolving) m.seatMs = DISSOLVE_MS;
      else if (m.handingOver) {
        m.seatMs = clamp(
          Math.hypot(m.pos.x - m.origin.x, m.pos.y - m.origin.y) / HAND_SPEED,
          100,
          320,
        );
      } else m.seatMs = SEAT_MS;
      m.seatScale = scale;
      m.phase = 'seat';
      m.phaseAt = now;
      m.from = { ...m.pos };
      m.fromScale = m.scale;
      if (!prefersReducedMotion()) return;
      m.pos = { ...m.origin };
      m.scale = scale;
      m.spin = 0;
      paint();
      finishSeat();
    },
    [finishSeat, measure, paint],
  );

  const release = useCallback(() => {
    const m = motion.current;
    if (!m || m.phase === 'seat' || m.phase === 'throw') return;

    const now = performance.now();

    // A visiting record has two endings and neither is a throw: it is put down
    // on the deck, or it goes back in its sleeve. Where the pointer is decides,
    // and nothing else does — speed says something about a record you already
    // own, and nothing about one you have borrowed.
    if (m.visiting) {
      const deck = m.visiting.deckEl;
      const box = deck?.getBoundingClientRect();
      const x = m.pointer.x + m.layer.left;
      const y = m.pointer.y + m.layer.top;
      const onDeck =
        !!box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
      m.delivering = onDeck && !!deck;
      if (m.delivering && deck) {
        // A crate opens out over the deck. A record lands on it at its size,
        // because the platter is about to take over those same pixels.
        m.dissolving = m.visiting.dissolves === true;
        beginSeat(m, deck, m.dissolving ? DISSOLVE_SCALE : 1, now);
      }
      else beginSeat(m, m.homeEl, m.homeScale, now, m.visiting);
      return;
    }

    const pointerVelocity = velocityFrom(m.samples, now);
    const speed = Math.hypot(pointerVelocity.x, pointerVelocity.y);
    const distance = Math.hypot(m.pos.x - m.origin.x, m.pos.y - m.origin.y);
    const verdict: Release = releaseVerdict(speed, distance);

    if (verdict === 'seat') {
      beginSeat(m, m.homeEl, m.homeScale, now);
      return;
    }

    if (prefersReducedMotion()) {
      finishThrow();
      return;
    }
    beginThrow(m, launchVelocity(verdict, pointerVelocity), now);
  }, [beginSeat, finishThrow]);

  /** A cancelled gesture is not a decision: the record goes back. */
  const cancel = useCallback(() => {
    const m = motion.current;
    if (!m || m.phase === 'seat' || m.phase === 'throw') return;
    beginSeat(m, m.homeEl, m.homeScale, performance.now(), m.visiting ?? undefined);
  }, [beginSeat]);

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

      syncSpin(m.homeEl);
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
    () => ({ grab, moveTo, release, cancel, eject, didJustThrow, didJustSeat }),
    [grab, moveTo, release, cancel, eject, didJustThrow, didJustSeat],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <HeldContext.Provider value={held && !held.visiting ? held.track.id : null}>
        <CarriedContext.Provider value={held?.track.id ?? null}>
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
              {held.look === 'sleeve' ? (
                /* A crate in the hand is the sleeve itself, drawn the way it is
                   drawn on the shelf: the printed square with the light on it.
                   No record showing through — what is being carried is the box,
                   and its records are in it. */
                <div
                  className="groove-sleeve-art relative overflow-hidden rounded-md bg-shell-900"
                  style={{ width: DISC_SIZE, height: DISC_SIZE, ['--notch' as string]: '0px' }}
                >
                  {held.track.coverArtUrl && (
                    <img
                      src={held.track.coverArtUrl}
                      alt=""
                      draggable={false}
                      className="h-full w-full object-cover"
                    />
                  )}
                  <span aria-hidden="true" className="groove-sleeve-face absolute inset-0" />
                </div>
              ) : (
                <>
                  {/* Paused, and set to the platter's angle: the record stopped
                      turning the moment it came off the deck, because the music
                      stopped with it. */}
                  <div ref={spinRef} className="groove-platter" data-spinning="false">
                    <VinylDisc size={DISC_SIZE} eager coverArtUrl={held.track.coverArtUrl} />
                  </div>
                  <DiscLight size={DISC_SIZE} />
                </>
              )}
            </div>
            )}
          </div>
        </CarriedContext.Provider>
      </HeldContext.Provider>
    </ActionsContext.Provider>
  );
}
