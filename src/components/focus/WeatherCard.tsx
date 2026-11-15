import { useEffect, useRef } from 'react';
import type { Weather } from '@/core/focus/weather';
import { prefersReducedMotion } from '@/core/utils/motion';

const W = 220;
const H = 300;
/** How far rain may drift past either side before it comes round again, so a slanted rain never leaves a gap. */
const MARGIN = 60;

type Rgb = [number, number, number];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as Rgb;

interface Cloud {
  x: number;
  y: number;
  w: number;
  h: number;
  front: boolean;
  bumps: { x: number; r: number }[];
}

function makeCloud(front: boolean, x: number): Cloud {
  const w = (front ? 78 : 54) + Math.random() * (front ? 34 : 22);
  const jitter = () => 0.9 + Math.random() * 0.2;
  return {
    x,
    y: front ? 110 + Math.random() * 30 : 84 + Math.random() * 24,
    w,
    h: w * 0.28,
    front,
    bumps: [
      { x: w * 0.3 * jitter(), r: w * 0.2 * jitter() },
      { x: w * 0.54, r: w * 0.27 * jitter() },
      { x: w * 0.76 * jitter(), r: w * 0.17 * jitter() },
    ],
  };
}

/** A flat cloud: a rounded bar with three bumps on top, one colour. */
function cloudPath(ctx: CanvasRenderingContext2D, cloud: Cloud) {
  const base = cloud.y;
  const r = cloud.h / 2;
  ctx.moveTo(cloud.x + r, base);
  ctx.arc(cloud.x + r, base - r, r, Math.PI / 2, Math.PI * 1.5);
  ctx.lineTo(cloud.x + cloud.w - r, base - cloud.h);
  ctx.arc(cloud.x + cloud.w - r, base - r, r, -Math.PI / 2, Math.PI / 2);
  ctx.closePath();
  for (const bump of cloud.bumps) {
    const cy = base - cloud.h * 0.55 - bump.r * 0.35;
    ctx.moveTo(cloud.x + bump.x + bump.r, cy);
    ctx.arc(cloud.x + bump.x, cy, bump.r, 0, Math.PI * 2);
  }
}

/**
 * The weather, drawn: a painted sky over three hills that does what the
 * session's sound will do. Each of the four settings shows on it — how hard it
 * rains in the rain itself, how changeable in how it swells and how the wind
 * leans it, how often it thunders in the flashes, and how close in what they
 * are: a fork of lightning and the whole card lit, or a far flicker in the
 * clouds.
 *
 * Drawn every frame while it can be seen, by the time that passed rather than
 * by frames, and nothing at all while its side of the drawer is hidden.
 * `onFlash` reports how bright a flash is, for the room around the card.
 */
