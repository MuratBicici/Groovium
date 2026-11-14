import { describe, expect, it } from 'vitest';
import { DIVE_S, LAYER_LAG_S, diveTotal, easeInOut, layerRise, mix, parseColour, surfaceAt, surfaceTotal } from './water';

describe('the water rising and falling', () => {
  it('starts below and ends over the top', () => {
    expect(layerRise(0, 0, 'down')).toBe(0);
    for (let layer = 0; layer < 3; layer += 1) expect(layerRise(layer, diveTotal(), 'down')).toBe(1);
    for (let layer = 0; layer < 3; layer += 1) expect(layerRise(layer, surfaceTotal(), 'up')).toBe(0);
  });

  it('brings the back layer up first, and takes the front one down first', () => {
    const mid = DIVE_S / 2;
    expect(layerRise(0, mid, 'down')).toBeGreaterThan(layerRise(2, mid, 'down'));
    expect(layerRise(2, 0.5, 'up')).toBeLessThan(layerRise(0, 0.5, 'up'));
  });

  it('has nothing of a layer on the window before it starts', () => {
    const height = 400;
    expect(surfaceAt(100, 0, 2, layerRise(2, LAYER_LAG_S, 'down'), height, 14)).toBeGreaterThan(height);
  });

  it('covers the window once it is over', () => {
    for (let x = 0; x < 1000; x += 50) expect(surfaceAt(x, 3.3, 2, 1, 400, 14)).toBeLessThan(0);
  });

  it('eases in and out', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(0.5)).toBe(0.5);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.1)).toBeLessThan(0.1);
  });
});

describe('colours read from the theme', () => {
  it('reads hex and rgb', () => {
    expect(parseColour('#16110d', [0, 0, 0])).toEqual([22, 17, 13]);
    expect(parseColour('#fff', [0, 0, 0])).toEqual([255, 255, 255]);
    expect(parseColour(' rgb(1, 2, 3)', [0, 0, 0])).toEqual([1, 2, 3]);
    expect(parseColour('nonsense', [9, 9, 9])).toEqual([9, 9, 9]);
  });

  it('mixes', () => {
    expect(mix([0, 0, 0], [100, 200, 50], 0.5)).toEqual([50, 100, 25]);
  });
});
