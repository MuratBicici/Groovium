import { useEffect, useRef } from 'react';
import {
  apartFrom,
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
  turnHue,
  wheel,
  wheelColours,
  type Speck,
} from '@/core/visualizer/backdrop';
import { levelFrom, watchBars } from '@/core/visualizer';
import { listen, NO_BEAT, type Beat } from '@/core/visualizer/onset';
import { readCover } from '@/core/theme/readCover';
import { whilePaletteMoves } from '@/core/theme/palette';
import { mixOklab, oklabToRgb, parseCssColour, parseHex, rgbToOklab, type Rgb } from '@/core/utils/colour';
import { prefersReducedMotion } from '@/core/utils/motion';
import { usePlayerStore } from '@/core/store';
import { useShown } from '@/platform/shown';
import { useHeldTrack } from './DiscHold';
import { DRAWER_WIDTH, PLAYER_WIDTH } from '@/platform/window';

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
/**
 * How wide the dust's air is, in CSS pixels, centred on the record: the player
 * and a drawer's width either side of it, which is the widest the window gets
 * on either side. The specks keep their place against the record, so opening
 * the drawer uncovers dust that was already in the air instead of stretching
 * what was showing across the new width.
 */
const DUST_FIELD = PLAYER_WIDTH + 2 * DRAWER_WIDTH;
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
  const onDeck = usePlayerStore((s) => (s.currentTrack ?? s.starting)?.coverArtUrl);
  // A record lifted off the deck takes its colours with it: the room goes back
  // to the theme's for as long as it is in the hand, as the theme itself does.
  const inHand = useHeldTrack() !== null;
  const cover = inHand ? undefined : onDeck;

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

  /** Counted up by every frame of bands, so the hits are listened for once a frame of them. */
  const heardFrames = useRef(0);
  useEffect(() => {
    if (!on || !shown) return;
    return watchBars((bars) => {
      measured.current = levelFrom(bars);
      spectrum.current = bars;
      heardFrames.current += 1;
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

    /**
     * The cover's colours, the theme's where it has too few, all kept apart
     * from the accent — worked out again only when the cover or the theme is
     * another, not every frame.
     */
    let wantedFor: { hues: Rgb[]; theme: typeof theme } | null = null;
    let wantedLab: ReturnType<typeof rgbToOklab>[] = [];
    const wanted = () => {
      if (wantedFor?.hues !== coverHues.current || wantedFor.theme !== theme) {
        wantedFor = { hues: coverHues.current, theme };
        wantedLab = wheelColours(coverHues.current, theme.colours).map((c) => rgbToOklab(apartFrom(c, theme.accent)));
      }
      return wantedLab;
    };
    /** Where each colour has got to, kept in OKLab as fractions so a slow change arrives. */
    let colours = wanted().map((c) => ({ ...c }));
    /** The wheel's stops as the gradient takes them, kept until the colours move. */
    let stops: { at: number; css: string }[] = [];
    let stopsFor: string = '';
    /** What the wheel was last drawn with, so a frame that would draw the same is skipped. */
    let drawn = '';
    let width = 0;
    let height = 0;
    let centre = { x: 0, y: 0 };
    const places = placesOnPage();
    let recordWas: number | null = null;
    let angle = 0;
    let showing = 0;
    let kick = 0;
    /** The surge the hits have asked for, and the one being drawn, which eases up to it. */
    let surgeWanted = 0;
    let surge = 0;
    let beat: Beat = NO_BEAT;
    /** The frame of bands last listened to, and the time gone since. */
    let heardAt = heardFrames.current;
    let unheard = 0;
    let specks: Speck[] = [];
    let last = performance.now();
    let owed = 0;
    let frame = 0;
    /** The backing stores' sizes, which only ever grow. */
    let storeWidth = 0;
    let storeHeight = 0;

    /**
     * The shell's size and the record's place in it, every frame. Every frame
     * because the drawer opening is the shell changing size under the light
     * for a fifth of a second, and a measurement kept for even a few frames
     * drew the light where the record had been.
     *
     * The canvases are made as wide as the window ever gets, once, and only
     * grow; the shell clips what is past its edge. Sized to the shell instead,
     * they were made again on every frame of the drawer's movement — a fresh
     * backing store a frame, for the largest canvas on the page — and that was
     * the frame the dust stalled on.
     */
    const measure = () => {
      const box = swirl.parentElement?.getBoundingClientRect();
      if (!box) return;
      width = Math.max(1, Math.round(box.width));
      height = Math.max(1, Math.round(box.height));
      centre = places.recordCentre(box);
      // As wide as the window ever gets from the first frame, and only ever
      // grown: shrinking back to the player after the drawer shut was tried,
      // and measured no cheaper, but it put the canvases' making back at the
      // start of the drawer's next opening — the moment that had to be smooth.
      const needWidth = Math.max(width, PLAYER_WIDTH + DRAWER_WIDTH);
      if (needWidth > storeWidth || height > storeHeight) {
        storeWidth = Math.max(storeWidth, needWidth);
        storeHeight = Math.max(storeHeight, height);
        swirl.width = Math.ceil(storeWidth / SHRINK);
        swirl.height = Math.ceil(storeHeight / SHRINK);
        swirl.style.width = `${swirl.width * SHRINK}px`;
        swirl.style.height = `${swirl.height * SHRINK}px`;
        air.width = storeWidth;
        air.height = storeHeight;
        air.style.width = `${storeWidth}px`;
        air.style.height = `${storeHeight}px`;
        drawn = '';
      }
    };

    // Every frame the screen draws while music plays, not at the spectrum's
    // thirty a second: dust moving fast stepped visibly at thirty, a speck
    // jumping a few pixels at a time. With nothing playing, thirty is plenty
    // for dust drifting at its slowest.
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      // Up to a quarter of a second, so a frame that comes late moves the dust
      // as far as the time it took rather than slowing it for that moment.
      owed += Math.min(0.25, (now - last) / 1000);
      last = now;
      if (!playingRef.current && owed < 1 / 30) return;
      const seconds = owed;
      owed = 0;
      measure();

      const still = prefersReducedMotion();
      const t = tuning.current;
      const breathe = still ? 0 : BACKDROP_TUNING.breath(t.breath);

      // The level settles slowly, so it breathes rather than flickers, and
      // only while something is playing: a paused song is a still room.
      const level = playingRef.current ? measured.current : 0;
      showing = ease(showing, level, seconds, BACKDROP.levelTau);
      // The hits are listened for once per frame of bands, with the time since
      // the last one: the same frame heard twice is no step at all.
      unheard += seconds;
      let hit = 0;
      if (heardFrames.current !== heardAt) {
        heardAt = heardFrames.current;
        const heard = listen(beat, playingRef.current ? spectrum.current : [], unheard);
        beat = heard.beat;
        hit = heard.hit;
        unheard = 0;
      }
      kick = Math.max(hit, kick * Math.exp(-seconds / BACKDROP.kickTau));
      // Eased in rather than added at once, so a hit is a push and not a jolt.
      surgeWanted = surging(surgeWanted, hit, breathe, seconds);
      surge = ease(surge, surgeWanted, seconds, BACKDROP.surgeRise);

      // Turned as far as the record turned, at the Speed slider's share of it.
      const recordNow = places.recordAngle();
      if (recordNow !== null && recordWas !== null && !still) {
        angle += turned(recordWas, recordNow, BACKDROP_TUNING.speed(t.speed));
      }
      recordWas = recordNow;

      const target = wanted();
      colours = target.map((to, k) => easeColour(colours[k] ?? to, to, seconds));

      // The stops again only when the colours have moved enough to show.
      const key = colours.map((c) => `${c.L.toFixed(3)},${c.a.toFixed(3)},${c.b.toFixed(3)}`).join('|');
      if (key !== stopsFor) {
        stopsFor = key;
        stops = wheel(colours.map(oklabToRgb)).map((stop) => ({ at: stop.at, css: rgb(stop.colour) }));
      }

      // How far things reach is measured against the player, which the drawer
      // opening does not change, rather than against the window, which it
      // triples: the light spread three times as far as the window widened.
      const room = Math.max(height, PLAYER_WIDTH);
      const look = {
        ...breathing(showing, kick, breathe),
        strength: BACKDROP_TUNING.brightness(t.brightness) * (light ? 0.55 : 1),
        spread: BACKDROP_TUNING.spread(t.spread),
      };
      // Nothing to redraw when nothing about the wheel has moved: a paused
      // song with its colours arrived is the same picture every frame.
      const picture = `${stopsFor}/${angle.toFixed(4)}/${centre.x},${centre.y}/${room}/${look.alpha.toFixed(4)},${look.reach.toFixed(4)},${look.strength.toFixed(4)},${look.spread.toFixed(4)}`;
      if (picture !== drawn) {
        drawn = picture;
        paintWheel(sc, swirl, stops, angle, centre, room, look);
      }

      // As many as the widest the window gets needs, so the drawer opening
      // shows dust that was already there rather than spreading the rest out.
      const count = still ? 0 : Math.round(BACKDROP.specks * BACKDROP_TUNING.dust(t.dust) * DUST_FIELD / PLAYER_WIDTH);
      specks = drift(specks, count, showing, seconds, Math.random, surge);
      paintDust(ac, specks, centre, width, height, room, kick * breathe, light);
    };

    measure();
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      themed.disconnect();
      fading();
    };
  }, [on, shown]);

  if (!on) return null;

  // All four at `-z-10`, under the shell's content and — earlier in the
  // document — under the visualiser too. The two canvases are sized in pixels
  // from `measure`, as wide as the window ever gets, and pinned to the shell's
  // corner: the shell's own rounded clip cuts them to it.
  return (
    <>
      <canvas
        ref={wheelCanvas}
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 -z-10"
      />
      <canvas
        ref={dustCanvas}
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 -z-10"
      />
      <div aria-hidden="true" className="groove-backdrop-grain pointer-events-none absolute inset-0 -z-10" />
      <div aria-hidden="true" className="groove-backdrop-shade pointer-events-none absolute inset-0 -z-10" />
    </>
  );
}

