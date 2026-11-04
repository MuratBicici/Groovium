import { useId } from 'react';

/** The ring, from seven o'clock round to five: three quarters of a circle. */
const RING = 'M21.0 79.0 A41 41 0 1 1 79.0 79.0';

/**
 * What a knob looks like: a dark groove with brass filling it to the level, a
 * face that does not turn, and a figure on the face.
 *
 * The listener chose this from a good many, with the brass from the tonearm so
 * that it reads as part of the same machine.
 *
 * The ring is one fixed path with its length called a hundred, and the brass is
 * a dash along it, so a change of level is only a number changing and CSS can
 * carry it round by itself. \`from\` and \`to\` are how far along it, 0 to 1.
 */
export function KnobFace({
  from = 0,
  to,
  dim = false,
  needle,
  gliding = false,
}: {
  from?: number;
  to: number;
  /** Turned down to nothing and meant to look it. */
  dim?: boolean;
  /** The angle of the pointer on the face, or null for none showing. */
  needle?: number | null;
  /** Moving by itself and not under a hand, so it may take a moment over it. */
  gliding?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const start = Math.min(from, to) * 100;
  const length = Math.abs(to - from) * 100;
  const carry = gliding ? 'groove-knob-carry' : '';

  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      className={`absolute inset-0 h-full w-full transition-[filter] duration-200 ${dim ? 'saturate-[.45] brightness-90' : ''}`}
    >
      <defs>
        <linearGradient id={`${id}-face`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--color-shell-600)' }} />
          <stop offset="1" style={{ stopColor: 'var(--color-shell-800)' }} />
        </linearGradient>
        <linearGradient id={`${id}-brass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--color-brass-400)' }} />
          <stop offset="1" style={{ stopColor: 'var(--color-brass-600)' }} />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" className="fill-shell-900" />
      <path d={RING} fill="none" strokeWidth="8" className="stroke-shell-900 brightness-75" />
      <path
        d={RING}
        pathLength={100}
        fill="none"
        strokeWidth="8"
        stroke={`url(#${id}-brass)`}
        strokeDasharray={`0 ${start} ${length} 200`}
        className={carry}
      />
      <circle cx="50" cy="50" r="33" fill={`url(#${id}-face)`} />
      <circle cx="50" cy="50" r="33" fill="none" className="stroke-cream-50" strokeOpacity="0.07" />
      {needle !== undefined && (
        <line
          x1="50"
          y1="24"
          x2="50"
          y2="44"
          strokeWidth="5"
          strokeLinecap="round"
          className={`stroke-brass-400 transition-opacity duration-150 ${carry}`}
          style={{
            opacity: needle === null ? 0 : 1,
            transformOrigin: '50px 50px',
            transform: `rotate(${needle ?? 0}deg)`,
          }}
        />
      )}
    </svg>
  );
}
