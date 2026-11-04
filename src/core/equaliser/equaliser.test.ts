import { describe, expect, it } from 'vitest';
import { EQ_BANDS, EQ_MOST, EQ_PRESETS, heldBands, heldDb, presetOf, sameBands } from './index';

describe('the equaliser’s settings', () => {
  it('holds a value to whole decibels within reach', () => {
    expect(heldDb(3.4)).toBe(3);
    expect(heldDb(99)).toBe(EQ_MOST);
    expect(heldDb(-99)).toBe(-EQ_MOST);
  });

  it('reads nonsense as nought', () => {
    expect(heldDb('loud')).toBe(0);
    expect(heldDb(Number.NaN)).toBe(0);
    expect(heldDb(undefined)).toBe(0);
    expect(Object.is(heldDb(-0.2), 0)).toBe(true);
  });

  it('has one value for each band, whatever was stored', () => {
    expect(heldBands(undefined)).toHaveLength(EQ_BANDS.length);
    expect(heldBands('nope').every((db) => db === 0)).toBe(true);
    const short = heldBands([5]);
    expect(short[0]).toBe(5);
    expect(short).toHaveLength(EQ_BANDS.length);
    expect(heldBands(new Array(30).fill(1))).toHaveLength(EQ_BANDS.length);
  });

  it('knows the settings that come with the app when it sees them', () => {
    for (const preset of EQ_PRESETS) {
      expect(presetOf(preset.bands)).toBe(preset.id);
      expect(preset.bands).toHaveLength(EQ_BANDS.length);
      expect(sameBands(heldBands(preset.bands), preset.bands)).toBe(true);
    }
    expect(presetOf(heldBands([1, 2, 3]))).toBeNull();
  });
});
