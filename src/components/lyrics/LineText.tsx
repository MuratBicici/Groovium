import type { LyricLine } from '@/core/lyrics/activeLine';
import { UNSUNG } from './useLyricFrame';

/**
 * A line's words, in syllables where a source times them.
 *
 * On the line being sung every syllable starts unsung, and the frame loop in
 * `useLyricFrame` lights them as they are reached. The class is only ever
 * changed by React when the line stops or starts being sung — its value is
 * the same on every render in between, so React leaves alone what the loop
 * has done to it.
 */
export function LineText({ line, singing }: { line: LyricLine; singing: boolean }) {
  if (!line.words || line.words.length === 0) return <>{line.text || '♪'}</>;
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
