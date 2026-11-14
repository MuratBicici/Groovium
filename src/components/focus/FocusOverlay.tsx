import { useEffect, useRef, useState } from 'react';
import { useT } from '@/core/i18n';
import { useSettingsStore } from '@/core/settings/store';
import { formatClock, remaining, share } from '@/core/focus/clock';
import { useFocusStore } from '@/core/focus/store';
import { rainBands } from '@/core/focus/sound';
import {
  LAYERS,
  css,
  diveTotal,
  layerRise,
  mix,
  parseColour,
  surfaceAt,
  surfaceTotal,
  type Rgb,
} from '@/core/focus/water';
import { prefersReducedMotion } from '@/core/utils/motion';

/** The ring around the clock: this many bars, fed by this many bands of the rain. */
const RING_BARS = 84;
const BANDS = 28;
/** How long the controls stay after the pointer stops. */
const CONTROLS_MS = 2600;
/** The point of a dive at which the clock starts to come in, before the water has quite settled. */
const REVEAL_AT = 0.72;
/** Before the water starts down, the clock and ring go. */
const SURFACE_DELAY_S = 0.28;
const WAVE_PX = 15;
const COMPACT_WAVE_PX = 4;

/** What is said once the time is up, one of these a session. */
const DONE_LINES = ['focus.done1', 'focus.done2', 'focus.done3'] as const;

const WATER: Rgb = [8, 42, 52];
const LIGHT: Rgb = [150, 210, 220];

/**
 * A focus session, over the whole window: the dive, the time under water, and
 * coming back up.
 *
 * The water is drawn on one canvas — three layers rising one behind the other,
 * light moving across the deep once they are over, bubbles on the way up — and
 * the clock and buttons are ordinary elements on top of it, so they read and
 * take a keyboard like everything else.
 *
 * It follows the window's shape rather than asking for one: drawer out, drawer
 * away and the collapsed bar are all the same session, and changing between
 * them only lays it out again.
 */
