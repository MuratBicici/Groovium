import { usePlayerStore, useQueue, useQueueIndex } from '@/core/store';
import { formatDuration } from '@/core/utils/time';

interface QueuePanelProps {
  open: boolean;
  onClose: () => void;
  /** Ties the panel to the button that toggles it, for screen readers. */
  id: string;
}

/**
 * The queue, as a surface that slides over the platter rather than a strip
 * wedged under it.
 *
 * At 340x480 the queue only ever had 21px of list to work with — less than one
 * 25px row. Covering the platter while open is what buys it roughly ten. The
 * transport controls stay outside this component and remain visible, so playback
 * is still controllable while browsing.
 *
 * Kept mounted when closed and hidden with opacity plus `pointer-events-none`,
 * which gives a fade-out without having to orchestrate an unmount.
 */
export function QueuePanel({ open, onClose, id }: QueuePanelProps) {
  const queue = useQueue();
  const queueIndex = useQueueIndex();
  const playAt = usePlayerStore((s) => s.playAt);
  const removeAt = usePlayerStore((s) => s.removeAt);
  const clearQueue = usePlayerStore((s) => s.clearQueue);

  return (
    <div
      id={id}
      aria-hidden={!open}
      // The platter keeps spinning underneath: a translucent, blurred ground
      // keeps the text readable without freezing the widget's only motion.
      className={`absolute inset-0 flex flex-col rounded-t-lg bg-shell-800/95 backdrop-blur-sm transition-all duration-200 ease-out ${
        open ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
      }`}
    >
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <span className="text-[9px] font-medium tracking-[0.18em] text-brass-400/80 uppercase">
          Queue · {queue.length}
        </span>

        <div className="flex items-center gap-2">
          {queue.length > 0 && (
            <button
              type="button"
              onClick={clearQueue}
              className="text-[9px] tracking-wide text-cream-400 uppercase transition-colors hover:text-brass-400"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            aria-label="Close queue"
            title="Close"
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
          >
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {queue.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4">
          <p className="text-center text-[11px] leading-relaxed text-cream-400/70">
            Queue is empty.
            <br />
            Add some audio files to start.
          </p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {queue.map((track, index) => {
            const active = index === queueIndex;
            return (
              // Position is part of the key because a queue may legitimately
              // hold the same track twice. Local files get a unique generated
              // id, but a Spotify track's id is its URI, so `track.id` alone
              // collides the moment a song is queued again.
              <li key={`${track.id}:${index}`} className="group/row relative">
                <button
                  type="button"
                  onClick={() => void playAt(index)}
                  className={`flex w-full items-center gap-2 rounded-md py-1 pr-7 pl-2 text-left transition-colors ${
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

                {/* Sits outside the row button — nesting buttons is invalid HTML
                    and would make the whole row unclickable in some browsers. */}
                <button
                  type="button"
                  aria-label={`Remove ${track.title}`}
                  title="Remove"
                  onClick={() => void removeAt(index)}
                  className="absolute top-1/2 right-1 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-cream-400 opacity-0 transition-all group-hover/row:opacity-100 hover:bg-shell-600 hover:text-red-300 focus-visible:opacity-100"
                >
                  <svg viewBox="0 0 10 10" className="h-2 w-2" aria-hidden="true">
                    <path
                      d="M1 1l8 8M9 1l-8 8"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
