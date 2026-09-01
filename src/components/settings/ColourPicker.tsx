import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '@/core/i18n';
import { useSettingsStore } from '@/core/settings/store';
import { CUSTOM_DEFAULTS } from '@/core/settings/themes';
import { hexToHsv, hsvToHex, hsvToRgb, luminance, parseHex, toHex, type Hsv } from '@/core/utils/colour';
import { prefersReducedMotion } from '@/core/utils/motion';
import { useSheet } from '@/core/utils/useSheet';

/**
 * The colour picker for a hand-rolled palette.
 *
 * It replaced a native `<input type="color">`. That worked, and the argument
 * for it was sound — the platform has one and people know it — but the one
 * Windows opens is a system dialog in system colours, and it landed in the
 * middle of a widget built to look like a physical object. The break was worse
 * than the reimplementation.
 *
 * A sheet over the whole window rather than a popover in the settings row: a
 * saturation square small enough to fit next to a label is not a control, it is
 * a hint at one. This takes the room it needs and gives it back.
 *
 * **The preview is the app.** Every move applies immediately, so the window
 * behind the sheet is already wearing the colour — which is a truer preview
 * than any swatch, and the reason there is no OK button to press.
 *
 * The picker holds HSV rather than reading it back out of the stored hex. Grey
 * has no hue and black has neither hue nor saturation, so a round trip through
 * a colour loses the very thing the other two controls are set to: drag the
 * value to zero and the hue bar would jump to red on the way back up.
 */

/** Hues across the grid, and the columns it is drawn in. */
const GRID_HUES = 12;

/** How long after the last change the palette starts easing again. */
const SETTLE_MS = 140;

let settling: ReturnType<typeof setTimeout> | undefined;

/**
 * Tell the document a colour is being chosen right now.
 *
 * The palette eases between colours, which is right for switching a theme and
 * wrong here: this applies on every frame of a drag, so a 220ms ease would
 * leave the window trailing the cursor. `styles.css` reads this attribute and
 * drops the duration to zero while it is set.
 *
 * Every control funnels through `apply` and `typeHex`, so marking it there
 * covers the saturation square, the hue bar, the sliders and the hex field
 * without any of them knowing about it. It clears itself a moment after the
 * last change, so letting go of the mouse hands the easing back.
 */
function markPicking(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.picking = 'live';
  clearTimeout(settling);
  settling = setTimeout(() => {
    delete document.documentElement.dataset.picking;
  }, SETTLE_MS);
}

/** How long the body takes to grow or shrink between two tabs. */
const RESIZE_MS = 220;

interface ColourPickerProps {
  /**
   * Which of the custom palette's two colours is being edited, or null while
   * the sheet is closed — it stays mounted so that it can animate out.
   */
  editing: 'primary' | 'secondary' | null;
  onClose: () => void;
}

type Tab = 'grid' | 'spectrum' | 'sliders';

