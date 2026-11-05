import { describe, expect, it } from 'vitest';
import { SLIDER_RUN_PX } from './knob';
import { flowAt } from './brassFlow';

const LEVELS = [0, 0.02, 0.1, 0.35, 0.5, 0.69, 0.7, 0.8, 0.95, 1];

describe('the level moving onto the slider', () => {
  it('starts as exactly the brass on the knob', () => {
    for (const level of LEVELS) {
      const flow = flowAt(level, 0);
      expect(flow.ring[0]).toBe(0);
      expect(flow.ring[1]).toBeCloseTo(level, 6);
      expect(flow.link[1]).toBe(0);
      expect(flow.fill).toBe(0);
      expect(flow.handle).toBe(0);
    }
  });

  it('ends as exactly the slider at that level, with nothing left on the way', () => {
    for (const level of LEVELS) {
      const flow = flowAt(level, 1);
      expect(flow.ring[1] - flow.ring[0]).toBeCloseTo(0, 6);
      expect(flow.link[1] - flow.link[0]).toBeCloseTo(0, 6);
      expect(flow.fill).toBeCloseTo(level * SLIDER_RUN_PX, 6);
      expect(flow.handle).toBe(1);
    }
  });

  it('never jumps between one frame and the next', () => {
    const frames = 27; // At sixty frames a second, the length of the move.
    for (const level of LEVELS) {
      let last = flowAt(level, 0);
      for (let frame = 1; frame <= frames; frame++) {
        const now = flowAt(level, frame / frames);
        expect(Math.abs(now.ring[0] - last.ring[0])).toBeLessThan(0.15);
        expect(Math.abs(now.ring[1] - last.ring[1])).toBeLessThan(0.15);
        expect(Math.abs(now.fill - last.fill)).toBeLessThan(14);
        last = now;
      }
    }
  });

  it('only ever moves forward on the way out', () => {
    for (const level of LEVELS) {
      let last = flowAt(level, 0);
      for (let frame = 1; frame <= 27; frame++) {
        const now = flowAt(level, frame / 27);
        expect(now.ring[0]).toBeGreaterThanOrEqual(last.ring[0] - 1e-9);
        expect(now.fill).toBeGreaterThanOrEqual(last.fill);
        last = now;
      }
    }
  });

  it('keeps its ends the right way round', () => {
    for (const level of LEVELS) {
      for (let frame = 0; frame <= 27; frame++) {
        const { ring, link } = flowAt(level, frame / 27);
        expect(ring[1]).toBeGreaterThanOrEqual(ring[0]);
        expect(link[1]).toBeGreaterThanOrEqual(link[0]);
      }
    }
  });

  it('sends nothing round from silence, and only a little from a sliver', () => {
    for (let frame = 0; frame <= 27; frame++) {
      const silent = flowAt(0, frame / 27);
      expect(silent.ring[1] - silent.ring[0]).toBeCloseTo(0, 6);
      expect(silent.link[1] - silent.link[0]).toBeCloseTo(0, 6);
      expect(silent.fill).toBe(0);

      const sliver = flowAt(0.02, frame / 27);
      expect(sliver.ring[1] - sliver.ring[0]).toBeLessThan(0.05);
    }
  });

  it('never fills past the level', () => {
    for (const level of LEVELS) {
      for (let frame = 0; frame <= 27; frame++) {
        expect(flowAt(level, frame / 27).fill).toBeLessThanOrEqual(level * SLIDER_RUN_PX + 1e-9);
      }
    }
  });
});