/**
 * The theme's accent — what the grooves and the edge light are drawn in, and
 * what the light keeps apart from — and the theme's own colours for a cover
 * with too few, or none.
 *
 * Not the accent itself, which is the one colour the light must not be: the
 * shell lifted, and the accent turned a little either way round the wheel and
 * quietened, so they read as the theme's and not as colours of their own.
 */
function themeColours(root: HTMLElement): { accent: Rgb; colours: Rgb[] } {
  const css = getComputedStyle(root);
  const read = (name: string, fallback: Rgb) => parseCssColour(css.getPropertyValue(name).trim()) ?? fallback;
  const accent = read('--color-brass-400', { r: 224, g: 176, b: 113 });
  const shell = read('--color-shell-600', { r: 74, g: 58, b: 46 });
  return {
    accent,
    colours: [
      mixOklab(shell, accent, 0.25),
      mixOklab(turnHue(accent, -50), shell, 0.45),
      mixOklab(turnHue(accent, 50), shell, 0.45),
    ],
  };
}

/** How often an element looked for and not found is looked for again, in milliseconds. */
const LOOK_AGAIN_MS = 250;

/**
 * The record's place and angle, from the elements that show them — kept once
 * found rather than looked up in the document every frame, and looked for
 * again only when the one kept has left the page (a record put on in its
 * place), or a quarter of a second after one was not there to be found.
 */
