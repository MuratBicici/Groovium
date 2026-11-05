import { describe, expect, it } from 'vitest';
import { SLIDER_RUN_PX } from './knob';
import { FLOW_MS, LEAVES_AT, flowAt, flowMs, glideMs } from './brassFlow';

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
    for (const level of LEVELS) {
      const frames = Math.round(flowMs(level) / 16); // At sixty frames a second.
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

describe('a level past where the brass leaves the ring', () => {
  const framesAt = (level: number) => Math.round(flowMs(level) / 16);

  it('draws the end of it back evenly, and not in a sudden slide under the line', () => {
    for (const level of [0.75, 0.85, 1]) {
      const frames = framesAt(level);
      let last = flowAt(level, 0);
      for (let frame = 1; frame <= frames; frame++) {
        const now = flowAt(level, frame / frames);
        expect(now.ring[1]).toBeLessThanOrEqual(last.ring[1] + 1e-9);
        expect(last.ring[1] - now.ring[1]).toBeLessThan(0.05);
        last = now;
      }
    }
  });

  it('takes longer the further it has to come back', () => {
    expect(flowMs(0.5)).toBe(FLOW_MS);
    expect(flowMs(1)).toBeGreaterThan(flowMs(0.85));
    expect(flowMs(0.85)).toBeGreaterThan(FLOW_MS);
  });
});

describe('the brass, at every moment of the move', () => {
  it('is one piece: nothing has left the ring while any is still past the way out', () => {
    for (let level = 0; level <= 1.0001; level += 0.01) {
      const frames = Math.round(flowMs(level) / 8);
      for (let frame = 0; frame <= frames; frame++) {
        const { ring, link, fill } = flowAt(level, frame / frames);
        const hasLeft = link[1] > 0 || fill > 0;
        if (hasLeft) expect(ring[1]).toBeLessThanOrEqual(LEAVES_AT + 1e-9);
      }
    }
  });

  it('has no gap on its way across: each part starts where the last one ends', () => {
    for (let level = 0.02; level <= 1.0001; level += 0.02) {
      const frames = Math.round(flowMs(level) / 8);
      for (let frame = 0; frame <= frames; frame++) {
        const { ring, link, fill } = flowAt(level, frame / frames);
        const onRing = ring[1] > ring[0] + 1e-9;
        const onLink = link[1] > link[0] + 1e-9;
        if (onRing && onLink) expect(ring[1]).toBeCloseTo(LEAVES_AT, 6);
        if (onRing && onLink) expect(link[0]).toBe(0);
        if (fill > 0 && link[0] < 1) expect(link[1]).toBe(1);
        if (fill > 0 && onRing) expect(link[0]).toBe(0);
      }
    }
  });
});

describe('a level moving by itself', () => {
  it('takes as long as the move does when it is muted, so it can be seen going', () => {
    expect(glideMs(0.8, 0)).toBeGreaterThanOrEqual(FLOW_MS);
    expect(glideMs(0, 0.8)).toBe(glideMs(0.8, 0));
  });

  it('is quick about a nudge of the wheel', () => {
    expect(glideMs(0.5, 0.55)).toBeLessThan(FLOW_MS / 3);
  });
});
