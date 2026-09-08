import { describe, expect, it } from 'vitest';
import { NO_BEAT, listen, type Beat } from './onset';

const FRAME = 1 / 60;
const BANDS = 24;

/** A frame of bands: `low` across the bottom quarter, `rest` everywhere else. */
const spectrum = (low: number, rest = 0.1) =>
  Array.from({ length: BANDS }, (_, band) => (band < BANDS / 4 ? low : rest));

/** A frame with one stretch of the spectrum lifted and the rest left alone. */
const only = (from: number, to: number, loud: number, rest = 0.1) =>
  Array.from({ length: BANDS }, (_, band) => (band >= from && band < to ? loud : rest));

/** Run a sequence of frames through, returning what was heard on each. */
function play(frames: number[][], seconds = FRAME): number[] {
  let beat: Beat = NO_BEAT;
  return frames.map((bars) => {
    const heard = listen(beat, bars, seconds);
    beat = heard.beat;
    return heard.hit;
  });
}

/** The same, over a low end that only ever moves. */
const lows = (values: number[], seconds = FRAME, rest = 0.1) =>
  play(
    values.map((low) => spectrum(low, rest)),
    seconds,
  );

/** A kick every `every` frames, over `frames` frames. */
const pattern = (frames: number, every: number, loud = 0.9, quiet = 0.15) =>
  Array.from({ length: frames }, (_, at) => (at % every < 3 ? loud : quiet));

describe('reading a part of the spectrum', () => {
  /** A run-up of quiet frames, then one where a single band is struck. */
  const oneBand = (band: number) =>
    play([
      ...Array.from({ length: 20 }, () => Array(BANDS).fill(0.05)),
      Array.from({ length: BANDS }, (_, at) => (at === band ? 0.9 : 0.05)),
    ]).at(-1) ?? 0;

  it('takes the loudest band of a part, not the part average', () => {
    // A kick is one or two bands out of six, and an average across the six
    // buries it: nine tenths in one band comes out at a seventh.
    expect(oneBand(1)).toBeGreaterThan(0.5);
  });

  it('hears one struck anywhere across the spectrum', () => {
    // Every part, which is the change. Only the first of these used to fire.
    for (const band of [1, 8, 14, 21]) expect(oneBand(band)).toBeGreaterThan(0);
  });
});

describe('hearing a hit', () => {
  it('hears nothing in silence', () => {
    expect(lows(Array(120).fill(0), FRAME, 0).every((hit) => hit === 0)).toBe(true);
  });

  it('hears nothing in a fade-out', () => {
    // Nothing is climbing, so nothing has started. The trap this used to guard
    // was subtler and is gone with the level it was about: an average of nearly
    // nothing was exceeded by nearly anything, so the quietest part of a track
    // fired hardest.
    const fading = Array.from({ length: 200 }, (_, at) => 0.06 * (1 - at / 200));
    expect(lows(fading, FRAME, 0).every((hit) => hit === 0)).toBe(true);
  });

  it('settles down under a tone that simply stays loud', () => {
    // Loud is not a hit. A sound that has stopped climbing is as quiet as
    // silence as far as this is concerned, however much of the meter it fills.
    const heard = lows(Array(240).fill(0.85));
    expect(heard.slice(10).every((hit) => hit === 0)).toBe(true);
  });

  it('hears a kick under a track that is loud all the way through', () => {
    const heard = lows(pattern(600, 30, 0.95, 0.55));
    expect(heard.filter((hit) => hit > 0).length).toBeGreaterThan(10);
  });

  it('hears one hit per kick and not one per frame', () => {
    // A kick is several frames wide. Every frame of one being its own hit is
    // what makes a visual stutter rather than pulse.
    const every = 30;
    const frames = 600;
    const hits = lows(pattern(frames, every)).filter((hit) => hit > 0).length;
    const kicks = frames / every;
    expect(hits).toBeLessThanOrEqual(kicks);
    expect(hits).toBeGreaterThanOrEqual(kicks - 2);
  });

  it('hears the same music at thirty frames a second as at sixty', () => {
    // The usual step follows the music on a time constant rather than a share
    // per frame, so the bar a step is held to is the same at either rate.
    const at = (seconds: number) => {
      const frames = Math.round(10 / seconds);
      const every = Math.round(0.5 / seconds);
      return lows(pattern(frames, every, 0.95, 0.15), seconds).filter((hit) => hit > 0).length;
    };
    expect(Math.abs(at(1 / 60) - at(1 / 30))).toBeLessThanOrEqual(1);
  });

  it('hits as hard on the twentieth kick as on the first', () => {
    const heard = lows(pattern(900, 30, 0.95, 0.55)).filter((hit) => hit > 0);
    expect(heard.length).toBeGreaterThan(24);
    for (const hit of heard.slice(-8)) expect(hit).toBeGreaterThan(0.5);
  });

  it('is not fooled into hitting on the quiet between them', () => {
    // Twenty-nine of every thirty frames are the fall after the kick, and a
    // fall is not a step. Counted from the second kick onwards: the first is
    // inside the gap after nothing at all and is swallowed by it, which costs a
    // hit at the very start of a track and nothing after that.
    const heard = lows(pattern(900, 30, 0.95, 0.55)).slice(60);
    expect(heard.filter((hit) => hit > 0).length).toBe(heard.length / 30);
  });

  it('says how hard it was hit', () => {
    const soft = lows([...Array(60).fill(0.3), 0.45]).at(-1) ?? 0;
    const hard = lows([...Array(60).fill(0.3), 1]).at(-1) ?? 0;
    expect(hard).toBeGreaterThan(soft);
    expect(hard).toBeLessThanOrEqual(1);
  });
});