export function ColourPicker({ editing, onClose }: ColourPickerProps) {
  const t = useT();
  // Null until someone has chosen one, the same fallback the settings panel
  // and `applyToDocument` make: a palette nobody has edited starts at Espresso,
  // so the first move here is an edit rather than a blank.
  const customPrimary = useSettingsStore((s) => s.customPrimary ?? CUSTOM_DEFAULTS.primary);
  const customSecondary = useSettingsStore((s) => s.customSecondary ?? CUSTOM_DEFAULTS.secondary);
  const setCustomColour = useSettingsStore((s) => s.setCustomColour);

  const { present, shown } = useSheet(editing !== null);
  /** Which colour the sheet is showing, which outlives the one it is for. */
  const [showing, setShowing] = useState<'primary' | 'secondary'>(editing ?? 'primary');

  const [tab, setTab] = useState<Tab>('spectrum');
  const [hsv, setHsv] = useState<Hsv>({ h: 0, s: 0, v: 0 });
  /** What the hex field shows while it is being typed in. */
  const [typed, setTyped] = useState<string | null>(null);
  /** What `editing` was last render, so an opening can be noticed during this one. */
  const [wasEditing, setWasEditing] = useState(editing);

  // Seeded at the opening, adjusted during render rather than in an effect.
  //
  // This used to be a `key` on the element, which remounts and makes the state
  // initialisers do the job — tidy, and it quietly destroyed the instance that
  // was meant to animate the sheet closed. The seeding stays here so the sheet
  // can outlive its own `editing` prop.
  if (editing !== wasEditing) {
    setWasEditing(editing);
    if (editing) {
      setShowing(editing);
      setHsv(
        hexToHsv(editing === 'secondary' ? customSecondary : customPrimary) ?? { h: 0, s: 0, v: 0 },
      );
      setTab('spectrum');
      setTyped(null);
    }
  }

  const bodyRef = useRef<HTMLDivElement | null>(null);
  /**
   * How tall the body was when the tab was last changed.
   *
   * Recorded at the click rather than measured afterwards: by the time an
   * effect runs React has already committed the new tab, so measuring "from"
   * there measures the destination. Same trap the collapse animation fell into.
   */
  const cameFrom = useRef<number | null>(null);

  // Escape closes it, like the other two sheets. Capture phase and
  // `stopImmediatePropagation`, for their reason: the shell has its own
  // listener on `window`, and only the immediate variant reaches it.
  useEffect(() => {
    // Only while it is open. This component stays mounted so it can animate
    // out, and an always-listening handler swallowed every Escape in the app —
    // the station's sheet and the playlist picker could not be closed at all.
    if (!editing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [editing, onClose]);

  // The sheet grows and shrinks between tabs rather than jumping: the grid is
  // twice the height of the sliders, and a dialog that changes size under the
  // pointer reads as a different dialog.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const from = cameFrom.current;
    cameFrom.current = null;
    if (!body || from === null || prefersReducedMotion()) return;

    const to = body.getBoundingClientRect().height;
    if (Math.abs(to - from) < 1) return;
    body.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: RESIZE_MS,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    });
  }, [tab]);

  function changeTab(next: Tab) {
    cameFrom.current = bodyRef.current?.getBoundingClientRect().height ?? null;
    setTab(next);
  }

  const hex = hsvToHex(hsv);

  function apply(next: Hsv) {
    markPicking();
    setHsv(next);
    setTyped(null);
    setCustomColour(showing, hsvToHex(next));
  }

  function typeHex(text: string) {
    markPicking();
    setTyped(text);
    const rgb = parseHex(text);
    // Only when it is a whole colour. Half a hex code is not a request to
    // repaint the window, and treating it as one flashes through nonsense on
    // the way to whatever someone is pasting.
    if (!rgb) return;
    setHsv(hexToHsv(toHex(rgb)) ?? hsv);
    setCustomColour(showing, toHex(rgb));
  }

  if (!present) return null;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onClose}
        className={`absolute inset-0 cursor-default bg-shell-900/70 backdrop-blur-[2px] transition-opacity duration-[180ms] ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div
        role="dialog"
        aria-label={t('colour.dialog')}
        className={`groove-surface relative flex max-h-full w-full flex-col overflow-hidden rounded-lg ring-1 ring-shell-600 transition-all duration-[180ms] ease-out ${
          shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-[0.97] opacity-0'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between px-3 pt-2.5 pb-2">
          <span className="text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
                {showing === 'primary' ? t('settings.customPrimary') : t('settings.customSecondary')}
          </span>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
          >
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex shrink-0 gap-1 px-3 pb-2">
          {(['grid', 'spectrum', 'sliders'] as const).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={tab === id}
              onClick={() => changeTab(id)}
              className={`flex-1 rounded px-2 py-1 text-meta tracking-wide transition-colors ${
                tab === id
                  ? 'bg-shell-600 text-cream-50'
                  : 'text-cream-400 hover:bg-shell-700 hover:text-cream-200'
              }`}
            >
              {t(`colour.${id}` as 'colour.grid')}
            </button>
          ))}
        </div>

        {/* `overflow-hidden` so the growing half of the move clips rather than
            spilling, and the body owns its own height so animating it does not
            fight the flex column above and below. */}
        <div ref={bodyRef} className="shrink-0 overflow-hidden px-3">
          {tab === 'grid' && <Grid onPick={apply} />}
          {tab === 'spectrum' && <Spectrum hsv={hsv} onChange={apply} />}
          {tab === 'sliders' && <Sliders hsv={hsv} onChange={apply} />}
        </div>

        {/* Under every tab rather than inside one: hex is how a colour arrives
            from somewhere else, and hunting for the tab that accepts it is the
            kind of thing that makes a picker feel like a form. */}
        <div className="flex shrink-0 items-center gap-2 px-3 pt-2 pb-3">
          <span
            aria-hidden="true"
            className="h-8 w-8 shrink-0 rounded ring-1 ring-shell-600"
            style={{ background: hex }}
          />
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 text-meta text-cream-400">{t('colour.hex')}</span>
            <input
              value={typed ?? hex}
              onChange={(e) => typeHex(e.target.value)}
              onBlur={() => setTyped(null)}
              spellCheck={false}
              autoComplete="off"
              // The value is a hex code in any language, and Turkish casing
              // rules on an English-looking string are exactly the trap that
              // turned this app's own name into GROOVİUM once.
              lang="en"
              className="groove-inset min-w-0 flex-1 rounded px-2 py-1 font-mono text-meta text-cream-50 outline-none ring-1 ring-shell-600 focus:ring-brass-500"
            />
          </label>
        </div>
      </div>
    </div>
  );
}

