import { useEffect, useRef, useState } from 'react';
import { useT } from '@/core/i18n';
import { DIAL_MINUTES, MIN_MINUTES, dialMinutes } from '@/core/focus/clock';
import { css, mix, parseColour, type Rgb } from '@/core/focus/water';
import { prefersReducedMotion } from '@/core/utils/motion';

const SIZE = 300;
/** Where the brass runs, and where the handle sits on it. */
const TRACK = 0.46;
const FACE = 0.18;

/**
 * The session's length, on a record: grooves for a face, a brass arc round it
 * for the minutes, and a handle to turn them up or down five at a time. The
 * label in the middle is the button that starts it.
 *
 * A full turn is two hours. The handle stops at both ends rather than going
 * round past them, so a hand that overshoots does not land on five minutes.
 */
export function FocusDial({
  minutes,
  onMinutes,
  onStart,
}: {
  minutes: number;
  onMinutes: (minutes: number) => void;
  onStart: () => void;
}) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const target = useRef(minutes);
  const [held, setHeld] = useState(false);
  const pressed = useRef(0);
  const hovering = useRef(false);

  useEffect(() => {
    target.current = minutes;
  }, [minutes]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = SIZE * dpr;
    el.height = SIZE * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let brass: Rgb = [200, 148, 90];
    let brassLight: Rgb = [224, 176, 113];
    let edge: Rgb = [61, 47, 36];
    let readAt = -Infinity;
    let shown = target.current;
    let last = performance.now();
    let frame = 0;
    const quick = prefersReducedMotion();

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      // Hidden with its side of the drawer: nothing to draw.
      if (el.offsetParent === null) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (now - readAt > 1000) {
        readAt = now;
        const style = getComputedStyle(el);
        brass = parseColour(style.getPropertyValue('--color-brass-500'), brass);
        brassLight = parseColour(style.getPropertyValue('--color-brass-400'), brassLight);
        edge = parseColour(style.getPropertyValue('--color-edge'), edge);
      }
      shown = quick ? target.current : shown + (target.current - shown) * (1 - Math.exp(-dt * 14));
      pressed.current *= Math.exp(-dt * 9);

      const c = SIZE / 2;
      const r = SIZE * TRACK;
      ctx.clearRect(0, 0, SIZE, SIZE);
      // The record.
      ctx.fillStyle = '#0d0a08';
      ctx.beginPath();
      ctx.arc(c, c, SIZE * 0.5 - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1;
      for (let groove = SIZE * 0.2; groove < SIZE * 0.43; groove += 3.5) {
        ctx.strokeStyle = css(brassLight, Math.round(groove) % 4 === 0 ? 0.08 : 0.035);
        ctx.beginPath();
        ctx.arc(c, c, groove, 0, Math.PI * 2);
        ctx.stroke();
      }
      // A sheen that turns slowly, as light does on a record.
      const sheen = now / 9000;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const at of [sheen, sheen + Math.PI]) {
        ctx.fillStyle = css(brassLight, 0.02);
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.arc(c, c, SIZE * 0.43, at, at + 0.35);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // Five-minute marks, longer every quarter hour, lit up to the length.
      const angleOf = (m: number) => -Math.PI / 2 + (m / DIAL_MINUTES) * Math.PI * 2;
      for (let m = 5; m <= DIAL_MINUTES; m += 5) {
        const a = angleOf(m);
        const long = m % 15 === 0;
        const inner = r - (long ? 13 : 8);
        ctx.strokeStyle = m <= shown + 0.01 ? css(brassLight, 0.9) : css(edge, 1);
        ctx.lineWidth = long ? 2.4 : 1.2;
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner);
        ctx.lineTo(c + Math.cos(a) * (r - 4), c + Math.sin(a) * (r - 4));
        ctx.stroke();
      }
      // The arc, and the handle at its end.
      const end = angleOf(shown);
      ctx.lineCap = 'round';
      ctx.strokeStyle = css(edge, 1);
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(c, c, r + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = css(brass, 1);
      ctx.beginPath();
      ctx.arc(c, c, r + 6, -Math.PI / 2, end);
      ctx.stroke();
      const hx = c + Math.cos(end) * (r + 6);
      const hy = c + Math.sin(end) * (r + 6);
      ctx.fillStyle = css(brassLight, 1);
      ctx.beginPath();
      ctx.arc(hx, hy, hovering.current ? 11 : 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // The label, which is the button: brass, pressed in when pressed.
      const scale = 1 - pressed.current * 0.07;
      ctx.save();
      ctx.translate(c, c);
      ctx.scale(scale, scale);
      const label = ctx.createRadialGradient(-8, -10, 4, 0, 0, SIZE * FACE);
      label.addColorStop(0, css(mix(brassLight, [255, 255, 255], 0.15)));
      label.addColorStop(1, css(brass));
      ctx.fillStyle = label;
      ctx.beginPath();
      ctx.arc(0, 0, SIZE * FACE, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  /** The minutes at a point on the dial, held to the ends rather than wrapping past them. */
  const at = (x: number, y: number): number | null => {
    const el = canvas.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const dx = x - box.left - box.width / 2;
    const dy = y - box.top - box.height / 2;
    let angle = Math.atan2(dy, dx) + Math.PI / 2;
    if (angle < 0) angle += Math.PI * 2;
    const next = dialMinutes((angle / (Math.PI * 2)) * DIAL_MINUTES);
    const from = target.current;
    // Over the top from either end: stay at that end.
    if (Math.abs(next - from) > DIAL_MINUTES / 2) return from > DIAL_MINUTES / 2 ? DIAL_MINUTES : MIN_MINUTES;
    return next;
  };
  const onFace = (x: number, y: number): boolean => {
    const el = canvas.current;
    if (!el) return false;
    const box = el.getBoundingClientRect();
    return Math.hypot(x - box.left - box.width / 2, y - box.top - box.height / 2) < (box.width * FACE);
  };

  return (
    <div className="groove-focus-dial" style={{ width: SIZE, height: SIZE }}>
      <canvas
        ref={canvas}
        role="slider"
        tabIndex={0}
        aria-label={t('focus.length')}
        aria-valuemin={MIN_MINUTES}
        aria-valuemax={DIAL_MINUTES}
        aria-valuenow={minutes}
        aria-valuetext={t('focus.minutes', { count: minutes })}
        style={{ width: SIZE, height: SIZE, cursor: held ? 'grabbing' : 'grab' }}
        onPointerDown={(e) => {
          if (e.button !== 0 || onFace(e.clientX, e.clientY)) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setHeld(true);
          const next = at(e.clientX, e.clientY);
          if (next !== null) onMinutes(next);
        }}
        onPointerMove={(e) => {
          hovering.current = !onFace(e.clientX, e.clientY);
          if (!held) return;
          const next = at(e.clientX, e.clientY);
          if (next !== null && next !== target.current) onMinutes(next);
        }}
        onPointerLeave={() => (hovering.current = false)}
        onPointerUp={() => setHeld(false)}
        onPointerCancel={() => setHeld(false)}
        onWheel={(e) => onMinutes(dialMinutes(minutes - Math.sign(e.deltaY) * 5))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onMinutes(dialMinutes(minutes + 5));
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onMinutes(dialMinutes(minutes - 5));
          else return;
          e.preventDefault();
        }}
      />
      <button
        type="button"
        className="groove-focus-dial-start"
        onPointerDown={() => (pressed.current = 1)}
        onClick={onStart}
        aria-label={`${t('focus.start')} · ${t('focus.minutes', { count: minutes })}`}
      >
        <span className="groove-focus-dial-minutes">{minutes}</span>
        <span className="groove-focus-dial-go">{t('focus.dive')}</span>
      </button>
    </div>
  );
}
