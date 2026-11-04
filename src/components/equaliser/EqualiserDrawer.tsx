import { useCallback, useEffect, useRef, useState } from 'react';
import { EQ_BANDS, EQ_FLAT, EQ_MOST, EQ_PRESETS, heldDb, presetOf, sameBands } from '@/core/equaliser';
import { useT } from '@/core/i18n';
import { useSettingsStore } from '@/core/settings/store';
import { prefersReducedMotion } from '@/core/utils/motion';
import { pacer } from '@/core/utils/pace';
import { DRAWER_WIDTH } from '@/platform/window';

/** The curve's own coordinates. The drawer's width and a height to suit it. */
const WIDE = 640;
const TALL = 190;
/** How far the curve keeps from the top and bottom, for a dot at full reach. */
const EDGE = 12;

const xOf = (at: number) => (WIDE / EQ_BANDS.length) * (at + 0.5);
const yOf = (db: number) => TALL / 2 - (db / EQ_MOST) * (TALL / 2 - EDGE);
const dbAt = (y: number) => ((TALL / 2 - y) / (TALL / 2 - EDGE)) * EQ_MOST;

/** How long a change takes to cross from one band to the next. */
const WAVE_STEP_MS = 38;
/** How fast each dot closes on where it is going, per second. */
const SETTLE_RATE = 11;
/** How fast a dot's flash goes out, per second. */
const FLASH_FADE = 3.2;

/** The line through the dots, carried level to both edges. */
function curvePath(values: readonly number[]): string {
  let path = `M0 ${yOf(values[0] ?? 0)} L${xOf(0)} ${yOf(values[0] ?? 0)}`;
  const half = WIDE / EQ_BANDS.length / 2;
  for (let at = 1; at < values.length; at++) {
    const [before, now] = [yOf(values[at - 1] ?? 0), yOf(values[at] ?? 0)];
    path += ` C${xOf(at - 1) + half} ${before} ${xOf(at) - half} ${now} ${xOf(at)} ${now}`;
  }
  return `${path} L${WIDE} ${yOf(values[values.length - 1] ?? 0)}`;
}

