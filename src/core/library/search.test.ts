import { describe, expect, it } from 'vitest';
import { findIn, fold, matchRank, queryWords } from './search';

describe('folding text to compare it', () => {
  it('drops accents and case', () => {
    expect(fold('Beyoncé')).toBe('beyonce');
    expect(fold('ŞARKI Çalış Göğüs Üzüm Ödev')).toBe('sarki calis gogus uzum odev');
  });

  it('makes every I an i, whichever keyboard wrote it', () => {
    expect(fold('IĞDIR')).toBe('igdir');
    expect(fold('Iğdır')).toBe('igdir');
    expect(fold('İstanbul')).toBe('istanbul');
    expect(fold('ISTANBUL')).toBe('istanbul');
  });

  it('splits a query into its words, and finds none in spaces', () => {
    expect(queryWords('  Kenan   Doğulu ')).toEqual(['kenan', 'dogulu']);
    expect(queryWords('   ')).toEqual([]);
  });
});

describe('matching', () => {
  it('needs every word, in any order and any field', () => {
    const fields = ['Gelinim Olur Musun', 'Kenan Doğulu', 'Festival'];
    expect(matchRank(queryWords('dogulu kenan'), fields)).not.toBeNull();
    expect(matchRank(queryWords('gelinim festival'), fields)).not.toBeNull();
    expect(matchRank(queryWords('gelinim tarkan'), fields)).toBeNull();
  });

  it('puts a name that starts with the query before one that only has it', () => {
    const words = queryWords('night');
    expect(matchRank(words, ['Nightcall', 'Kavinsky'])).toBe(0);
    expect(matchRank(words, ['Late Night', 'Someone'])).toBe(1);
    expect(matchRank(words, ['Intro', 'Night Tapes'])).toBe(2);
  });

  it('matches nothing for an empty query', () => {
    expect(matchRank([], ['anything'])).toBeNull();
    expect(findIn(['a', 'b'], '  ', (s) => [s])).toEqual([]);
  });

  it('lists the best first and keeps the shelf order within a rank', () => {
    const songs = [
      { title: 'Late Night', artist: 'A' },
      { title: 'Intro', artist: 'Night Tapes' },
      { title: 'Nightcall', artist: 'B' },
      { title: 'Night Drive', artist: 'C' },
    ];
    expect(findIn(songs, 'night', (s) => [s.title, s.artist]).map((s) => s.title)).toEqual([
      'Nightcall',
      'Night Drive',
      'Late Night',
      'Intro',
    ]);
  });
});
