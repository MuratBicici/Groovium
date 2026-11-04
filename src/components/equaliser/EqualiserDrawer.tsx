import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EQ_BANDS,
  EQ_FLAT,
  EQ_MOST,
  EQ_NAME_MOST,
  EQ_PRESETS,
  EQ_SAVED_MOST,
  cleanName,
  heldDb,
  isTaken,
  presetOf,
  sameBands,
} from '@/core/equaliser';
import { useT } from '@/core/i18n';
import { useSettingsStore } from '@/core/settings/store';
import { prefersReducedMotion } from '@/core/utils/motion';
import { pacer } from '@/core/utils/pace';
import { DRAWER_WIDTH } from '@/platform/window';

/** The screen's own coordinates, the width of the drawer inside its margins. */
const WIDE = 640;
const TALL = 312;
/** Room inside the screen for the scale on the left and the names along the foot. */
const LEFT = 34;
const RIGHT = 14;
const TOP = 16;
const FOOT = 30;

const COLUMN = (WIDE - LEFT - RIGHT) / EQ_BANDS.length;
const ZERO = (TALL - FOOT + TOP) / 2;
const REACH = (TALL - FOOT - TOP) / 2 - 4;

const xOf = (at: number) => LEFT + COLUMN * (at + 0.5);
const yOf = (db: number) => ZERO - (db / EQ_MOST) * REACH;
const dbAt = (y: number) => ((ZERO - y) / REACH) * EQ_MOST;

/** The lines across the screen, and the numbers beside them. */
const SCALE = [12, 6, 0, -6, -12];

/** How long a change takes to cross from one band to the next. */
const WAVE_STEP_MS = 38;
/** How fast each dot closes on where it is going, per second. */
const SETTLE_RATE = 11;
/** How fast a dot's flash goes out, per second. */
const FLASH_FADE = 3.2;
/** How wide a flash opens as it goes out, from just behind the dot. */
const FLASH_FROM = 6;
const FLASH_OPENS = 10;
/** The drawer opening: a moment for it to arrive, then the dots, a little slower than a wave. */
const ARRIVE_WAIT_MS = 120;
const ARRIVE_STEP_MS = 45;
/** How fast a dot comes up from dark as it arrives, per second. */
const LIGHT_RATE = 9;

/** How far the input knob turns either way, and how far the pointer goes per decibel. */
const KNOB_TURN = 135;
const KNOB_PX_PER_DB = 6;

/** The line through the dots, carried level to both sides of the screen. */
function curvePath(values: readonly number[]): string {
  let path = `M${LEFT} ${yOf(values[0] ?? 0)} L${xOf(0)} ${yOf(values[0] ?? 0)}`;
  for (let at = 1; at < values.length; at++) {
    const [before, now] = [yOf(values[at - 1] ?? 0), yOf(values[at] ?? 0)];
    path += ` C${xOf(at - 1) + COLUMN / 2} ${before} ${xOf(at) - COLUMN / 2} ${now} ${xOf(at)} ${now}`;
  }
  return `${path} L${WIDE - RIGHT} ${yOf(values[values.length - 1] ?? 0)}`;
}

const signed = (db: number) => (db > 0 ? `+${db}` : String(db));

/**
 * How the next change moves: every dot in turn and lit, the dots that move in
 * turn and lit, or in turn and quietly. A hand on a dot is none of these.
 */
type Crossing = 'all' | 'changed' | 'quiet' | null;

/**
 * The equaliser, in the drawer: one curve through ten dots, on a screen.
 *
 * A dot is dragged up or down. A setting chosen crosses the curve from left to
 * right, and each dot flashes once as the change reaches it; the listener asked
 * for that and nothing more, having been shown a good deal more. It draws only
 * while something is moving, and stands still otherwise.
 *
 * The first version had the curve loose on the drawer and the browser's own
 * slider underneath it, and the listener said it felt cheap and that it floated.
 * So it sits in a recess with its scale drawn in, as the deck's other surfaces
 * do, and the input is the same knob as the volume beside the deck.
 *
 * Drawn straight onto the elements rather than through React, since a change is
 * a second of frames with nothing else in the page changing.
 */
