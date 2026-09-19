import { useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react';
import type { DrawerSide } from '@/core/settings';
import type { LyricLine } from '@/core/lyrics/activeLine';
import { prefersReducedMotion } from '@/core/utils/motion';
import { CENTER_INSET, TEXT_RADIUS, lineAngle, lineLook, visibleRange } from './arc';
import type { Move } from './browse';
import { LineText } from './LineText';
import { ARRIVE_EASING, LOOK_MS, TURN_EASING, TURN_MS } from './motion';

/**
 * The CSS transition for a turn of the wheel — and of the record, which turns
 * with it — by how it moved: an ordinary turn, the longer wind back from a
 * scroll, or nothing at all for a cut.
 */
export function turnTransition(move: Move): string {
  if (move.kind === 'cut' || prefersReducedMotion()) return 'none';
  const ms = move.kind === 'return' ? move.ms : TURN_MS;
  return `transform ${ms}ms ${TURN_EASING}`;
}

/**
 * The lines of a synced song as spokes of the record beside them.
 *
 * A zero-sized wheel sits at the record's centre and every line is placed on
 * it once, at its own fixed angle. What moves is the wheel, turned by
 * `angle` — the same angle the record is turned by, so the two go round as
 * one.
 *
 * Every line of the song is drawn, however long it is. Only the few near the
 * level can be seen; the rest are transparent and take no pointer. Drawing
 * only those few was quicker, and it meant a fast scroll could reach a line
 * before it existed — blank for a frame, which is exactly the moment somebody
 * is looking. A few hundred spans that are never repainted cost less than
 * that does.
 *
 * The line shown on the level is usually the one being sung, but a scroll
 * can take the view elsewhere; the line being sung keeps its light wherever
 * it is.
 */
export function LyricWheel({
  lines,
  side,
  view,
  sung,
  angle,
  move,
  sungEl,
  onPick,
}: {
  lines: LyricLine[];
  side: DrawerSide;
  /** The line on the level. */
  view: number;
  /** The line being sung. */
  sung: number;
  angle: number;
  move: Move;
  sungEl: RefObject<HTMLButtonElement | null>;
  onPick: (line: LyricLine) => void;
}) {
  const layer = useRef<HTMLDivElement | null>(null);
  const range = visibleRange(view, lines.length);
  const left = side === 'left';

  // A cut fades the lines in where they now are, instead of turning to them.
  useLayoutEffect(() => {
    if (move.kind !== 'cut' || prefersReducedMotion()) return;
    layer.current?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 260,
      easing: ARRIVE_EASING,
    });
  }, [view, move]);

  const wheel: CSSProperties = {
    position: 'absolute',
    top: '50%',
    [left ? 'left' : 'right']: CENTER_INSET,
    width: 0,
    height: 0,
    transform: `rotate(${angle}deg)`,
    transition: turnTransition(move),
  };

  return (
    <div ref={layer} className="lyric-edge-fade absolute inset-0 overflow-hidden" aria-hidden="true">
      <div style={wheel}>
        {lines.map((line, index) => {
          const singing = index === sung;
          const near = range !== null && index >= range[0] && index <= range[1];
          const look = lineLook(index - view);
          return (
            <div
              key={index}
              className="absolute top-0 left-0"
              style={{
                transformOrigin: '0 0',
                transform: left
                  ? `rotate(${lineAngle(index, side)}deg) translate(${TEXT_RADIUS}px, -50%)`
                  : `rotate(${lineAngle(index, side)}deg) translate(${-TEXT_RADIUS}px, -50%) translateX(-100%)`,
                // Out of reach: still there, still in its place, but nothing
                // to see and nothing to press.
                visibility: near ? 'visible' : 'hidden',
              }}
            >
              <button
                ref={singing ? sungEl : undefined}
                type="button"
                tabIndex={-1}
                data-line={index}
                onClick={() => onPick(line)}
                className={`block w-max max-w-[400px] cursor-pointer rounded-md px-2 py-1 leading-snug transition-[opacity,transform,color] hover:!opacity-80 ${
                  left ? 'text-left' : 'text-right'
                } ${
                  singing
                    ? 'text-[22px] font-semibold text-cream-50 lyric-glow'
                    : 'text-[17px] text-cream-200'
                }`}
                style={{
                  opacity: near ? look.opacity : 0,
                  transform: `scale(${look.scale})`,
                  transformOrigin: left ? 'left center' : 'right center',
                  transitionDuration: `${LOOK_MS}ms`,
                  transitionTimingFunction: ARRIVE_EASING,
                }}
              >
                <LineText line={line} singing={singing} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
