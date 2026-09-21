import { useEffect, useRef } from 'react';
import { GLOW, levelFrom, settleLevel, watchBars } from '@/core/visualizer';
import { advance, launch, type Mote } from '@/core/visualizer/motes';
import { NO_BEAT, listen, type Beat } from '@/core/visualizer/onset';
import { useSettingsStore } from '@/core/settings/store';
import { prefersReducedMotion } from '@/core/utils/motion';
import { whilePaletteMoves } from '@/core/theme/palette';
import { HALO_ALPHA, HALO_WIDTH, RIM_ALPHA, orbitMargin, orbitRadius, streak } from './orbit';

/**
 * The window's edge lighting, gone round the record.
 *
 * The same lights that rise along the window's edges — the same motes, born on
 * the same hits, at the same rate, tuned by the same dials — travelling round
 * the picture on the label instead, and the rim under them taking each hit as
 * it lands. With the lyrics open that picture is what is being looked at, and
 * something keeping time there is what stops a reader losing the beat: neither
 * the window's edge nor the record on the deck is being looked at at all.
 *
 * All of it keeps to the rim. The words start a little outside the label, and
 * a light that reached them would be competing with the thing it is there to
 * keep time for.
 *
 * A canvas, for the reason the window's edge is one: a handful of small lights
 * redrawn sixty times a second is a canvas or it is sixty style recalculations
 * a second. Small, though, and cheap by the pixel — it covers the label and the
 * rim just outside it rather than the whole record, and it is rasterised at one
 * pixel per pixel. What this costs is its area, on every frame.
 *
 * The record turns under it a line at a time and the lights do not turn with
 * it. They are light on the record rather than something printed on it, which
 * is the same reason `DiscLight` stays where it is.
 */

interface Accents {
  low: string;
  high: string;
}

/** A colour at a share of itself, for a gradient stop that is on its way in. */
function fade(colour: string, share: number): string {
  return `color-mix(in srgb, ${colour} ${Math.round(share * 100)}%, transparent)`;
}

function accents(root: HTMLElement): Accents {
  const css = getComputedStyle(root);
  const pick = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    low: pick('--color-brass-600', '#a2743f'),
    high: pick('--color-brass-400', '#e0b071'),
  };
}

