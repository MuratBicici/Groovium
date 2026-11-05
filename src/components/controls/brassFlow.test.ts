import { describe, expect, it } from 'vitest';
import { SLIDER_RUN_PX, SLIDER_START_PX } from './knob';
import { FLOW_MS, flowAt, glideMs } from './brassFlow';

const LEVELS = [0.02, 0.1, 0.35, 0.5, 0.69, 0.7, 0.8, 0.95, 1];
const FRAMES = Math.round(FLOW_MS / 16);

const CENTRE = 18;
const RADIUS = 14.76;

describe('the strip at rest', () => {
  it('starts as exactly the brass on the knob', () => {
    for (const level of LEVELS) {
      const flow = flowAt(level, 0);
      for (const [x, y] of flow.points) expect(Math.hypot(x - CENTRE, y - CENTRE)).toBeCloseTo(RADIUS, 6);

      // From seven o'clock round to the level.
      const tip = ((-135 + level * 270) * Math.PI) / 180;
      expect(flow.head[0]).toBeCloseTo(CENTRE + RADIUS * Math.sin(tip), 6);
      expect(flow.head[1]).toBeCloseTo(CENTRE - RADIUS * Math.cos(tip), 6);
      expect(flow.width).toBeCloseTo(2.88, 6);
      expect(flow.handle).toBe(0);
      expect(flow.groove).toBe(0);
      expect(flow.body).toBe(36);
    }
  });

  it('ends as exactly the slider at that level', () => {
    for (const level of LEVELS) {
      const flow = flowAt(level, 1);
      for (const [, y] of flow.points) expect(y).toBeCloseTo(CENTRE, 6);
      const run = level * SLIDER_RUN_PX;
      expect(flow.points[0]?.[0]).toBeCloseTo(SLIDER_START_PX + Math.min(3, run), 6);
      expect(flow.head[0]).toBeCloseTo(SLIDER_START_PX + run, 6);
      expect(flow.head[1]).toBeCloseTo(CENTRE, 6);
      expect(flow.width).toBe(6);
      expect(flow.handle).toBe(1);
      expect(flow.groove).toBe(1);
      expect(flow.body).toBe(160);
    }
  });
});

describe('the strip on the move', () => {
  it('never jumps between one frame and the next', () => {
    for (const level of LEVELS) {
      let last = flowAt(level, 0);
      for (let frame = 1; frame < FRAMES; frame++) {
        const now = flowAt(level, frame / FRAMES);
        now.points.forEach(([x, y], i) => {
          const [px, py] = last.points[i] ?? [x, y];
          expect(Math.hypot(x - px, y - py)).toBeLessThan(16);
        });
        last = now;
      }
    }
  });

  it('holds together: no two neighbouring points of it are ever far apart', () => {
    for (const level of LEVELS) {
      for (let frame = 0; frame < FRAMES; frame++) {
        const { points } = flowAt(level, frame / FRAMES);
        for (let i = 1; i < points.length; i++) {
          const [ax, ay] = points[i - 1] ?? [0, 0];
          const [bx, by] = points[i] ?? [0, 0];
          expect(Math.hypot(bx - ax, by - ay)).toBeLessThan(6);
        }
      }
    }
  });

  it('is one move: past the way off the ring, the head only ever comes forward', () => {
    for (const level of [0.75, 0.85, 0.95, 1]) {
      let last = flowAt(level, 0).head[0];
      for (let frame = 1; frame <= FRAMES; frame++) {
        const now = flowAt(level, frame / FRAMES).head[0];
        expect(now).toBeGreaterThanOrEqual(last - 1e-9);
        last = now;
      }
    }
  });

  it('is one move: the whole strip is on its way well before the head arrives', () => {
    for (const level of LEVELS) {
      const before = flowAt(level, 0).points;
      const during = flowAt(level, 0.5).points;
      during.forEach(([x, y], i) => {
        const [bx, by] = before[i] ?? [x, y];
        expect(Math.hypot(x - bx, y - by)).toBeGreaterThan(0);
      });
    }
  });

  it('has nothing to move from silence', () => {
    for (let frame = 0; frame <= FRAMES; frame++) expect(flowAt(0, frame / FRAMES).points).toEqual([]);
  });

  it('has the body open around its head, so it is never cut off', () => {
    for (const level of LEVELS) {
      for (let frame = 0; frame <= FRAMES; frame++) {
        const flow = flowAt(level, frame / FRAMES);
        expect(flow.head[0]).toBeLessThanOrEqual(flow.body);
      }
    }
  });
});

describe('a level moving by itself', () => {
  it('takes as long as the move does when it is muted, so it can be seen going', () => {
    expect(glideMs(0.8, 0)).toBe(FLOW_MS);
    expect(glideMs(0, 0.8)).toBe(FLOW_MS);
  });

  it('is quick about a nudge of the wheel', () => {
    expect(glideMs(0.5, 0.55)).toBeLessThan(FLOW_MS / 3);
  });
});
