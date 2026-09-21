import { describe, expect, it } from 'vitest';
import type { Mote } from '@/core/visualizer/motes';
import { FROM_LABEL, START, WIDTH, orbitRadius, streak } from './orbit';

const TAU = Math.PI * 2;

function mote(height: number, extra: Partial<Mote> = {}): Mote {
  return { height, speed: 0.4, size: 1, heat: 1, ...extra };
}

describe('a light going round the record', () => {
  it('is born at the top of the label and comes back to it', () => {
    expect(streak(mote(0), 0.5, 1).head).toBeCloseTo(START, 5);
    expect(streak(mote(1), 0.5, 1).head).toBeCloseTo(START + TAU, 5);
  });

  it('goes round the way a record turns', () => {
    const early = streak(mote(0.25), 0.5, 1).head;
    const later = streak(mote(0.75), 0.5, 1).head;
    expect(later).toBeGreaterThan(early);
    // A quarter of the lap is a quarter turn, and no more.
    expect(early - START).toBeCloseTo(TAU / 4, 5);
  });

  it('always draws its tail behind it', () => {
    const at = streak(mote(0.4), 0.5, 1);
    expect(at.tail).toBeLessThan(at.head);
  });

  it('draws a longer tail the louder it is, and a longer one the larger it is', () => {
    const arc = (level: number, size: number) => {
      const s = streak(mote(0.4, { size }), level, 1);
      return s.head - s.tail;
    };
    expect(arc(0.9, 1)).toBeGreaterThan(arc(0.1, 1));
    expect(arc(0.5, 1.3)).toBeGreaterThan(arc(0.5, 0.6));
    // Still a light on a rim, not a ring: never a third of the way round.
    expect(arc(1, 1.3)).toBeLessThan(TAU / 3);
  });

  it('swells and burns with the level, and with the dial', () => {
    expect(streak(mote(0.4), 0.9, 1).width).toBeGreaterThan(streak(mote(0.4), 0.1, 1).width);
    expect(streak(mote(0.4), 0.5, 1.5).width).toBeGreaterThan(WIDTH);
    expect(streak(mote(0.4), 0.5, 0.5).width).toBeLessThan(WIDTH);
  });

  it('is out before it is born and as it finishes', () => {
    expect(streak(mote(-0.02), 0.5, 1).alpha).toBe(0);
    expect(streak(mote(0.999), 0.5, 1).alpha).toBeCloseTo(0, 3);
    expect(streak(mote(0.4), 0.5, 1).alpha).toBeGreaterThan(0);
  });

  it('never burns past full, however it is tuned', () => {
    expect(streak(mote(0.3), 1, 1.55).alpha).toBeLessThanOrEqual(1);
  });

  it('runs just outside the label', () => {
    expect(orbitRadius(620, 0.21)).toBe(620 * 0.21 + FROM_LABEL);
  });
});
