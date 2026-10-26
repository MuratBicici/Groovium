import { describe, expect, it } from 'vitest';
import { plugged, saving } from './power';

/** Battery saver: when it is on, and when the notice saying so goes up. */

const MAINS = { onBattery: false, declined: false, told: false };

describe('battery saver', () => {
  it('is on by hand whatever the power', () => {
    expect(saving(true, false, { onBattery: false, declined: false })).toBe(true);
  });

  it('comes on by itself on battery, unless turned off from the notice', () => {
    expect(saving(false, true, { onBattery: true, declined: false })).toBe(true);
    expect(saving(false, true, { onBattery: true, declined: true })).toBe(false);
    expect(saving(false, true, { onBattery: false, declined: false })).toBe(false);
    expect(saving(false, false, { onBattery: true, declined: false })).toBe(false);
  });

  it('says so when the plug comes out and it is about to come on by itself', () => {
    expect(plugged(MAINS, true, false, true)).toEqual({ onBattery: true, declined: false, told: true });
    // Already on by hand, or not allowed to come on: nothing to say.
    expect(plugged(MAINS, true, true, true).told).toBe(false);
    expect(plugged(MAINS, true, false, false).told).toBe(false);
  });

  it('forgets being turned off once the plug is back, so next time asks again', () => {
    const declined = { onBattery: true, declined: true, told: false };
    const back = plugged(declined, false, false, true);
    expect(back).toEqual(MAINS);
    expect(plugged(back, true, false, true).told).toBe(true);
  });

  it('changes nothing when nothing changed', () => {
    const state = { onBattery: true, declined: true, told: false };
    expect(plugged(state, true, false, true)).toBe(state);
  });
});
