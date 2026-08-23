import { useRef, useState } from 'react';
import { useDurationMs, usePlayerStore, usePositionMs } from '@/core/store';
import { clamp, formatDuration } from '@/core/utils/time';

/**
 * Seek scrubber.
 *
 * While the user is dragging, the bar follows the pointer and ignores incoming
 * progress events — otherwise every provider tick would yank the handle back to
 * where playback still is.
 *
 * Pointer position is measured against the bar's own rectangle rather than left
 * to the range input underneath. A native range keeps its thumb inside the
 * track, so it maps values to `thumbWidth/2 … width − thumbWidth/2` while the
 * drawn fill maps `0 … width`; the two disagreed by half a thumb at each end,
 * which is why the end of a track sat a few pixels left of the right edge. The
 * input stays for the keyboard and for the slider semantics it carries, but it
 * no longer decides where a click lands.
 */
export function ProgressBar() {
  const positionMs = usePositionMs();
  const durationMs = useDurationMs();
  const seek = usePlayerStore((s) => s.seek);

  const [scrubMs, setScrubMs] = useState<number | null>(null);
  // A ref, not state: pointerup must see what pointerdown wrote in the same
  // tick, and React has no reason to have flushed a state update by then.
  // Nothing renders from it either.
  const dragging = useRef(false);
  const barRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayMs = scrubMs ?? positionMs;
  const fraction = durationMs > 0 ? Math.min(displayMs / durationMs, 1) : 0;
  const disabled = durationMs <= 0;

  function commit(value: number) {
    setScrubMs(null);
    void seek(value);
  }

  /** Where a pointer at `clientX` falls on the bar, in milliseconds. */
  function positionAt(clientX: number): number {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1) * durationMs;
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    // Capture so a drag that leaves the bar — or the window — still ends here.
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    setScrubMs(positionAt(e.clientX));
    // The input is pointer-transparent now, so clicking has to focus it by hand
    // or the arrow keys would not work after a click.
    inputRef.current?.focus();
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    setScrubMs(positionAt(e.clientX));
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragging.current = false;
    commit(positionAt(e.clientX));
  }

  return (
    <div className="px-4">
      <div
        ref={barRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`group relative flex h-4 touch-none items-center ${
          disabled ? 'cursor-default' : 'cursor-pointer'
        }`}
      >
        {/* Track */}
        <div className="groove-inset h-1 w-full overflow-hidden rounded-full">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brass-600 to-brass-400"
            style={{ width: `${fraction * 100}%` }}
          />
        </div>

        {/* Handle, shown on hover or while scrubbing. */}
        <div
          className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-cream-50 opacity-0 shadow transition-opacity group-hover:opacity-100"
          style={{ left: `${fraction * 100}%`, opacity: scrubMs !== null ? 1 : undefined }}
        />

        {/* Keyboard and assistive technology only — `pointer-events-none` keeps
            it out of the hit testing the handlers above are responsible for. */}
        <input
          ref={inputRef}
          type="range"
          min={0}
          max={Math.max(durationMs, 1)}
          step={100}
          value={displayMs}
          disabled={disabled}
          aria-label="Seek"
          onChange={(e) => setScrubMs(Number(e.target.value))}
          onKeyUp={(e) => commit(Number(e.currentTarget.value))}
          onBlur={(e) => {
            if (scrubMs !== null && !dragging.current) commit(Number(e.currentTarget.value));
          }}
          className="pointer-events-none absolute inset-x-0 h-4 w-full appearance-none bg-transparent opacity-0"
        />
      </div>

      <div className="mt-1 flex justify-between text-meta tabular-nums text-cream-400">
        <span>{formatDuration(displayMs)}</span>
        <span>{formatDuration(durationMs)}</span>
      </div>
    </div>
  );
}
