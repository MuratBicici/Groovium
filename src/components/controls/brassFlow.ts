import { clamp } from '@/core/utils/time';
import { KNOB_PX, SLIDER_RUN_PX, SLIDER_START_PX } from './knob';

/**
 * The level moving from the knob's ring onto the slider and back, in one move.
 *
 * The brass is one strip, whose shape is what changes, so there are no parts to come
 * apart. It was a piece on the ring, a piece on a curve and a piece on the slider,
 * each with ends of its own: at full volume that forked into two arms, and drawing
 * the far one back first cured that by making it two moves. Here each point of the
 * strip has one journey, from where it sits on the ring to where it belongs on the
 * line. All of them are on their way from the start, the head a little ahead.
 *
 * Points up to where the ring is heading for the line go round to it, and on down a
 * short curve. Past that point the ring turns back on itself and there is no way
 * round, so they follow the same journey, starting out to one side of it by however
 * far they are from it: that lower part of the strip bends up and forwards as it
 * opens, rather than sliding back.
 *
 * Apart from the component, so that both ends of it can be checked against what sits
 * still on either side: any difference is a jump somebody would see.
 */

type Point = [number, number];

/** The ring, in px on a 36px knob: its centre, its radius and its width. */
const CENTRE_PX = 18;
const RADIUS_PX = 14.76;
const RING_WIDTH_PX = 2.88;
const SWEEP_DEGREES = 270;
const FIRST_DEGREES = -SWEEP_DEGREES / 2;

/** The ring as a path in the strip's own px, for what is drawn along it. */
export const RING_PATH = 'M7.56 28.44 A14.76 14.76 0 1 1 28.44 28.44';

/** Where the strip heads off for the line, in degrees clockwise from twelve o'clock. */
const LEAVES_AT_DEGREES = 50;

/** How wide the strip is on the line, and how wide the body is open. */
const LINE_WIDTH_PX = 6;
const BODY_OPEN_PX = 160;

/** How long the move takes, one way. */
export const FLOW_MS = 500;

/** How much later the tail sets off than the head, as a share of the move. */
const TAIL_LAG = 0.35;

/** How many stretches the strip is drawn in while it is curved. */
const STRETCHES = 48;

/** The shortest a level takes to get to a new one by itself. */
const GLIDE_LEAST_MS = 80;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const lerp = (a: number, b: number, along: number) => a + (b - a) * along;

function onRing(degrees: number): Point {
  const angle = toRadians(degrees);
  return [CENTRE_PX + RADIUS_PX * Math.sin(angle), CENTRE_PX - RADIUS_PX * Math.cos(angle)];
}

const LEAVES_AT = onRing(LEAVES_AT_DEGREES);
const CURVE: [Point, Point, Point, Point] = [
  LEAVES_AT,
  [LEAVES_AT[0] + 2.8, LEAVES_AT[1] + 3.3],
  [33.5, CENTRE_PX],
  [SLIDER_START_PX, CENTRE_PX],
];

function onCurve(q: number): Point {
  const m = 1 - q;
  const at = (i: 0 | 1) =>
    m * m * m * CURVE[0][i] + 3 * m * m * q * CURVE[1][i] + 3 * m * q * q * CURVE[2][i] + q * q * q * CURVE[3][i];
  return [at(0), at(1)];
}

/** How far round the ring the way off it is, and how long the curve from there is. */
const RING_TO_CURVE_PX = RADIUS_PX * toRadians(LEAVES_AT_DEGREES - FIRST_DEGREES);
const CURVE_PX = (() => {
  let length = 0;
  let last = onCurve(0);
  for (let i = 1; i <= 40; i++) {
    const next = onCurve(i / 40);
    length += Math.hypot(next[0] - last[0], next[1] - last[1]);
    last = next;
  }
  return length;
})();

