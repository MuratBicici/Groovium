import { describe, expect, it } from 'vitest';
import type { TrackMetadata } from '@/core/types';
import { PAGE_RADIUS_PX, backwards, bubbleFrames, flightFrames, hoursAndMinutes, minutesOf } from './crateMotion';

const from = { left: 100, top: 40, width: 92, height: 92 };
const to = { left: 8, top: 8, width: 664, height: 454 };

describe('the page swelling out of its crate', () => {
  it('starts exactly on the crate and unseen', () => {
    const [first] = bubbleFrames(from, to);
    expect(first).toMatchObject({ left: '100px', top: '40px', width: '92px', height: '92px', opacity: 0 });
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

describe('a record leaving the cover', () => {
  const start = { x: 200, y: 100 };
  const end = { x: 300, y: 260 };

  it('ends exactly on its row, at the size it is drawn there', () => {
    const frames = flightFrames(start, end);
    expect(frames.at(-2)?.transform).toBe('translate(300px, 260px) scale(1)');
    expect(frames.at(-1)?.opacity).toBe(0);
  });

  it('goes up over what is between before coming down', () => {
    const y = (frame: Keyframe | undefined) => Number(/, (-?[\d.]+)px\)/.exec(String(frame?.transform))?.[1]);
    const frames = flightFrames(start, end);
    expect(y(frames[2])).toBeLessThan(Math.min(start.y, end.y));
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
