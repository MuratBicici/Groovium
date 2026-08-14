import { useState } from 'react';
import { useDurationMs, usePlayerStore, usePositionMs } from '@/core/store';
import { formatDuration } from '@/core/utils/time';

/**
 * Seek scrubber.
 *
 * While the user is dragging, the bar follows the pointer and ignores incoming
 * progress events — otherwise every provider tick would yank the handle back to
 * where playback still is.
 */
export function ProgressBar() {
  const positionMs = usePositionMs();
  const durationMs = useDurationMs();
  const seek = usePlayerStore((s) => s.seek);

  const [scrubMs, setScrubMs] = useState<number | null>(null);

  const displayMs = scrubMs ?? positionMs;
  const fraction = durationMs > 0 ? Math.min(displayMs / durationMs, 1) : 0;
  const disabled = durationMs <= 0;

  function commit(value: number) {
    setScrubMs(null);
    void seek(value);
  }

  return (
    <div className="px-4">
      <div className="group relative flex h-4 items-center">
        {/* Track */}
        <div className="h-1 w-full overflow-hidden rounded-full bg-shell-600">
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

        <input
          type="range"
          min={0}
          max={Math.max(durationMs, 1)}
          step={100}
          value={displayMs}
          disabled={disabled}
          aria-label="Seek"
          onChange={(e) => setScrubMs(Number(e.target.value))}
          onPointerUp={(e) => commit(Number(e.currentTarget.value))}
          onKeyUp={(e) => commit(Number(e.currentTarget.value))}
          onBlur={(e) => {
            if (scrubMs !== null) commit(Number(e.currentTarget.value));
          }}
          className="absolute inset-x-0 h-4 w-full cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-default"
        />
      </div>

      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-cream-400">
        <span>{formatDuration(displayMs)}</span>
        <span>{formatDuration(durationMs)}</span>
      </div>
    </div>
  );
}
