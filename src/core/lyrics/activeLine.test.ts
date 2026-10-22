import { describe, expect, it } from 'vitest';
import {
  BREAK_WORTH_SHOWING_MS,
  INTRO_WORTH_SHOWING_MS,
  LAST_LINE_MS,
  acrossWords,
  activeLine,
  isSilence,
  lineSweep,
  withBreaks,
  withIntro,
  withoutOutro,
  type LyricLine,
} from './activeLine';

const lines = [1000, 2000, 2000, 5000].map((timeMs, i) => ({ timeMs, text: `${i}` }));

describe('the line being sung', () => {
  it('is none in an empty song', () => {
    expect(activeLine([], 3000)).toBe(-1);
  });

  it('is none before the first line starts', () => {
    expect(activeLine(lines, 999)).toBe(-1);
  });

  it('starts on the exact millisecond', () => {
    expect(activeLine(lines, 1000)).toBe(0);
  });

  it('holds between two lines', () => {
    expect(activeLine(lines, 1999)).toBe(0);
    expect(activeLine(lines, 4999)).toBe(2);
  });

  it('is the last of lines that share a stamp', () => {
    expect(activeLine(lines, 2000)).toBe(2);
  });

  it('stays on the last line to the end', () => {
    expect(activeLine(lines, 999_999)).toBe(3);
  });

  it('finds the syllable being sung within a line the same way', () => {
    const words = [
      { timeMs: 8750, text: '문' },
      { timeMs: 8860, text: '을 ' },
      { timeMs: 9080, text: '열' },
    ];
    expect(activeLine(words, 8700)).toBe(-1);
    expect(activeLine(words, 8900)).toBe(1);
    expect(activeLine(words, 9080)).toBe(2);
  });
});

describe('the light over the line being sung', () => {
  // A line at two seconds, the next at four: the light crosses it in two.
  const song = [
    { timeMs: 2000, text: 'first' },
    { timeMs: 4000, text: 'second' },
  ];

  it('is nothing at all as the line begins', () => {
    expect(lineSweep(song, 0, 2000)).toBe(0);
  });

  it('is halfway across at the halfway second', () => {
    expect(lineSweep(song, 0, 3000)).toBeCloseTo(0.5, 5);
  });

  it('reaches the end of the line as the next line starts', () => {
    expect(lineSweep(song, 0, 3999)).toBeGreaterThan(0.999);
    expect(lineSweep(song, 0, 4000)).toBe(1);
  });

  it('keeps inside the line it is over', () => {
    expect(lineSweep(song, 0, 1000)).toBe(0);
    expect(lineSweep(song, 0, 99_000)).toBe(1);
  });

  it('gives the last line of a song a length of its own', () => {
    expect(lineSweep(song, 1, 4000 + LAST_LINE_MS / 2)).toBeCloseTo(0.5, 5);
    expect(lineSweep(song, 1, 4000 + LAST_LINE_MS)).toBe(1);
  });

  it('has a line timed onto the next one over already', () => {
    const together = [
      { timeMs: 2000, text: 'first' },
      { timeMs: 2000, text: 'second' },
    ];
    expect(lineSweep(together, 0, 2000)).toBe(1);
  });

  it('is nothing at all off the end of the song', () => {
    expect(lineSweep(song, -1, 3000)).toBe(0);
    expect(lineSweep(song, 9, 3000)).toBe(0);
  });
});

describe('the light laid out along the words', () => {
  it('is nothing anywhere before the line begins', () => {
    expect(acrossWords([10, 30, 10], 0)).toEqual([0, 0, 0]);
  });

  it('is everything everywhere once it is over', () => {
    expect(acrossWords([10, 30, 10], 1)).toEqual([1, 1, 1]);
  });

  it('spends on each word the room that word takes', () => {
    // Half of fifty is twenty-five: the first word is behind it, the second is
    // halfway through, the third has not been reached.
    expect(acrossWords([10, 30, 10], 0.5)).toEqual([1, 0.5, 0]);
  });

  it('crosses a word boundary without a step in it', () => {
    const just = acrossWords([10, 10], 0.499);
    const over = acrossWords([10, 10], 0.501);
    expect(just[0]).toBeCloseTo(0.998, 3);
    expect(just[1]).toBe(0);
    expect(over[0]).toBe(1);
    expect(over[1]).toBeCloseTo(0.002, 3);
  });

  it('stays inside itself however it is asked', () => {
    expect(acrossWords([10, 10], -3)).toEqual([0, 0]);
    expect(acrossWords([10, 10], 9)).toEqual([1, 1]);
    expect(acrossWords([], 0.5)).toEqual([]);
    expect(acrossWords([0, 0], 1)).toEqual([1, 1]);
  });
});

