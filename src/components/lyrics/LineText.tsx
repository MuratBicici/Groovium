import type { LyricLine } from '@/core/lyrics/activeLine';
import { UNSUNG } from './useLyricFrame';

/** A word and the space after it, which travels with it when a line wraps. */
const WORDS = /\S+\s*/g;

/**
 * A stretch of the song with no words in it: the wait before the first line,
 * and the instrumental breaks whoever timed the song wrote as empty lines.
 *
 * A short wave rather than a note. It is drawn dim and filled from the left as
 * the stretch runs out, so it says how long is left the way the line being sung
 * says how far through it the singing is — the same light, through the shape of
 * a wave instead of the shape of letters. Nothing to read, so nothing is read
 * out: the line is in the list a screen reader gets, empty, as it is.
 */
export function Silence({ lit = false }: { lit?: boolean }) {
  return <span {...(lit ? { 'data-word': true } : {})} className="lyric-wave" aria-hidden="true" />;
}

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

  // Nothing to say: a wave for as long as the silence lasts.
  if (!line.text.trim()) return <Silence lit />;

  const words = line.text.match(WORDS) ?? [line.text];
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
