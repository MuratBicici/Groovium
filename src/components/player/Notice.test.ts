import { describe, expect, it } from 'vitest';
import { noticeMs, openingFrames, pillRadius } from './Notice';

describe('how long a notice stays', () => {
  it('is six seconds for a sentence', () => {
    expect(noticeMs('x'.repeat(40))).toBe(6_000);
  });

  it('is longer for more to read, but never past twelve seconds', () => {
    expect(noticeMs('x'.repeat(110))).toBeGreaterThan(noticeMs('x'.repeat(40)));
    expect(noticeMs('x'.repeat(1_000))).toBe(12_000);
  });

  it('is long enough to see even with almost nothing in it', () => {
    expect(noticeMs('')).toBe(4_000);
  });
});

describe('how a notice opens', () => {
  it('starts as its mark alone, small and below where it ends up', () => {
    const [first] = openingFrames(240, 28);
    expect(first).toMatchObject({ width: '28px', height: '28px', borderRadius: '14px' });
    expect(first?.transform).toContain('translateY(26px)');
  });

  it('holds the mark for a moment before opening', () => {
    const frames = openingFrames(240, 28);
    expect(frames[1]?.width).toBe(frames[2]?.width);
    expect(frames[1]?.offset).toBeLessThan(frames[2]?.offset as number);
  });

  it('ends at exactly the size of what it says', () => {
    const last = openingFrames(240, 46).at(-1);
    expect(last).toMatchObject({ width: '240px', height: '46px', borderRadius: '15px' });
  });

  it('never makes the mark bigger than a short pill', () => {
    expect(openingFrames(100, 22)[0]?.width).toBe('26px');
    expect(openingFrames(100, 80)[0]?.width).toBe('28px');
  });

  it('is round at the ends of one line, and only so round on more', () => {
    expect(pillRadius(26)).toBe(13);
    expect(pillRadius(70)).toBe(15);
  });
});
