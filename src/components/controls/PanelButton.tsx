import { useT } from '@/core/i18n';

/**
 * Which overlay a button opens.
 *
 * The id and the label used to be the same string — `label="Library"` picked
 * both the icon and the text. That works until the text is translated, at which
 * point the icon lookup starts missing in Turkish and every button turns into
 * the library. The id is the id now; the label is looked up from it.
 */
export type PanelId = 'library' | 'playlists' | 'spotify' | 'settings';

const ICONS: Record<PanelId, React.ReactNode> = {
  library: <path d="M4 5v14M8 5v14M12 6l6 13" strokeLinecap="round" />,
  playlists: (
    <>
      <path d="M4 7h11M4 12h11M4 17h7" strokeLinecap="round" />
      <path d="M18 12v7l4-3.5z" fill="currentColor" stroke="none" />
    </>
  ),
  spotify: (
    <path
      d="M12 2a10 10 0 100 20 10 10 0 000-20zm4.4 14.5a.75.75 0 01-1.03.25c-2.82-1.72-6.37-2.11-10.55-1.16a.75.75 0 11-.33-1.46c4.57-1.04 8.5-.59 11.66 1.34a.75.75 0 01.25 1.03zm1.18-2.86a.94.94 0 01-1.29.31c-3.23-1.98-8.15-2.56-11.96-1.4a.94.94 0 11-.55-1.8c4.36-1.32 9.78-.68 13.49 1.6a.94.94 0 01.31 1.29zm.1-2.98C13.82 8.36 7.6 8.15 4.9 8.97a1.12 1.12 0 11-.65-2.15c3.1-.94 9.97-.7 14.2 1.81a1.12 1.12 0 11-1.14 1.93z"
      fill="currentColor"
      stroke="none"
    />
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path
        d="M12 2.8l1.4 2.3 2.7-.5.5 2.7 2.3 1.4-1.4 2.3 1.4 2.3-2.3 1.4-.5 2.7-2.7-.5L12 21.2l-1.4-2.3-2.7.5-.5-2.7-2.3-1.4L6.5 13 5.1 10.7l2.3-1.4.5-2.7 2.7.5z"
        strokeLinejoin="round"
      />
    </>
  ),
};

interface PanelButtonProps {
  panel: PanelId;
  open: boolean;
  onToggle: () => void;
  controls: string;
  /**
   * A mark saying there is something inside worth opening for.
   *
   * A dot rather than a count or a word: this row is icon-only because four
   * buttons and a volume knob are most of a 340px window, and anything with
   * text in it would have to resize when the language changes.
   */
  badge?: string | undefined;
}

/**
 * Opens one of the stage overlays.
 *
 * Icon-only: four of these plus the volume knob is most of a 340px row, and the
 * tooltip carries the name — which also means the row does not resize when the
 * language changes, since none of these labels are drawn.
 */
export function PanelButton({ panel, open, onToggle, controls, badge }: PanelButtonProps) {
  const t = useT();
  const name = t(`panel.${panel}`);

  return (
    <button
      type="button"
      // The badge joins the label rather than being drawn and left unsaid: a
      // dot is not something a screen reader can report on its own.
      aria-label={`${open ? t('panel.close', { name }) : t('panel.open', { name })}${
        badge ? ` — ${badge}` : ''
      }`}
      aria-expanded={open}
      aria-controls={controls}
      title={badge ? `${name} — ${badge}` : name}
      onClick={onToggle}
      className={`relative flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
        open
          ? 'bg-brass-600 text-on-accent'
          : 'bg-shell-700 text-cream-200 hover:bg-shell-600 hover:text-cream-50'
      }`}
    >
      {badge && (
        <span
          aria-hidden="true"
          // Ringed in the shell's own colour so it reads as sitting on top of
          // the button rather than as part of its edge.
          className="absolute -top-px -right-px h-2 w-2 rounded-full bg-brass-400 ring-2 ring-shell-900"
        />
      )}
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        {ICONS[panel]}
      </svg>
    </button>
  );
}
