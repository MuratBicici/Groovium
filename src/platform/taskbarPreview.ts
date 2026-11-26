import { say } from '@/core/i18n';
import { usePlayerStore } from '@/core/store';
import type { TrackMetadata } from '@/core/types';
import { isTauri } from '@/core/utils/env';
import { log } from '@/platform/log';

/**
 * The picture over Groovium on the taskbar.
 *
 * Windows asks for it at the size it wants (`src-tauri/src/taskbar.rs`), and it
 * is drawn here, where the song, the theme and the language are known: the
 * cover in the middle, how far the song has got under it, and its name and
 * artist below. With nothing on, the same square, plain, with a note in it, so
 * the picture keeps its shape from one to the other.
 *
 * Windows keeps the last picture it was given and asks for a new one only when
 * told the old one is out of date (`taskbar_preview_changed`), so it is told on
 * every change, on screen or not; it only draws again when it shows it.
 */

/** Must match `PREVIEW_EVENT` in `src-tauri/src/taskbar.rs`. */
const PREVIEW_EVENT = 'taskbar:preview';

/** How often a playing song's progress is brought up to date while the preview shows. */
const TICK_MS = 1000;

/** Tabler's `music`, on its 24 grid: the note in the empty square. */
const NOTE = 'M3 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0 M13 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0 M9 17v-13h10v13 M9 8h10';

interface Palette {
  ground: string;
  groundDeep: string;
  accent: string;
  text: string;
  muted: string;
  hollow: string;
}

function palette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    ground: read('--color-shell-800', '#211913'),
    groundDeep: read('--color-shell-900', '#16110d'),
    accent: read('--color-brass-400', '#e0b071'),
    text: read('--color-cream-50', '#f6efe4'),
    muted: read('--color-cream-400', '#a9977e'),
    hollow: read('--color-shell-700', '#2a1f18'),
  };
}

/** Covers that are loaded, by address; null for one that could not be drawn from. */
const covers = new Map<string, HTMLImageElement | null>();

/** The cover if it is ready to draw, starting it loading if it is not. */
function coverOf(url: string | undefined, onReady: () => void): HTMLImageElement | null {
  if (!url) return null;
  if (covers.has(url)) return covers.get(url) ?? null;
  covers.set(url, null);
  const image = new Image();
  // So the picture it is drawn into can still be read back and handed over.
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    covers.set(url, image);
    onReady();
  };
  image.onerror = () => covers.set(url, null);
  image.src = url;
  return null;
}

/**
 * `text` in at most `lines` lines of `width`, the last ending in an ellipsis if
 * it had to be cut. Words are kept whole where they fit, and broken where one
 * alone is wider than the line.
 */
export function wrap(
  measure: (text: string) => number,
  text: string,
  width: number,
  lines: number,
): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest && out.length < lines) {
    if (measure(rest) <= width) {
      out.push(rest);
      rest = '';
      break;
    }
    // The most of it that fits, at a space if there is one.
    let fit = 0;
    while (fit < rest.length && measure(rest.slice(0, fit + 1)) <= width) fit += 1;
    const space = rest.lastIndexOf(' ', fit);
    const cut = space > 0 ? space : Math.max(1, fit);
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest && out.length > 0) {
    let last = `${out[out.length - 1]}…`;
    while (last.length > 1 && measure(last) > width) last = `${last.slice(0, -2).trimEnd()}…`;
    out[out.length - 1] = last;
  }
  return out;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Draw the preview, `width` by `height` physical pixels: the cover in the
 * middle at the top, a thin line under it for how far the song has got, and its
 * name and artist below, each on one line. Every size is a share of the height
 * Windows gave, so it looks the same at any scale.
 */
