/**
 * An on/off switch with its label and a line saying what it does.
 *
 * The whole row is the button, not just the switch: the words are the larger
 * target and the one people aim for. The knob slides with a small overshoot and
 * the track warms to brass behind it, so the change is seen as well as read.
 * With reduced motion it simply is in its new place.
 */
export function Toggle({
  label,
  hint,
  on,
  onChange,
  size = 'body',
}: {
  label: string;
  hint: string;
  on: boolean;
  onChange: (next: boolean) => void;
  /** The label's text size: `body` in Settings, `meta` in a smaller sheet. */
  size?: 'body' | 'meta';
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-shell-700/60"
    >
      <span className="min-w-0 flex-1">
        <span className={`block text-cream-200 ${size === 'body' ? 'text-body' : 'text-meta'}`}>
          {label}
        </span>
        <span
          className={`block leading-snug text-cream-400 ${size === 'body' ? 'text-meta' : 'text-label'}`}
        >
          {hint}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={`relative h-4 w-7 shrink-0 rounded-full ring-1 transition-[background-color,box-shadow] duration-200 motion-reduce:transition-none ${
          on
            ? 'bg-brass-600 shadow-[0_0_6px_rgba(224,176,113,0.35)] ring-brass-400/40'
            : 'bg-shell-600 ring-[var(--color-edge)]'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-cream-50 shadow-sm transition-transform duration-[220ms] ease-[cubic-bezier(0.3,1.45,0.55,1)] motion-reduce:transition-none ${
            on ? 'translate-x-3' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
}
