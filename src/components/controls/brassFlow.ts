import { clamp } from '@/core/utils/time';
import { SLIDER_RUN_PX } from './knob';

/**
 * The level moving from the knob's ring onto the slider and back.
 *
 * The brass goes round the ring the way the level grows, leaves it, and carries on
 * along the slider, with the handle at its head. One rail, in other words, and
 * everything here is where on it the two ends of the brass are.
 *
 * It leaves the ring where it is already heading for the slider. Going straight
 * across at three o'clock looked like the obvious way, and there the ring runs
 * straight down and the slider straight along: a right angle, in something meant
 * to look poured. At this angle the ring is heading down and to the right, and a
 * short curve brings that round into the line.
 *
 * It is one piece at every moment. A level past that point has brass further round
 * than the way out, which has to come back to it, and it does that first, while
 * nothing has left. Done together with the rest, the brass forked there into two
 * arms, one running on to the slider and one drawing back beneath it.
 *
 * Apart from the component, so that the two ends of it can be checked against what
 * sits still on either side: any difference is a jump somebody would see.
 */

/** The ring's radius and the sweep of it, in px on a 36px knob. */
const RING_RADIUS_PX = 14.76;
const RING_SWEEP_DEGREES = 270;
const RING_PX = (RING_RADIUS_PX * RING_SWEEP_DEGREES * Math.PI) / 180;

/** Where the brass leaves the ring, in degrees clockwise from twelve o'clock. */
const LEAVES_AT_DEGREES = 50;
/** How far round the ring that is, from its start at seven o'clock, in px. */
const LEAVES_AT_PX = (((LEAVES_AT_DEGREES + RING_SWEEP_DEGREES / 2) / RING_SWEEP_DEGREES) * RING_PX);

/** That point as how far along the ring it is, 0 to 1. */
export const LEAVES_AT = LEAVES_AT_PX / RING_PX;

/** The curve from there to the slider, in the knob's own hundred units. */
export const LINK_PATH = 'M81.4 23.6 C89.1 32.8 96 50 108 50';
/** How long that curve is, in px. */
const LINK_PX = 14.4;

/** Where the slider starts, along the whole rail. */
const BAR_AT_PX = LEAVES_AT_PX + LINK_PX;

/** How long the move takes, one way. */
export const FLOW_MS = 450;

/** How far back it has come when the body starts to close around it. */
const BODY_CLOSES_AT = 0.45;

/** How much of the move the handle takes to grow, at the end of it. */
const HANDLE_GROWS_FROM = 0.55;

/** How long brass past the way out takes to come back to it, for each px of it. */
const DRAW_BACK_MS_PER_PX = 12;

/** How far a level's brass is past the way out, in px. */
function pastTheWayOut(level: number): number {
  return Math.max(0, level * RING_PX - LEAVES_AT_PX);
}

/** How long the whole move takes at a level, drawing back included. */
export function flowMs(level: number): number {
  return FLOW_MS + pastTheWayOut(level) * DRAW_BACK_MS_PER_PX;
}

/** How much of the move at a level is spent drawing back, 0 to 1. */
function drawBackShare(level: number): number {
  return 1 - FLOW_MS / flowMs(level);
}

/** How far the flowing part of the move has got, 0 to 1. */
function flowingAlong(level: number, along: number): number {
  const share = drawBackShare(level);
  return clamp((along - share) / (1 - share), 0, 1);
}

/** Whether the body should still be open around the brass at this point. */
export function bodyStaysOpen(level: number, along: number): boolean {
  return flowingAlong(level, along) > BODY_CLOSES_AT;
}

/** The shortest a level takes to get to a new one by itself. */
const GLIDE_LEAST_MS = 80;

/**
 * How long a level not under a hand takes to get to a new one. In step with the
 * move for the whole way, so that a press that mutes takes the brass all the way
 * home as it empties: it used to empty in a fifth of the time, and with nothing left
 * to carry home the sound looked to be cut with no movement at all. A nudge of the
 * wheel is short, or holding it would lag behind.
 */
export function glideMs(from: number, to: number): number {
  return Math.min(flowMs(Math.max(from, to)), Math.max(GLIDE_LEAST_MS, Math.abs(to - from) * FLOW_MS * 1.5));
}

export function smooth(p: number): number {
  return p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
}

const lerp = (a: number, b: number, along: number) => a + (b - a) * along;

export interface Flow {
  /** The brass on the ring, as how far along it each end is, 0 to 1. */
  ring: [number, number];
  /** The brass on the curve, the same way. */
  link: [number, number];
  /** How much of the slider is filled, in px. */
  fill: number;
  /** How big the handle is, 0 to 1. Where it is, is the end of the fill. */
  handle: number;
}

/**
 * Where the brass is, for a level and how far the move has got: 0 on the ring as
 * it sits on the knob, 1 on the slider.
 */
export function flowAt(level: number, along: number): Flow {
  const tip = level * RING_PX;
  const run = level * SLIDER_RUN_PX;
  const end = BAR_AT_PX + run;

  // The head goes first and the tail follows, which is what makes it a flow and
  // not a shape sliding about.
  const flowing = flowingAlong(level, along);
  const headAlong = smooth(clamp(flowing / 0.85, 0, 1));
  const tailAlong = smooth(clamp((flowing - 0.15) / 0.85, 0, 1));
  const head = lerp(Math.min(tip, LEAVES_AT_PX), end, headAlong);

  // No longer than the level makes it at either end. Without this a low level
  // sent a long streak round the ring, out of a sliver of brass, and silence sent
  // one out of nothing.
  const tail = Math.max(lerp(0, BAR_AT_PX, tailAlong), head - Math.max(Math.min(tip, LEAVES_AT_PX), run));

  // Past the way out it comes back first, and takes its time: quickly, it was a
  // sudden slide under the line at full volume, and a sudden shot from under it on
  // the way home.
  const share = drawBackShare(level);
  const ringEnd =
    tip > LEAVES_AT_PX
      ? lerp(tip, LEAVES_AT_PX, smooth(clamp(along / share, 0, 1)))
      : Math.min(head, LEAVES_AT_PX);
  const ringStart = Math.min(tail, LEAVES_AT_PX);

  return {
    ring: [ringStart / RING_PX, Math.max(ringStart, ringEnd) / RING_PX],
    link: [
      clamp((tail - LEAVES_AT_PX) / LINK_PX, 0, 1),
      clamp((head - LEAVES_AT_PX) / LINK_PX, 0, 1),
    ],
    fill: Math.max(0, head - BAR_AT_PX),
    handle: smooth(clamp((flowing - HANDLE_GROWS_FROM) / (1 - HANDLE_GROWS_FROM), 0, 1)),
  };
}
