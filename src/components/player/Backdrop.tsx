import { useEffect, useRef } from 'react';
import {
  BACKDROP,
  BACKDROP_TUNING,
  breathing,
  drift,
  ease,
  easeColour,
  falloffStops,
  glint,
  surging,
  turned,
  wheel,
  wheelColours,
  type Speck,
} from '@/core/visualizer/backdrop';
import { levelFrom, watchBars } from '@/core/visualizer';
import { listen, NO_BEAT, type Beat } from '@/core/visualizer/onset';
import { readCover } from '@/core/theme/readCover';
import { whilePaletteMoves } from '@/core/theme/palette';
import { mixOklab, parseCssColour, parseHex, type Rgb } from '@/core/utils/colour';
import { prefersReducedMotion } from '@/core/utils/motion';
import { usePlayerStore } from '@/core/store';
import { useShown } from '@/platform/shown';

/**
 * The light behind everything: the cover's colours turning with the record,
 * and dust in the lamp over the deck. The numbers are in
 * `src/core/visualizer/backdrop.ts`; this only draws them.
 *
 * Two canvases under the shell's content, the visualiser's grooves over them.
 * The wheel is drawn on a canvas a tenth of the window's size and stretched to
 * fill it: the browser's own smoothing on the way up is a blur as wide as ten
 * pixels for nothing, which is what leaves no edge anywhere in it, and a
 * canvas that small costs nothing to redraw. The dust is drawn at one pixel per
 * pixel of the page, which is all fifty specks need. A faint grain over both
 * keeps a dark gradient from stepping in eight-bit bands, and a shade at the
 * foot keeps the controls on a calm ground.
 */

/** How much smaller than the window the wheel is drawn. */
const SHRINK = 10;
/** Frames a second: the spectrum's own rate, and plenty for something this slow. */
const FPS = 30;
/** How long the record's place is trusted before it is measured again. */
const MEASURE_MS = 400;
/** One turn of the record, in milliseconds: `.groove-platter`'s animation. */
const RECORD_TURN_MS = 4500;