export function drawPreview(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  track: TrackMetadata | null,
  progress: number,
  cover: HTMLImageElement | null,
): void {
  const colours = palette();
  const font = getComputedStyle(document.body).fontFamily || "'Segoe UI', sans-serif";
  const H = height;

  const ground = ctx.createLinearGradient(0, 0, width, height);
  ground.addColorStop(0, colours.hollow);
  ground.addColorStop(1, colours.groundDeep);
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, width, height);

  const side = Math.round(H * 0.54);
  const bar = track ? Math.max(2, Math.round(H * 0.025)) : 0;
  const barGap = track ? Math.round(H * 0.042) : 0;
  const titleGap = Math.round(H * (track ? 0.05 : 0.06));
  const titleSize = H * 0.0975;
  const artistSize = H * 0.089;
  const pad = Math.round(H * 0.1);
  const room = width - pad * 2;

  const title = track ? track.title : say('track.none');
  const artist = track ? track.artist : say('track.hint');
  const titleLine = fitLine(ctx, title, room, titleSize, 500, font);
  const artistLine = fitLine(ctx, artist, room, artistSize, 400, font);

  const block = side + barGap + bar + titleGap + titleLine.size * 1.25 + artistLine.size * 1.3;
  const top = Math.round((H - block) / 2);
  const sx = Math.round((width - side) / 2);
  const sy = top;
  const radius = Math.max(2, side * 0.07);

  // The square: the cover, or the same square plain with a note in it.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = side * 0.15;
  ctx.shadowOffsetY = side * 0.06;
  ctx.fillStyle = colours.ground;
  roundedRect(ctx, sx, sy, side, side, radius);
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundedRect(ctx, sx, sy, side, side, radius);
  ctx.clip();
  if (cover && track) {
    const scale = Math.max(side / cover.naturalWidth, side / cover.naturalHeight);
    const w = cover.naturalWidth * scale;
    const h = cover.naturalHeight * scale;
    ctx.drawImage(cover, sx + (side - w) / 2, sy + (side - h) / 2, w, h);
  } else {
    const unit = (side * 0.42) / 24;
    ctx.translate(sx + (side - 24 * unit) / 2, sy + (side - 24 * unit) / 2);
    ctx.scale(unit, unit);
    ctx.strokeStyle = colours.muted;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(NOTE));
  }
  ctx.restore();
  if (!(cover && track)) {
    ctx.save();
    ctx.strokeStyle = 'rgba(246,239,228,0.1)';
    ctx.lineWidth = Math.max(1, H / 118);
    roundedRect(ctx, sx + 0.5, sy + 0.5, side - 1, side - 1, radius);
    ctx.stroke();
    ctx.restore();
  }

  let y = sy + side;
  if (track) {
    // As wide as the cover, under it.
    y += barGap;
    ctx.fillStyle = 'rgba(224,176,113,0.2)';
    roundedRect(ctx, sx, y, side, bar, bar / 2);
    ctx.fill();
    ctx.fillStyle = colours.accent;
    roundedRect(ctx, sx, y, Math.max(bar, side * Math.min(1, Math.max(0, progress))), bar, bar / 2);
    ctx.fill();
    y += bar;
  }

  y += titleGap;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  ctx.font = `500 ${titleLine.size}px ${font}`;
  ctx.fillStyle = colours.text;
  ctx.fillText(titleLine.text, width / 2, y);
  y += titleLine.size * 1.25;
  ctx.font = `400 ${artistLine.size}px ${font}`;
  ctx.fillStyle = colours.muted;
  ctx.fillText(artistLine.text, width / 2, y);
  ctx.textAlign = 'start';
}

/**
 * One line of `text` that fits `room`: as it is if it fits, a little smaller
 * if that is enough, and cut at a word with an ellipsis if it is not.
 */
function fitLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  room: number,
  size: number,
  weight: number,
  font: string,
): { text: string; size: number } {
  let at = size;
  ctx.font = `${weight} ${at}px ${font}`;
  while (at > size * 0.85 && ctx.measureText(text).width > room) {
    at -= 0.5;
    ctx.font = `${weight} ${at}px ${font}`;
  }
  return { text: wrap((s) => ctx.measureText(s).width, text, room, 1)[0] ?? '', size: at };
}

async function invoke(command: string, args?: unknown, options?: { headers: Record<string, string> }) {
  const core = await import('@tauri-apps/api/core');
  return core.invoke(command, args as never, options);
}

/** Begin answering Windows. Returns a function that stops. */
export function startTaskbarPreview(): () => void {
  if (!isTauri()) return () => {};

  const changed = () => {
    void invoke('taskbar_preview_changed').catch(() => {});
  };

  const answer = (width: number, height: number) => {
    const { currentTrack, positionMs, durationMs } = usePlayerStore.getState();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cover = currentTrack ? coverOf(currentTrack.coverArtUrl, changed) : null;
    const progress = durationMs > 0 ? positionMs / durationMs : 0;
    drawPreview(ctx, width, height, currentTrack, progress, cover);
    let pixels: Uint8ClampedArray;
    try {
      pixels = ctx.getImageData(0, 0, width, height).data;
    } catch {
      // A cover from somewhere that would not let it be read back: drawn
      // without it from now on.
      if (currentTrack?.coverArtUrl) covers.set(currentTrack.coverArtUrl, null);
      drawPreview(ctx, width, height, currentTrack, progress, null);
      pixels = ctx.getImageData(0, 0, width, height).data;
    }
    void invoke('taskbar_thumbnail', new Uint8Array(pixels.buffer), {
      headers: { width: String(width), height: String(height) },
    }).catch((err: unknown) => log('warn', 'taskbar', 'could not hand over the preview', err));
  };

  let unlisten: (() => void) | null = null;
  let stopped = false;
  void import('@tauri-apps/api/event')
    .then(({ listen }) => listen<{ width: number; height: number }>(PREVIEW_EVENT, (e) => answer(e.payload.width, e.payload.height)))
    .then((stop) => {
      if (stopped) {
        stop();
        return;
      }
      unlisten = stop;
      // Windows may have asked before this was listening, and been left with
      // nothing: asked again, now that the answer will be heard.
      changed();
    })
    .catch((err: unknown) => log('warn', 'taskbar', 'could not listen for the preview', err));

  // What is in it changing: a different song, or playing and pausing.
  const unsubscribe = usePlayerStore.subscribe((s, prev) => {
    if (s.currentTrack !== prev.currentTrack || s.playbackState !== prev.playbackState) changed();
  });
  // And the progress, while it moves.
  const ticking = setInterval(() => {
    if (usePlayerStore.getState().playbackState === 'PLAYING') changed();
  }, TICK_MS);

  return () => {
    stopped = true;
    unlisten?.();
    unsubscribe();
    clearInterval(ticking);
  };
}
