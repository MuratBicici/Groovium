import { describe, expect, it } from 'vitest';
import { NO_BEAT, bassOf, listen, type Beat } from './onset';

const FRAME = 1 / 60;

/** A frame of bands: `low` across the bottom quarter, `rest` everywhere else. */
const spectrum = (low: number, rest = 0.1) =>
  Array.from({ length: 24 }, (_, band) => (band < 6 ? low : rest));

/** Run a sequence of frames through, returning what was heard on each. */
function play(frames: number[], seconds = FRAME): number[] {
  let beat: Beat = NO_BEAT;
  return frames.map((low) => {
    const heard = listen(beat, bassOf(spectrum(low)), seconds);
    beat = heard.beat;
    return heard.hit;
  });
}

/** A kick every `every` frames, over `frames` frames. */
const pattern = (frames: number, every: number, loud = 0.9, quiet = 0.15) =>
  Array.from({ length: frames }, (_, at) => (at % every < 3 ? loud : quiet));

describe('finding the low end', () => {
  it('takes the loudest of the low bands, not their average', () => {
    // A kick is one or two bands, and an average across the quarter buries it.
    const bars = Array(24).fill(0);
    bars[1] = 0.9;
    expect(bassOf(bars)).toBe(0.9);
  });

  it('ignores the top end entirely', () => {
    const bars = Array(24).fill(0);
    bars[20] = 1;
    expect(bassOf(bars)).toBe(0);
  });
});

describe('hearing a hit', () => {
  it('hears nothing in silence', () => {
    expect(play(Array(120).fill(0)).every((hit) => hit === 0)).toBe(true);
  });

  it('hears nothing in a fade-out', () => {
    // The trap this guards: an average of nearly nothing is exceeded by nearly
    // anything, so without a floor the quietest part of a track fires hardest.
    const fading = Array.from({ length: 200 }, (_, at) => 0.06 * (1 - at / 200));
    expect(play(fading).every((hit) => hit === 0)).toBe(true);
  });

  it('settles down under a tone that simply stays loud', () => {
    // Loud is not a hit. Once the average has caught up, a steady sound is as
    // quiet as silence as far as this is concerned.
    const heard = play(Array(240).fill(0.85));
    expect(heard.slice(120).every((hit) => hit === 0)).toBe(true);
  });

  it('hears a kick under a track that is loud all the way through', () => {
    const heard = play(pattern(600, 30, 0.95, 0.55));
    expect(heard.filter((hit) => hit > 0).length).toBeGreaterThan(10);
  });

  it('hears one hit per kick and not one per frame', () => {
    // A kick is several frames wide. Every frame of one being its own hit is
    // what makes a visual stutter rather than pulse.
    const every = 30;
    const frames = 600;
    const hits = play(pattern(frames, every)).filter((hit) => hit > 0).length;
    const kicks = frames / every;
    expect(hits).toBeLessThanOrEqual(kicks);
    expect(hits).toBeGreaterThanOrEqual(kicks - 2);
  });

  it('hears the same music at thirty frames a second as at sixty', () => {
    // The average catches up on a time constant, not on a fixed step per call.
    const at = (seconds: number) => {
      const frames = Math.round(10 / seconds);
      const every = Math.round(0.5 / seconds);
      return play(pattern(frames, every, 0.95, 0.15), seconds).filter((hit) => hit > 0).length;
    };
    expect(Math.abs(at(1 / 60) - at(1 / 30))).toBeLessThanOrEqual(1);
  });

  it('hits as hard on the twentieth kick as on the first', () => {
    // The reported want. Following the music at one rate, the level a jump is
    // measured against climbs through a bass-heavy passage until it sits among
    // the kicks themselves — so a kick barely clears it, and the edge stops
    // answering exactly where the music is busiest. Settling into the quiet
    // between them instead, every kick is the same jump the first one made.
    const heard = play(pattern(900, 30, 0.95, 0.55)).filter((hit) => hit > 0);
    expect(heard.length).toBeGreaterThan(24);

    const last = heard.slice(-8);
    for (const hit of last) expect(hit).toBeGreaterThan(0.5);
  });

  it('is not fooled into hitting on the quiet between them', () => {
    // The other half of a floor that drops quickly: it must not drop so far
    // that the gaps themselves start clearing it. Twenty-nine of every thirty
    // frames are the quiet part, so a floor that had fallen through it would
    // put the count many times above the number of kicks.
    //
    // Counted from the second kick onwards. The first half-second is the floor
    // finding the music from nothing, and it fires two or three extra times
    // getting there — which is the start of a track flaring, and right.
    const heard = play(pattern(900, 30, 0.95, 0.55)).slice(60);
    const kicks = heard.length / 30;
    expect(heard.filter((hit) => hit > 0).length).toBe(kicks);
  });

  it('says how hard it was hit', () => {
    const soft = play([...Array(60).fill(0.3), 0.45]).at(-1) ?? 0;
    const hard = play([...Array(60).fill(0.3), 1]).at(-1) ?? 0;
    expect(hard).toBeGreaterThan(soft);
    expect(hard).toBeLessThanOrEqual(1);
  });
});
