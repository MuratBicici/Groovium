import { useLayoutEffect, useRef } from 'react';
import { useIsPlaying, useProgressFraction } from '@/core/store';
import { prefersReducedMotion } from '@/core/utils/motion';
import {
  ARM_LENGTH,
  INNER_GROOVE,
  OUTER_GROOVE,
  PAD,
  PARK_RADIUS,
  PIVOT_X,
  PIVOT_Y,
  VIEW,
  angleForRadius,
} from './tonearmGeometry';

/**
 * The tonearm, and it tracks.
 *
 * What replaced it: a circle, a bar and a rectangle in a flex column, rotated
 * between two hardcoded angles — and rotated about the corner of its own box
 * rather than about the pivot, so it swung like a signpost instead of pivoting
 * like an arm.
 *
 * The angle is computed from the radius the stylus should be sitting at, not
 * picked to look right. Given a pivot a fixed distance from the spindle and an
 * arm of fixed length, the triangle closes: the law of cosines gives exactly
 * one angle that puts the stylus on a given groove. That solver lives in
 * `tonearmGeometry.ts`, where the test can reach it without a DOM.
 *
 * Drawn into a viewport `PAD` larger than the well on every side, offset back
 * by the same amount, so the coordinates below are still the well's — an SVG
 * viewport clips, and the counterweight reaches behind the pivot into what used
 * to be negative space.
 *
 * It subscribes to progress **itself**, deliberately. `DiskPlatter` reads only
 * playback state and the current track, so it does not re-render on the four
 * progress ticks a second; feeding the arm from up there would have re-rendered
 * both un-memoised discs underneath it at 4Hz for the sake of a fifth of a
 * degree.
 */
/**
 * `stowed` swings the whole arm clear of the deck.
 *
 * Out fast and in slowly on purpose: lifting an arm off a record is a flick of
 * the wrist, and setting one down is the careful half of the gesture. The
 * translate rides on the `<svg>` so it composes with, rather than fights, the
 * rotation the `<g>` is already carrying.
 *
 * **How far is measured, not chosen.** A stowed arm keeps tracking, because the
 * track it was stowed on keeps playing: the angle goes on opening from 96 to
 * 118 degrees, and every degree of that carries the stylus further to the left.
 * A distance that cleared the window at the start of a song did not clear it by
 * the end, and the tip came creeping back in from the right. The whole viewport
 * is pushed past the edge instead, which no angle can undo, since nothing is
 * drawn outside it.
 */
