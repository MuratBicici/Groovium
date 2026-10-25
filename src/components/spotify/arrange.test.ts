import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { arranged, landing, makingRoom, moved, readOrder, writeOrder } from './arrange';

/**
 * Moving the front page's shelves: what order is kept, and where a shelf
 * being carried lands and what moves out of its way.
 */

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const DEFAULTS = ['recent', 'genres', 'liked', 'top', 'playlists'];

describe('the order kept', () => {
  it('is the default to begin with', () => {
    expect(readOrder(DEFAULTS)).toEqual(DEFAULTS);
  });

  it('is what was left', () => {
    writeOrder(['playlists', 'recent', 'genres', 'liked', 'top']);
    expect(readOrder(DEFAULTS)).toEqual(['playlists', 'recent', 'genres', 'liked', 'top']);
  });

  it('puts a shelf never seen where the default has it, after the one before it', () => {
    expect(arranged(['top', 'recent', 'playlists'], DEFAULTS)).toEqual([
      'top',
      'recent',
      'genres',
      'liked',
      'playlists',
    ]);
    expect(arranged(['liked', 'top'], ['new', 'liked', 'top'])).toEqual(['new', 'liked', 'top']);
  });

  it('drops a shelf that is gone, and a repeat', () => {
    expect(arranged(['gone', 'top', 'top', 'recent'], ['recent', 'top'])).toEqual(['top', 'recent']);
  });

  it('survives garbage and refused storage', () => {
    localStorage.setItem('groovium.homeOrder', '{nope');
    expect(readOrder(DEFAULTS)).toEqual(DEFAULTS);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(readOrder(DEFAULTS)).toEqual(DEFAULTS);
    expect(() => writeOrder(DEFAULTS)).not.toThrow();
  });
});

describe('carrying a shelf', () => {
  // A tall one in the middle: the genre shelves move as one.
  const spans = [
    { top: 0, height: 100 },
    { top: 112, height: 300 },
    { top: 424, height: 100 },
  ];

  it('stays where it is until it passes another’s middle', () => {
    expect(landing(spans, 0, 100)).toBe(0);
    expect(landing(spans, 0, 230)).toBe(1);
    expect(landing(spans, 0, 500)).toBe(2);
    expect(landing(spans, 2, -150)).toBe(2);
    expect(landing(spans, 2, -250)).toBe(1);
    expect(landing(spans, 2, -450)).toBe(0);
  });

  it('moves those it passed by its own height and the gap', () => {
    expect(makingRoom(spans, 12, 0, 2)).toEqual([0, -112, -112]);
    expect(makingRoom(spans, 12, 2, 0)).toEqual([112, 112, 0]);
    expect(makingRoom(spans, 12, 1, 1)).toEqual([0, 0, 0]);
  });

  it('reorders', () => {
    expect(moved(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(moved(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });
});
