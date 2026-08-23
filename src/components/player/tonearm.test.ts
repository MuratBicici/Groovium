import { describe, expect, it } from 'vitest';
import * as G from './tonearmGeometry';

/**
 * The claim the tonearm makes is geometric: the stylus sits on the groove it
 * is supposed to be sitting on. The angle is solved for, not chosen, so it can
 * be checked rather than eyeballed.
 */
function stylusAt(radius: number): { x: number; y: number } {
  const rad = (G.angleForRadius(radius) * Math.PI) / 180;
  return {
    x: G.PIVOT_X + G.ARM_LENGTH * Math.cos(rad),
    y: G.PIVOT_Y + G.ARM_LENGTH * Math.sin(rad),
  };
}

const distanceFromSpindle = (radius: number) => {
  const { x, y } = stylusAt(radius);
  return Math.hypot(x - G.CENTRE, y - G.CENTRE);
};

describe('tonearm geometry', () => {
  it('lands the stylus on exactly the groove it was given', () => {
    for (const r of [G.OUTER_GROOVE, 60, 50, 40, G.INNER_GROOVE, G.PARK_RADIUS]) {
      expect(distanceFromSpindle(r)).toBeCloseTo(r, 6);
    }
  });

  it('travels inward as the track plays, and never backwards', () => {
    const radii = Array.from({ length: 21 }, (_, i) => {
      const p = i / 20;
      return G.OUTER_GROOVE + (G.INNER_GROOVE - G.OUTER_GROOVE) * p;
    });
    const reached = radii.map(distanceFromSpindle);

    expect(reached[0]).toBeCloseTo(G.OUTER_GROOVE, 5);
    expect(reached[reached.length - 1]).toBeCloseTo(G.INNER_GROOVE, 5);
    for (let i = 1; i < reached.length; i++) {
      expect(reached[i] as number).toBeLessThan(reached[i - 1] as number);
    }
  });

  it('parks clear of the record', () => {
    expect(G.PARK_RADIUS).toBeGreaterThan(G.DISC_RADIUS);
    expect(distanceFromSpindle(G.PARK_RADIUS)).toBeGreaterThan(G.DISC_RADIUS);
  });

  it('keeps the music inside the record and outside the label', () => {
    // The label is 56/152 of the disc across, so its edge is at radius 28.
    expect(G.INNER_GROOVE).toBeGreaterThan(28);
    expect(G.OUTER_GROOVE).toBeLessThan(G.DISC_RADIUS);
  });

  it('sweeps about as far as a real arm does', () => {
    const sweep = Math.abs(G.angleForRadius(G.INNER_GROOVE) - G.angleForRadius(G.OUTER_GROOVE));
    expect(sweep).toBeGreaterThan(12);
    expect(sweep).toBeLessThan(30);
  });

  it('stays inside the well it is drawn in', () => {
    // The SVG is the 168px box; an arm that solved the geometry but reached
    // outside it would be clipped or overlap the track title.
    for (const r of [G.OUTER_GROOVE, G.INNER_GROOVE, G.PARK_RADIUS]) {
      const { x, y } = stylusAt(r);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(168);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(168);
    }
  });

  it('does not produce NaN for a radius the arm cannot reach', () => {
    // A NaN in a transform drops the whole arm silently.
    expect(Number.isFinite(G.angleForRadius(0))).toBe(true);
    expect(Number.isFinite(G.angleForRadius(9999))).toBe(true);
  });
});
