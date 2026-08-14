const ICONS: Record<string, React.ReactNode> = {
  Library: (
    <>
      <path d="M4 5v14M8 5v14M12 6l6 13" strokeLinecap="round" />
    </>
  ),
  Playlists: (
    <>
      <path d="M4 7h11M4 12h11M4 17h7" strokeLinecap="round" />
      <path d="M18 12v7l4-3.5z" fill="currentColor" stroke="none" />
    </>
  ),
  Spotify: (
    <path
      d="M12 2a10 10 0 100 20 10 10 0 000-20zm4.4 14.5a.75.75 0 01-1.03.25c-2.82-1.72-6.37-2.11-10.55-1.16a.75.75 0 11-.33-1.46c4.57-1.04 8.5-.59 11.66 1.34a.75.75 0 01.25 1.03zm1.18-2.86a.94.94 0 01-1.29.31c-3.23-1.98-8.15-2.56-11.96-1.4a.94.94 0 11-.55-1.8c4.36-1.32 9.78-.68 13.49 1.6a.94.94 0 01.31 1.29zm.1-2.98C13.82 8.36 7.6 8.15 4.9 8.97a1.12 1.12 0 11-.65-2.15c3.1-.94 9.97-.7 14.2 1.81a1.12 1.12 0 11-1.14 1.93z"
      fill="currentColor"
      stroke="none"
    />
  ),
};

interface PanelButtonProps {
  label: keyof typeof ICONS | string;
  open: boolean;
  onToggle: () => void;
  controls: string;
}

/**
 * Opens one of the stage overlays.
 *
 * Icon-only: three of these plus the volume knob is already most of a 340px
 * row, and the tooltip carries the name.
 */
export function PanelButton({ label, open, onToggle, controls }: PanelButtonProps) {
  return (
    <button
      type="button"
      aria-label={open ? `Close ${label} panel` : `Open ${label} panel`}
      aria-expanded={open}
      aria-controls={controls}
      title={label}
      onClick={onToggle}
      className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
        open
          ? 'bg-brass-600 text-shell-900'
          : 'bg-shell-700 text-cream-200 hover:bg-shell-600 hover:text-cream-50'
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        {ICONS[label] ?? ICONS.Library}
      </svg>
    </button>
  );
}
