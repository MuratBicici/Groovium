import { describe, expect, it } from 'vitest';
import { inReach, paletteAngle, restingSlot, slotAngle, slotAt, slotLook, STEP_DEG } from './palette';

describe("the queue's palette", () => {
  it('goes round the other way on the left, so what comes next is still below', () => {
    expect(slotAngle(2, 'right')).toBe(-2 * STEP_DEG);
    expect(slotAngle(2, 'left')).toBe(2 * STEP_DEG);
    expect(paletteAngle(1, 'right')).toBe(STEP_DEG);
  });

  it('rests on the next song, or on the one playing when nothing follows', () => {
    expect(restingSlot(3)).toBe(1);
    expect(restingSlot(0)).toBe(0);
  });

  it('draws only what is near the level', () => {
    expect(inReach(4, 1)).toBe(true);
    expect(inReach(5, 1)).toBe(false);
  });

  it('is whole on the level and dimmer away from it', () => {
    expect(slotLook(0)).toEqual({ opacity: 1, scale: 1 });
    expect(slotLook(1).opacity).toBeGreaterThan(slotLook(3).opacity);
  });

  it('finds the slot under a point by its angle', () => {
    expect(slotAt(200, 0, 1)).toBe(1);
    const down = Math.tan((STEP_DEG * Math.PI) / 180) * 200;
    expect(slotAt(200, down, 1)).toBe(2);
    expect(slotAt(-200, -down, 1)).toBe(0);
  });
});
