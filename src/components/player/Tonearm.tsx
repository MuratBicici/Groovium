import { useIsPlaying, useProgressFraction } from '@/core/store';
import { prefersReducedMotion } from '@/core/utils/motion';
import {
  ARM_LENGTH,
  BOX,
  INNER_GROOVE,
  OUTER_GROOVE,
  PARK_RADIUS,
  PIVOT_X,
  PIVOT_Y,
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
 * It subscribes to progress **itself**, deliberately. `DiskPlatter` reads only
 * playback state and the current track, so it does not re-render on the four
 * progress ticks a second; feeding the arm from up there would have re-rendered
 * both un-memoised discs underneath it at 4Hz for the sake of a fifth of a
 * degree.
 */
export function Tonearm() {
  const isPlaying = useIsPlaying();
  const progress = useProgressFraction();

  const radius = isPlaying
    ? OUTER_GROOVE + (INNER_GROOVE - OUTER_GROOVE) * progress
    : PARK_RADIUS;
  const angle = angleForRadius(radius);

  return (
    <svg
      viewBox={`0 0 ${BOX} ${BOX}`}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <g
        style={{
          // A CSS transform rather than the SVG attribute, so one mechanism
          // owns the angle. `view-box` makes the origin resolve in viewBox
          // units, which is what the pivot coordinates above are in.
          transform: `rotate(${angle.toFixed(2)}deg)`,
          transformBox: 'view-box',
          // One duration for two very different moves. Cueing on and off the
          // record is ~22 degrees and reads as a deliberate drop; tracking is a
          // fifth of a degree every 250ms and just needs smoothing. A slower
          // transition would spend its life chasing the progress ticks.
          transition: prefersReducedMotion() ? 'none' : 'transform 300ms ease-out',
          transformOrigin: `${PIVOT_X}px ${PIVOT_Y}px`,
          // Lifted while parked: the shadow falls further from the arm.
          filter: isPlaying
            ? 'drop-shadow(0 1px 1px rgba(0,0,0,0.55))'
            : 'drop-shadow(0 4px 4px rgba(0,0,0,0.5))',
        }}
      >
        {/* Counterweight, behind the pivot — what an arm balances with, and
            the detail whose absence made the old one read as a stick. */}
        <rect
          x={PIVOT_X - 31}
          y={PIVOT_Y - 5.5}
          width={17}
          height={11}
          rx={5.5}
          fill="var(--color-shell-700)"
        />
        <rect
          x={PIVOT_X - 31}
          y={PIVOT_Y - 5.5}
          width={17}
          height={4}
          rx={2}
          fill="rgba(255,247,235,0.10)"
        />
        <rect
          x={PIVOT_X - 14}
          y={PIVOT_Y - 2}
          width={5}
          height={4}
          rx={1}
          fill="var(--color-brass-600)"
        />

        {/* Arm tube: tapers toward the headshell the way a real one does. */}
        <path
          d={`M ${PIVOT_X + 4} ${PIVOT_Y - 2.4}
              L ${PIVOT_X + ARM_LENGTH - 16} ${PIVOT_Y - 1.5}
              L ${PIVOT_X + ARM_LENGTH - 16} ${PIVOT_Y + 1.5}
              L ${PIVOT_X + 4} ${PIVOT_Y + 2.4} Z`}
          fill="var(--color-brass-500)"
        />
        <path
          d={`M ${PIVOT_X + 4} ${PIVOT_Y - 2.4}
              L ${PIVOT_X + ARM_LENGTH - 16} ${PIVOT_Y - 1.5}
              L ${PIVOT_X + ARM_LENGTH - 16} ${PIVOT_Y - 0.3}
              L ${PIVOT_X + 4} ${PIVOT_Y - 0.9} Z`}
          fill="rgba(255,247,235,0.28)"
        />

        {/* Headshell, angled down to the record like the real fitting. */}
        <path
          d={`M ${PIVOT_X + ARM_LENGTH - 17} ${PIVOT_Y - 3.2}
              L ${PIVOT_X + ARM_LENGTH - 4} ${PIVOT_Y - 1}
              L ${PIVOT_X + ARM_LENGTH - 2} ${PIVOT_Y + 3.4}
              L ${PIVOT_X + ARM_LENGTH - 15} ${PIVOT_Y + 3.4} Z`}
          fill="var(--color-shell-700)"
        />
        <path
          d={`M ${PIVOT_X + ARM_LENGTH - 17} ${PIVOT_Y - 3.2}
              L ${PIVOT_X + ARM_LENGTH - 4} ${PIVOT_Y - 1}
              L ${PIVOT_X + ARM_LENGTH - 4} ${PIVOT_Y + 0.2}
              L ${PIVOT_X + ARM_LENGTH - 17} ${PIVOT_Y - 1.8} Z`}
          fill="rgba(255,247,235,0.14)"
        />

        {/* The stylus, at exactly `ARM_LENGTH` from the pivot — this point is
            what the geometry above is solving for. */}
        <path
          d={`M ${PIVOT_X + ARM_LENGTH - 6} ${PIVOT_Y + 3.4}
              L ${PIVOT_X + ARM_LENGTH} ${PIVOT_Y + 6.4}
              L ${PIVOT_X + ARM_LENGTH - 3} ${PIVOT_Y + 3.4} Z`}
          fill="var(--color-cream-200)"
        />

        {/* Pivot housing, drawn last so it sits over both the arm and the
            counterweight, which is how a gimbal actually looks. */}
        <circle cx={PIVOT_X} cy={PIVOT_Y} r={6.5} fill="var(--color-shell-800)" />
        <circle
          cx={PIVOT_X}
          cy={PIVOT_Y}
          r={6.5}
          fill="none"
          stroke="var(--color-brass-600)"
          strokeWidth={1.2}
        />
        <circle cx={PIVOT_X} cy={PIVOT_Y} r={2.6} fill="var(--color-brass-400)" />
        <circle cx={PIVOT_X - 1.4} cy={PIVOT_Y - 1.6} r={0.9} fill="rgba(255,247,235,0.45)" />
      </g>
    </svg>
  );
}
