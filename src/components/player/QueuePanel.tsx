import { usePlayerStore, useQueue, useQueueIndex } from '@/core/store';
import { formatDuration } from '@/core/utils/time';

/** Compact queue list. Clicking a row jumps straight to that track. */
export function QueuePanel() {
  const queue = useQueue();
  const queueIndex = useQueueIndex();
  const playAt = usePlayerStore((s) => s.playAt);

  if (queue.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <p className="text-center text-[11px] leading-relaxed text-cream-400/70">
          Queue is empty.
          <br />
          Add some audio files to start.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex-1 overflow-y-auto px-2 pb-1">
      {queue.map((track, index) => {
        const active = index === queueIndex;
        return (
          <li key={track.id}>
            <button
              type="button"
              onClick={() => void playAt(index)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors ${
                active ? 'bg-shell-700 text-brass-400' : 'text-cream-200 hover:bg-shell-700/60'
              }`}
            >
              <span className="w-4 shrink-0 text-[10px] tabular-nums text-cream-400">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px]">{track.title}</span>
              <span className="shrink-0 text-[10px] tabular-nums text-cream-400">
                {formatDuration(track.duration)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