/**
 * A fixed set of colours, for picking one without aiming at anything.
 *
 * Generated rather than listed: a hand-written table of 132 hex codes is 132
 * chances to typo a colour nobody would ever notice was wrong. The columns are
 * evenly spaced hues and the rows walk from dark through vivid to pale, which
 * is the shape the greyscale strip above them completes.
 */
function Grid({ onPick }: { onPick: (hsv: Hsv) => void }) {
  const t = useT();
  const rows: Hsv[][] = [];

  // Greys first, as their own row: they are what the shell of a dark palette
  // is mostly made of, and they are unreachable from a hue grid.
  rows.push(
    Array.from({ length: GRID_HUES }, (_, i) => ({
      h: 0,
      s: 0,
      v: 100 - (i * 100) / (GRID_HUES - 1),
    })),
  );

  // Dark to vivid, then vivid to pale.
  const steps: Array<{ s: number; v: number }> = [
    { s: 100, v: 30 }, { s: 100, v: 45 }, { s: 100, v: 60 }, { s: 100, v: 78 }, { s: 100, v: 100 },
    { s: 78, v: 100 }, { s: 58, v: 100 }, { s: 40, v: 100 }, { s: 24, v: 100 }, { s: 12, v: 100 },
  ];
  for (const step of steps) {
    rows.push(
      Array.from({ length: GRID_HUES }, (_, i) => ({ h: (i * 360) / GRID_HUES, ...step })),
    );
  }

  return (
    <div className="space-y-[2px] pb-1" role="group" aria-label={t('colour.grid')}>
      {rows.map((row, y) => (
        <div key={y} className="flex gap-[2px]">
          {row.map((cell, x) => {
            const colour = hsvToHex(cell);
            return (
              <button
                key={x}
                type="button"
                aria-label={colour}
                title={colour}
                onClick={() => onPick(cell)}
                style={{ background: colour }}
                className="h-[18px] flex-1 rounded-[2px] transition-transform hover:scale-110"
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** The saturation/value square and the hue bar under it. */
function Spectrum({ hsv, onChange }: { hsv: Hsv; onChange: (hsv: Hsv) => void }) {
  const t = useT();
  const marker = luminance(hsvToRgb(hsv)) > 0.45 ? '#000' : '#fff';

  return (
    <div className="space-y-2 pb-1">
      <Field
        label={t('colour.field')}
        // Two gradients over one hue: white to the pure colour across, and
        // black up from the bottom. Every colour of that hue is somewhere in
        // the square, which is what makes it pickable by eye rather than by
        // number.
        style={{
          background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`,
        }}
        onPick={(x, y) => onChange({ ...hsv, s: x * 100, v: (1 - y) * 100 })}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
          style={{
            left: `${hsv.s}%`,
            top: `${100 - hsv.v}%`,
            // Flipped against what is under it, so it never disappears into
            // the corner it is sitting in.
            color: marker,
            boxShadow: `0 0 0 2px ${marker}, 0 1px 3px rgba(0,0,0,0.5)`,
            borderColor: 'transparent',
          }}
        />
      </Field>

      <Field
        label={t('colour.hue')}
        className="h-4 rounded-full"
        style={{
          background:
            'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
        }}
        onPick={(x) => onChange({ ...hsv, h: x * 360 })}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 h-5 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cream-50 shadow-[0_1px_3px_rgba(0,0,0,0.6)] ring-1 ring-shell-900/40"
          style={{ left: `${(hsv.h / 360) * 100}%` }}
        />
      </Field>
    </div>
  );
}

/**
 * A draggable surface, one or two dimensional.
 *
 * Pointer capture for the reason the scrubber uses it: a drag that leaves the
 * control still belongs to it, and letting go outside must not strand the
 * handle mid-move.
 */
function Field({
  label,
  style,
  className = 'h-[132px] rounded',
  onPick,
  children,
}: {
  label: string;
  style: React.CSSProperties;
  className?: string;
  onPick: (x: number, y: number) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  function at(e: React.PointerEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const x = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    const y = Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1);
    onPick(x, y);
  }

  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        at(e);
      }}
      onPointerMove={(e) => {
        if (dragging.current) at(e);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      className={`relative w-full touch-none ring-1 ring-shell-600 ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

/**
 * The same colour as three numbers.
 *
 * Native ranges, unlike the two above: there is no drawn fill to line up with a
 * thumb here — the reason the progress bar had to stop using one — and in
 * exchange the keyboard gets the whole picker for free. The square and the hue
 * bar are pointer-only, so this tab is the way in without a mouse.
 */
function Sliders({ hsv, onChange }: { hsv: Hsv; onChange: (hsv: Hsv) => void }) {
  const t = useT();
  const pure = hsvToHex({ h: hsv.h, s: 100, v: 100 });

  return (
    <div className="space-y-2.5 pb-1">
      <Range
        label={t('colour.hue')}
        value={hsv.h}
        max={360}
        onChange={(h) => onChange({ ...hsv, h })}
        track="linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)"
      />
      <Range
        label={t('colour.saturation')}
        value={hsv.s}
        max={100}
        onChange={(s) => onChange({ ...hsv, s })}
        track={`linear-gradient(to right, ${hsvToHex({ h: hsv.h, s: 0, v: hsv.v })}, ${hsvToHex({ h: hsv.h, s: 100, v: hsv.v })})`}
      />
      <Range
        label={t('colour.brightness')}
        value={hsv.v}
        max={100}
        onChange={(v) => onChange({ ...hsv, v })}
        track={`linear-gradient(to right, #000, ${pure})`}
      />
    </div>
  );
}

function Range({
  label,
  value,
  max,
  onChange,
  track,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
  track: string;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-meta text-cream-200">{label}</span>
        <span className="text-meta tabular-nums text-cream-400">{Math.round(value)}</span>
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={Math.round(value)}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ background: track }}
        className="groove-range mt-1 h-3 w-full cursor-pointer appearance-none rounded-full ring-1 ring-shell-600"
      />
    </label>
  );
}