export function Backdrop({
  on,
  brightness,
  spread,
  speed,
  breath,
  dust,
}: {
  on: boolean;
  brightness: number;
  spread: number;
  speed: number;
  breath: number;
  dust: number;
}) {
  const shown = useShown();
  const wheelCanvas = useRef<HTMLCanvasElement | null>(null);
  const dustCanvas = useRef<HTMLCanvasElement | null>(null);
  const measured = useRef(0);
  const spectrum = useRef<number[]>([]);
  /** The cover's colours, or none while there is no cover or it has none. */
  const coverHues = useRef<Rgb[]>([]);
  const playing = usePlayerStore((s) => s.playbackState === 'PLAYING');
  const playingRef = useRef(playing);
  const cover = usePlayerStore((s) => (s.currentTrack ?? s.starting)?.coverArtUrl);

  // The sliders, read each frame rather than redrawn for: dragging one should
  // change the light under the hand, not start it over.
  const tuning = useRef({ brightness, spread, speed, breath, dust });
  useEffect(() => {
    tuning.current = { brightness, spread, speed, breath, dust };
  }, [brightness, spread, speed, breath, dust]);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  // The cover's colours, from the same read the theme uses — cached, so a
  // record come round again costs nothing.
  useEffect(() => {
    if (!on) return;
    let alive = true;
    if (!cover) {
      coverHues.current = [];
      return;
    }
    void readCover(cover).then((seen) => {
      if (!alive) return;
      const hues = seen.read ? (seen.palette?.hues ?? []) : [];
      coverHues.current = hues.map((hex) => parseHex(hex)).filter((rgb): rgb is Rgb => rgb !== null);
    });
    return () => {
      alive = false;
    };
  }, [on, cover]);

  useEffect(() => {
    if (!on || !shown) return;
    return watchBars((bars) => {
      measured.current = levelFrom(bars);
      spectrum.current = bars;
    });
  }, [on, shown]);

  useEffect(() => {
    const swirl = wheelCanvas.current;
    const air = dustCanvas.current;
    if (!on || !shown || !swirl || !air) return;
    const sc = swirl.getContext('2d');
    const ac = air.getContext('2d');
    if (!sc || !ac) return;

    const root = document.documentElement;
    let theme = themeColours(root);
    let light = root.dataset.ground === 'light';
    const reread = () => {
      theme = themeColours(root);
      light = root.dataset.ground === 'light';
    };
    const themed = new MutationObserver(reread);
    themed.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-ground', 'style'] });
    const fading = whilePaletteMoves(reread);

    let colours = wheelColours(coverHues.current, theme);
    let width = 0;
    let height = 0;
    let centre = { x: 0, y: 0 };
    let measuredAt = -Infinity;
    let recordWas: number | null = null;
    let angle = 0;
    let showing = 0;
    let kick = 0;
    let surge = 0;
    let beat: Beat = NO_BEAT;
    let specks: Speck[] = [];
    let last = performance.now();
    let owed = 0;
    let frame = 0;

    const measure = (now: number) => {
      const box = swirl.parentElement?.getBoundingClientRect();
      if (!box) return;
      const w = Math.max(1, Math.round(box.width));
      const h = Math.max(1, Math.round(box.height));
      if (w !== width || h !== height) {
        width = w;
        height = h;
        swirl.width = Math.max(2, Math.ceil(w / SHRINK));
        swirl.height = Math.max(2, Math.ceil(h / SHRINK));
        air.width = w;
        air.height = h;
      }
      centre = recordCentre(box);
      measuredAt = now;
    };

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      owed += Math.min(0.1, (now - last) / 1000);
      last = now;
      if (owed < 1 / FPS) return;
      const seconds = owed;
      owed = 0;
      if (now - measuredAt > MEASURE_MS) measure(now);

      const still = prefersReducedMotion();
      const t = tuning.current;
      const breathe = still ? 0 : BACKDROP_TUNING.breath(t.breath);

      // The level settles slowly, so it breathes rather than flickers, and
      // only while something is playing: a paused song is a still room.
      const level = playingRef.current ? measured.current : 0;
      showing = ease(showing, level, seconds, BACKDROP.levelTau);
      const heard = listen(beat, playingRef.current ? spectrum.current : [], seconds);
      beat = heard.beat;
      kick = Math.max(heard.hit, kick * Math.exp(-seconds / BACKDROP.kickTau));
      surge = surging(surge, heard.hit, breathe, seconds);

      // Turned as far as the record turned, at the Speed slider's share of it.
      const recordNow = recordAngle();
      if (recordNow !== null && recordWas !== null && !still) {
        angle += turned(recordWas, recordNow, BACKDROP_TUNING.speed(t.speed));
      }
      recordWas = recordNow;

      const target = wheelColours(coverHues.current, theme);
      colours = target.map((to, k) => easeColour(colours[k] ?? to, to, seconds));

      paintWheel(sc, swirl, colours, angle, centre, width, height, {
        ...breathing(showing, kick, breathe),
        strength: BACKDROP_TUNING.brightness(t.brightness) * (light ? 0.55 : 1),
        spread: BACKDROP_TUNING.spread(t.spread),
      });

      const count = still ? 0 : Math.round(BACKDROP.specks * BACKDROP_TUNING.dust(t.dust));
      specks = drift(specks, count, showing, seconds, Math.random, surge);
      paintDust(ac, specks, centre, width, height, kick * breathe, light);
    };

    measure(performance.now());
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      themed.disconnect();
      fading();
    };
  }, [on, shown]);

  if (!on) return null;

  // All four at `-z-10`, under the shell's content and — earlier in the
  // document — under the visualiser too. A canvas needs a CSS size as well as
  // `inset-0`; see the note in `Visualizer`.
  return (
    <>
      <canvas
        ref={wheelCanvas}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full rounded-[var(--radius-widget)]"
      />
      <canvas
        ref={dustCanvas}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full rounded-[var(--radius-widget)]"
      />
      <div aria-hidden="true" className="groove-backdrop-grain pointer-events-none absolute inset-0 -z-10" />
      <div aria-hidden="true" className="groove-backdrop-shade pointer-events-none absolute inset-0 -z-10" />
    </>
  );
}