describe("the song's own opening", () => {
  const words = (timeMs: number) => ({ timeMs, text: 'a word' });

  it('is a line with nothing in it, at the very start', () => {
    const song = withIntro([words(9_000), words(12_000)]);
    expect(song).toHaveLength(3);
    expect(song[0]).toEqual({ timeMs: 0, text: '' });
    expect(song[1]).toEqual(words(9_000));
  });

  it('is not worth showing when the singing starts at once', () => {
    // A mark that appeared and was gone before it could be read.
    const song = [words(900), words(4_000)];
    expect(withIntro(song)).toEqual(song);
    expect(withIntro([words(INTRO_WORTH_SHOWING_MS - 1)])).toHaveLength(1);
    expect(withIntro([words(INTRO_WORTH_SHOWING_MS)])).toHaveLength(2);
  });

  it('leaves a song with no lines alone', () => {
    expect(withIntro([])).toEqual([]);
  });

  it('is a line like any other, with its own share of the light', () => {
    // Which is the whole reason it is a line: the mark fills over the wait,
    // the way every other silence in the song does.
    const song = withIntro([words(8_000)]);
    expect(lineSweep(song, 0, 0)).toBe(0);
    expect(lineSweep(song, 0, 4_000)).toBeCloseTo(0.5, 5);
    expect(lineSweep(song, 0, 8_000)).toBe(1);
  });
});

describe('a line with no words on it', () => {
  it('is nothing at all', () => {
    expect(isSilence('')).toBe(true);
    expect(isSilence('   ')).toBe(true);
  });

  it('is a note, or a row of them, the way people timing songs mark a break', () => {
    // What the report was: a line that says "♪" drawn as a word saying "♪".
    for (const mark of ['♪', '♪ ♪ ♪', '♫', '♬♪', '🎵', '🎶', ' ♪ '])
      expect(isSilence(mark), mark).toBe(true);
  });

  it('is dots, a dash, or a note in brackets', () => {
    for (const mark of ['...', '…', '-', '—', '(♪)', '[♪]', '• • •', '~♪~'])
      expect(isSilence(mark), mark).toBe(true);
  });

  it('is never a line with a word in it, however short', () => {
    for (const words of ['I', 'oh ♪', '♪ la la ♪', 'Instrumental', '1, 2', 'N’olur'])
      expect(isSilence(words), words).toBe(false);
  });
});