export function DiscOrbit({
  /** The record's radius, and the label's share of it: where the lights run. */
  radius,
  labelRatio,
}: {
  radius: number;
  labelRatio: number;
}) {
  const on = useSettingsStore((s) => s.windowGlow);
  const strength = useSettingsStore((s) => s.glowStrength);
  const sensitivity = useSettingsStore((s) => s.glowSensitivity);
  const speed = useSettingsStore((s) => s.glowSpeed);
  const flare = useSettingsStore((s) => s.glowFlare);

  const canvas = useRef<HTMLCanvasElement | null>(null);
  const measured = useRef(0);
  const spectrum = useRef<number[]>([]);
  /** What the sliders say, so moving one changes the lights rather than
      throwing away the ones in the air. */
  const tuning = useRef({ strength, sensitivity, speed, flare });
  useEffect(() => {
    tuning.current = { strength, sensitivity, speed, flare };
  }, [strength, sensitivity, speed, flare]);

  const ring = orbitRadius(radius, labelRatio);
  // Room for the widest light the dials allow, so none of them is ever cut
  // off against the canvas's own edge.
  const side = Math.ceil((ring + orbitMargin()) * 2);

  useEffect(() => {
    const el = canvas.current;
    if (!on || !el || prefersReducedMotion()) return;

    const context = el.getContext('2d');
    if (!context) return;

    let colours = accents(document.documentElement);
    const reread = () => {
      colours = accents(document.documentElement);
    };
    const themed = new MutationObserver(reread);
    themed.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-ground', 'style'],
    });
    // And every frame of a theme's own fade, so these colours move with it
    // rather than arriving a theme late.
    const fading = whilePaletteMoves(reread);

    const label = radius * labelRatio;
    // One backing pixel per pixel, whatever the screen's ratio is. Everything
    // drawn here is a soft light with no edge anywhere in it, and at a ratio of
    // one and a half that is the same picture rasterised over twice as many
    // pixels — every frame, for a difference nobody can point at.
    el.width = side;
    el.height = side;
    const centre = side / 2;

    let motes: Mote[] = [];
    let owed = 0;
    let showing = 0;
    let punch = 0;
    let beat: Beat = NO_BEAT;
    let last = performance.now();
    let frame = 0;

    /** One light on the rim, drawn as its own soft pass and then its bright one. */
    const light = (from: number, to: number, width: number, alpha: number) => {
      const span = (to - from) / (Math.PI * 2);
      // Nothing at the tail, deep brass through the middle of it, bright at
      // the head. Two stops on the way up rather than one, so the tail comes
      // in as a ramp instead of arriving at a colour.
      const paint = context.createConicGradient(from, centre, centre);
      const at = (share: number) => Math.min(1, span * share);
      paint.addColorStop(0, 'transparent');
      paint.addColorStop(at(0.35), fade(colours.low, 0.35));
      paint.addColorStop(at(0.72), colours.low);
      paint.addColorStop(Math.min(1, span), colours.high);
      if (span < 1) paint.addColorStop(Math.min(1, span + 0.002), 'transparent');
      context.strokeStyle = paint;
      context.lineCap = 'round';

      // The soft pass, while there is enough of it to see. It is three times
      // the width of the light and so most of what this costs; under a fiftieth
      // it is a wide band of nothing.
      if (alpha * HALO_ALPHA > 0.02) {
        context.globalAlpha = alpha * HALO_ALPHA;
        context.lineWidth = width * HALO_WIDTH;
        context.beginPath();
        context.arc(centre, centre, ring, from, to);
        context.stroke();
      }

      context.globalAlpha = alpha;
      context.lineWidth = width;
      context.beginPath();
      context.arc(centre, centre, ring, from, to);
      context.stroke();
    };

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const seconds = Math.min(0.05, (now - last) / 1000);
      last = now;

      const { strength: force, sensitivity: ear, speed: pace, flare: felt } = tuning.current;
      const climb = GLOW.speed(pace);
      showing = settleLevel(showing, measured.current);
      ({ motes, owed } = advance(motes, showing, seconds, owed, Math.random, climb));

      const heard = listen(beat, spectrum.current, seconds, GLOW.threshold(ear));
      beat = heard.beat;
      if (heard.hit > 0) motes = launch(motes, showing, heard.hit, Math.random, climb);
      // What is left of the last hit, fading over as long as the window's edge
      // feels one, so a burst here and a flare there are the same gesture.
      punch = Math.max(0, punch - (seconds * 1000) / GLOW.flare(felt));
      punch = Math.max(punch, heard.hit);

      context.clearRect(0, 0, side, side);
      if (motes.length === 0 && punch <= 0.01) return;

      // Added rather than painted over: where two lights overlap the rim is
      // brighter, which is what light does.
      context.globalCompositeOperation = 'lighter';

      // The beat, on the rim itself: the whole circle takes the hit, so it is
      // read where the eye already is rather than wherever a travelling light
      // happens to be.
      if (punch > 0.01) {
        context.globalAlpha = Math.min(1, punch * RIM_ALPHA * GLOW.strength(force));
        context.lineWidth = 2 + punch * 2;
        context.strokeStyle = colours.high;
        context.beginPath();
        context.arc(centre, centre, ring, 0, Math.PI * 2);
        context.stroke();
      }

      for (const mote of motes) {
        const at = streak(mote, showing, GLOW.strength(force));
        if (at.alpha <= 0) continue;
        light(at.tail, at.head, at.width, at.alpha);
      }

      // And off the label again. A light is thicker than the gap between the
      // rim and itself, so its soft half lay over the cover — the one part of
      // the record that is somebody's artwork, and the one part that is
      // already bright. Taken away over a few pixels rather than at a line, so
      // what is left is a light that stops at the rim rather than a disc with
      // a hole cut in it.
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'destination-out';
      const clear = context.createRadialGradient(centre, centre, label - 8, centre, centre, label - 2);
      clear.addColorStop(0, '#000');
      clear.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = clear;
      context.beginPath();
      context.arc(centre, centre, label, 0, Math.PI * 2);
      context.fill();
      context.globalCompositeOperation = 'source-over';
    };
    frame = requestAnimationFrame(draw);

    const unwatch = watchBars((bars) => {
      measured.current = levelFrom(bars);
      spectrum.current = bars;
    });

    return () => {
      cancelAnimationFrame(frame);
      unwatch();
      themed.disconnect();
      fading();
      context.clearRect(0, 0, side, side);
    };
  }, [on, side, ring, radius, labelRatio]);

  if (!on) return null;

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{
        width: side,
        height: side,
        left: `calc(50% - ${side / 2}px)`,
        top: `calc(50% - ${side / 2}px)`,
      }}
    />
  );
}
