import type { LyricLine } from '@/core/lyrics/activeLine';
import { UNSUNG } from './useLyricFrame';

/** A word and the space after it, which travels with it when a line wraps. */
const WORDS = /\S+\s*/g;

/**
 * A line's words: in syllables where a source times them, and in plain words
 * where it does not.
 *
 * On the line being sung every syllable starts unsung, and the frame loop in
 * `useLyricFrame` lights them as they are reached. The class is only ever
 * changed by React when the line stops or starts being sung — its value is
 * the same on every render in between, so React leaves alone what the loop
 * has done to it.
 *
 * A line nobody timed by syllable is still cut into words, because the light
 * that crosses it has to be laid out along them. One ramp across the whole box
 * is a ramp across every row of it at once: wrapped onto two lines, the second
 * row fills before its first word is sung. A word at a time is read in the
 * order the words are, and a row break stops being anything at all.
 */
export function LineText({ line, singing }: { line: LyricLine; singing: boolean }) {
  if (line.words && line.words.length > 0) {
    return (
      <>
        {line.words.map((word, w) => (
          <span key={w} data-syllable className={`lyric-syllable ${singing ? UNSUNG : ''}`}>
            {word.text}
          </span>
        ))}
      </>
    );
  }

  const words = (line.text || '♪').match(WORDS) ?? ['♪'];
  return (
    <>
      {words.map((word, w) => (
        <span key={w} data-word>
          {word}
        </span>
      ))}
    </>
  );
}