export function WeatherCard({
  weather,
  strikeSoon,
  onFlash,
}: {
  weather: Weather;
  /** Counted up when the thunder's settings change, so a flash comes soon and shows what they do. */
  strikeSoon: number;
  onFlash: (brightness: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const shake = useRef<HTMLDivElement | null>(null);
  const state = useRef({ weather, onFlash, next: 1.5 });

  useEffect(() => {
    state.current.weather = weather;
    state.current.onFlash = onFlash;
  });
  useEffect(() => {
    if (strikeSoon > 0) state.current.next = Math.min(state.current.next, 0.3);
  }, [strikeSoon]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = W * dpr;
    el.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const still = prefersReducedMotion();

    const clouds = [
      ...Array.from({ length: 3 }, (_, i) => makeCloud(false, i * 120 - 30)),
      ...Array.from({ length: 3 }, (_, i) => makeCloud(true, i * 95 + 40)),
    ];
    const drops = Array.from({ length: 320 }, () => ({
      x: Math.random() * (W + 2 * MARGIN) - MARGIN,
      y: Math.random() * H,
      speed: 0.6 + Math.random() * 0.6,
      floor: 0.78 + Math.random() * 0.2,
    }));
    let splashes: { x: number; y: number; life: number }[] = [];
    let pour = 0;
    let pourTo = 0;
    let pourFor = 0;
    let wind = 0;
    let windTo = 0;
    let windFor = 0;
    let flash = 0;
    let bolt: { points: [number, number][]; branch: [number, number][]; life: number; x: number } | null = null;
    let far = 0;
    let farX = W * 0.7;
    let flickers: number[] = [];
    let lit = 0;
    let litX = W / 2;
    let last = performance.now();
    let frame = 0;
    /** The light as reported, following the flashes quickly up and easing back down. */
    let shown = 0;
    let hidden = true;

    const makeBolt = () => {
      const points: [number, number][] = [];
      let x = 30 + Math.random() * (W - 60);
      let y = 40;
      points.push([x, y]);
      while (y < H * 0.66) {
        y += 9 + Math.random() * 15;
        x += (Math.random() - 0.5) * 28;
        points.push([x, y]);
      }
      const branch: [number, number][] = [];
      const from = points[2 + Math.floor(Math.random() * 3)];
      if (from) {
        let [bx, by] = from;
        branch.push([bx, by]);
        for (let i = 0; i < 6; i += 1) {
          by += 9 + Math.random() * 12;
          bx += (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 12);
          branch.push([bx, by]);
        }
      }
      return { points, branch, life: 1, x: points[0]![0] };
    };

    const strike = (now: number) => {
      const { power } = state.current.weather;
      const near = Math.max(0, Math.min(1, power * 0.8 + Math.random() * 0.4 - 0.2 + (pour > 0.12 ? 0.12 : 0)));
      if (near > 0.5) {
        flash = 0.6 + 0.4 * near;
        bolt = makeBolt();
        lit = 1;
        litX = bolt.x;
        if (near > 0.7 && !still) {
          shake.current?.animate(
            [
              { transform: 'translate(0, 0)' },
              { transform: 'translate(-3px, 1px)' },
              { transform: 'translate(3px, -1px)' },
              { transform: 'translate(-1px, 0)' },
              { transform: 'translate(0, 0)' },
            ],
            { duration: 320 },
          );
        }
      } else {
        farX = W * (0.15 + Math.random() * 0.7);
        flickers = [0, 0.12, 0.27, 0.38].slice(0, 2 + Math.floor(Math.random() * 3)).map((t) => now / 1000 + t);
      }
    };

    const drawClouds = (front: boolean, dark: number) => {
      for (const cloud of clouds) {
        if (cloud.front !== front) continue;
        const light: Rgb = front ? [240, 244, 248] : [196, 208, 222];
        const dim: Rgb = front ? [118, 130, 146] : [78, 90, 108];
        let colour = mix(light, dim, dark * 0.85);
        const near =
          lit * Math.max(0, 1 - Math.abs(cloud.x + cloud.w / 2 - litX) / 150) +
          far * 0.9 * Math.max(0, 1 - Math.abs(cloud.x + cloud.w / 2 - farX) / 110);
        if (near > 0) colour = mix(colour, [244, 247, 255], Math.min(1, near));
        ctx.fillStyle = `rgb(${colour.join(',')})`;
        ctx.beginPath();
        cloudPath(ctx, cloud);
        ctx.fill();
      }
    };

    const draw = (now: number) => {
      // Asked for first, so a frame that goes wrong cannot stop the ones after it.
      frame = requestAnimationFrame(draw);
      if (el.offsetParent === null) {
        // Put away mid-flash, it comes back to a dark sky rather than to the
        // end of a flash, and the window is not left lit.
        if (!hidden) {
          hidden = true;
          flash = 0;
          far = 0;
          lit = 0;
          bolt = null;
          flickers = [];
          shown = 0;
          state.current.onFlash(0);
        }
        last = now;
        return;
      }
      hidden = false;
      const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
      last = Math.max(last, now);
      const t = now / 1000;
      const { rain, change, thunder } = state.current.weather;

      pourFor -= dt;
      if (pourFor <= 0) {
        pourTo = change < 0.2 ? 0 : Math.random() < change * 0.75 ? 0.12 + Math.random() * 0.45 * change : -0.12 * change;
        pourFor = 2.5 + Math.random() * (6 - change * 3);
      }
      pour += (pourTo - pour) * (1 - Math.exp(-dt * (0.6 + change * 1.4)));
      windFor -= dt;
      if (windFor <= 0) {
        windTo = (Math.random() - 0.4) * (0.1 + change * 0.9);
        windFor = 2 + Math.random() * 4;
      }
      wind += (windTo - wind) * (1 - Math.exp(-dt * 1.5));
      const hard = Math.max(0, Math.min(1, rain + pour));

      state.current.next -= dt;
      if (thunder > 0.1 && state.current.next < 0) {
        strike(now);
        state.current.next = (1.9 - thunder * 1.5) * 2.6 + Math.random() * 3;
        if (Math.random() < 0.3 * thunder) state.current.next = 0.4;
      }
      far = Math.max(0, far - dt * 7);
      if (flickers.length > 0 && flickers[0]! <= t) {
        far = Math.max(far, 0.75 + Math.random() * 0.25);
        flickers.shift();
      }

      // The sky, darker the harder it rains and the more it thunders.
      const dark = Math.min(1, 0.15 + hard * 0.5 + thunder * 0.15);
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#b9d0e2');
      sky.addColorStop(0.55, '#5f8fae');
      sky.addColorStop(1, '#0b1a26');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = `rgba(8, 16, 26, ${dark * 0.75})`;
      ctx.fillRect(0, 0, W, H);
      if (far > 0) {
        const glow = ctx.createRadialGradient(farX, H * 0.5, 4, farX, H * 0.5, W * 0.55);
        glow.addColorStop(0, `rgba(215, 225, 255, ${far * 0.5})`);
        glow.addColorStop(1, 'rgba(215, 225, 255, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);
      }
      if (flash > 0) {
        ctx.fillStyle = `rgba(238, 244, 255, ${flash * 0.55})`;
        ctx.fillRect(0, 0, W, H);
      }

      // Clouds go one way only, faster the more changeable it is.
      for (const cloud of clouds) {
        if (!still) cloud.x += (3 + change * 14 + Math.abs(wind) * 12) * (cloud.front ? 1 : 0.55) * dt;
        if (cloud.x > W + 20) cloud.x = -cloud.w - 10;
      }
      drawClouds(false, dark);
      if (bolt && bolt.life > 0) {
        ctx.save();
        ctx.shadowColor = '#d6e4ff';
        ctx.shadowBlur = 16;
        ctx.strokeStyle = `rgba(250, 252, 255, ${bolt.life})`;
        ctx.lineJoin = 'round';
        for (const [line, width] of [
          [bolt.points, 2.6],
          [bolt.branch, 1.3],
        ] as const) {
          ctx.lineWidth = width;
          ctx.beginPath();
          line.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.stroke();
        }
        ctx.restore();
        bolt.life -= dt * (Math.random() < 0.3 ? 7 : 2.2);
      }
      drawClouds(true, dark);
      if (lit > 0) lit -= dt * (Math.random() < 0.25 ? 5 : 1.6);

      for (let layer = 0; layer < 3; layer += 1) {
        ctx.fillStyle = `#0b1a26${['66', 'aa', 'ff'][layer]}`;
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += 8) {
          ctx.lineTo(x, H * (0.6 + layer * 0.12) + Math.sin(x / (50 + layer * 20) + layer) * H * 0.04);
        }
        ctx.lineTo(W, H);
        ctx.fill();
      }
      if (hard > 0.55) {
        const mist = ctx.createLinearGradient(0, H * 0.3, 0, H * 0.85);
        mist.addColorStop(0, 'rgba(200, 215, 230, 0)');
        mist.addColorStop(1, `rgba(200, 215, 230, ${(hard - 0.55) * 0.4})`);
        ctx.fillStyle = mist;
        ctx.fillRect(0, H * 0.3, W, H * 0.7);
      }

      // The rain, wrapping round the sides so a slant never leaves a gap.
      const slant = wind * 1.4 + 0.12;
      const count = Math.round(25 + hard * 290);
      const speed = 180 + hard * 360;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.2 + hard * 0.3})`;
      ctx.lineWidth = 0.6 + hard * 0.8;
      ctx.beginPath();
      for (let i = 0; i < count; i += 1) {
        const drop = drops[i]!;
        drop.y += speed * drop.speed * dt;
        drop.x += speed * drop.speed * dt * slant;
        if (drop.x > W + MARGIN) drop.x -= W + 2 * MARGIN;
        else if (drop.x < -MARGIN) drop.x += W + 2 * MARGIN;
        if (drop.y > H * drop.floor) {
          if (Math.random() < hard * 0.5 && drop.x > 0 && drop.x < W) splashes.push({ x: drop.x, y: drop.y, life: 0.3 });
          drop.y -= H * drop.floor + 10 + Math.random() * 20;
          drop.x = Math.random() * (W + 2 * MARGIN) - MARGIN;
        }
        const length = (5 + hard * 12) * drop.speed;
        ctx.moveTo(drop.x, drop.y);
        ctx.lineTo(drop.x - length * slant, drop.y - length);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 0.8;
      splashes = splashes.filter((splash) => {
        splash.life -= dt;
        if (splash.life <= 0) return false;
        const r = Math.max(0.1, (0.3 - splash.life) * 14);
        ctx.beginPath();
        ctx.ellipse(splash.x, splash.y, r, r * 0.35, 0, Math.PI, 0);
        ctx.stroke();
        return true;
      });
      if (splashes.length > 120) splashes = splashes.slice(-120);

      const light = flash > 0 ? flash : far * 0.3;
      // Up fast, down slowly: a flash, then the light ebbing, rather than a
      // lamp switched on and off.
      shown += (light - shown) * (1 - Math.exp(-dt * (light > shown ? 30 : 5)));
      state.current.onFlash(shown);
      if (flash > 0) flash -= dt * 2.6;
    };
    frame = requestAnimationFrame(draw);
    const live = state.current;
    return () => {
      cancelAnimationFrame(frame);
      live.onFlash(0);
    };
  }, []);

  return (
    <div ref={shake} className="groove-weather-card-face">
      <canvas ref={canvas} aria-hidden="true" />
    </div>
  );
}