/** A point a distance along the way: round the ring, down the curve, along the line. */
function onTheWay(distance: number): Point {
  if (distance <= RING_TO_CURVE_PX) return onRing(FIRST_DEGREES + (distance / RADIUS_PX) * (180 / Math.PI));
  if (distance <= RING_TO_CURVE_PX + CURVE_PX) return onCurve((distance - RING_TO_CURVE_PX) / CURVE_PX);
  return [SLIDER_START_PX + distance - RING_TO_CURVE_PX - CURVE_PX, CENTRE_PX];
}

export function smooth(p: number): number {
  return p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
}

/**
 * Where a point of the strip is. `u` is how far along the strip, 0 at the tail.
 *
 * On the line its round end reaches the start of the slider and the handle's place
 * at the head, as the fill always has: so the tail stops short by as much as the
 * round end adds, on a line long enough to have that to spare.
 */
function pointAt(level: number, u: number, along: number): Point {
  const degrees = FIRST_DEGREES + u * level * SWEEP_DEGREES;
  const journey = smooth(clamp((along - (1 - u) * TAIL_LAG) / (1 - TAIL_LAG), 0, 1));

  const run = level * SLIDER_RUN_PX;
  const roundEnd = Math.min(LINE_WIDTH_PX / 2, run);
  const onLine = roundEnd + u * (run - roundEnd);
  const end = RING_TO_CURVE_PX + CURVE_PX + onLine;

  if (degrees <= LEAVES_AT_DEGREES) {
    return onTheWay(lerp(RADIUS_PX * toRadians(degrees - FIRST_DEGREES), end, journey));
  }
  const way = onTheWay(lerp(RING_TO_CURVE_PX, end, journey));
  const start = onRing(degrees);
  const aside = (1 - journey) ** 2;
  return [way[0] + (start[0] - LEAVES_AT[0]) * aside, way[1] + (start[1] - LEAVES_AT[1]) * aside];
}

export interface Flow {
  /** The strip, from tail to head, in px across the knob. None for no level at all. */
  points: Point[];
  /** How wide the strip is, in px. */
  width: number;
  /** Where its head is, which is where the handle goes. */
  head: Point;
  /** How big the handle is, 0 to 1. */
  handle: number;
  /** The brass's colour running from one point to another, across the strip. */
  shade: [number, number, number, number];
  /** How much of the line's groove shows, 0 to 1. */
  groove: number;
  /** How wide the body is, in px. */
  body: number;
}

/**
 * The strip, for a level and how far the move has got: 0 on the ring as it sits on
 * the knob, 1 on the slider.
 */
export function flowAt(level: number, along: number): Flow {
  const settled = smooth(along);
  const stretches = along >= 1 ? 1 : STRETCHES;
  const points: Point[] = [];
  if (level > 0) {
    for (let i = 0; i <= stretches; i++) points.push(pointAt(level, i / stretches, along));
  }
  return {
    points,
    width: lerp(RING_WIDTH_PX, LINE_WIDTH_PX, settled),
    head: pointAt(level, 1, along),
    handle: smooth(clamp((along - 0.5) / 0.5, 0, 1)),
    // Across the ring as the knob's own brass is, and then along the line with the
    // bright end at the head, as the fill is.
    shade: [
      lerp(3.24, SLIDER_START_PX + level * SLIDER_RUN_PX, settled),
      lerp(3.24, CENTRE_PX, settled),
      lerp(32.76, SLIDER_START_PX, settled),
      lerp(28.44, CENTRE_PX, settled),
    ],
    groove: clamp((along - 0.05) * 4, 0, 1),
    // Open ahead of the strip going out, and so closed behind it coming home.
    body: lerp(KNOB_PX, BODY_OPEN_PX, smooth(clamp(along * 1.6, 0, 1))),
  };
}

/**
 * How long a level not under a hand takes to get to a new one. In step with the
 * move for the whole way, so that a press that mutes takes the brass all the way
 * home as it empties: it used to empty in a fifth of the time, and with nothing left
 * to carry home the sound looked to be cut with no movement at all. A nudge of the
 * wheel is short, or holding it would lag behind.
 */
export function glideMs(from: number, to: number): number {
  return Math.min(FLOW_MS, Math.max(GLIDE_LEAST_MS, Math.abs(to - from) * FLOW_MS * 1.5));
}
