import { describe, expect, it } from 'vitest';
import { REACH, STEP_DEG, lineAngle, lineLook, turnsTo, visibleRange, wheelAngle } from './arc';

describe('which lines are drawn', () => {
  it('draws the one being sung and REACH either side', () => {
    expect(visibleRange(20, 100)).toEqual([20 - REACH, 20 + REACH]);
  });

  it('stops at the first and last lines', () => {
    expect(visibleRange(1, 100)).toEqual([0, 1 + REACH]);
    expect(visibleRange(98, 100)).toEqual([98 - REACH, 99]);
  });

  it('shows the first lines waiting before the song has begun', () => {
    expect(visibleRange(-1, 100)).toEqual([0, REACH - 1]);
  });

  it('draws nothing for a song with no lines', () => {
    expect(visibleRange(0, 0)).toBeNull();
  });
});

describe('the wheel', () => {
  it('brings the line being sung to the level', () => {
    for (const side of ['left', 'right'] as const) {
      expect(lineAngle(7, side) + wheelAngle(7, side)).toBe(0);
    }
  });

  it('puts lines to come below the level and past lines above, on either side', () => {
    // Below the level is clockwise on the left, where the spokes point right,
    // and anticlockwise on the right, where they point left.
    const after = (side: 'left' | 'right') => lineAngle(8, side) + wheelAngle(7, side);
    expect(after('left')).toBe(STEP_DEG);
    expect(after('right')).toBe(-STEP_DEG);
  });

  it('is the mirror image on the right', () => {
    expect(lineAngle(5, 'right')).toBe(-lineAngle(5, 'left'));
    expect(wheelAngle(5, 'right')).toBe(-wheelAngle(5, 'left'));
  });

  it('turns for a line or two, and cuts for anything further', () => {
    expect(turnsTo(4, 5)).toBe(true);
    expect(turnsTo(5, 3)).toBe(true);
    expect(turnsTo(5, 8)).toBe(false);
    expect(turnsTo(40, 2)).toBe(false);
  });
});

describe('how a line looks', () => {
  it('is whole at the level', () => {
    expect(lineLook(0)).toEqual({ opacity: 1, scale: 1 });
  });

  it('fades and shrinks the further it is, never to nothing', () => {
    for (const dir of [1, -1]) {
      let last = lineLook(0);
      for (let away = 1; away <= REACH + 2; away++) {
        const look = lineLook(dir * away);
        expect(look.opacity).toBeLessThanOrEqual(last.opacity);
        expect(look.scale).toBeLessThanOrEqual(last.scale);
        expect(look.opacity).toBeGreaterThan(0);
        last = look;
      }
    }
  });

  it('keeps the lines to come a little brighter than the lines gone', () => {
    for (let away = 1; away <= REACH; away++) {
      expect(lineLook(away).opacity).toBeGreaterThan(lineLook(-away).opacity);
    }
  });
});
