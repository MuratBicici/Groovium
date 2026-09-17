import { describe, expect, it } from 'vitest';
import { gridGeometry, previewOrder, recordKeys, slotAt } from './reorder';

/**
 * Dragging a record to a new place in an open crate.
 *
 * The drawer's crate is a wrapping grid of equal cards, 132px wide with a 12px
 * gap, in however many columns the drawer's width allows.
 */

const card = { width: 132, height: 176 };

describe('the shape of the grid', () => {
  it('fits as many columns as the width allows, counting no gap after the last', () => {
    // 4 cards need 4 * 132 + 3 * 12 = 564px.
    expect(gridGeometry(card, 564, 12).columns).toBe(4);
    expect(gridGeometry(card, 563, 12).columns).toBe(3);
  });

  it('has at least one column however narrow it is', () => {
    expect(gridGeometry(card, 40, 12).columns).toBe(1);
  });
});

describe('the slot under the pointer', () => {
  const geometry = gridGeometry(card, 564, 12);

  it('reads row by row', () => {
    expect(slotAt({ x: 10, y: 10 }, geometry, 20)).toBe(0);
    expect(slotAt({ x: 150, y: 10 }, geometry, 20)).toBe(1);
    expect(slotAt({ x: 10, y: 200 }, geometry, 20)).toBe(4);
    expect(slotAt({ x: 450, y: 200 }, geometry, 20)).toBe(7);
  });

  it('gives the gap after a card to that card', () => {
    expect(slotAt({ x: 138, y: 10 }, geometry, 20)).toBe(0);
  });

  it('lands at the start when dragged above or left of everything', () => {
    expect(slotAt({ x: -50, y: -80 }, geometry, 20)).toBe(0);
  });

  it('lands at the end when dragged past the last card or off the right', () => {
    expect(slotAt({ x: 10, y: 5000 }, geometry, 6)).toBe(5);
    expect(slotAt({ x: 9000, y: 10 }, geometry, 20)).toBe(3);
  });
});

describe('the order while a record is held', () => {
  it('moves the record and shifts what is between', () => {
    expect(previewOrder(5, 0, 3)).toEqual([1, 2, 3, 0, 4]);
    expect(previewOrder(5, 4, 1)).toEqual([0, 4, 1, 2, 3]);
  });

  it('is the original order when it has not moved', () => {
    expect(previewOrder(4, 2, 2)).toEqual([0, 1, 2, 3]);
  });

  it('clamps a target past either end', () => {
    expect(previewOrder(3, 0, 99)).toEqual([1, 2, 0]);
    expect(previewOrder(3, 2, -4)).toEqual([2, 0, 1]);
  });
});

describe('naming records so a move does not remount them', () => {
  it('names each copy of a song by the order it appears in', () => {
    expect(recordKeys(['a', 'b', 'a'])).toEqual(['a#0', 'b#0', 'a#1']);
  });

  it('keeps a song’s name when the songs around it move', () => {
    const before = recordKeys(['a', 'b', 'c']);
    const after = recordKeys(['c', 'a', 'b']);
    expect(new Set(after)).toEqual(new Set(before));
  });
});