describe('a break nobody wrote down', () => {
  // A song as one LRCLIB record times it: each line's start and how many
  // letters it has, the words themselves left out. Its eighteenth line runs on
  // for eighteen seconds into a break no empty line marks.
  const timed: [number, number][] = [
    [0, 13], [7000, 13], [14160, 28], [15880, 30], [17600, 32], [19130, 34], [21250, 30],
    [22920, 32], [24760, 31], [26380, 34], [28740, 25], [32020, 29], [35500, 26], [39650, 22],
    [43050, 28], [46470, 24], [49730, 27], [53290, 30], [71180, 38], [75170, 36], [78900, 41],
    [82220, 14], [88650, 4], [92370, 47], [95760, 68], [99530, 61], [103050, 65], [106640, 36],
    [108320, 50], [110160, 32], [111880, 60], [113700, 22], [114890, 32], [116660, 41],
    [120670, 27], [122570, 33], [124380, 69], [127920, 34], [129730, 28], [131440, 59],
  ];
  const song = timed.map(([timeMs, letters]) => ({ timeMs, text: 'x'.repeat(letters) }));
  const shown = withBreaks(song);
  /** Where a break was put in after the line at `ms`, or −1. */
  const breakAfter = (ms: number) => {
    const at = shown.findIndex((line) => line.timeMs === ms && song.includes(line)) + 1;
    return shown[at] && !song.includes(shown[at]) ? at : -1;
  };

  it('is found where a line runs on far past its words', () => {
    const at = breakAfter(53_290);
    expect(at).toBeGreaterThan(0);
    // The words are over within seconds; the next line is at 71.18 s.
    const start = (shown[at] as LyricLine).timeMs;
    expect(start).toBeGreaterThan(53_290 + 2_000);
    expect(start).toBeLessThanOrEqual(71_180 - BREAK_WORTH_SHOWING_MS);
  });

  it('comes in just after the line it follows, a line with nothing on it', () => {
    const at = breakAfter(53_290);
    expect(shown[at]?.text).toBe('');
    expect(shown[at + 1]).toBe(song[18]);
  });

  it('is not found where the song is sung line after line', () => {
    // From the chorus to the end, every line is over before the next is due.
    for (const [ms] of timed.slice(23)) expect(breakAfter(ms), `after ${ms}`).toBe(-1);
  });

  it('is never added where the song already marks one', () => {
    const marked = [
      { timeMs: 1_000, text: 'a line of words' },
      { timeMs: 4_000, text: '♪' },
      { timeMs: 30_000, text: 'a line of words' },
      { timeMs: 33_000, text: 'a line of words' },
    ];
    expect(withBreaks(marked)).toEqual(marked);
  });

  it('is not a held note: a short line given a little longer is left alone', () => {
    const held = [
      { timeMs: 0, text: 'a line of words here' },
      { timeMs: 3_000, text: 'a line of words here' },
      { timeMs: 6_000, text: 'oh' },
      { timeMs: 12_000, text: 'a line of words here' },
      { timeMs: 15_000, text: 'a line of words here' },
    ];
    expect(withBreaks(held)).toEqual(held);
  });

  it('is found after the last syllable, where a source timed them', () => {
    const syllables = (timeMs: number): LyricLine => ({
      timeMs,
      text: 'la la la',
      words: [0, 300, 600].map((d) => ({ timeMs: timeMs + d, text: 'la ' })),
    });
    const sung = [syllables(0), syllables(2_000), syllables(20_000), syllables(22_000)];
    const breaks = withBreaks(sung).filter((line) => !sung.includes(line));
    // Its last syllable at 2.6 s, but a line is given three seconds at least.
    expect(breaks).toEqual([{ timeMs: 5_000, text: '' }]);
  });

  it('leaves an empty song alone', () => {
    expect(withBreaks([])).toEqual([]);
  });
});

describe("the song's end", () => {
  const words = (timeMs: number) => ({ timeMs, text: 'a word' });
  const quiet = (timeMs: number, text = '') => ({ timeMs, text });

  it('has no wave after the last words', () => {
    expect(withoutOutro([words(1_000), words(4_000), quiet(9_000)])).toEqual([
      words(1_000),
      words(4_000),
    ]);
  });

  it('loses every mark of silence at the end, written however', () => {
    expect(withoutOutro([words(1_000), quiet(5_000, '♪'), quiet(9_000, '...')])).toEqual([
      words(1_000),
    ]);
  });

  it('keeps the silences between the words', () => {
    const song = [words(1_000), quiet(4_000), words(9_000)];
    expect(withoutOutro(song)).toEqual(song);
  });

  it('keeps a last line timed by syllable, whatever its text', () => {
    const song = [words(1_000), { timeMs: 4_000, text: '', words: [{ timeMs: 4_000, text: 'oh' }] }];
    expect(withoutOutro(song)).toEqual(song);
  });

  it('leaves a song that is all silence as it is', () => {
    const song = [quiet(0), quiet(30_000)];
    expect(withoutOutro(song)).toEqual(song);
    expect(withoutOutro([])).toEqual([]);
  });
});
