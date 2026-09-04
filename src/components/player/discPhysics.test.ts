import { describe, expect, it } from 'vitest';
import {
  CATCH_RADIUS,
  FLING_SPEED,
  GRAVITY,
  HAND_REACH,
  isGone,
  launchVelocity,
  MAX_FLING_SPEED,
  reachMs,
  releaseVerdict,
  seatPoint,
  stepProjectile,
  type Sample,
  velocityFrom,
} from './discPhysics';

/**
 * Letting go of the record decides whether the music survives, so the rule that
 * decides it is worth stating on its own rather than leaving inside a pointer
 * handler where only a mouse can reach it.
 */
describe('what happens when the record is released', () => {
  it('seats it when it is put down over the deck', () => {
    expect(releaseVerdict(0, 0)).toBe('seat');
    expect(releaseVerdict(120, CATCH_RADIUS - 1)).toBe('seat');
  });

  it('drops it when it is let go in mid-air', () => {
    // Letting go of a record away from the deck is letting go of it, however
    // gently the hand was moving at the time.
    expect(releaseVerdict(0, CATCH_RADIUS + 1)).toBe('drop');
    expect(releaseVerdict(120, 400)).toBe('drop');
  });

  it('throws it whenever the hand was moving, wherever the hand was', () => {
    // Speed wins outright: someone whipping the mouse across the window has
    // thrown it, and where the pointer happened to be at the instant of release
    // is not what the gesture was about.
    expect(releaseVerdict(FLING_SPEED, 0)).toBe('fling');
    expect(releaseVerdict(FLING_SPEED + 500, 400)).toBe('fling');
  });

  it('draws both lines where they say they are', () => {
    // The boundaries are inclusive on the side that keeps the music, and each
    // is checked from both directions so a `<` slipping to `<=` is caught.
    expect(releaseVerdict(FLING_SPEED - 1, CATCH_RADIUS)).toBe('seat');
    expect(releaseVerdict(FLING_SPEED, CATCH_RADIUS)).toBe('fling');
    expect(releaseVerdict(FLING_SPEED - 1, CATCH_RADIUS + 0.001)).toBe('drop');
  });
});

describe('the speed the release is judged by', () => {
  const trail = (points: Array<[number, number, number]>): Sample[] =>
    points.map(([x, y, t]) => ({ x, y, t }));

  it('is zero when there is nothing to measure', () => {
    expect(velocityFrom([], 0)).toEqual({ x: 0, y: 0 });
    expect(velocityFrom(trail([[10, 10, 0]]), 0)).toEqual({ x: 0, y: 0 });
  });

  it('is zero once the pointer has been sitting still', () => {
    // The case this whole window exists for: drag the record across the
    // window, hold it over the deck, then let go. Judged from the last sample
    // that is still a fast drag, and putting a record down carefully would
    // fling it across the room.
    const dragged = trail([
      [0, 0, 0],
      [150, 0, 20],
      [300, 0, 40],
    ]);
    expect(velocityFrom(dragged, 40).x).toBeCloseTo(7500, 6);
    expect(velocityFrom(dragged, 300)).toEqual({ x: 0, y: 0 });
  });

  it('reads a hand that is slowing as slowing', () => {
    // A dwell shorter than the window is not a stop, but it is not full speed
    // either: the pause goes into the divisor, so the reading decays.
    const flick = trail([
      [0, 0, 0],
      [80, 0, 40],
    ]);
    expect(velocityFrom(flick, 40).x).toBeCloseTo(2000, 6);
    expect(velocityFrom(flick, 80).x).toBeCloseTo(1000, 6);
  });

  it('reads a steady drag as its actual speed', () => {
    // 60px right and 30px down over 60ms.
    const v = velocityFrom(trail([
      [0, 0, 0],
      [20, 10, 20],
      [40, 20, 40],
      [60, 30, 60],
    ]), 60);
    expect(v.x).toBeCloseTo(1000, 6);
    expect(v.y).toBeCloseTo(500, 6);
  });

  it('ignores what the pointer did before the window', () => {
    // A long slow drag that ends in a flick is a flick, and a long fast drag
    // that ends in a pause is a placement. Only the tail counts.
    const v = velocityFrom(trail([
      [0, 0, 0],
      [400, 0, 500],
      [400, 0, 560],
      [400, 0, 600],
    ]), 600);
    expect(v.x).toBe(0);
  });

  it('does not turn a 1ms mouse report into a thousand pixels a second', () => {
    // The bug this window exists for: two samples a millisecond and a pixel
    // apart are mostly quantisation, and dividing by them says 1000px/s.
    const v = velocityFrom(trail([
      [0, 0, 0],
      [1, 0, 40],
      [2, 0, 79],
      [3, 0, 80],
    ]), 80);
    expect(Math.hypot(v.x, v.y)).toBeLessThan(FLING_SPEED);
  });

  it('refuses to divide by a zero interval', () => {
    expect(velocityFrom(trail([[0, 0, 5], [90, 0, 5]]), 5)).toEqual({ x: 0, y: 0 });
  });
});

