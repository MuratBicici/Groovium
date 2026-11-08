import { describe, expect, it } from 'vitest';
import type { TrackMetadata } from '@/core/types';
import {
  PAGE_RADIUS_PX,
  backwards,
  bubbleFrames,
  flightFrames,
  hoursAndMinutes,
  minutesOf,
  mouthOf,
} from './crateMotion';

const from = { left: 100, top: 40, width: 92, height: 92 };
const to = { left: 8, top: 8, width: 664, height: 454 };

describe('the page swelling out of its crate', () => {
  it('starts exactly on the crate, solid, so that it covers it from the first frame', () => {
    const [first] = bubbleFrames(from, to);
    expect(first).toMatchObject({ left: '100px', top: '40px', width: '92px', height: '92px' });
    expect(first).not.toHaveProperty('opacity');
  });

  it('ends exactly on the page, with its round corners', () => {
    expect(bubbleFrames(from, to).at(-1)).toMatchObject({
      left: '8px',
      top: '8px',
      width: '664px',
      height: '454px',
      borderRadius: `${PAGE_RADIUS_PX}px`,
    });
  });
});

describe('where records leave the cover', () => {
  it('is its right edge, half way up', () => {
    expect(mouthOf({ left: 22, top: 48, width: 152, height: 152 })).toEqual({ x: 22 + 155.04 - 18, y: 48 + 76 - 18 });
  });
});

describe('a record leaving the cover', () => {
  const start = { x: 200, y: 100 };
  const end = { x: 300, y: 260 };

  const places = (frames: Keyframe[]) =>
    frames.map((frame) => {
      const [, x, y] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(String(frame.transform)) ?? [];
      return { x: Number(x), y: Number(y) };
    });
  // With room for rounding: a row level with the cover is a hair off 100 at each step.
  const oneWay = (values: number[]) =>
    values.every((value, i) => i === 0 || value >= (values[i - 1] as number) - 1e-6) ||
    values.every((value, i) => i === 0 || value <= (values[i - 1] as number) + 1e-6);

  it('ends exactly on its row, at the size it is drawn there', () => {
    const last = flightFrames(start, end).at(-1);
    expect(last?.transform).toBe('translate(300px, 260px) scale(1)');
    expect(last?.opacity).toBe(0);
  });

  it('starts inside the cover, unseen', () => {
    const first = flightFrames(start, end)[0];
    expect(places([first as Keyframe])[0]).toEqual({ x: 170, y: 100 });
    expect(first?.opacity).toBe(0);
  });

  it.each([
    ['below', { x: 300, y: 260 }],
    ['above', { x: 300, y: 40 }],
    ['level', { x: 300, y: 100 }],
  ])('goes to a row %s it without ever turning back', (_where, row) => {
    const route = places(flightFrames(start, row));
    expect(oneWay(route.map((place) => place.x))).toBe(true);
    expect(oneWay(route.map((place) => place.y))).toBe(true);
  });

  it('is a little further on at every step, but less so each time', () => {
    const route = places(flightFrames(start, { x: 300, y: 100 })).map((place) => place.x);
    const steps = route.slice(1).map((x, i) => x - (route[i] as number));
    expect(steps[0]).toBeGreaterThan(steps.at(-1) as number);
  });

  it('runs the same way home', () => {
    const out = flightFrames(start, end);
    const home = backwards(out);
    expect(home[0]?.transform).toBe(out.at(-1)?.transform);
    expect(home.at(-1)?.transform).toBe(out[0]?.transform);
    expect(home.map((frame) => frame.offset)).toEqual([...home.map((frame) => frame.offset)].sort());
    expect(home[0]?.offset).toBe(0);
    expect(home.at(-1)?.offset).toBe(1);
  });
});

describe('how long a playlist is', () => {
  const song = (minutes: number) => ({ duration: minutes * 60_000 }) as TrackMetadata;

  it('adds its songs up, to the nearest minute', () => {
    expect(minutesOf([song(3.5), song(4.2)])).toBe(8);
    expect(minutesOf([])).toBe(0);
  });

  it('is told in hours once there are some', () => {
    expect(hoursAndMinutes(44)).toEqual({ hours: 0, minutes: 44 });
    expect(hoursAndMinutes(135)).toEqual({ hours: 2, minutes: 15 });
  });
});
