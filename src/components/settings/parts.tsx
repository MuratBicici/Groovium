import { useState } from 'react';
import type { Ref } from 'react';
import { useT } from '@/core/i18n';
import { NOTCHES } from '@/core/visualizer';
import { SCALES } from '@/core/settings';

/**
 * The pieces Settings is built from: the cards its rows sit in, and the
 * controls that only it uses. Shared by the shell and its pages, so a toggle in
 * Lights and one in General cannot drift apart.
 */

/**
 * Rows that belong together, on a raised card of their own.
 *
 * The shell's deepest shade under a hairline of `--color-edge`, which every
 * palette defines, so a card reads as a card on Espresso and on Sakura alike.
 */
export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-shell-900/55 p-1 ring-1 ring-[var(--color-edge)]">
      {children}
    </div>
  );
}

/** A hairline between two rows on a card. */
export function CardDivider() {
  return <div aria-hidden="true" className="mx-1.5 h-px bg-[var(--color-edge)]" />;
}

/**
 * A card with a small heading above it, or none: a page with one card needs no
 * heading over it, its name is already at the top. `aside` is a word on the
 * heading's far end — what the card is set to, where that is worth a glance.
 */
export function Group({
  title,
  aside,
  children,
}: {
  title?: string;
  aside?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1">
      {title && (
        <div className="flex items-baseline justify-between gap-2 px-1">
          <h2 className="text-label font-medium tracking-[0.16em] text-cream-400 uppercase">
            {title}
          </h2>
          {aside && <span className="truncate text-meta text-cream-400">{aside}</span>}
        </div>
      )}
      <Card>{children}</Card>
    </section>
  );
}

