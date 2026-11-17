import { useRef } from 'react';

/** How many lights a row has: the finest step it can be set in. */
export const STEPS = 12;

/** Which of three words a level reads as. */
export const wordAt = (level: number): 0 | 1 | 2 => Math.min(2, Math.round(level * 2)) as 0 | 1 | 2;

/**
 * One setting as a row of lights, like a meter on a hi-fi: lit from the left
 * to its level, each light a little brighter than the one before. Pressed or
 * dragged across, it lights up to where the pointer is; the wheel and the
 * arrow keys move it a light at a time.
 */
export function WeatherSteps({
  label,
  words,
  level,
  dim,
  onLevel,
  onSettle,
}: {
  label: string;
  /** What the low, middle and high end are called. */
  words: readonly [string, string, string];
  level: number;
  /** Shown faded: set, but with nothing to act on just now. */
  dim?: boolean;
  onLevel: (level: number) => void;
  /** The hand has let go, or a key or the wheel has moved it. */
  onSettle: () => void;
}) {
  const row = useRef<HTMLDivElement | null>(null);
  const lit = Math.round(level * STEPS);
  const at = (x: number) => {
    const box = row.current?.getBoundingClientRect();
    if (!box) return level;
    return Math.max(0, Math.min(STEPS, Math.ceil(((x - box.left) / box.width) * STEPS))) / STEPS;
  };
  const step = (by: number) => {
    onLevel(Math.max(0, Math.min(STEPS, lit + by)) / STEPS);
    onSettle();
  };

  return (
    <div className={`groove-weather-steps ${dim ? 'is-dim' : ''}`}>
      <div className="groove-weather-steps-head">
        <span className="groove-focus-label">{label}</span>
        <span className="groove-weather-steps-word">{words[wordAt(level)]}</span>
      </div>
      <div
        ref={row}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={STEPS}
        aria-valuenow={lit}
        aria-valuetext={words[wordAt(level)]}
        className="groove-weather-steps-row"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          onLevel(at(e.clientX));
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) onLevel(at(e.clientX));
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          onSettle();
        }}
        onWheel={(e) => step(e.deltaY < 0 ? 1 : -1)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') step(1);
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') step(-1);
          else if (e.key === 'Home') step(-STEPS);
          else if (e.key === 'End') step(STEPS);
          else return;
          e.preventDefault();
        }}
      >
        {Array.from({ length: STEPS }, (_, i) => (
          <i
            key={i}
            className={i < lit ? 'is-on' : undefined}
            // How far along the row: each light a little brighter than the one before.
            style={{ ['--step' as string]: i / (STEPS - 1) }}
          />
        ))}
      </div>
    </div>
  );
}