/**
 * The two complaints this was rebuilt for.
 *
 * A kick that never counts as one because the low end it lands on is already at
 * the top of its range, and a song carried by a voice that lit nothing at all
 * because nothing it does happens below two hundred hertz.
 */
describe('hearing the rest of the music', () => {
  it('hears a kick on a low end that is already nearly at the top', () => {
    // The one that shipped broken, and the reason for the rebuild. Measured as
    // a level against its own average, this kick stands five percent above a
    // low end sitting at nine tenths and counts as nothing — on a ratio there
    // is nothing left to clear. It is still a step, and a step is a hit.
    const squashed = Array.from({ length: 600 }, (_, at) => (at % 30 < 3 ? 0.95 : 0.86));
    expect(lows(squashed).filter((hit) => hit > 0).length).toBeGreaterThan(15);
  });

  it('hears a snare with nothing underneath it', () => {
    // Nothing in the low end at all, which is where this used to look.
    const frames = Array.from({ length: 600 }, (_, at) =>
      at % 30 < 3 ? only(6, 12, 0.8, 0.06) : only(6, 12, 0.2, 0.06),
    );
    expect(play(frames).filter((hit) => hit > 0).length).toBeGreaterThan(15);
  });

  it('hears the front of a sung phrase', () => {
    // Slower and softer than a drum, in the band a voice is heard in, over a
    // track with no percussion in it whatsoever.
    const frames: number[][] = [];
    for (let phrase = 0; phrase < 8; phrase++) {
      for (let at = 0; at < 90; at++) {
        // Two frames climbing into the phrase, then it holds and falls away.
        const level = at < 2 ? 0.2 + 0.2 * (at + 1) : Math.max(0.15, 0.6 - (at - 2) * 0.01);
        frames.push(only(12, 18, level, 0.05));
      }
    }
    expect(play(frames).filter((hit) => hit > 0).length).toBeGreaterThanOrEqual(6);
  });

  it('counts the same hit for more down low than up top', () => {
    // A kick should still outweigh a hi-hat. It no longer silences it.
    const struck = (from: number, to: number) =>
      play([
        // Long enough before the strike to be clear of the gap.
        ...Array.from({ length: 20 }, () => only(from, to, 0.2, 0.05)),
        only(from, to, 0.9, 0.05),
      ]).at(-1) ?? 0;

    const low = struck(0, 6);
    const high = struck(18, 24);
    expect(low).toBeGreaterThan(high);
    expect(high).toBeGreaterThan(0);
  });

  it('does not fire on a hi-hat while the rest of the window is silent', () => {
    // The other half of the balance: a part of the spectrum has to be audible
    // before a change in it means anything.
    const ticking = Array.from({ length: 300 }, (_, at) =>
      only(18, 24, at % 15 < 2 ? 0.07 : 0.01, 0),
    );
    expect(play(ticking).every((hit) => hit === 0)).toBe(true);
  });
});
