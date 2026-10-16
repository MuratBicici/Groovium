import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useT } from '@/core/i18n';
import { libraryIdOf } from '@/core/library';
import { LAST_LINE_MS, type LyricLine } from '@/core/lyrics/activeLine';
import { playheadMs, seekLyrics } from '@/core/lyrics/playhead';
import { useLyricsStore } from '@/core/lyrics/store';
import {
  addPin,
  movePin,
  removePin,
  retime,
  shiftAll,
  type LyricsPin,
  type LyricsTiming,
} from '@/core/lyrics/timing';
import { envelopeOf } from '@/core/lyrics/waveform';
import { useLanguage } from '@/core/settings/store';
import { usePlayerStore } from '@/core/store';

/**
 * The song as a strip, its lines as marks along it, for the listener to move.
 *
 * The block between the first and the last line drags every line at once. Its
 * two ends are handles — the first line and the last — and a mark pinned with
 * a double click becomes a handle of its own: the lines between two handles
 * spread in proportion as either moves (see `timing.ts`). Behind it all, for a
 * song on this computer, the shape of its sound, which is where the lines have
 * to land. A press anywhere else on the strip goes there, to listen.
 *
 * The lines move under the strip as it is dragged; what is dragged is kept
 * when it is let go.
 *
 * A whole song across a few hundred pixels is a third of a second a pixel,
 * too coarse to set a line by. So the wheel narrows the strip to a stretch of
 * the song, around the pointer, down to a few seconds across; a thin
 * overview under it holds the whole song and the stretch in view, and is
 * dragged to move along it.
 */

/** How far a press has to travel before it is a drag rather than a press. */
const DRAG_PX = 3;
/** Arrow keys move a handle this far, and ten times as far with Shift. */
const STEP_MS = 100;
/** Keys are kept once they stop, not once per press. */
const KEEP_AFTER_KEYS_MS = 600;
/** Two presses on one mark this close together are a double click. */
const DOUBLE_MS = 400;
/** The narrowest stretch the strip shows. */
const MIN_VIEW_MS = 3_000;
/** How much one wheel pixel narrows or widens it. */
const ZOOM_PER_PX = 0.002;
/** Time marks along the strip, the finest that leave room between them. */
const LABEL_STEPS_MS = [1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000];

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

type Drag = {
  kind: 'pin' | 'shift' | 'seek';
  /** Which pin, for a pin. */
  index: number;
  /** Which line's mark was pressed, for a mark. */
  tick: number;
  x: number;
  /** Milliseconds a pixel, at the zoom the press started at. */
  scale: number;
  from: LyricsTiming;
  moved: boolean;
};

