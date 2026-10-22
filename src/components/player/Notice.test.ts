import { describe, expect, it } from 'vitest';
import { noticeMs } from './Notice';

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