export function EqualiserDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const on = useSettingsStore((s) => s.equaliserOn);
  const bands = useSettingsStore((s) => s.equaliserBands);
  const preamp = useSettingsStore((s) => s.equaliserPreamp);
  const saved = useSettingsStore((s) => s.equaliserSaved);
  const setOn = useSettingsStore((s) => s.setEqualiserOn);
  const setBands = useSettingsStore((s) => s.setEqualiserBands);
  const setPreamp = useSettingsStore((s) => s.setEqualiserPreamp);

  const [grabbed, setGrabbed] = useState<number | null>(null);
  /** The band the reading is of, kept after the release while it fades. */
  const [read, setRead] = useState(0);
  const reveal = useRef<SVGRectElement | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const line = useRef<SVGPathElement | null>(null);
  const fill = useRef<SVGPathElement | null>(null);
  const dots = useRef<(SVGCircleElement | null)[]>([]);
  const flashes = useRef<(SVGCircleElement | null)[]>([]);

  const shown = on ? bands : EQ_FLAT;
  /**
   * Whether the next change crosses the curve. Said by whoever makes it, and not
   * worked out from whether a dot is held: the last small change of a drag can
   * arrive just after the release, and taken for a setting chosen, the dot went
   * back to where it had been, waited its turn in the wave, and flashed.
   */
  const crossing = useRef<Crossing>(prefersReducedMotion() ? null : 'all');
  /** Where the dots are this frame, how lit each is, and when each may start. */
  const motion = useRef({
    // From flat and dark as the drawer opens, unless nothing here is to move.
    now: prefersReducedMotion() ? [...shown] : [...EQ_FLAT],
    goal: prefersReducedMotion() ? [...shown] : [...EQ_FLAT],
    lit: EQ_BANDS.map((): number => (prefersReducedMotion() ? 1 : 0)),
    /** How far along the line has been drawn, and when it started. */
    drawn: prefersReducedMotion() ? WIDE : LEFT,
    drawFrom: 0,
    flash: EQ_BANDS.map(() => 0),
    startAt: EQ_BANDS.map(() => 0),
    pending: EQ_BANDS.map(() => false),
    /** The band the pointer has hold of. */
    grabbed: null as number | null,
    frame: 0,
    last: 0,
  });

  const paint = useCallback(() => {
    const { now, flash, lit, drawn } = motion.current;
    const path = curvePath(now);
    reveal.current?.setAttribute('width', String(drawn));
    line.current?.setAttribute('d', path);
    fill.current?.setAttribute('d', `${path} L${WIDE - RIGHT} ${ZERO} L${LEFT} ${ZERO} Z`);
    now.forEach((db, at) => {
      const y = String(yOf(db));
      const dot = dots.current[at];
      dot?.setAttribute('cy', y);
      dot?.setAttribute('opacity', String(lit[at] ?? 1));
      const halo = flashes.current[at];
      const glow = flash[at] ?? 0;
      halo?.setAttribute('cy', y);
      halo?.setAttribute('r', String(FLASH_FROM + (1 - glow) * FLASH_OPENS));
      halo?.setAttribute('opacity', String(glow * 0.5));
    });
  }, []);

  const start = useCallback(() => {
    const state = motion.current;
    if (state.frame) return;
    const due = pacer();
    state.last = performance.now();
    const step = (time: number) => {
      state.frame = 0;
      if (due(time)) {
        const seconds = Math.min(0.05, (time - state.last) / 1000);
        state.last = time;
        state.now.forEach((db, at) => {
          const goal = state.goal[at] ?? 0;
          if (time >= (state.startAt[at] ?? 0)) {
            if (state.pending[at]) {
              state.pending[at] = false;
              state.flash[at] = 1;
            }
            state.lit[at] = Math.min(1, (state.lit[at] ?? 1) + seconds * LIGHT_RATE);
            const close = 1 - Math.exp(-seconds * SETTLE_RATE);
            const next = db + (goal - db) * close;
            state.now[at] = Math.abs(goal - next) < 0.02 ? goal : next;
          }
          state.flash[at] = Math.max(0, (state.flash[at] ?? 0) - seconds * FLASH_FADE);
        });
        if (state.drawn < WIDE) {
          // Keeping just ahead of the dot arriving, so the line leads to it.
          const along = (time - state.drawFrom) / ARRIVE_STEP_MS;
          state.drawn = along < 0 ? LEFT : Math.min(WIDE, LEFT + (along + 0.5) * COLUMN);
        }
        paint();
      }
      const moving =
        state.now.some((db, at) => db !== state.goal[at]) ||
        state.flash.some((glow) => glow > 0) ||
        state.lit.some((lit) => lit < 1) ||
        state.drawn < WIDE ||
        state.pending.some(Boolean);
      if (moving) state.frame = requestAnimationFrame(step);
    };
    state.frame = requestAnimationFrame(step);
  }, [paint]);

  useEffect(() => {
    const state = motion.current;
    return () => {
      if (state.frame) cancelAnimationFrame(state.frame);
      state.frame = 0;
    };
  }, []);

  // A new goal, or the switch moved. A setting chosen crosses the curve and the
  // dots with somewhere to go light up; the drawer opening or the switch going
  // on lights them all in turn, and going off takes them down quietly. Anything
  // else is a hand on a dot, which goes exactly where it is put.
  const shownKey = shown.join();
  useEffect(() => {
    const state = motion.current;
    const next = shownKey.split(',').map(Number);
    const time = performance.now();
    const how = prefersReducedMotion() ? null : crossing.current;
    crossing.current = null;
    // Only the first of these is the drawer opening: nothing is lit before it.
    const arriving = how === 'all' && state.lit.every((lit) => lit === 0);
    const from = arriving ? time + ARRIVE_WAIT_MS : time;
    const step = arriving ? ARRIVE_STEP_MS : WAVE_STEP_MS;
    if (arriving) state.drawFrom = from;
    next.forEach((db, at) => {
      const changed = state.goal[at] !== db;
      state.goal[at] = db;
      if (how === null) {
        if (changed) {
          state.now[at] = db;
          state.startAt[at] = 0;
          state.pending[at] = false;
        }
      } else if (changed || how === 'all') {
        state.startAt[at] = from + at * step;
        state.pending[at] = how !== 'quiet';
      }
    });
    paint();
    // Whatever was asked for, and whatever an interrupted frame left unfinished.
    start();
  }, [on, shownKey, paint, start]);

  /** Choose a whole setting, which crosses the curve. */
  const choose = (next: readonly number[]) => {
    crossing.current = 'changed';
    setBands([...next]);
  };

  useEffect(paint, [paint]);

  /** Change one band to where the pointer is. */
  const moveBand = (at: number, clientY: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const db = heldDb(dbAt(((clientY - box.top) / box.height) * TALL));
    const current = useSettingsStore.getState().equaliserBands;
    crossing.current = null;
    if (current[at] === db) return;
    setBands(current.map((value, band) => (band === at ? db : value)));
  };

  const grab = (down: React.PointerEvent<SVGSVGElement>) => {
    if (down.button !== 0 || !on) return;
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const across = ((down.clientX - box.left) / box.width) * WIDE;
    const at = Math.max(0, Math.min(EQ_BANDS.length - 1, Math.floor((across - LEFT) / COLUMN)));
    down.preventDefault();
    down.currentTarget.setPointerCapture(down.pointerId);
    motion.current.grabbed = at;
    setGrabbed(at);
    setRead(at);
    moveBand(at, down.clientY);
  };

  const drop = () => {
    motion.current.grabbed = null;
    setGrabbed(null);
  };

  const pressKey = (at: number, key: string) => {
    const by = key === 'ArrowUp' ? 1 : key === 'ArrowDown' ? -1 : 0;
    if (by === 0 || !on) return;
    crossing.current = null;
    setBands(bands.map((value, band) => (band === at ? heldDb(value + by) : value)));
  };

  const preset = presetOf(bands);
  const readDb = bands[read] ?? 0;
  const reading = grabbed !== null;

  return (
    <div
      id={id}
      className="relative flex h-full shrink-0 flex-col border-l border-[var(--color-edge)] px-5 pt-2 pb-4"
      style={{ width: `${DRAWER_WIDTH}px` }}
    >
      <div className="flex h-7 shrink-0 items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
          {t('panel.equaliser')}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={t('equaliser.onOff')}
          title={`${t('equaliser.onOff')}. ${t('equaliser.note')}`}
          onClick={() => {
            crossing.current = on ? 'quiet' : 'all';
            setOn(!on);
          }}
          className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${on ? 'bg-brass-500' : 'groove-inset'}`}
        >
          <span
            className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-[left,background-color] duration-200 ${
              on ? 'left-4 bg-shell-900' : 'left-0.5 bg-cream-400'
            }`}
          />
        </button>
        <button
          type="button"
          aria-label={t('common.close')}
          title={t('common.close')}
          onClick={onClose}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
        >
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className={`mt-2 flex min-h-0 flex-1 flex-col transition-opacity duration-300 ${on ? '' : 'opacity-50'}`}>
        <div className="groove-inset shrink-0 rounded-[10px]">
          <svg
            ref={svg}
            viewBox={`0 0 ${WIDE} ${TALL}`}
            className={`block w-full touch-none select-none ${on ? 'cursor-ns-resize' : ''}`}
            onPointerDown={grab}
            onPointerMove={(move) => {
              if (motion.current.grabbed !== null) moveBand(motion.current.grabbed, move.clientY);
            }}
            onPointerUp={drop}
            onPointerCancel={drop}
            aria-hidden={!on}
          >
            {EQ_BANDS.map((band, at) => (
              <g key={band} className="pointer-events-none">
                <line
                  x1={xOf(at)}
                  x2={xOf(at)}
                  y1={TOP}
                  y2={TALL - FOOT}
                  className="stroke-cream-50"
                  strokeOpacity="0.045"
                />
                <text x={xOf(at)} y={TALL - 10} textAnchor="middle" fontSize="11" className="fill-cream-400">
                  {band}
                </text>
              </g>
            ))}
            {SCALE.map((db) => (
              <g key={db} className="pointer-events-none">
                <line
                  x1={LEFT}
                  x2={WIDE - RIGHT}
                  y1={yOf(db)}
                  y2={yOf(db)}
                  className="stroke-cream-50"
                  strokeOpacity={db === 0 ? 0.16 : 0.045}
                />
                <text
                  x={LEFT - 7}
                  y={yOf(db) + 4}
                  textAnchor="end"
                  fontSize="11"
                  className={`fill-cream-400 transition-opacity duration-150 ${reading ? 'opacity-25' : ''}`}
                >
                  {signed(db)}
                </text>
              </g>
            ))}
            {/* The value in the scale itself, with a line across to the dot. It
                has no surface of its own: the listener chose this over a box,
                which did not belong to anything else here. */}
            <g className={`pointer-events-none transition-opacity duration-150 ${reading ? 'opacity-100' : 'opacity-0'}`}>
              <line
                x1={LEFT}
                x2={xOf(read)}
                y1={yOf(readDb)}
                y2={yOf(readDb)}
                className="stroke-brass-400"
                strokeOpacity="0.45"
                strokeDasharray="2 3"
              />
              <text
                x={LEFT - 7}
                y={yOf(readDb) + 4}
                textAnchor="end"
                fontSize="12"
                strokeWidth="5"
                className="fill-brass-400 stroke-shell-900 font-medium"
                style={{ paintOrder: 'stroke' }}
              >
                {signed(readDb)}
              </text>
            </g>
            <clipPath id="groove-eq-drawn">
              <rect ref={reveal} x="0" y="0" height={TALL} />
            </clipPath>
            <g clipPath="url(#groove-eq-drawn)" className="pointer-events-none">
              <path ref={fill} className="fill-brass-500" opacity="0.13" />
              <path ref={line} fill="none" className="stroke-brass-400" strokeWidth="2" strokeLinecap="round" />
            </g>
            {EQ_BANDS.map((band, at) => (
              <g key={band}>
                <circle
                  ref={(el) => {
                    flashes.current[at] = el;
                  }}
                  cx={xOf(at)}
                  className="pointer-events-none fill-brass-400"
                  opacity="0"
                />
                <circle
                  ref={(el) => {
                    dots.current[at] = el;
                  }}
                  role="slider"
                  tabIndex={on ? 0 : -1}
                  aria-label={`${band} Hz`}
                  aria-valuemin={-EQ_MOST}
                  aria-valuemax={EQ_MOST}
                  aria-valuenow={bands[at] ?? 0}
                  onKeyDown={(key) => pressKey(at, key.key)}
                  cx={xOf(at)}
                  r={grabbed === at ? 8 : 5.5}
                  opacity="0"
                  className="fill-brass-400 outline-none transition-[r] duration-100 focus-visible:stroke-cream-50 focus-visible:stroke-2"
                />
              </g>
            ))}
          </svg>
        </div>

        <div className="mt-3 flex min-h-0 flex-1 items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="groove-inset inline-flex gap-0.5 rounded-full p-[3px]">
              {EQ_PRESETS.map(({ id: presetId, bands: presetBands }) => (
                <button
                  key={presetId}
                  type="button"
                  disabled={!on}
                  onClick={() => choose(presetBands)}
                  className={`rounded-full px-3 py-1 text-meta transition-colors ${
                    preset === presetId ? 'bg-brass-500 text-on-accent' : 'text-cream-200 enabled:hover:text-cream-50'
                  }`}
                >
                  {t(`equaliser.preset.${presetId}`)}
                </button>
              ))}
            </div>
            <OwnSettings on={on} bands={bands} saved={saved} isPreset={preset !== null} onChoose={choose} />
          </div>
          <InputKnob db={preamp} on={on} onChange={setPreamp} />
        </div>
      </div>
    </div>
  );
}