export function TimingStrip({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const language = useLanguage();
  const track = usePlayerStore((s) => s.currentTrack);
  const library = usePlayerStore((s) => s.library);
  const raw = useLyricsStore((s) => s.raw);
  const timing = useLyricsStore((s) => s.timing);
  const timingError = useLyricsStore((s) => s.timingError);
  const setTiming = useLyricsStore((s) => s.setTiming);
  const commitTiming = useLyricsStore((s) => s.commitTiming);
  const resetTiming = useLyricsStore((s) => s.resetTiming);
  const stopTuning = useLyricsStore((s) => s.stopTuning);

  const lines = raw?.result.status === 'Synced' ? raw.result.data : null;
  const shown = useMemo(() => (lines && timing ? retime(lines, timing) : lines), [lines, timing]);

  // The strip is the song; a last line moved past its end widens it.
  const lastMs = shown?.[shown.length - 1]?.timeMs ?? 0;
  const span = Math.max(track?.duration ?? 0, lastMs + LAST_LINE_MS, 1);

  // The stretch of it on show: all of it, or what the wheel narrowed it to.
  const [view, setView] = useState<{ start: number; span: number } | null>(null);
  const viewSpan = view ? Math.min(view.span, span) : span;
  const viewStart = view ? clamp(view.start, 0, span - viewSpan) : 0;
  const at = (ms: number) => `${((ms - viewStart) / viewSpan) * 100}%`;
  const across = (ms: number) => `${(ms / viewSpan) * 100}%`;

  const strip = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const head = useRef<HTMLDivElement | null>(null);
  const overview = useRef<HTMLDivElement | null>(null);
  const overviewHead = useRef<HTMLDivElement | null>(null);
  const pan = useRef<{ x: number; start: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const keysDone = useRef(0);
  /**
   * The last press that went nowhere, to know a double click by. Counted
   * here rather than left to the browser: the strip holds the pointer while it
   * is down, and the browser then sends the double click to the strip instead
   * of to the mark or pin that was pressed.
   */
  const lastPress = useRef<{ what: string; at: number } | null>(null);
  const [active, setActive] = useState<number | null>(null);

  // The shape of the sound, for a song on this computer.
  const libraryId = track ? libraryIdOf(track.id) : null;
  const storedFile = libraryId ? library.find((song) => song.id === libraryId)?.storedFile : undefined;
  const [envelope, setEnvelope] = useState<{ file: string; shape: Float32Array | null } | null>(null);
  useEffect(() => {
    if (!storedFile) return;
    let live = true;
    void envelopeOf(storedFile).then((shape) => {
      if (live) setEnvelope({ file: storedFile, shape });
    });
    return () => {
      live = false;
    };
  }, [storedFile]);
  const shape = envelope && envelope.file === storedFile ? envelope.shape : null;

  // Drawn again at every size and every theme, in the theme's own colour.
  useEffect(() => {
    const el = canvas.current;
    if (!el || !shape) return;
    const draw = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      const ratio = window.devicePixelRatio || 1;
      el.width = Math.round(width * ratio);
      el.height = Math.round(height * ratio);
      const context = el.getContext('2d');
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const colour = getComputedStyle(document.documentElement).getPropertyValue('--color-shell-600');
      context.fillStyle = colour.trim() || '#3d2f24';
      // A pixel at a time, the loudest of the columns under it: many when the
      // whole song is on show, a fraction of one at the narrowest.
      const song = track?.duration ?? span;
      const perMs = shape.length / song;
      for (let x = 0; x < width; x++) {
        const from = viewStart + (x / width) * viewSpan;
        if (from >= song) break;
        const to = viewStart + ((x + 1) / width) * viewSpan;
        const c0 = Math.floor(from * perMs);
        const c1 = Math.max(c0 + 1, Math.floor(to * perMs));
        let peak = 0;
        for (let c = c0; c < c1 && c < shape.length; c++) peak = Math.max(peak, shape[c] as number);
        const tall = Math.max(1, peak * height * 0.82);
        context.fillRect(x, (height - tall) / 2, 1, tall);
      }
    };
    draw();
    const sized = new ResizeObserver(draw);
    sized.observe(el);
    const themed = new MutationObserver(draw);
    themed.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-ground', 'style'],
    });
    return () => {
      sized.disconnect();
      themed.disconnect();
    };
  }, [shape, span, viewStart, viewSpan, track?.duration]);

  // The playhead, on the strip and the overview, every frame, without a render.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const ms = playheadMs();
      if (head.current) head.current.style.left = `${((ms - viewStart) / viewSpan) * 100}%`;
      if (overviewHead.current) overviewHead.current.style.left = `${(ms / span) * 100}%`;
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [span, viewStart, viewSpan]);

  // The wheel narrows or widens the strip around the pointer. Its own
  // listener, not React's: React listens for the wheel passively, and this
  // has to keep the page from taking the same turn.
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const box = el.getBoundingClientRect();
      if (box.width === 0) return;
      const where = clamp((e.clientX - box.left) / box.width, 0, 1);
      const turn = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      setView((was) => {
        const wasSpan = was ? Math.min(was.span, span) : span;
        const wasStart = was ? clamp(was.start, 0, span - wasSpan) : 0;
        const next = clamp(wasSpan * Math.exp(turn * ZOOM_PER_PX), Math.min(MIN_VIEW_MS, span), span);
        if (next >= span) return null;
        const pointed = wasStart + where * wasSpan;
        return { start: clamp(pointed - where * next, 0, span - next), span: next };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [span, lines, timing]);

  // Escape puts the strip away, ahead of whatever else listens for it.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      stopTuning();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [stopTuning]);

  // Keys not yet kept are kept when the strip goes.
  useEffect(
    () => () => {
      if (keysDone.current) {
        window.clearTimeout(keysDone.current);
        commitTiming();
      }
    },
    [commitTiming],
  );

  if (!lines || !shown || !timing) return null;

  const msAt = (clientX: number) => {
    const box = strip.current?.getBoundingClientRect();
    if (!box || box.width === 0) return 0;
    return Math.max(0, viewStart + ((clientX - box.left) / box.width) * viewSpan);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const pin = target.closest<HTMLElement>('[data-pin]');
    const tick = target.closest<HTMLElement>('[data-tick]');
    const onBlock = tick !== null || target.closest('[data-block]') !== null;
    const index = pin ? Number(pin.dataset.pin) : -1;
    drag.current = {
      kind: pin ? 'pin' : onBlock ? 'shift' : 'seek',
      index,
      tick: tick ? Number(tick.dataset.tick) : -1,
      x: e.clientX,
      scale: viewSpan / (strip.current?.clientWidth || 1),
      from: timing,
      moved: false,
    };
    if (pin) setActive(index);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.kind === 'seek') return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < DRAG_PX) return;
    d.moved = true;
    const ms = dx * d.scale;
    if (d.kind === 'pin') setTiming(movePin(d.from, d.index, (d.from[d.index] as LyricsPin).ms + ms));
    else setTiming(shiftAll(d.from, ms));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      lastPress.current = null;
      commitTiming();
      return;
    }
    // A second press on the same mark or pin pins or unpins its line.
    const what = d.kind === 'pin' ? `pin:${d.index}` : d.tick >= 0 ? `tick:${d.tick}` : '';
    const again =
      what !== '' && lastPress.current?.what === what && e.timeStamp - lastPress.current.at < DOUBLE_MS;
    lastPress.current = what ? { what, at: e.timeStamp } : null;
    if (again) {
      lastPress.current = null;
      const next =
        d.kind === 'pin'
          ? removePin(timing, (timing[d.index] as LyricsPin).line)
          : addPin(timing, d.tick, lines);
      if (next !== timing) {
        setTiming(next);
        commitTiming();
        setActive(null);
      }
      return;
    }
    // A press that went nowhere goes there, to listen.
    if (d.kind !== 'pin') seekLyrics(msAt(e.clientX));
  };

  const keepSoon = () => {
    window.clearTimeout(keysDone.current);
    keysDone.current = window.setTimeout(() => {
      keysDone.current = 0;
      commitTiming();
    }, KEEP_AFTER_KEYS_MS);
  };

  const onPinKey = (index: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    const pin = timing[index] as LyricsPin;
    const step = e.shiftKey ? STEP_MS * 10 : STEP_MS;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      setTiming(movePin(timing, index, pin.ms + (e.key === 'ArrowLeft' ? -step : step)));
      keepSoon();
    } else if (e.key === '+' || e.key === '=' || e.key === '-') {
      // Narrower or wider around the handle, for the keyboard's wheel.
      e.preventDefault();
      const next = clamp(viewSpan * (e.key === '-' ? 2 : 0.5), Math.min(MIN_VIEW_MS, span), span);
      setView(next >= span ? null : { start: clamp(pin.ms - next / 2, 0, span - next), span: next });
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && index > 0 && index < timing.length - 1) {
      e.preventDefault();
      setTiming(removePin(timing, pin.line));
      commitTiming();
      setActive(null);
    }
  };

  // A hundredth of a second once the strip is narrow enough to set one.
  const digits = viewSpan < 20_000 ? 2 : 1;
  const seconds = new Intl.NumberFormat(language, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const onePlace = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const viewName = view
    ? viewSpan >= 60_000
      ? t('lyrics.timing.minutes', { value: onePlace.format(viewSpan / 60_000) })
      : t('lyrics.timing.seconds', { value: onePlace.format(viewSpan / 1000) })
    : t('lyrics.timing.viewAll');
  const labelStep =
    LABEL_STEPS_MS.find((step) => viewSpan / step <= (compact ? 4 : 7)) ??
    (LABEL_STEPS_MS[LABEL_STEPS_MS.length - 1] as number);
  const labels: number[] = [];
  for (let ms = Math.ceil(viewStart / labelStep) * labelStep; ms <= viewStart + viewSpan; ms += labelStep) {
    // Not right at either end, where half of it would be cut off.
    const along = (ms - viewStart) / viewSpan;
    if (along > 0.04 && along < 0.96) labels.push(ms);
  }

  // Dragging the overview moves the stretch along the song; a press beside
  // the stretch brings it there first.
  const onOverviewDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!view || e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const pressed = ((e.clientX - box.left) / box.width) * span;
    const inside = pressed >= viewStart && pressed <= viewStart + viewSpan;
    const start = inside ? viewStart : clamp(pressed - viewSpan / 2, 0, span - viewSpan);
    if (!inside) setView({ start, span: viewSpan });
    pan.current = { x: e.clientX, start };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onOverviewMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = pan.current;
    const width = overview.current?.clientWidth;
    if (!p || !width) return;
    const start = clamp(p.start + ((e.clientX - p.x) / width) * span, 0, span - viewSpan);
    setView({ start, span: viewSpan });
  };
  const delta = (pin: LyricsPin) => {
    const s = (pin.ms - (lines[pin.line] as LyricLine).timeMs) / 1000;
    const sign = s >= 0.05 ? '+' : s <= -0.05 ? '−' : '';
    return t('lyrics.timing.seconds', { value: `${sign}${seconds.format(Math.abs(s))}` });
  };
  const nameOf = (index: number) =>
    index === 0
      ? t('lyrics.timing.start')
      : index === timing.length - 1
        ? t('lyrics.timing.end')
        : t('lyrics.timing.line', { line: (timing[index] as LyricsPin).line + 1 });

  const first = shown[0] as LyricLine;
  const last = shown[shown.length - 1] as LyricLine;
  const pinned = new Set(timing.map((pin) => pin.line));
  const focus = active !== null && timing[active] && active > 0 && active < timing.length - 1 ? active : null;

  return (
    <div className="pointer-events-auto flex w-full flex-col gap-1.5">
      <div
        ref={strip}
        title={t('lyrics.timing.hint')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        className={`relative w-full cursor-pointer touch-none overflow-hidden rounded-md bg-shell-900/80 ring-1 ring-[var(--color-edge)] select-none ${
          compact ? 'h-8' : 'h-[52px]'
        }`}
      >
        {shape && <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />}
        <div
          data-block
          className="absolute inset-y-0.5 cursor-grab border-y border-brass-500/60 bg-brass-500/10 active:cursor-grabbing"
          style={{ left: at(first.timeMs), width: across(last.timeMs - first.timeMs) }}
        />
        {labels.map((ms) => (
          <span
            key={ms}
            className="pointer-events-none absolute bottom-0 -translate-x-1/2 text-[9px] leading-none text-cream-400/70 tabular-nums"
            style={{ left: at(ms) }}
          >
            {clock(ms)}
          </span>
        ))}
        {shown.map((line, i) =>
          pinned.has(i) ? null : (
            <div
              key={i}
              data-tick={i}
              className="absolute inset-y-1.5 w-2.5 -translate-x-1/2 cursor-grab"
              style={{ left: at(line.timeMs) }}
            >
              <div className="mx-auto h-full w-0.5 rounded-full bg-brass-400/85" />
            </div>
          ),
        )}
        <div ref={head} className="pointer-events-none absolute inset-y-0 w-0.5 bg-cream-50/90" />
        {timing.map((pin, i) => (
          <div
            key={pin.line}
            data-pin={i}
            role="slider"
            tabIndex={0}
            aria-label={nameOf(i)}
            aria-valuemin={0}
            aria-valuemax={Math.round(span)}
            aria-valuenow={pin.ms}
            aria-valuetext={`${nameOf(i)} ${delta(pin)}`}
            onKeyDown={onPinKey(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive((was) => (was === i ? null : was))}
            className="absolute inset-y-0 flex w-2.5 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded-[3px] bg-brass-500 outline-none focus-visible:ring-2 focus-visible:ring-cream-50"
            style={{ left: at(pin.ms) }}
          >
            <div className="h-3.5 w-0.5 rounded-full bg-shell-900/60" />
          </div>
        ))}
      </div>

      {/* The whole song, the lines on it and the stretch on show above. */}
      <div className="flex items-center gap-2">
        <div
          ref={overview}
          onPointerDown={onOverviewDown}
          onPointerMove={onOverviewMove}
          onPointerUp={() => (pan.current = null)}
          onPointerCancel={() => (pan.current = null)}
          className={`relative flex-1 touch-none overflow-hidden rounded-sm bg-shell-900/80 ring-1 ring-[var(--color-edge)] select-none ${
            compact ? 'h-2' : 'h-2.5'
          } ${view ? 'cursor-pointer' : ''}`}
        >
          {shown.map((line, i) => (
            <div
              key={i}
              className="pointer-events-none absolute inset-y-0.5 w-px bg-brass-400/45"
              style={{ left: `${(line.timeMs / span) * 100}%` }}
            />
          ))}
          <div
            className={`absolute inset-y-0 rounded-[2px] border border-brass-500 bg-brass-500/20 ${
              view ? 'cursor-grab active:cursor-grabbing' : ''
            }`}
            style={{
              left: `${(viewStart / span) * 100}%`,
              width: `max(4px, ${(viewSpan / span) * 100}%)`,
            }}
          />
          <div ref={overviewHead} className="pointer-events-none absolute inset-y-0 w-px bg-cream-50/90" />
        </div>
        <span className="shrink-0 text-label text-cream-400 tabular-nums">{viewName}</span>
      </div>

      <div className="flex min-w-0 items-center gap-2 text-meta text-cream-400">
        <span className="min-w-0 flex-1 truncate tabular-nums">
          {timingError ? (
            <span className="text-warn/90">{t('lyrics.timing.failed')}</span>
          ) : focus !== null ? (
            <>
              {nameOf(focus)} <span className="text-brass-400">{delta(timing[focus] as LyricsPin)}</span>
            </>
          ) : (
            <>
              {t('lyrics.timing.start')}{' '}
              <span className="text-brass-400">{delta(timing[0] as LyricsPin)}</span>
              {' · '}
              {t('lyrics.timing.end')}{' '}
              <span className="text-brass-400">{delta(timing[timing.length - 1] as LyricsPin)}</span>
            </>
          )}
        </span>
        <button type="button" onClick={resetTiming} className={PILL}>
          {t('lyrics.timing.reset')}
        </button>
        <button
          type="button"
          onClick={stopTuning}
          className={`${PILL} bg-brass-500 text-on-accent ring-brass-500 hover:text-on-accent`}
        >
          {t('lyrics.timing.done')}
        </button>
      </div>
      {!compact && <p className="text-label text-cream-400/70">{t('lyrics.timing.hint')}</p>}
    </div>
  );
}

const PILL =
  'shrink-0 rounded-full px-2.5 py-0.5 text-meta text-cream-200 ring-1 ring-[var(--color-edge)] transition-colors hover:text-cream-50 hover:ring-brass-500';
