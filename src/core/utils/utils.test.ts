import { describe, expect, it } from 'vitest';
import { clamp, formatDuration } from './time';
import { volumeToAmplitude } from './volume';
import { joinPath } from './paths';
import { arcKeyframes, easeInOutCubic } from './motion';

describe('formatDuration', () => {
  it('formats what a player actually shows', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(59_999)).toBe('0:59');
    expect(formatDuration(60_000)).toBe('1:00');
    expect(formatDuration(3_599_000)).toBe('59:59');
  });

  it('survives what an audio element hands it before metadata loads', () => {
    // `HTMLMediaElement.duration` is NaN until then, and Infinity for streams.
    expect(formatDuration(NaN)).toBe('0:00');
    expect(formatDuration(Infinity)).toBe('0:00');
    expect(formatDuration(-1)).toBe('0:00');
  });
});

describe('clamp', () => {
  it('holds a value inside its bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('volumeToAmplitude', () => {
  it('applies the perceptual curve the doc comment promises', () => {
    // `HTMLMediaElement.volume` is linear amplitude, which does not sound
    // linear. A wrong exponent here is audible on every track.
    expect(volumeToAmplitude(0)).toBe(0);
    expect(volumeToAmplitude(1)).toBe(1);
    expect(volumeToAmplitude(0.5)).toBeCloseTo(0.25, 5);
    expect(volumeToAmplitude(0.25)).toBeCloseTo(0.0625, 5);
  });
});

describe('joinPath', () => {
  // Written with String.raw so the Windows separators read as themselves.
  const win = String.raw`C:\Music`;
  const winJoined = String.raw`C:\Music\a.mp3`;

  it('follows the separator the directory already uses', () => {
    // Every cover-art URL is built through this. Wrong, and no artwork renders.
    expect(joinPath(win, 'a.mp3')).toBe(winJoined);
    expect(joinPath('/home/me', 'a.mp3')).toBe('/home/me/a.mp3');
  });

  it('does not double a separator the directory already ends with', () => {
    expect(joinPath(win + '\\', 'a.mp3')).toBe(winJoined);
    expect(joinPath('/home/me/', 'a.mp3')).toBe('/home/me/a.mp3');
  });
});

describe('easeInOutCubic', () => {
  it('runs from 0 to 1 through the midpoint', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 5);
  });
});

describe('arcKeyframes', () => {
  const from = { x: -100, y: 80, scale: 0.16 };
  const to = { x: 0, y: 0, scale: 1 };

  it('starts and ends exactly where it was told to', () => {
    const frames = arcKeyframes(from, to, 40);
    expect(frames[0]?.offset).toBe(0);
    expect(frames[frames.length - 1]?.offset).toBe(1);
    expect(frames[0]?.transform).toContain('translate(-100px, 80px)');
    expect(frames[frames.length - 1]?.transform).toContain('translate(0px, 0px) scale(1)');
  });

  it('lifts above the straight line in between', () => {
    // Without the lift this is a slide, not a throw.
    const straight = arcKeyframes(from, to, 0);
    const arced = arcKeyframes(from, to, 40);
    const yOf = (t: string) => Number(t.match(/translate\([^,]+,\s*(-?[\d.]+)px\)/)?.[1]);

    const mid = Math.floor(arced.length / 2);
    expect(yOf(arced[mid]?.transform as string)).toBeLessThan(
      yOf(straight[mid]?.transform as string),
    );
  });

  it('does not divide by zero when asked for a single sample', () => {
    // `i / (samples - 1)` is NaN at one sample, which silently produces a
    // keyframe list the browser rejects.
    const frames = arcKeyframes(from, to, 40, 1);
    for (const frame of frames) {
      expect(String(frame.transform)).not.toContain('NaN');
      expect(Number.isFinite(frame.offset as number)).toBe(true);
    }
  });
});
