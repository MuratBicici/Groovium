import { describe, expect, it } from 'vitest';
import { hexToHsv, hsvToHex, hsvToRgb, luminance, parseHex, rgbToHsv, toHex } from './colour';

/**
 * The picker drags in HSV and stores hex, so every move crosses this boundary.
 * What matters is not that any one conversion is textbook-correct but that
 * going round the loop does not move the colour — a drift of one unit per
 * frame is a slider that walks away from where it was put.
 */

describe('reading a hex colour', () => {
  it('takes the shapes people actually type', () => {
    const espresso = { r: 0x2e, g: 0x23, b: 0x1b };
    expect(parseHex('#2e231b')).toEqual(espresso);
    expect(parseHex('2e231b')).toEqual(espresso);
    expect(parseHex('  #2E231B  ')).toEqual(espresso);
  });

  it('expands the three-digit form the way CSS does', () => {
    expect(parseHex('#f0c')).toEqual({ r: 0xff, g: 0x00, b: 0xcc });
  });

  it('refuses anything else rather than guessing', () => {
    // A half-typed field is not a request to change the colour, and guessing
    // at one would repaint the window on every keystroke.
    for (const bad of ['', '#', '#12', '#12345', '#1234567', '#gggggg', 'rebeccapurple']) {
      expect(parseHex(bad), bad).toBeNull();
    }
  });

  it('writes back lowercase, six digits, with the hash', () => {
    expect(toHex({ r: 255, g: 0, b: 204 })).toBe('#ff00cc');
    expect(toHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
  });

  it('keeps a channel inside the byte it has to fit in', () => {
    expect(toHex({ r: 300, g: -20, b: 128.6 })).toBe('#ff0081');
  });
});

describe('the conversions themselves', () => {
  it('agrees with the textbook on the corners', () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, v: 100 });
    expect(rgbToHsv({ r: 0, g: 255, b: 0 })).toEqual({ h: 120, s: 100, v: 100 });
    expect(rgbToHsv({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 100, v: 100 });
    expect(rgbToHsv({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, v: 100 });
    expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, v: 0 });
  });

  it('comes back out again', () => {
    expect(hsvToRgb({ h: 0, s: 100, v: 100 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsvToRgb({ h: 180, s: 100, v: 100 })).toEqual({ r: 0, g: 255, b: 255 });
    expect(hsvToRgb({ h: 300, s: 100, v: 100 })).toEqual({ r: 255, g: 0, b: 255 });
  });

  it('wraps the hue rather than falling off the end of it', () => {
    // The hue bar is a circle drawn straight, so its ends meet. 360 and 0 are
    // the same red, and dragging past either must not produce black.
    expect(hsvToRgb({ h: 360, s: 100, v: 100 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsvToRgb({ h: 720, s: 100, v: 100 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsvToRgb({ h: -60, s: 100, v: 100 })).toEqual({ r: 255, g: 0, b: 255 });
  });

  it('holds still over a round trip', () => {
    // The property the picker actually depends on. Every drag goes
    // hex → hsv → hex, and a colour that shifted by a unit each time would
    // walk away from wherever it was put.
    for (const hex of [
      '#2e231b', '#c8945a', '#1b2740', '#e29ab1', '#9fbfa8',
      '#000000', '#ffffff', '#7f7f7f', '#010203', '#fe0102',
    ]) {
      const hsv = hexToHsv(hex);
      expect(hsv, hex).not.toBeNull();
      expect(hsvToHex(hsv!), hex).toBe(hex);
      // And again, in case the first pass was the one that settled it.
      expect(hsvToHex(hexToHsv(hsvToHex(hsv!))!), hex).toBe(hex);
    }
  });

  it('survives every hue at full strength', () => {
    for (let h = 0; h < 360; h += 1) {
      const hex = hsvToHex({ h, s: 100, v: 100 });
      const back = hexToHsv(hex);
      expect(back, String(h)).not.toBeNull();
      expect(hsvToHex(back!), String(h)).toBe(hex);
    }
  });

  it('reports no hue for grey, and does not invent one', () => {
    expect(rgbToHsv({ r: 128, g: 128, b: 128 })).toEqual({ h: 0, s: 0, v: expect.closeTo(50.2, 1) });
  });
});

describe('luminance', () => {
  it('runs from black to white', () => {
    expect(luminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 6);
    expect(luminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 6);
  });

  it('weights green the most, which is what makes it useful here', () => {
    // The picker's marker flips between light and dark against the colour
    // under it, and pure green is bright enough to need a dark one.
    const green = luminance({ r: 0, g: 255, b: 0 });
    expect(green).toBeGreaterThan(luminance({ r: 255, g: 0, b: 0 }));
    expect(green).toBeGreaterThan(luminance({ r: 0, g: 0, b: 255 }));
    expect(green).toBeGreaterThan(0.5);
  });
});
