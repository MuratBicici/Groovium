interface SpotifyButtonProps {
  open: boolean;
  onToggle: () => void;
  controls: string;
}

/**
 * Entry point for the Spotify panel.
 *
 * Icon-only: the bottom row already carries volume, two import buttons and the
 * queue toggle, and 340px does not leave room for a label.
 */
export function SpotifyButton({ open, onToggle, controls }: SpotifyButtonProps) {
  return (
    <button
      type="button"
      aria-label={open ? 'Close Spotify panel' : 'Open Spotify panel'}
      aria-expanded={open}
      aria-controls={controls}
      title="Spotify"
      onClick={onToggle}
      className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
        open
          ? 'bg-brass-600 text-shell-900'
          : 'bg-shell-700 text-cream-200 hover:bg-shell-600 hover:text-cream-50'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
        <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm4.4 14.5a.75.75 0 01-1.03.25c-2.82-1.72-6.37-2.11-10.55-1.16a.75.75 0 11-.33-1.46c4.57-1.04 8.5-.59 11.66 1.34a.75.75 0 01.25 1.03zm1.18-2.86a.94.94 0 01-1.29.31c-3.23-1.98-8.15-2.56-11.96-1.4a.94.94 0 11-.55-1.8c4.36-1.32 9.78-.68 13.49 1.6a.94.94 0 01.31 1.29zm.1-2.98C13.82 8.36 7.6 8.15 4.9 8.97a1.12 1.12 0 11-.65-2.15c3.1-.94 9.97-.7 14.2 1.81a1.12 1.12 0 11-1.14 1.93z" />
      </svg>
    </button>
  );
}