describe('the throw itself', () => {
  it('starts a drop from rest, so gravity is the whole of it', () => {
    expect(launchVelocity('drop', { x: 4000, y: -4000 })).toEqual({ x: 0, y: 0 });
  });

  it('keeps a fling’s direction but caps how hard it can be thrown', () => {
    const fast = launchVelocity('fling', { x: 6000, y: 8000 });
    expect(Math.hypot(fast.x, fast.y)).toBeCloseTo(MAX_FLING_SPEED, 6);
    // Direction survives the cap: 3-4-5, so the ratio is unchanged.
    expect(fast.y / fast.x).toBeCloseTo(8 / 6, 6);

    const gentle = launchVelocity('fling', { x: 300, y: -100 });
    expect(gentle).toEqual({ x: 300, y: -100 });
  });

  it('falls, and falls faster the longer it falls', () => {
    let p = { x: 0, y: 0, vx: 0, vy: 0, spin: 0 };
    const first = stepProjectile(p, 16);
    p = first;
    for (let i = 0; i < 10; i++) p = stepProjectile(p, 16);
    const last = stepProjectile(p, 16);

    expect(first.y).toBeGreaterThan(0);
    expect(last.y - p.y).toBeGreaterThan(first.y);
    expect(last.vy).toBeCloseTo(GRAVITY * (12 * 16) / 1000, 6);
  });

  it('tumbles the way it is travelling, and not at all when it is not', () => {
    const right = stepProjectile({ x: 0, y: 0, vx: 600, vy: 0, spin: 0 }, 16);
    const left = stepProjectile({ x: 0, y: 0, vx: -600, vy: 0, spin: 0 }, 16);
    const straightDown = stepProjectile({ x: 0, y: 0, vx: 0, vy: 600, spin: 0 }, 16);

    expect(right.spin).toBeGreaterThan(0);
    expect(left.spin).toBeLessThan(0);
    expect(straightDown.spin).toBe(0);
  });

  it('counts the record gone only once its rim has cleared the edge', () => {
    const bounds = { width: 340, height: 480 };
    const at = (x: number, y: number) => ({ x, y, vx: 0, vy: 0, spin: 0 });

    expect(isGone(at(170, 240), bounds)).toBe(false);
    // Centre past the bottom edge but still showing.
    expect(isGone(at(170, 490), bounds)).toBe(false);
    expect(isGone(at(170, 600), bounds)).toBe(true);
    expect(isGone(at(-100, 240), bounds)).toBe(true);
    expect(isGone(at(500, 240), bounds)).toBe(true);
    // Flung upward hard enough to leave over the top.
    expect(isGone(at(170, -100), bounds)).toBe(true);
  });
});