/**
 * The equaliser, in the drawer: one curve through ten dots.
 *
 * A dot is dragged up or down. A setting chosen crosses the curve from left to
 * right, and each dot flashes once as the change reaches it; the listener asked
 * for that and nothing more, having been shown a good deal more. It draws only
 * while something is moving, and stands still otherwise.
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
  const saveBands = useSettingsStore((s) => s.saveEqualiserBands);

  const [grabbed, setGrabbed] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const line = useRef<SVGPathElement | null>(null);
  const fill = useRef<SVGPathElement | null>(null);
  const dots = useRef<(SVGCircleElement | null)[]>([]);
  const flashes = useRef<(SVGCircleElement | null)[]>([]);

  const shown = on ? bands : EQ_FLAT;
  /** Where the dots are this frame, how lit each is, and when each may start. */
  const motion = useRef({
    now: [...shown],
    goal: [...shown],
    flash: EQ_BANDS.map(() => 0),
    startAt: EQ_BANDS.map(() => 0),
    pending: EQ_BANDS.map(() => false),
    grabbed: null as number | null,
    frame: 0,
    last: 0,
  });

  const paint = useCallback(() => {
    const { now, flash } = motion.current;
    const path = curvePath(now);
    line.current?.setAttribute('d', path);
    fill.current?.setAttribute('d', `${path} L${WIDE} ${TALL / 2} L0 ${TALL / 2} Z`);
    now.forEach((db, at) => {
      const y = String(yOf(db));
      dots.current[at]?.setAttribute('cy', y);
      const halo = flashes.current[at];
      halo?.setAttribute('cy', y);
      halo?.setAttribute('opacity', String((flash[at] ?? 0) * 0.55));
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
            const close = 1 - Math.exp(-seconds * (state.grabbed === at ? SETTLE_RATE * 3 : SETTLE_RATE));
            const next = db + (goal - db) * close;
            state.now[at] = Math.abs(goal - next) < 0.02 ? goal : next;
          }
          state.flash[at] = Math.max(0, (state.flash[at] ?? 0) - seconds * FLASH_FADE);
        });
        paint();
      }
      const moving = state.now.some((db, at) => db !== state.goal[at]) || state.flash.some((f) => f > 0) || state.pending.some(Boolean);
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

  // A new goal. From a dot being dragged it goes straight there; from anything
  // else it crosses the curve, and only the dots with somewhere to go light up.
  const shownKey = shown.join();
  useEffect(() => {
    const state = motion.current;
    const next = shownKey.split(',').map(Number);
    const time = performance.now();
    const still = prefersReducedMotion();
    next.forEach((db, at) => {
      const changed = state.goal[at] !== db;
      state.goal[at] = db;
      if (!changed) return;
      if (still) {
        state.now[at] = db;
      } else if (state.grabbed === null) {
        state.startAt[at] = time + at * WAVE_STEP_MS;
        state.pending[at] = true;
      } else {
        state.startAt[at] = 0;
      }
    });
    if (still) paint();
    else start();
  }, [shownKey, paint, start]);

  useEffect(paint, [paint]);

  /** Change one band to where the pointer is. */
  const moveBand = (at: number, clientY: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const db = heldDb(dbAt(((clientY - box.top) / box.height) * TALL));
    const current = useSettingsStore.getState().equaliserBands;
    if (current[at] === db) return;
    setBands(current.map((value, band) => (band === at ? db : value)));
  };

  const grab = (down: React.PointerEvent<SVGSVGElement>) => {
    if (down.button !== 0 || !on) return;
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const across = ((down.clientX - box.left) / box.width) * WIDE;
    const at = Math.max(0, Math.min(EQ_BANDS.length - 1, Math.floor(across / (WIDE / EQ_BANDS.length))));
    down.preventDefault();
    down.currentTarget.setPointerCapture(down.pointerId);
    const state = motion.current;
    state.grabbed = at;
    state.flash[at] = 1;
    setGrabbed(at);
    moveBand(at, down.clientY);
    start();
  };

  const drop = () => {
    motion.current.grabbed = null;
    setGrabbed(null);
  };

  const pressKey = (at: number, key: string) => {
    const by = key === 'ArrowUp' ? 1 : key === 'ArrowDown' ? -1 : 0;
    if (by === 0 || !on) return;
    setBands(bands.map((value, band) => (band === at ? heldDb(value + by) : value)));
  };

  const preset = presetOf(bands);
  const isSaved = saved !== null && sameBands(saved, bands);
  const grabbedDb = grabbed === null ? 0 : (bands[grabbed] ?? 0);

  return (
    <div
      id={id}
      className="relative flex h-full shrink-0 flex-col border-l border-[var(--color-edge)] px-5 pt-2 pb-4"
      style={{ width: `${DRAWER_WIDTH}px` }}
    >
      <div className="flex shrink-0 items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
          {t('panel.equaliser')}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={t('equaliser.onOff')}
          title={t('equaliser.onOff')}
          onClick={() => setOn(!on)}
          className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${on ? 'bg-brass-500' : 'bg-shell-900'}`}
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

      <div className={`flex min-h-0 flex-1 flex-col justify-center transition-opacity duration-300 ${on ? '' : 'opacity-50'}`}>
        <svg
          ref={svg}
          viewBox={`0 0 ${WIDE} ${TALL}`}
          className={`w-full touch-none select-none overflow-visible ${on ? 'cursor-ns-resize' : ''}`}
          onPointerDown={grab}
          onPointerMove={(move) => {
            if (motion.current.grabbed !== null) moveBand(motion.current.grabbed, move.clientY);
          }}
          onPointerUp={drop}
          onPointerCancel={drop}
          aria-hidden={!on}
        >
          <line x1="0" x2={WIDE} y1={TALL / 2} y2={TALL / 2} className="stroke-shell-600" strokeWidth="1" />
          <path ref={fill} className="fill-brass-500" opacity="0.1" />
          <path ref={line} fill="none" className="stroke-brass-400" strokeWidth="2" strokeLinecap="round" />
          {EQ_BANDS.map((band, at) => (
            <g key={band}>
              <circle
                ref={(el) => {
                  flashes.current[at] = el;
                }}
                cx={xOf(at)}
                r="13"
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
                className="fill-brass-400 outline-none transition-[r] duration-100 focus-visible:stroke-cream-50 focus-visible:stroke-2"
              />
            </g>
          ))}
          {grabbed !== null && (
            <g
              transform={`translate(${Math.max(26, Math.min(WIDE - 26, xOf(grabbed)))} ${Math.max(32, yOf(grabbedDb))})`}
              className="pointer-events-none"
            >
              <rect x="-24" y="-30" width="48" height="19" rx="5" className="fill-cream-50" />
              <text y="-16" textAnchor="middle" fontSize="12" className="fill-shell-900 font-medium">
                {grabbedDb > 0 ? `+${grabbedDb}` : grabbedDb} dB
              </text>
            </g>
          )}
        </svg>
        <div className="mt-1 flex" aria-hidden="true">
          {EQ_BANDS.map((band) => (
            <span key={band} className="flex-1 text-center text-meta text-cream-400">
              {band}
            </span>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {EQ_PRESETS.map(({ id: presetId, bands: presetBands }) => (
            <button
              key={presetId}
              type="button"
              disabled={!on}
              onClick={() => setBands([...presetBands])}
              className={`rounded-full px-3 py-1 text-meta transition-colors ${
                preset === presetId
                  ? 'bg-brass-500 text-on-accent'
                  : 'bg-shell-900/70 text-cream-300 enabled:hover:bg-shell-600 enabled:hover:text-cream-50'
              }`}
            >
              {t(`equaliser.preset.${presetId}`)}
            </button>
          ))}
          {saved !== null && (
            <button
              type="button"
              disabled={!on}
              onClick={() => setBands([...saved])}
              className={`rounded-full px-3 py-1 text-meta transition-colors ${
                isSaved
                  ? 'bg-brass-500 text-on-accent'
                  : 'bg-shell-900/70 text-cream-300 enabled:hover:bg-shell-600 enabled:hover:text-cream-50'
              }`}
            >
              {t('equaliser.mine')}
            </button>
          )}
          {preset === null && !isSaved && (
            <button
              type="button"
              disabled={!on}
              onClick={() => saveBands(bands)}
              className="rounded-full px-3 py-1 text-meta text-brass-400 transition-colors enabled:hover:bg-shell-600"
            >
              {t('equaliser.save')}
            </button>
          )}
        </div>

        <label className="mt-4 flex items-center gap-3 text-meta text-cream-300">
          <span className="shrink-0">{t('equaliser.preamp')}</span>
          <input
            type="range"
            min={-EQ_MOST}
            max={EQ_MOST}
            step={1}
            disabled={!on}
            value={preamp}
            onChange={(change) => setPreamp(Number(change.target.value))}
            className="min-w-0 flex-1 accent-[var(--color-brass-400)]"
          />
          <span className="w-12 shrink-0 text-right tabular-nums">
            {preamp > 0 ? `+${preamp}` : preamp} dB
          </span>
        </label>

        <p className="mt-3 text-meta leading-snug text-cream-400/80">{t('equaliser.note')}</p>
      </div>
    </div>
  );
}