/**
 * A row on a card that is not a switch: a label, perhaps a line under it, and
 * a control below. Padded as `Toggle` is, so its words line up with theirs.
 */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-1 py-1">
      <div>
        <p className="text-body text-cream-200">{label}</p>
        {hint && <p className="text-meta leading-snug text-cream-400">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * What a switch opens, folded away while it is off.
 *
 * Kept mounted and folded rather than added and removed. The row template goes
 * from nothing to its content's own height, which is the one way to animate to
 * a height nobody has to measure — and `inert` takes the controls out of the
 * tab order while they are folded, so there is nothing to reach that cannot be
 * seen.
 */
export function Fold({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      inert={!open}
      aria-hidden={!open}
      className={`grid overflow-hidden transition-all duration-200 ease-out ${
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className="min-h-0">
        {/* Hung off the switch by a line down its left, as a branch of it. */}
        <div className="mx-1 mb-1.5 ml-2 flex flex-col gap-2 border-l border-shell-600 pt-1 pl-2.5">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * One way into a page of Settings: its mark, its name, and where it stands now,
 * so most visits can end on the list without opening anything.
 */
export function CategoryRow({
  icon,
  name,
  summary,
  onOpen,
  ref,
}: {
  icon: React.ReactNode;
  name: string;
  summary: string;
  onOpen: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2.5 rounded-lg bg-shell-900/55 px-2 py-1.5 text-left ring-1 ring-[var(--color-edge)] transition-shadow outline-none hover:ring-brass-500 focus-visible:ring-2 focus-visible:ring-brass-400"
    >
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brass-600/20 text-brass-400"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body text-cream-50">{name}</span>
        <span className="block truncate text-meta text-cream-400">{summary}</span>
      </span>
      <ChevronIcon direction="right" />
    </button>
  );
}

/**
 * The marks drawn in Settings, all to one rule: a 24-unit box, round ends and
 * joins, and a 2.2 stroke, so that at 12px they read as one set.
 */
function Mark({ className = 'h-3 w-3', children }: { className?: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** `>` to go into a page, `<` to come back out of it. */
export function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <Mark className={direction === 'right' ? 'h-3 w-3 text-cream-400' : 'h-3 w-3'}>
      <path d={direction === 'right' ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'} />
    </Mark>
  );
}

/** A painter's palette, for Appearance. */
export function PaletteIcon() {
  return (
    <Mark className="h-3.5 w-3.5">
      <path d="M12 3.5c-4.7 0-8.5 3.6-8.5 8.2 0 4.5 3.6 8.3 8 8.3 1.2 0 1.9-.8 1.9-1.8 0-.6-.3-1-.6-1.4-.3-.4-.5-.8-.5-1.3 0-1 .8-1.7 1.8-1.7h2c2.6 0 4.4-1.9 4.4-4.4 0-3.3-3.8-5.9-8.5-5.9z" />
      <circle cx="8" cy="11.3" r="0.6" fill="currentColor" />
      <circle cx="10.6" cy="7.6" r="0.6" fill="currentColor" />
      <circle cx="15" cy="7.9" r="0.6" fill="currentColor" />
    </Mark>
  );
}

/** A glint and a smaller one, for Lights. */
export function LightsIcon() {
  return (
    <Mark className="h-3.5 w-3.5">
      <path d="M11 3.5l1.8 4.9 4.9 1.8-4.9 1.8L11 16.9l-1.8-4.9-4.9-1.8 4.9-1.8z" />
      <path d="M18.5 15.5v5M16 18h5" />
    </Mark>
  );
}

/** Two sliders, for General. */
export function GeneralIcon() {
  return (
    <Mark className="h-3.5 w-3.5">
      <path d="M4 7.5h8M18 7.5h2M4 16.5h2M12 16.5h8" />
      <circle cx="15" cy="7.5" r="2.5" />
      <circle cx="9" cy="16.5" r="2.5" />
    </Mark>
  );
}

/** Two links of a chain, for Connections. */
export function ConnectionsIcon() {
  return (
    <Mark className="h-3.5 w-3.5">
      <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
    </Mark>
  );
}

/** A circled i, for About. */
export function AboutIcon() {
  return (
    <Mark className="h-3.5 w-3.5">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.8" r="0.5" fill="currentColor" />
    </Mark>
  );
}

/**
 * A page with a couple of lines written on it.
 *
 * Sized and drawn to the same rules as `RefreshIcon`, since the two sit in
 * matching pills one row apart and any difference between them would read as a
 * mistake rather than a distinction.
 */
export function NotesIcon() {
  return (
    <Mark>
      <path d="M6 3h12v18H6z" />
      <path d="M9.5 8.5h5M9.5 12.5h5M9.5 16.5h3" />
    </Mark>
  );
}

/**
 * A circling arrow, for the errand of looking.
 *
 * `animate-spin` while it runs, matching the spinner `TransportControls`
 * already uses — a loading indicator is information rather than decoration, so
 * it is not gated behind the reduce-motion switch the platter is.
 */
export function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <Mark className={`h-3 w-3 ${spinning ? 'animate-spin' : ''}`}>
      <path d="M20 11a8 8 0 10-.7 4.3" />
      <path d="M20 4v7h-6" />
    </Mark>
  );
}

/** The outlined pill for an errand: checking, opening a folder, reporting. */
export const ERRAND =
  'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-meta text-cream-200 ring-1 ring-[var(--color-edge)] transition-colors hover:text-cream-50 hover:ring-brass-500 disabled:opacity-60';

/**
 * One colour of a hand-rolled palette: a swatch that opens the picker.
 *
 * This was a native `<input type="color">`, on the argument that the platform
 * already has a picker and it is the one people know. True, and still the
 * wrong call here — the one Windows opens is a system dialog wearing system
 * colours, and it arrived in the middle of a widget built to look like a
 * physical object. `ColourPicker` is the replacement.
 */
export function Colour({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-brass-400"
    >
      <span
        aria-hidden="true"
        className="h-6 w-8 shrink-0 rounded ring-1 ring-[var(--color-edge)]"
        style={{ background: value }}
      />
      <span className="min-w-0 truncate text-meta text-cream-200">{label}</span>
    </button>
  );
}

/**
 * One of the edge light's dials, in notches from -4 to 4.
 *
 * Notches rather than a smooth run, because these are settled by moving one and
 * looking at the window: a handful of positions can be tried and compared, and
 * an unbroken range only invites hunting for a number that is not there.
 *
 * No figure beside it either, and the marks underneath carry no numbers. Which
 * notch it is on is worth seeing; what the notch is called is not — the answer
 * is the light.
 */
export function Slider({
  label,
  notch,
  onChange,
}: {
  label: string;
  notch: number;
  onChange: (next: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-meta text-cream-300">{label}</span>
      <SteppedRange
        min={-NOTCHES}
        max={NOTCHES}
        value={notch}
        label={label}
        valueText={notch > 0 ? `+${notch}` : String(notch)}
        onChange={onChange}
      />
      {/* One mark per notch, the middle one taller: where the slider came from
          is the thing worth being able to find again without thinking. */}
      <span aria-hidden="true" className="mt-0.5 flex items-start justify-between px-1">
        {Array.from({ length: NOTCHES * 2 + 1 }, (_, at) => (
          <span
            key={at}
            className={`w-px rounded-full ${
              at === NOTCHES ? 'h-1.5 bg-brass-500' : 'h-1 bg-shell-600'
            }`}
          />
        ))}
      </span>
    </label>
  );
}

/**
 * How large the window is drawn: one stop per size in `SCALES`.
 *
 * Unlike the edge light's dials this one says its number. A size is something
 * people think of as a number, and 110% is an answer to "how much bigger".
 */
export function ScaleSlider({
  label,
  scale,
  onChange,
}: {
  label: string;
  scale: number;
  onChange: (next: number) => void;
}) {
  // Where the thumb is while it is being moved, which is not yet the size.
  // Every stop resizes the window, and doing that under a moving thumb made
  // the window lurch through each size on the way to the one wanted — so the
  // number follows the thumb, and the window changes once, on letting go.
  const [held, setHeld] = useState<number | null>(null);
  const shown = held ?? scale;
  const at = Math.max(0, SCALES.findIndex((step) => step === shown));
  const percent = `${Math.round(shown * 100)}%`;
  const settle = () => {
    if (held !== null && held !== scale) onChange(held);
    setHeld(null);
  };
  return (
    <label className="block px-1 py-1">
      <span className="flex items-baseline justify-between">
        <span className="text-body text-cream-200">{label}</span>
        <span className="text-meta text-cream-400 tabular-nums">{percent}</span>
      </span>
      <SteppedRange
        min={0}
        max={SCALES.length - 1}
        value={at}
        label={label}
        valueText={percent}
        onChange={(stop) => setHeld(SCALES[stop] ?? 1)}
        onSettle={settle}
      />
    </label>
  );
}

/**
 * A slider with a handful of stops, whose knob glides between them.
 *
 * The native range is kept for everything it does — pointer, keyboard, what a
 * screen reader hears — but drawn invisibly over the rail; the knob on show is
 * a sibling that moves to the stop over a moment (`.groove-stepped-knob`). The
 * native thumb jumps, and on a slider of five or nine stops a jump is a knob
 * teleporting a fifth of the rail at a time.
 *
 * `onSettle` is for a change that should wait for the hand to let go.
 */
function SteppedRange({
  min,
  max,
  value,
  label,
  valueText,
  onChange,
  onSettle,
}: {
  min: number;
  max: number;
  value: number;
  label: string;
  valueText: string;
  onChange: (next: number) => void;
  onSettle?: () => void;
}) {
  const fraction = max > min ? (value - min) / (max - min) : 0;
  return (
    <span className="relative mt-1 flex h-4 items-center">
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-label={label}
        aria-valuetext={valueText}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onSettle}
        onKeyUp={onSettle}
        onBlur={onSettle}
        className="groove-range peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none opacity-0"
      />
      {/* The rail, and the ring the keyboard sees: the input itself is clear. */}
      <span
        aria-hidden="true"
        className="h-3 w-full rounded-full bg-shell-600 ring-1 ring-[var(--color-edge)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brass-400"
      />
      <span
        aria-hidden="true"
        className="groove-stepped-knob pointer-events-none absolute top-0"
        style={{ left: `calc(${fraction} * (100% - 16px))` }}
      />
    </span>
  );
}

/** One of two or more answers, none of which is the absence of the others. */
export function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex-1 rounded-full px-2 py-1 text-meta font-medium tracking-wide transition-colors ${
        active
          ? 'bg-brass-600 text-on-accent'
          : 'bg-shell-700 text-cream-200 hover:bg-shell-600 hover:text-cream-50'
      }`}
    >
      {children}
    </button>
  );
}

/** A service Groovium can use: whether it is set up, and the way to change that. */
export function Connection({
  name,
  hint,
  ready,
  onSetUp,
  onForget,
}: {
  name: string;
  hint: string;
  ready: boolean;
  onSetUp: () => void;
  onForget: () => Promise<void>;
}) {
  const t = useT();

  return (
    <div className="flex items-center gap-2 rounded-md px-1 py-1">
      <span className="min-w-0 flex-1">
        <span className="block text-body text-cream-200">{name}</span>
        <span className="block text-meta leading-snug text-cream-400">{hint}</span>
      </span>
      <span
        className={`shrink-0 text-meta ${ready ? 'text-brass-400' : 'text-cream-400/70'}`}
      >
        {ready ? t('settings.configured') : t('settings.notConfigured')}
      </span>
      <button
        type="button"
        onClick={() => (ready ? void onForget() : onSetUp())}
        className="shrink-0 rounded-full bg-shell-700 px-2 py-1 text-meta tracking-wide text-cream-200 uppercase transition-colors hover:bg-shell-600 hover:text-cream-50"
      >
        {ready ? t('settings.forget') : t('settings.setUp')}
      </button>
    </div>
  );
}
