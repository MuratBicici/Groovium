import { describe, expect, it } from 'vitest';
import {
  CALM_WEATHER,
  downpourAt,
  heldWeather,
  intensity,
  maybeDownpour,
  nextThunderIn,
  rainSound,
  thunderSound,
  wander,
} from './weather';

const always = (n: number) => () => n;

describe('the rain', () => {
  it('is louder and brighter the harder it rains', () => {
    const light = rainSound(0.1);
    const heavy = rainSound(0.9);
    expect(heavy.gainDb).toBeGreaterThan(light.gainDb);
    expect(heavy.brightHz).toBeGreaterThan(light.brightHz);
    expect(rainSound(0.4).heavyShare).toBe(0);
    expect(rainSound(1).heavyShare).toBe(1);
  });

  it('never goes past what the recordings can take', () => {
    expect(rainSound(5).gainDb).toBeLessThanOrEqual(3);
    expect(intensity({ ...CALM_WEATHER, rain: 1 }, 0.3, 0.5)).toBe(1);
    expect(intensity({ ...CALM_WEATHER, rain: 0 }, -0.3, 0)).toBe(0);
  });

  it('does not wander or pour when it is not to change', () => {
    const still = { ...CALM_WEATHER, change: 0 };
    expect(wander(still, Math.random).by).toBe(0);
    expect(maybeDownpour(still, 0, 1, always(0))).toBeNull();
  });

  it('pours sometimes when it is to change', () => {
    const spell = maybeDownpour({ ...CALM_WEATHER, change: 1 }, 100, 1, always(0));
    expect(spell).not.toBeNull();
    if (!spell) return;
    expect(downpourAt(spell, 100)).toBe(0);
    expect(downpourAt(spell, spell.peakAt)).toBeCloseTo(spell.height);
    expect(downpourAt(spell, spell.until)).toBe(0);
  });
});

describe('the thunder', () => {
  it('does not come when there is to be none', () => {
    expect(nextThunderIn({ ...CALM_WEATHER, thunder: 0 }, false, Math.random)).toBeNull();
  });

  it('comes sooner when set to come often, and sooner while it pours', () => {
    const half = always(0.5);
    const rare = nextThunderIn({ ...CALM_WEATHER, thunder: 0.2 }, false, half) ?? 0;
    const often = nextThunderIn({ ...CALM_WEATHER, thunder: 1 }, false, half) ?? 0;
    const pouring = nextThunderIn({ ...CALM_WEATHER, thunder: 1 }, true, half) ?? 0;
    expect(often).toBeLessThan(rare);
    expect(pouring).toBeLessThanOrEqual(often);
    expect(nextThunderIn({ ...CALM_WEATHER, thunder: 1 }, true, always(0))).toBe(10);
  });

  it('is nearer, louder and brighter when set close', () => {
    const far = thunderSound({ ...CALM_WEATHER, power: 0 }, false, always(0.5));
    const close = thunderSound({ ...CALM_WEATHER, power: 1 }, false, always(0.5));
    expect(close.gainDb).toBeGreaterThan(far.gainDb);
    expect(close.brightHz).toBeGreaterThan(far.brightHz);
    expect(close.arriveS).toBeLessThan(far.arriveS);
    expect(close.gainDb).toBeLessThanOrEqual(4);
    expect(close.brightHz).toBeLessThanOrEqual(800);
  });
});

describe('weather read back from settings', () => {
  it('is held to its range', () => {
    expect(heldWeather({ rain: 3, change: -1 })).toEqual({ rain: 1, change: 0, thunder: 0.5, power: 0.5 });
    expect(heldWeather(undefined)).toEqual(CALM_WEATHER);
  });
});