describe('the way back to where a record lives', () => {
  const from = { x: 0, y: 200 };
  const home = { x: 400, y: 100 };
  /** Out past the sleeve's right edge, which is the side its mouth is on. */
  const mouth = { x: home.x + 118, y: home.y - 8 };

  it('starts where the hand let go and ends where the record lives', () => {
    expect(seatPoint(from, home, mouth, 0)).toEqual(from);
    const end = seatPoint(from, home, mouth, 1);
    expect(end.x).toBeCloseTo(home.x, 6);
    expect(end.y).toBeCloseTo(home.y, 6);
  });

  it('goes out past the mouth before it turns in', () => {
    // The whole point of the control point: without it the record crosses the
    // printed face of the sleeve and enters from the left, through cardboard.
    const furthest = Math.max(
      ...Array.from({ length: 101 }, (_, i) => seatPoint(from, home, mouth, i / 100).x),
    );
    expect(furthest).toBeGreaterThan(home.x);
  });

  it('is still travelling inwards when it arrives', () => {
    // The fault this replaced: the record reached the mouth, stopped, and was
    // slid in by a second animation — two moves with a full stop between them.
    // One curve cannot stop in the middle, and this is the half that proves
    // the last thing it does is move left, into the sleeve.
    const late = seatPoint(from, home, mouth, 0.96);
    const arrival = seatPoint(from, home, mouth, 1);
    expect(arrival.x).toBeLessThan(late.x);
  });

  it('is a straight line for a platter, which is entered from above', () => {
    const half = seatPoint(from, home, null, 0.5);
    expect(half.x).toBeCloseTo((from.x + home.x) / 2, 6);
    expect(half.y).toBeCloseTo((from.y + home.y) / 2, 6);
  });

  it('hops over the line when it is a record going onto a spindle', () => {
    const flat = seatPoint(from, home, null, 0.5);
    const dropped = seatPoint(from, home, null, 0.5, { height: 22, at: 0.5 });
    // Up is negative, and the apex is the full height at the middle.
    expect(flat.y - dropped.y).toBeCloseTo(22, 6);
    // And it is back on the line at both ends, so it cannot miss.
    expect(seatPoint(from, home, null, 1, { height: 22, at: 1 }).y).toBeCloseTo(home.y, 6);
  });

  it('does not hop when it is going back where it was borrowed from', () => {
    // A sleeve and a shelf are places a thing is put back into, not places it
    // is dropped onto. A crate bouncing on its way home read as it hitting the
    // shelf rather than settling into it.
    for (const at of [0.25, 0.5, 0.75]) {
      expect(seatPoint(from, home, mouth, at)).toEqual(seatPoint(from, home, mouth, at, undefined));
    }
  });
});

describe('how long the hand takes to reach', () => {
  it('grows with the square root of the distance, not with the distance', () => {
    // The whole reason this is not a speed. Under a constant speed, reaching
    // four times as far costs four times as long — which is what made a drag
    // across the drawer a wait, and what made raising the speed until that
    // stopped turn a short drag into a blink.
    const near = reachMs(100, 0, 10_000);
    const far = reachMs(400, 0, 10_000);
    expect(far / near).toBeCloseTo(2, 6);
  });

  it('keeps the whole gesture within about half again across the window', () => {
    // What anybody feels is the whole of taking a record out: the tug that
    // draws it clear, which is a fixed distance and so a fixed time, and then
    // the reach. Ninety milliseconds is what the crate spends on the tug — the
    // number lives with the sleeve, and is repeated here because this is the
    // claim being made about the gesture rather than about the leg.
    const tug = 90;
    const shortest = tug + reachMs(100, 80, 360);
    const longest = tug + reachMs(450, 80, 360);
    expect(longest / shortest).toBeLessThan(1.7);
    expect(longest / shortest).toBeGreaterThan(1.4);
    // And under a constant speed the same two would be four and a half times
    // apart before the tug, which is the spread this replaced.
    expect(450 / 100).toBe(4.5);
  });

  it('holds a leg with nothing to travel at its floor', () => {
    // A record lifted off the deck: the hand is already on it, so the floor is
    // the whole of the duration and the arm's rule never comes into it.
    expect(reachMs(0, 180, 360)).toBe(180);
    expect(reachMs(20, 180, 360)).toBe(180);
  });

  it('never runs away with a very long one', () => {
    expect(reachMs(5000, 80, 360)).toBe(360);
  });

  it('is the acceleration it says it is', () => {
    expect(reachMs(121, 0, 10_000)).toBeCloseTo(HAND_REACH * 11, 6);
  });
});