export function Tonearm({ stowed = false }: { stowed?: boolean }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const isPlaying = useIsPlaying();
  const progress = useProgressFraction();

  const radius = isPlaying
    ? OUTER_GROOVE + (INNER_GROOVE - OUTER_GROOVE) * progress
    : PARK_RADIUS;
  const angle = angleForRadius(radius);

  // The pivot in viewport coordinates. Everything below is drawn relative to
  // it, so the shapes stay written in the well's frame.
  const px = PIVOT_X + PAD;
  const py = PIVOT_Y + PAD;

  // Written onto the well rather than the svg: the svg's own left moves when it
  // is stowed, so measuring it again would compound, and React owns that
  // element's style attribute while it does not own the well's.
  useLayoutEffect(() => {
    const well = svgRef.current?.parentElement;
    if (!well) return;
    const left = well.getBoundingClientRect().left - PAD;
    well.style.setProperty('--stow-x', `${Math.ceil(window.innerWidth - left + 8)}px`);
  }, []);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className="pointer-events-none absolute"
      style={{
        top: -PAD,
        left: -PAD,
        width: VIEW,
        height: VIEW,
        // The fallback is only for the frame before the measurement lands.
        transform: stowed ? 'translateX(var(--stow-x, 300px))' : 'translateX(0)',
        transition: prefersReducedMotion()
          ? 'none'
          : stowed
            ? 'transform 170ms cubic-bezier(0.4, 0, 1, 1)'
            : 'transform 360ms cubic-bezier(0.16, 1, 0.3, 1) 60ms',
      }}
      aria-hidden="true"
    >
      <g
        style={{
          // A CSS transform rather than the SVG attribute, so one mechanism
          // owns the angle. `view-box` makes the origin resolve in viewBox
          // units, measured from the viewBox's own corner — hence the padded
          // pivot rather than the raw one.
          transform: `rotate(${angle.toFixed(2)}deg)`,
          transformBox: 'view-box',
          // One duration for two very different moves. Cueing on and off the
          // record is ~22 degrees and reads as a deliberate drop; tracking is a
          // fifth of a degree every 250ms and just needs smoothing. A slower
          // transition would spend its life chasing the progress ticks.
          transition: prefersReducedMotion() ? 'none' : 'transform 300ms ease-out',
          transformOrigin: `${px}px ${py}px`,
          // Lifted while parked: the shadow falls further from the arm.
          filter: isPlaying
            ? 'drop-shadow(0 1px 1px rgba(0,0,0,0.55))'
            : 'drop-shadow(0 4px 4px rgba(0,0,0,0.5))',
        }}
      >
        {/* Counterweight, and the stub it rides on. An arm balances behind
            its pivot; drawn as a lone pill it read as a bead on a wire. */}
        <rect x={px - 21} y={py - 2.4} width={16} height={4.8} rx={2.2} fill="var(--color-brass-600)" />
        <rect x={px - 33} y={py - 7.2} width={19} height={14} rx={5} fill="var(--color-shell-700)" />
        <rect x={px - 33} y={py - 7.2} width={19} height={5} rx={2.4} fill="rgba(255,247,235,0.2)" />
        <rect x={px - 33} y={py + 2.6} width={19} height={4.2} rx={2} fill="rgba(0,0,0,0.45)" />
        {/* The knurled band a weight is adjusted by. */}
        <rect x={px - 26} y={py - 7.2} width={2.2} height={14} fill="rgba(0,0,0,0.3)" />
        <rect x={px - 22} y={py - 7.2} width={2.2} height={14} fill="rgba(0,0,0,0.3)" />

        {/* The tube. Three bands, not one fill: a cylinder lit from above has a
            bright line along the top, a mid tone and a dark underside, and it
            is their absence that made the old arm read as a strip of card.
            Tapered toward the headshell the way a real one is. */}
        <path
          d={`M ${px + 5} ${py - 6.1} L ${px + 82} ${py - 5.2}
              L ${px + 82} ${py - 1.6} L ${px + 5} ${py - 0.7} Z`}
          fill="var(--color-brass-600)"
        />
        <path
          d={`M ${px + 5} ${py - 6.1} L ${px + 82} ${py - 5.2}
              L ${px + 82} ${py - 4.2} L ${px + 5} ${py - 4.8} Z`}
          fill="rgba(255,247,235,0.38)"
        />
        <path
          d={`M ${px + 5} ${py - 1.9} L ${px + 82} ${py - 2.3}
              L ${px + 82} ${py - 1.6} L ${px + 5} ${py - 0.7} Z`}
          fill="rgba(0,0,0,0.42)"
        />

        {/* Headshell and cartridge, as one block offset across the tube's
            line. Real arms angle the cartridge to cut tracking error, and that
            kink is most of what reads as "tonearm" rather than "stick".

            Drawn as one piece deliberately. The whole business end is about
            fourteen pixels on screen; a separate headshell, cartridge and
            finger lift at that size stopped being three parts and became a
            smudge with a brass line through it. */}
        <path
          d={`M ${px + 80.9} ${py - 7.1} L ${px + 96.9} ${py - 2.7}
              L ${px + 95.2} ${py + 3.5} L ${px + 79.2} ${py - 0.9} Z`}
          fill="var(--color-shell-800)"
        />
        <path
          d={`M ${px + 80.9} ${py - 7.1} L ${px + 96.9} ${py - 2.7}
              L ${px + 96.5} ${py - 1.3} L ${px + 80.5} ${py - 5.7} Z`}
          fill="var(--color-brass-500)"
        />
        <path
          d={`M ${px + 79.2} ${py - 0.9} L ${px + 95.2} ${py + 3.5}
              L ${px + 95} ${py + 4.2} L ${px + 79} ${py - 0.2} Z`}
          fill="rgba(0,0,0,0.45)"
        />

        {/* The stylus. Its contact point is at exactly `ARM_LENGTH` along the
            arm's own axis — that is the point the geometry solves for, so
            drawing it anywhere else would put the stylus on a different groove
            than the one being computed. */}
        <path
          d={`M ${px + 96.2} ${py - 0.8} L ${px + ARM_LENGTH} ${py}
              L ${px + 95.6} ${py + 1.8} Z`}
          fill="var(--color-cream-50)"
        />

        {/* Pivot housing, drawn last so it sits over both the arm and the
            counterweight, which is how a gimbal actually looks. */}
        <circle cx={px} cy={py} r={7} fill="var(--color-shell-800)" />
        <circle cx={px} cy={py} r={7} fill="none" stroke="var(--color-brass-600)" strokeWidth={1.3} />
        <circle cx={px} cy={py} r={3} fill="var(--color-brass-400)" />
        <circle cx={px - 1.5} cy={py - 1.7} r={1} fill="rgba(255,247,235,0.5)" />
      </g>
    </svg>
  );
}