export function FocusOverlay({
  compact,
  drawerOpen,
  onToggleDrawer,
}: {
  compact: boolean;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
}) {
  const t = useT();
  const phase = useFocusStore((s) => s.phase);
  const clock = useFocusStore((s) => s.clock);
  const silent = useFocusStore((s) => s.silent);
  const { dived, surfaced, togglePause, end, setVolume } = useFocusStore.getState();
  const volume = useSettingsStore((s) => s.focusVolume);
  const setFocus = useSettingsStore((s) => s.setFocus);

  const host = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  /** The dive is far enough along for the clock to come in. */
  const [diveReady, setDiveReady] = useState(false);
  const revealed = phase === 'under' || (phase === 'diving' && diveReady);
  const [now, setNow] = useState(() => Date.now());
  const [stirred, setStirred] = useState(true);
  const stillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One line for the end of this session, chosen once rather than every second.
  // The overlay is only here for one session, so this is one line a session.
  const [doneLine] = useState(() => DONE_LINES[Math.floor(Math.random() * DONE_LINES.length)] ?? 'focus.done1');

  // What the canvas loop reads each frame, without re-rendering for it.
  const live = useRef({ phase, compact, revealed, paused: false, share: 1, over: false });
  useEffect(() => {
    live.current = {
      phase,
      compact,
      revealed,
      paused: clock?.pausedAt != null,
      share: clock ? share(clock, now) : 1,
      over: clock ? remaining(clock, now) < 0 : false,
    };
  });

  // The clock, a few times a second: enough that a second never lands late.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  // The dive and the surfacing, timed here; the canvas only draws them.
  useEffect(() => {
    const quick = prefersReducedMotion();
    if (phase === 'diving') {
      const reveal = setTimeout(() => setDiveReady(true), quick ? 0 : diveTotal() * REVEAL_AT * 1000);
      const done = setTimeout(dived, quick ? 250 : diveTotal() * 1000);
      return () => {
        clearTimeout(reveal);
        clearTimeout(done);
      };
    }
    if (phase === 'surfacing') {
      const done = setTimeout(surfaced, quick ? 250 : (SURFACE_DELAY_S + surfaceTotal()) * 1000);
      return () => clearTimeout(done);
    }
    return undefined;
  }, [phase, dived, surfaced]);

  // Controls come up with the pointer and go when it is still.
  const stir = () => {
    setStirred(true);
    if (stillTimer.current) clearTimeout(stillTimer.current);
    stillTimer.current = setTimeout(() => setStirred(false), CONTROLS_MS);
  };
  useEffect(() => {
    stillTimer.current = setTimeout(() => setStirred(false), CONTROLS_MS);
    return () => {
      if (stillTimer.current) clearTimeout(stillTimer.current);
    };
  }, []);

  // Space pauses, as it would a record — unless a button or slider has it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || useFocusStore.getState().phase !== 'under') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('button, input, select, textarea')) return;
      e.preventDefault();
      togglePause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePause]);

  useWater(host, canvas, live);

  const left = clock ? remaining(clock, now) : 0;
  const paused = clock?.pausedAt != null;
  const over = left < 0;
  const showControls = revealed && (stirred || paused);

  return (
    <div
      ref={host}
      className={`groove-focus ${compact ? 'is-compact' : ''} ${revealed ? 'is-revealed' : ''} ${
        paused ? 'is-paused' : ''
      } ${over ? 'is-over' : ''}`}
      onPointerMove={stir}
      onPointerDown={stir}
      onFocus={stir}
    >
      <canvas ref={canvas} className="groove-focus-water" aria-hidden="true" />

      <div className="groove-focus-centre" role="timer" aria-live="off">
        <div className="groove-focus-clock" aria-label={formatClock(left)}>
          {formatClock(left)}
        </div>
        <div className="groove-focus-under">
          {over ? t('focus.doneShort') : paused ? t('focus.paused') : silent ? t('focus.silent') : `${t('focus.rain')} · ${t('focus.minutes', { count: Math.round((clock?.lengthMs ?? 0) / 60_000) })}`}
        </div>
      </div>

      {!compact && (
        <p className="groove-focus-done" aria-live="polite">
          {over ? t(doneLine) : ''}
        </p>
      )}

      <div className={`groove-focus-controls ${showControls ? 'is-shown' : ''}`} inert={!revealed}>
        <button type="button" className="groove-focus-button" onClick={togglePause} aria-label={paused ? t('focus.resume') : t('focus.pause')} title={paused ? t('focus.resume') : t('focus.pause')}>
          {paused ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5.5h3v13H8zM13 5.5h3v13h-3z" fill="currentColor" />
            </svg>
          )}
        </button>
        <button type="button" className="groove-focus-button is-end" onClick={end} aria-label={t('focus.end')} title={t('focus.end')}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
          </svg>
          {!compact && <span>{t('focus.end')}</span>}
        </button>
        {!compact && (
          <>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(volume * 100)}
              aria-label={t('focus.volume')}
              title={t('focus.volume')}
              onChange={(e) => {
                const next = Number(e.target.value) / 100;
                setFocus({ focusVolume: next });
                setVolume(next);
              }}
              className="groove-focus-range is-under"
              style={{ ['--filled' as string]: `${Math.round(volume * 100)}%` }}
            />
            <button
              type="button"
              className="groove-focus-button"
              onClick={onToggleDrawer}
              aria-label={drawerOpen ? t('focus.foldDrawer') : t('focus.unfoldDrawer')}
              title={drawerOpen ? t('focus.foldDrawer') : t('focus.unfoldDrawer')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <rect x="4" y="5" width="16" height="14" rx="2" />
                <path d={drawerOpen ? 'M12 5v14' : 'M12 5v14M15 10l2 2-2 2'} />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

interface Live {
  phase: string;
  compact: boolean;
  revealed: boolean;
  paused: boolean;
  share: number;
  over: boolean;
}

interface Bubble {
  x: number;
  y: number;
  r: number;
  speed: number;
  wobble: number;
}

/** The canvas: water, light, bubbles, and the ring of bars. */
function useWater(
  host: React.RefObject<HTMLDivElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  live: React.RefObject<Live>,
) {
  useEffect(() => {
    const el = host.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!el || !canvas || !ctx) return;

    let width = 0;
    let height = 0;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      width = el.clientWidth;
      height = el.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);

    // The theme's own colours, read now and again: the cover can change them.
    let shell: Rgb = [22, 17, 13];
    let brass: Rgb = [200, 148, 90];
    let brassLight: Rgb = [224, 176, 113];
    let readAt = -Infinity;
    const readColours = (time: number) => {
      if (time - readAt < 1) return;
      readAt = time;
      const style = getComputedStyle(el);
      shell = parseColour(style.getPropertyValue('--color-shell-900'), shell);
      brass = parseColour(style.getPropertyValue('--color-brass-500'), brass);
      brassLight = parseColour(style.getPropertyValue('--color-brass-400'), brassLight);
    };

    const quick = prefersReducedMotion();
    let motionStart = performance.now() / 1000;
    let motionPhase = live.current.phase;
    let reveal = 0;
    const bands = new Float32Array(BANDS);
    const heard = new Float32Array(RING_BARS);
    let bubbles: Bubble[] = [];
    let frame = 0;
    let lastTime = performance.now() / 1000;

    const draw = (ms: number) => {
      frame = requestAnimationFrame(draw);
      const time = ms / 1000;
      // Everything that eases or moves goes by the time that passed, not by
      // frames: a window that draws slowly must not dive slowly too.
      const dt = Math.max(0, Math.min(0.1, time - lastTime));
      lastTime = time;
      const state = live.current;
      readColours(time);
      if (state.phase !== motionPhase) {
        motionPhase = state.phase;
        motionStart = time + (state.phase === 'surfacing' ? SURFACE_DELAY_S : 0);
      }
      const since = Math.max(0, time - motionStart);

      // How far up each layer is.
      const rises: number[] = [];
      for (let layer = 0; layer < LAYERS; layer += 1) {
        if (quick) rises.push(state.phase === 'surfacing' ? 0 : 1);
        else if (state.phase === 'diving') rises.push(layerRise(layer, since, 'down'));
        else if (state.phase === 'surfacing') rises.push(time < motionStart ? 1 : layerRise(layer, since, 'up'));
        else rises.push(1);
      }

      ctx.clearRect(0, 0, width, height);
      const deep = mix(shell, WATER, 0.62);
      const colours = [mix(shell, mix(WATER, LIGHT, 0.32), 0.55), mix(shell, mix(WATER, LIGHT, 0.14), 0.6), deep];
      const amplitude = state.compact ? COMPACT_WAVE_PX : WAVE_PX;
      if (quick) ctx.globalAlpha = state.phase === 'surfacing' ? 0 : 1;

      for (let layer = 0; layer < LAYERS; layer += 1) {
        const rise = rises[layer] as number;
        if (rise <= 0) continue;
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let x = 0; x <= width + 8; x += 8) ctx.lineTo(x, surfaceAt(x, time, layer, rise, height, amplitude));
        ctx.lineTo(width, height);
        ctx.closePath();
        if (layer === LAYERS - 1) {
          // The front, and what is seen once under: lit from above, darker below.
          const top = Math.max(0, surfaceAt(width / 2, time, layer, rise, height, amplitude));
          const fill = ctx.createLinearGradient(0, top, 0, height);
          fill.addColorStop(0, css(mix(deep, LIGHT, 0.12)));
          fill.addColorStop(1, css(mix(deep, [0, 0, 0], 0.35)));
          ctx.fillStyle = fill;
        } else {
          ctx.fillStyle = css(colours[layer] as Rgb, 0.92);
        }
        ctx.fill();

        // A line of light along the front crest while it moves.
        if (layer === LAYERS - 1 && rise < 1) {
          ctx.beginPath();
          for (let x = 0; x <= width + 8; x += 8) {
            const y = surfaceAt(x, time, layer, rise, height, amplitude);
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = css(brassLight, 0.55);
          ctx.lineWidth = 1.5;
          ctx.stroke();
          // Bubbles thrown up where the water is moving fastest.
          if (!quick && state.phase === 'diving' && rise > 0.05 && Math.random() < dt * 54) {
            for (let i = 0; i < (state.compact ? 1 : 3); i += 1) {
              const x = Math.random() * width;
              bubbles.push({
                x,
                y: surfaceAt(x, time, layer, rise, height, amplitude) + 10 + Math.random() * 60,
                r: 1 + Math.random() * 3.2,
                speed: 60 + Math.random() * 110,
                wobble: Math.random() * 6,
              });
            }
          }
        }
      }
      ctx.globalAlpha = 1;

      const front = rises[LAYERS - 1] as number;
      if (front >= 1 && !quick) {
        // Light coming down from the surface in slow shafts that sway, and
        // the surface itself, just above, catching it.
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const reach = height * (state.compact ? 1 : 0.8);
        for (let ray = 0; ray < 5; ray += 1) {
          const centre = width * (0.12 + ray * 0.19) + Math.sin(time * 0.17 + ray * 2.1) * width * 0.05;
          const top = width * (0.025 + 0.012 * Math.sin(time * 0.3 + ray));
          const lean = width * 0.08;
          const strength = 0.035 + 0.025 * Math.sin(time * 0.23 + ray * 1.7);
          const shaft = ctx.createLinearGradient(0, 0, 0, reach);
          shaft.addColorStop(0, css(LIGHT, Math.max(0, strength)));
          shaft.addColorStop(1, css(LIGHT, 0));
          ctx.fillStyle = shaft;
          ctx.beginPath();
          ctx.moveTo(centre - top, 0);
          ctx.lineTo(centre + top, 0);
          ctx.lineTo(centre + lean + top * 2.6, reach);
          ctx.lineTo(centre + lean - top * 2.6, reach);
          ctx.closePath();
          ctx.fill();
        }
        ctx.beginPath();
        for (let x = 0; x <= width + 8; x += 8) {
          const y = 3 + Math.sin(x / 60 + time * 0.9) * 2 + Math.sin(x / 23 - time * 1.4) * 1.2;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = css(LIGHT, 0.14);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
        // Now and then, one bubble.
        if (!state.paused && Math.random() < dt * (state.compact ? 0.6 : 2.1)) {
          bubbles.push({ x: Math.random() * width, y: height + 6, r: 1 + Math.random() * 2.4, speed: 18 + Math.random() * 30, wobble: Math.random() * 6 });
        }
      }

      // Bubbles: rise, sway, and go at the surface.
      ctx.lineWidth = 1;
      bubbles = bubbles.filter((bubble) => {
        bubble.y -= bubble.speed * dt;
        const x = bubble.x + Math.sin(bubble.y / 14 + bubble.wobble) * 2.2;
        const ceiling = Math.max(-10, surfaceAt(x, time, LAYERS - 1, front, height, amplitude));
        if (bubble.y < ceiling + bubble.r) return false;
        ctx.beginPath();
        ctx.arc(x, bubble.y, bubble.r, 0, Math.PI * 2);
        ctx.strokeStyle = css(mix(LIGHT, brassLight, 0.4), 0.45);
        ctx.stroke();
        return true;
      });
      if (bubbles.length > 220) bubbles = bubbles.slice(-220);

      // The ring of bars, brought in as the water settles and taken away first.
      reveal += ((state.revealed ? 1 : 0) - reveal) * (quick ? 1 : 1 - Math.exp(-dt * (state.revealed ? 3.4 : 10)));
      if (reveal > 0.002) {
        rainBands(bands);
        for (let i = 0; i < RING_BARS; i += 1) {
          // Each bar follows a band, mirrored so the ring has no seam at the top.
          const position = i / RING_BARS;
          const band = Math.min(BANDS - 1, Math.floor((position < 0.5 ? position * 2 : (1 - position) * 2) * BANDS));
          const wobble = 0.75 + 0.25 * Math.sin(i * 1.9 + time * 2.4);
          const target = state.paused ? 0 : (bands[band] as number) * wobble;
          heard[i] = (heard[i] as number) + (target - (heard[i] as number)) * (1 - Math.exp(-dt * 16));
        }
        if (state.compact) drawStrip(ctx, width, height, heard, reveal, brass, brassLight, state);
        else drawRing(ctx, width, height, heard, reveal, brass, brassLight, state, time);
      }
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
    };
  }, [host, canvasRef, live]);
}

function drawRing(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  heard: Float32Array,
  reveal: number,
  brass: Rgb,
  brassLight: Rgb,
  state: Live,
  time: number,
) {
  const cx = width / 2;
  const cy = height * 0.46;
  const radius = Math.min(width, height) * 0.25 * (0.86 + 0.14 * reveal);
  // Inside the ring, a few grooves of a record: the deck is away, but this is still Groovium.
  ctx.lineWidth = 1;
  for (let groove = 0; groove < 3; groove += 1) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (0.86 - groove * 0.05), 0, Math.PI * 2);
    ctx.strokeStyle = css(brassLight, (0.09 - groove * 0.025) * reveal);
    ctx.stroke();
  }
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, radius * 0.028);
  // The bars sweep in clockwise from the top as the ring arrives.
  const shown = Math.ceil(heard.length * Math.min(1, reveal * 1.15));
  for (let i = 0; i < shown; i += 1) {
    const angle = -Math.PI / 2 + (i / heard.length) * Math.PI * 2;
    const lit = state.over || i / heard.length < state.share;
    const pulse = state.over ? 0.15 * (0.5 + 0.5 * Math.sin(time * 2.2 - i * 0.15)) : 0;
    const length = radius * (0.05 + (heard[i] as number) * 0.3 + pulse);
    const inner = radius;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(cx + cos * inner, cy + sin * inner);
    ctx.lineTo(cx + cos * (inner + length), cy + sin * (inner + length));
    ctx.strokeStyle = lit ? css(state.over ? brassLight : brass, (state.paused ? 0.55 : 0.95) * reveal) : css(brassLight, 0.16 * reveal);
    ctx.stroke();
  }
}

function drawStrip(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  heard: Float32Array,
  reveal: number,
  brass: Rgb,
  brassLight: Rgb,
  state: Live,
) {
  // In the bar, the ring unrolls into a row: lit from the left for what is left.
  const count = 22;
  const from = width * 0.36;
  const span = width * 0.3;
  const gap = span / count;
  const bottom = height * 0.66;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, gap * 0.45);
  for (let i = 0; i < count; i += 1) {
    const lit = state.over || i / count < state.share;
    const value = heard[Math.floor((i / count) * heard.length)] as number;
    const length = height * (0.06 + value * 0.32) * reveal;
    const x = from + i * gap;
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x, bottom - length);
    ctx.strokeStyle = lit ? css(state.over ? brassLight : brass, 0.95 * reveal) : css(brassLight, 0.16 * reveal);
    ctx.stroke();
  }
}