function placesOnPage() {
  const kept = new Map<string, { el: Element | null; at: number }>();
  const find = (selector: string): Element | null => {
    const now = performance.now();
    const had = kept.get(selector);
    if (had?.el?.isConnected) return had.el;
    if (had && !had.el && now - had.at < LOOK_AGAIN_MS) return null;
    const el = document.querySelector(selector);
    kept.set(selector, { el, at: now });
    return el;
  };
  return {
    /**
     * Where the record on the deck is, against the shell; or, with no record
     * on the deck to be seen, where it would be — the upper middle of the player.
     */
    recordCentre(shell: DOMRect): { x: number; y: number } {
      const disc = find('[data-morph="disc"]') as HTMLElement | null;
      const box = disc?.getBoundingClientRect();
      if (box && box.width > 8 && disc?.offsetParent !== null) {
        return { x: box.left + box.width / 2 - shell.left, y: box.top + box.height / 2 - shell.top };
      }
      const player = find('main')?.getBoundingClientRect();
      if (player) return { x: player.left + player.width / 2 - shell.left, y: player.top + player.height * 0.32 - shell.top };
      return { x: shell.width / 2, y: shell.height * 0.32 };
    },
    /** The record's angle, in radians, from its own animation; null with none running. */
    recordAngle(): number | null {
      const at = find('.groove-platter')?.getAnimations()[0]?.currentTime;
      if (typeof at !== 'number') return null;
      return ((at % RECORD_TURN_MS) / RECORD_TURN_MS) * Math.PI * 2;
    },
  };
}

