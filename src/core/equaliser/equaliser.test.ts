import { describe, expect, it } from 'vitest';
import {
  cleanName,
  EQ_BANDS,
  EQ_MOST,
  EQ_NAME_MOST,
  EQ_PRESETS,
  EQ_SAVED_MOST,
  heldBands,
  heldDb,
  heldSaved,
  isTaken,
  presetOf,
  sameBands,
  withSaved,
  withoutSaved,
} from './index';

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

describe('settings somebody kept', () => {
  const low = heldBands([5]);
  const high = heldBands([0, 0, 0, 0, 0, 0, 0, 0, 0, 5]);

  it('keeps a setting under its name, at the end', () => {
    const one = withSaved([], ' Gece ', low);
    expect(one).toEqual([{ name: 'Gece', bands: low }]);
    expect(withSaved(one, 'Sabah', high).map((own) => own.name)).toEqual(['Gece', 'Sabah']);
  });

  it('keeps no more than three', () => {
    let saved = withSaved(withSaved(withSaved([], 'a', low), 'b', low), 'c', low);
    expect(saved).toHaveLength(EQ_SAVED_MOST);
    saved = withSaved(saved, 'd', high);
    expect(saved.map((own) => own.name)).toEqual(['a', 'b', 'c']);
  });

  it('writes over a name in use, whatever its case, and even with no room left', () => {
    const saved = withSaved(withSaved(withSaved([], 'Gece', low), 'b', low), 'c', low);
    const again = withSaved(saved, 'GECE', high);
    expect(again).toHaveLength(EQ_SAVED_MOST);
    expect(again[0]).toEqual({ name: 'Gece', bands: high });
  });

  it('keeps nothing without a name', () => {
    expect(withSaved([], '   ', low)).toEqual([]);
  });

  it('holds a name to what fits on its button', () => {
    expect(cleanName('x'.repeat(40))).toHaveLength(EQ_NAME_MOST);
  });

  it('forgets one by name', () => {
    const saved = withSaved(withSaved([], 'Gece', low), 'Sabah', high);
    expect(withoutSaved(saved, 'gece').map((own) => own.name)).toEqual(['Sabah']);
    expect(isTaken(saved, 'SABAH')).toBe(true);
  });

  it('reads whatever was stored as the right shape', () => {
    expect(heldSaved(null)).toEqual([]);
    expect(heldSaved('nope')).toEqual([]);
    expect(heldSaved([{ name: '', bands: [] }, { bands: [1] }, 3])).toEqual([]);
    expect(heldSaved([{ name: 'a', bands: [99] }])[0]?.bands[0]).toBe(EQ_MOST);
    const many = ['a', 'b', 'c', 'd', 'A'].map((name) => ({ name, bands: [] }));
    expect(heldSaved(many).map((own) => own.name)).toEqual(['a', 'b', 'c']);
  });

  it('carries the one unnamed setting of the earlier build across', () => {
    const [only, ...rest] = heldSaved([1, 2, 3]);
    expect(only?.name).toBeTruthy();
    expect(only?.bands.slice(0, 3)).toEqual([1, 2, 3]);
    expect(rest).toEqual([]);
  });
});