/** The listener's own settings, kept with names, and the way to keep another. */
function OwnSettings({
  on,
  bands,
  saved,
  isPreset,
  onChoose,
}: {
  on: boolean;
  bands: readonly number[];
  saved: readonly { name: string; bands: number[] }[];
  isPreset: boolean;
  onChoose: (bands: readonly number[]) => void;
}) {
  const t = useT();
  const keep = useSettingsStore((s) => s.saveEqualiserCurve);
  const forget = useSettingsStore((s) => s.removeEqualiserCurve);
  /** What is being typed, or null while nobody is naming anything. */
  const [naming, setNaming] = useState<string | null>(null);
  /** A name already in use, waiting to be told whether to write over it. */
  const [clash, setClash] = useState<string | null>(null);

  const stopNaming = () => {
    setNaming(null);
    setClash(null);
  };
  const submit = () => {
    const name = cleanName(naming ?? '');
    if (!name) return stopNaming();
    if (isTaken(saved, name)) return setClash(name);
    keep(name, bands);
    stopNaming();
  };

  const matches = saved.some((own) => sameBands(own.bands, bands));
  const full = saved.length >= EQ_SAVED_MOST;

  return (
    <div className="mt-2 flex h-7 min-w-0 items-center gap-1.5">
      {saved.map((own) => {
        const active = sameBands(own.bands, bands);
        return (
          <span key={own.name} className="group/own relative shrink-0">
            <button
              type="button"
              disabled={!on}
              onClick={() => onChoose(own.bands)}
              className={`rounded-full py-1 pr-5 pl-3 text-meta transition-colors ${
                active ? 'bg-brass-500 text-on-accent' : 'groove-inset text-cream-200 enabled:hover:text-cream-50'
              }`}
            >
              {own.name}
            </button>
            <button
              type="button"
              aria-label={t('equaliser.remove', { name: own.name })}
              title={t('equaliser.remove', { name: own.name })}
              onClick={() => forget(own.name)}
              className={`absolute top-1/2 right-1 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full opacity-0 transition-opacity group-hover/own:opacity-100 focus-visible:opacity-100 ${
                active ? 'text-on-accent' : 'text-cream-400 hover:text-cream-50'
              }`}
            >
              <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M3 3l6 6M9 3l-6 6" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        );
      })}

      {clash !== null && (
        <span className="flex min-w-0 items-center gap-1.5 text-meta text-cream-200">
          <span className="truncate">{t('equaliser.overwrite', { name: clash })}</span>
          <button
            type="button"
            onClick={() => {
              keep(clash, bands);
              stopNaming();
            }}
            className="shrink-0 rounded-full bg-brass-500 px-2.5 py-0.5 text-on-accent"
          >
            {t('equaliser.overwriteYes')}
          </button>
          <button type="button" onClick={stopNaming} className="shrink-0 rounded-full px-2 py-0.5 text-cream-400 hover:text-cream-50">
            {t('common.cancel')}
          </button>
        </span>
      )}

      {clash === null && naming !== null && (
        <input
          autoFocus
          value={naming}
          maxLength={EQ_NAME_MOST}
          placeholder={t('equaliser.namePlaceholder')}
          aria-label={t('equaliser.namePlaceholder')}
          onChange={(change) => setNaming(change.target.value)}
          onKeyDown={(key) => {
            if (key.key === 'Enter') submit();
            if (key.key === 'Escape') stopNaming();
          }}
          onBlur={stopNaming}
          className="groove-inset h-7 w-32 min-w-0 rounded-full px-3 text-meta text-cream-50 outline-none ring-1 ring-brass-500/60 placeholder:text-cream-400"
        />
      )}

      {clash === null && naming === null && on && !isPreset && !matches && !full && (
        <button
          type="button"
          onClick={() => setNaming('')}
          className="shrink-0 rounded-full px-2.5 py-1 text-meta text-brass-400 transition-colors hover:bg-shell-600"
        >
          {t('equaliser.save')}
        </button>
      )}
      {clash === null && naming === null && on && !isPreset && !matches && full && (
        <span className="truncate text-meta text-cream-400">{t('equaliser.full')}</span>
      )}
    </div>
  );
}

/**
 * The level going in: the same knob as the volume beside the deck, dragged up
 * and down, turned with the wheel, or back to nought with a double click.
 */
function InputKnob({ db, on, onChange }: { db: number; on: boolean; onChange: (db: number) => void }) {
  const t = useT();
  const from = useRef<{ y: number; db: number } | null>(null);
  const [turning, setTurning] = useState(false);

  return (
    <div className="flex shrink-0 items-center gap-2 pt-px">
      <span className="flex flex-col items-end leading-tight">
        <span className="text-meta text-cream-400">{t('equaliser.preamp')}</span>
        <span className="text-meta text-cream-200 tabular-nums">{signed(db)} dB</span>
      </span>
      <div
        role="slider"
        tabIndex={on ? 0 : -1}
        aria-label={t('equaliser.preamp')}
        aria-valuemin={-EQ_MOST}
        aria-valuemax={EQ_MOST}
        aria-valuenow={db}
        aria-disabled={!on}
        onPointerDown={(down) => {
          if (!on) return;
          down.preventDefault();
          down.currentTarget.setPointerCapture(down.pointerId);
          from.current = { y: down.clientY, db };
          setTurning(true);
        }}
        onPointerMove={(move) => {
          if (from.current) onChange(from.current.db + (from.current.y - move.clientY) / KNOB_PX_PER_DB);
        }}
        onPointerUp={() => {
          from.current = null;
          setTurning(false);
        }}
        onPointerCancel={() => {
          from.current = null;
          setTurning(false);
        }}
        onDoubleClick={() => {
          if (on) onChange(0);
        }}
        onWheel={(wheel) => {
          if (on) onChange(db - Math.sign(wheel.deltaY));
        }}
        onKeyDown={(key) => {
          if (on && key.key === 'ArrowUp') onChange(db + 1);
          if (on && key.key === 'ArrowDown') onChange(db - 1);
        }}
        className={`relative h-8 w-8 touch-none rounded-full bg-gradient-to-b from-shell-600 to-shell-800 shadow-[0_2px_4px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.08)] ring-1 ring-shell-900 outline-none focus-visible:ring-2 focus-visible:ring-brass-400 ${
          turning ? 'cursor-grabbing' : on ? 'cursor-grab' : ''
        }`}
      >
        <span
          aria-hidden="true"
          className="absolute inset-0"
          style={{ transform: `rotate(${(db / EQ_MOST) * KNOB_TURN}deg)` }}
        >
          <span className="absolute top-1 left-1/2 h-2.5 w-[2px] -translate-x-1/2 rounded-full bg-brass-400" />
        </span>
      </div>
    </div>
  );
}