const rgb = ({ r, g, b }: Rgb, alpha = 1) => `rgba(${r},${g},${b},${alpha})`;

/** How strong the light is with distance, as stops: the same every frame, so worked out once. */
const FALLOFF = falloffStops();

/** The wheel, small: a turn of colour round the record, fading but never to nothing. */
function paintWheel(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  stops: readonly { at: number; css: string }[],
  angle: number,
  centre: { x: number; y: number },
  /** The size the reach is measured against, in CSS pixels: the player's, not the window's. */
  room: number,
  look: { alpha: number; reach: number; strength: number; spread: number },
): void {
  const w = canvas.width;
  const h = canvas.height;
  // The canvas is the window's pixels a tenth over, from the same corner.
  const cx = centre.x / SHRINK;
  const cy = centre.y / SHRINK;
  context.globalCompositeOperation = 'source-over';
  context.clearRect(0, 0, w, h);

  const turn = context.createConicGradient(angle, cx, cy);
  for (const stop of stops) turn.addColorStop(stop.at, stop.css);
  context.fillStyle = turn;
  context.fillRect(0, 0, w, h);

  // Faded by distance, and by how strongly it shows at all, in one pass.
  const reach = (room / SHRINK) * look.reach * look.spread;
  const fade = context.createRadialGradient(cx, cy, 0, cx, cy, reach * 1.6);
  const shown = Math.min(1, look.alpha * look.strength);
  for (const stop of FALLOFF) fade.addColorStop(stop.at, `rgba(0,0,0,${(stop.strength * shown).toFixed(4)})`);
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
  /** The size the lamp's reach is measured against: the player's, not the window's. */
  room: number,
  kick: number,
  light: boolean,
): void {
  // The whole of what was last drawn, which is wider than the window when the
  // drawer has just shut.
  context.clearRect(0, 0, context.canvas.width, height);
  if (specks.length === 0) return;
  // The lamp hangs a little above the record.
  const lampX = centre.x;
  const lampY = centre.y - height * 0.12;
  const reach = room * 0.55;
  // One colour for all of it, each speck's strength as the context's alpha
  // rather than a colour written out afresh for every speck every frame.
  context.fillStyle = light ? 'rgb(60,46,34)' : 'rgb(255,232,200)';
  const dim = light ? 0.6 : 1;
  for (const s of specks) {
    // Across the dust's own air, centred on the record, and not drawn where
    // the window does not reach.
    const x = centre.x + (s.x - 0.5) * DUST_FIELD;
    if (x < -4 || x > width + 4) continue;
    const y = s.y * height;
    const near = Math.max(0, 1 - Math.hypot(x - lampX, y - lampY) / reach);
    context.globalAlpha = glint(near, kick) * dim;
    context.beginPath();
    context.arc(x, y, s.size * (1 + 0.35 * near * kick), 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
}
