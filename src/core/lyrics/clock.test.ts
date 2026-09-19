import { describe, expect, it } from 'vitest';
import { LyricsClock, SEEK_GAP_MS } from './clock';

describe('the lyrics clock', () => {
  it('runs on between reports while playing', () => {
    const clock = new LyricsClock();
    clock.anchor(10_000, true, 100);
    expect(clock.at(350)).toBe(10_250);
  });

  it('stands still while paused', () => {
    const clock = new LyricsClock();
    clock.anchor(10_000, false, 100);
    expect(clock.at(5_000)).toBe(10_000);
  });

  it('ignores a report that is only jitter', () => {
    const clock = new LyricsClock();
    clock.anchor(10_000, true, 0);
    clock.observe(10_000 + 250 - SEEK_GAP_MS, true, 250);
    expect(clock.at(250)).toBe(10_250);
  });

  it('jumps to a report far enough off to be a seek', () => {
    const clock = new LyricsClock();
    clock.anchor(10_000, true, 0);
    clock.observe(10_250 + SEEK_GAP_MS + 1, true, 250);
    expect(clock.at(250)).toBe(10_250 + SEEK_GAP_MS + 1);
  });

  it('re-anchors when playback stops or starts', () => {
    const clock = new LyricsClock();
    clock.anchor(10_000, true, 0);
    clock.observe(10_200, false, 250);
    expect(clock.at(9_000)).toBe(10_200);
    clock.observe(10_200, true, 9_000);
    expect(clock.at(9_100)).toBe(10_300);
  });

  it('jumps to a chosen line at once', () => {
    const clock = new LyricsClock();
    clock.anchor(10_000, true, 0);
    clock.seekTo(60_000, 100);
    expect(clock.at(200)).toBe(60_100);
  });
});
