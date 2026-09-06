import { describe, expect, it } from 'vitest';
import { levelFrom, settleLevel } from './index';

describe('how loud it is', () => {
  it('is nothing when there is nothing', () => {
    expect(levelFrom([])).toBe(0);
    expect(levelFrom(Array(24).fill(0))).toBe(0);
  });

  it('is everything when everything is full', () => {
    expect(levelFrom(Array(24).fill(1))).toBe(1);
  });

  it('rises with the music rather than sitting at the top', () => {
    // A peak would: anything with a drum in it fills one band completely, and
    // a meter pinned at the top says nothing about loudness.
    const oneLoudBand = [1, ...Array(23).fill(0)];
    expect(levelFrom(oneLoudBand)).toBeLessThan(0.3);
  });

  it('separates a verse from a chorus', () => {
    const verse = levelFrom(Array(24).fill(0.2));
    const chorus = levelFrom(Array(24).fill(0.6));
    expect(chorus).toBeGreaterThan(verse + 0.25);
  });

  it('answers to the bass more than to the top end', () => {
    // What should move an ornament on the window's edge is the part of the
    // music you feel. A hi-hat is a band at full height every half second and
    // would have the edge flickering through a quiet passage; a kick is what
    // should push it.
    const low = Array(24).fill(0);
    const high = Array(24).fill(0);
    for (let band = 0; band < 6; band++) low[band] = 0.9;
    for (let band = 18; band < 24; band++) high[band] = 0.9;
    expect(levelFrom(low)).toBeGreaterThan(levelFrom(high) * 1.8);
  });

  it('still lights for a track with no bass in it', () => {
    // Leaning on the low end is not ignoring everything else.
    const high = Array(24).fill(0);
    for (let band = 16; band < 24; band++) high[band] = 1;
    expect(levelFrom(high)).toBeGreaterThan(0.15);
  });

  it('does not let quiet read as loud', () => {
    // The curve lifts the middle of the range. It must not lift the bottom of
    // it — a room tone should leave the light off.
    expect(levelFrom(Array(24).fill(0.02))).toBeLessThan(0.12);
  });
});

describe('the level being shown', () => {
  it('arrives the instant the sound does', () => {
    expect(settleLevel(0, 0.8)).toBe(0.8);
  });

  it('falls rather than dropping', () => {
    const fallen = settleLevel(0.8, 0);
    expect(fallen).toBeGreaterThan(0);
    expect(fallen).toBeLessThan(0.8);
  });

  it('reaches nothing rather than approaching it forever', () => {
    let showing = 1;
    for (let frame = 0; frame < 200; frame++) showing = settleLevel(showing, 0);
    expect(showing).toBe(0);
  });

  it('holds a level that is being renewed', () => {
    let showing = 0.5;
    for (let frame = 0; frame < 20; frame++) showing = settleLevel(showing, 0.5);
    expect(showing).toBe(0.5);
  });
});