/** The theme's own colours, for a cover with too few of its own, or none. */
function themeColours(root: HTMLElement): Rgb[] {
  const css = getComputedStyle(root);
  const read = (name: string, fallback: Rgb) => parseCssColour(css.getPropertyValue(name).trim()) ?? fallback;
  const bright = read('--color-brass-400', { r: 224, g: 176, b: 113 });
  const deep = read('--color-brass-600', { r: 162, g: 116, b: 63 });
  const shell = read('--color-shell-600', { r: 74, g: 58, b: 46 });
  return [bright, deep, mixOklab(bright, shell, 0.55)];
}

/**
 * Where the record on the deck is, against the shell; or, with no record on
 * the deck to be seen, where it would be — the upper middle of the player.
 */
function recordCentre(shell: DOMRect): { x: number; y: number } {
  const disc = document.querySelector<HTMLElement>('[data-morph="disc"]');
  const box = disc?.getBoundingClientRect();
  if (box && box.width > 8 && disc?.offsetParent !== null) {
    return { x: box.left + box.width / 2 - shell.left, y: box.top + box.height / 2 - shell.top };
  }
  const player = document.querySelector('main')?.getBoundingClientRect();
  if (player) return { x: player.left + player.width / 2 - shell.left, y: player.top + player.height * 0.32 - shell.top };
  return { x: shell.width / 2, y: shell.height * 0.32 };
}

/** The record's angle, in radians, from its own animation; null with none running. */
function recordAngle(): number | null {
  const spin = document.querySelector('.groove-platter')?.getAnimations()[0];
  const at = spin?.currentTime;
  if (typeof at !== 'number') return null;
  return ((at % RECORD_TURN_MS) / RECORD_TURN_MS) * Math.PI * 2;
}

const rgb = ({ r, g, b }: Rgb, alpha = 1) => `rgba(${r},${g},${b},${alpha})`;

/** The wheel, small: a turn of colour round the record, fading but never to nothing. */
function paintWheel(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  colours: Rgb[],
  angle: number,
  centre: { x: number; y: number },
  width: number,
  height: number,
  look: { alpha: number; reach: number; strength: number; spread: number },
): void {
  const w = canvas.width;
  const h = canvas.height;
  const cx = (centre.x / width) * w;
  const cy = (centre.y / height) * h;
  context.globalCompositeOperation = 'source-over';
  context.clearRect(0, 0, w, h);

  const turn = context.createConicGradient(angle, cx, cy);
  for (const stop of wheel(colours)) turn.addColorStop(stop.at, rgb(stop.colour));
  context.fillStyle = turn;
  context.fillRect(0, 0, w, h);

  // Faded by distance, and by how strongly it shows at all, in one pass.
  const reach = Math.max(w, h) * look.reach * look.spread;
  const fade = context.createRadialGradient(cx, cy, 0, cx, cy, reach * 1.6);
  const shown = Math.min(1, look.alpha * look.strength);
  for (const stop of falloffStops()) fade.addColorStop(stop.at, `rgba(0,0,0,${(stop.strength * shown).toFixed(4)})`);
  context.globalCompositeOperation = 'destination-in';
  context.fillStyle = fade;
  context.fillRect(0, 0, w, h);
  context.globalCompositeOperation = 'source-over';
}

/** The dust, catching the lamp over the record. */
function paintDust(
  context: CanvasRenderingContext2D,
  specks: readonly Speck[],
  centre: { x: number; y: number },
  width: number,
  height: number,
  kick: number,
  light: boolean,
): void {
  context.clearRect(0, 0, width, height);
  if (specks.length === 0) return;
  // The lamp hangs a little above the record.
  const lampX = centre.x;
  const lampY = centre.y - height * 0.12;
  const reach = Math.max(width, height) * 0.55;
  const tint = light ? { r: 60, g: 46, b: 34 } : { r: 255, g: 232, b: 200 };
  for (const s of specks) {
    const x = s.x * width;
    const y = s.y * height;
    const near = Math.max(0, 1 - Math.hypot(x - lampX, y - lampY) / reach);
    const alpha = glint(near, kick) * (light ? 0.6 : 1);
    context.fillStyle = rgb(tint, Number(alpha.toFixed(3)));
    context.beginPath();
    context.arc(x, y, s.size * (1 + 0.35 * near * kick), 0, Math.PI * 2);
    context.fill();
  }
}
