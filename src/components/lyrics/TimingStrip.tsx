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
 */

/** How far a press has to travel before it is a drag rather than a press. */
const DRAG_PX = 3;
/** Arrow keys move a handle this far, and ten times as far with Shift. */
const STEP_MS = 100;
/** Keys are kept once they stop, not once per press. */
const KEEP_AFTER_KEYS_MS = 600;
/** Two presses on one mark this close together are a double click. */
const DOUBLE_MS = 400;

type Drag = {
  kind: 'pin' | 'shift' | 'seek';
  /** Which pin, for a pin. */
  index: number;
  /** Which line's mark was pressed, for a mark. */
  tick: number;
  x: number;
  width: number;
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
  const at = (ms: number) => `${(ms / span) * 100}%`;

  const strip = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const head = useRef<HTMLDivElement | null>(null);
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
      // The sound covers its own length of the strip, which can be wider.
      const songWidth = (width * (track?.duration ?? span)) / span;
      const column = songWidth / shape.length;
      for (let i = 0; i < shape.length; i++) {
        const tall = Math.max(1, (shape[i] as number) * height * 0.82);
        context.fillRect(i * column, (height - tall) / 2, Math.max(1, column - 0.5), tall);
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
  }, [shape, span, track?.duration]);

  // The playhead, every frame, without a render.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (head.current) head.current.style.left = `${(playheadMs() / span) * 100}%`;
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [span]);

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
    return Math.max(0, ((clientX - box.left) / box.width) * span);
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
      width: strip.current?.clientWidth ?? 1,
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
    const ms = (dx / d.width) * span;
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
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && index > 0 && index < timing.length - 1) {
      e.preventDefault();
      setTiming(removePin(timing, pin.line));
      commitTiming();
      setActive(null);
    }
  };

  const seconds = new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
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
          style={{ left: at(first.timeMs), width: at(last.timeMs - first.timeMs) }}
        />
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
