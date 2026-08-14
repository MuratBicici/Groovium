import { useQueue } from '@/core/store';

interface QueueToggleButtonProps {
  open: boolean;
  onToggle: () => void;
  /** Id of the panel this controls. */
  controls: string;
}

/**
 * Opens and closes the queue panel.
 *
 * Carries the track count so the queue's size is legible without opening it —
 * the panel covers the platter, so it is not something to leave open.
 */
export function QueueToggleButton({ open, onToggle, controls }: QueueToggleButtonProps) {
  const queue = useQueue();

  return (
    <button
      type="button"
      aria-label={open ? 'Close queue' : 'Open queue'}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-medium tracking-wide uppercase transition-colors ${
        open
          ? 'bg-brass-600 text-shell-900'
          : 'bg-shell-700 text-cream-200 hover:bg-shell-600 hover:text-cream-50'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M4 7h11M4 12h11M4 17h7" strokeLinecap="round" />
        <path d="M18 12v7l4-3.5z" fill="currentColor" stroke="none" />
      </svg>
      {queue.length > 0 && <span className="tabular-nums">{queue.length}</span>}
    </button>
  );
}
