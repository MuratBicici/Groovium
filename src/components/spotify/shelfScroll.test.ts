import { describe, expect, it } from 'vitest';
import { canGo, EDGE_ZONE_PX, edgeWay, nextStop, scrolls, type Reach } from './shelfScroll';

/**
 * The arrows on a shelf.
 *
 * All three of these come down to not lying to the hand: an arrow that is lit
 * has somewhere to go, a shelf that fits has no arrows at all, and a press
 * lands somewhere the shelf can actually be.
 */

/** A shelf of 900 through a 300 window, scrolled to `at`. */
const shelf = (at: number): Reach => ({ at, width: 900, visible: 300 });

describe('which way a shelf can still go', () => {
  it('cannot go back from the start, and can from anywhere else', () => {
    expect(canGo(shelf(0), 'left')).toBe(false);
    expect(canGo(shelf(300), 'left')).toBe(true);
  });

  it('cannot go on from the end, and can from anywhere else', () => {
    expect(canGo(shelf(600), 'right')).toBe(false);
    expect(canGo(shelf(0), 'right')).toBe(true);
  });

  it('counts a fraction short of an end as the end', () => {
    // Scroll positions are fractional. Without slack both arrows stay lit on a
    // shelf that has arrived, and pressing one does nothing at all.
    expect(canGo(shelf(599.4), 'right')).toBe(false);
    expect(canGo(shelf(0.6), 'left')).toBe(false);
  });

  it('has no arrows when everything is already on screen', () => {
    expect(scrolls({ at: 0, width: 280, visible: 300 })).toBe(false);
    expect(scrolls({ at: 0, width: 900, visible: 300 })).toBe(true);
  });
});

describe('where a press lands', () => {
  it('keeps some of what was on screen on screen', () => {
    // Nearly a screenful, not a screenful: the overlap is how somebody keeps
    // their place across the movement.
    const to = nextStop(shelf(0), 'right');
    expect(to).toBeGreaterThan(0);
    expect(to).toBeLessThan(300);
  });

  it('stops at the end rather than past it', () => {
    expect(nextStop(shelf(500), 'right')).toBe(600);
  });

  it('stops at the start rather than before it', () => {
    expect(nextStop(shelf(100), 'left')).toBe(0);
  });

  it('still moves half a screen when the shelf is narrower than the overlap', () => {
    // A drawer can be narrow enough that a whole screenful is less than what a
    // press is meant to leave behind, which would make every press a no-op.
    const narrow: Reach = { at: 0, width: 400, visible: 60 };
    expect(nextStop(narrow, 'right')).toBe(30);
  });
});

describe('holding a record against the end of a shelf', () => {
  const box = { left: 100, right: 700, top: 50, bottom: 180 };

  it('goes the way of the end it is held at', () => {
    expect(edgeWay({ x: 100 + EDGE_ZONE_PX - 1, y: 100 }, box)).toBe('left');
    expect(edgeWay({ x: 700 - EDGE_ZONE_PX + 1, y: 100 }, box)).toBe('right');
  });

  it('does nothing in the middle', () => {
    expect(edgeWay({ x: 400, y: 100 }, box)).toBeNull();
  });

  it('does nothing for a record passing above, below or beside the shelf', () => {
    expect(edgeWay({ x: 105, y: 20 }, box)).toBeNull();
    expect(edgeWay({ x: 695, y: 300 }, box)).toBeNull();
    expect(edgeWay({ x: 40, y: 100 }, box)).toBeNull();
  });
});

