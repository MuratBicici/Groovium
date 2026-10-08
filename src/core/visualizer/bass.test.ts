import { describe, expect, it } from 'vitest';
import { NO_BASS, bassBands, bassPeak, meterBass, type BassMeter } from './bass';

const FRAME = 1 / 60;
const BANDS = 24;

/** A frame with the bass at `low` and everything above it at `rest`. */
const frame = (low: number, rest = 0.5) =>
  Array.from({ length: BANDS }, (_, band) => (band < bassBands(BANDS) ? low : rest));

/** Run peaks through the meter, returning the level after each. */
function meter(peaks: number[], seconds = FRAME): number[] {
  let state: BassMeter = NO_BASS;
  return peaks.map((peak) => {
    const next = meterBass(state, peak, seconds);
    state = next.meter;
    return next.level;
  });
}

/** A kick every half second over a bass that sits at `under`, for `frames`. */
const kicks = (frames: number, kick: number, under: number) =>
  Array.from({ length: frames }, (_, at) => (at % 30 < 3 ? kick : under));

describe('where the bass is', () => {
  it('is the bottom third of the bands: eight of twenty-four, about 45–300Hz', () => {
    expect(bassBands(24)).toBe(8);
    expect(bassBands(72)).toBe(24);
    // Never none, however few bands arrive.
    expect(bassBands(2)).toBe(1);
  });

  it('is read from those bands alone, at their loudest', () => {
    const bars = frame(0.3, 0.9);
    bars[2] = 0.7;
    expect(bassPeak(bars)).toBeCloseTo(0.7, 6);
    // The top of the bass is in it — where a fifth used to stop short.
    const body = frame(0.3, 0.3);
    body[7] = 0.9;
    expect(bassPeak(body)).toBeCloseTo(0.9, 6);
    // A loud snare above the bass is not the bass.
    const snare = frame(0.2, 0.2);
    snare[10] = 1;
    expect(bassPeak(snare)).toBeCloseTo(0.2, 6);
  });

  it('is nothing in a frame of nothing', () => {
    expect(bassPeak([])).toBe(0);
  });
});

describe('how much of a moment the bass is', () => {
  it('rises on each kick and falls back between them', () => {
    const levels = meter(kicks(240, 0.9, 0.55));
    // Past the first second, once the meter knows the song's range.
    const settled = levels.slice(60);
    const onKicks = settled.filter((_, at) => (at + 60) % 30 === 0);
    const between = settled.filter((_, at) => (at + 60) % 30 === 15);
    for (const level of onKicks) expect(level).toBeGreaterThan(0.9);
    for (const level of between) expect(level).toBeLessThan(0.1);
  });

  it('stays low under a bass held steady, however loud', () => {
    // Mastered loud, the low end sits near the top all song. That is not a
    // moment, and it must not keep the edge at full.
    const wobble = Array.from({ length: 300 }, (_, at) => 0.92 + (at % 2) * 0.005);
    const levels = meter(wobble).slice(120);
    expect(Math.max(...levels)).toBeLessThan(0.3);
  });

  it('is nothing in silence', () => {
    expect(meter(Array.from({ length: 120 }, () => 0)).every((level) => level === 0)).toBe(true);
    // Nor in a room's hum.
    expect(meter(Array.from({ length: 120 }, (_, at) => (at % 2) * 0.05)).at(-1)).toBe(0);
  });

  it('keeps time the same at thirty frames a second as at sixty', () => {
    const at60 = meter(kicks(240, 0.9, 0.55), 1 / 60);
    const at30 = meter(
      kicks(240, 0.9, 0.55).filter((_, at) => at % 2 === 0),
      1 / 30,
    );
    expect(at30[120 / 2]).toBeCloseTo(at60[120] ?? 0, 1);
  });

  it('starts over from the first frame it is given', () => {
    expect(meterBass(NO_BASS, 0.8, FRAME)).toEqual({ meter: { low: 0.8, high: 0.8 }, level: 0 });
  });
});
