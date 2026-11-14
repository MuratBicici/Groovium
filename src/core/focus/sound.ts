import { log } from '@/platform/log';

/**
 * A focus session's sound: rain, from recordings.
 *
 * Two attempts at making rain from noise both sounded made, so this plays four
 * real recordings (see `public/ambient/rain/CREDITS.md`). Each is under a
 * minute, and a loop that short is heard as a loop. So two layers play at once,
 * each a stretch of a recording picked by chance from a point picked by
 * chance, and each crossfades into another before its stretch is up. The two
 * turn over at different moments, and nothing ever repeats on a beat.
 *
 * Its own audio context, not the music's: the equaliser's graph has its own
 * rules about gain, and nothing here should be able to touch them.
 *
 * Built to be gentle on ears first. It starts from silence and comes up over
 * three seconds; its level has a ceiling well under full scale; and a limiter
 * sits last, so no stretch of any recording can go past it. The recordings
 * themselves sit up to 17 dB apart, so each is brought to the same average
 * before it plays, and a crossfade never jumps in loudness.
 */

const CLIPS = ['1', '2', '3', '4'].map((name) => `/ambient/rain/${name}.ogg`);

/** The ceiling on the gain at the top of the volume control. */
export const MAX_LEVEL = 0.35;
/** The average every recording is brought to, and the room left above its loudest moment. */
const TARGET_RMS = 10 ** (-26 / 20);
const PEAK_ROOM = 10 ** (-1 / 20);
const FADE_IN_S = 3;
const FADE_OUT_S = 1.5;
const PAUSE_FADE_S = 0.6;
const CROSS_S = 4;
/** How long one stretch plays before the next comes in. */
const STRETCH_MIN_S = 18;
const STRETCH_SPREAD_S = 14;
/** Each layer's share, so two together sit where one alone would. */
const LAYER_SHARE = 0.7;

/** The gain that brings one recording to the common average without letting its peak past −1 dB. */
export function evenOut(channels: readonly Float32Array[]): number {
  let peak = 0;
  let sum = 0;
  let n = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i += 1) {
      const v = Math.abs(data[i] as number);
      if (v > peak) peak = v;
      sum += v * v;
      n += 1;
    }
  }
  if (n === 0 || peak === 0) return 0;
  return Math.min(TARGET_RMS / Math.sqrt(sum / n), PEAK_ROOM / peak);
}

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

interface Layer {
  voice: Voice | null;
  last: number;
  /** The context time at which the next stretch comes in. */
  turnAt: number;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let buffers: AudioBuffer[] = [];
let trims: number[] = [];
let layers: Layer[] = [];
let ticking: ReturnType<typeof setInterval> | null = null;
let level = 0.5;
let loading: Promise<boolean> | null = null;
let bins = new Uint8Array(0);

/** Read and decode the recordings once. False when they could not be. */
function load(): Promise<boolean> {
  loading ??= (async () => {
    try {
      ctx ??= new AudioContext();
      const decoded = await Promise.all(
        CLIPS.map(async (url) => {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`${url}: ${response.status}`);
          return (ctx as AudioContext).decodeAudioData(await response.arrayBuffer());
        }),
      );
      buffers = decoded;
      trims = decoded.map((buffer) =>
        evenOut(Array.from({ length: buffer.numberOfChannels }, (_, ch) => buffer.getChannelData(ch))),
      );

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      master = ctx.createGain();
      master.gain.value = 0;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      master.connect(limiter);
      limiter.connect(analyser);
      analyser.connect(ctx.destination);
      return true;
    } catch (err) {
      log('warn', 'focus', 'could not load the rain', err);
      loading = null;
      return false;
    }
  })();
  return loading;
}

function pick(avoid: number): number {
  if (buffers.length < 2) return 0;
  let index = avoid;
  while (index === avoid) index = Math.floor(Math.random() * buffers.length);
  return index;
}

/** Start a new stretch on a layer, fading the old one out as this comes in. */
function turn(layer: Layer, fadeS: number): void {
  if (!ctx || !master) return;
  const now = ctx.currentTime;
  const index = pick(layer.last);
  layer.last = index;
  const buffer = buffers[index] as AudioBuffer;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const gain = ctx.createGain();
  const share = LAYER_SHARE * (trims[index] ?? 0);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(share, now + fadeS);
  source.connect(gain);
  gain.connect(master);
  source.start(now, Math.random() * buffer.duration);

  const old = layer.voice;
  if (old) {
    old.gain.gain.cancelScheduledValues(now);
    old.gain.gain.setValueAtTime(old.gain.gain.value, now);
    old.gain.gain.linearRampToValueAtTime(0, now + CROSS_S);
    old.source.stop(now + CROSS_S + 0.1);
  }
  layer.voice = { source, gain };
  layer.turnAt = now + STRETCH_MIN_S + Math.random() * STRETCH_SPREAD_S;
}

/**
 * Turns layers over by the context's own clock, which stands still while the
 * sound is paused — a timer on the wall clock would carry on through a pause
 * and turn every layer over at once on resuming.
 */
function tick(): void {
  if (!ctx || ctx.state !== 'running') return;
  for (const layer of layers) {
    if (ctx.currentTime >= layer.turnAt) turn(layer, CROSS_S);
  }
}

/** Begin, from silence. False when the recordings could not be read. */
export async function startRain(volume: number): Promise<boolean> {
  if (!(await load()) || !ctx || !master) return false;
  stopVoices();
  level = clampVolume(volume);
  if (ctx.state === 'suspended') await ctx.resume();
  const now = ctx.currentTime;
  layers = [
    { voice: null, last: -1, turnAt: now },
    // The second comes in later, so the two never turn over together.
    { voice: null, last: -1, turnAt: now + 9 },
  ];
  const first = layers[0] as Layer;
  turn(first, 0.05);
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(MAX_LEVEL * level, now + FADE_IN_S);
  ticking ??= setInterval(tick, 250);
  return true;
}

/** Hold the sound where it is, after a short fade. */
export async function pauseRain(): Promise<void> {
  if (!ctx || !master || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(0, now + PAUSE_FADE_S);
  await new Promise((resolve) => setTimeout(resolve, PAUSE_FADE_S * 1000 + 50));
  await ctx.suspend();
}

export async function resumeRain(): Promise<void> {
  if (!ctx || !master || ctx.state !== 'suspended') return;
  await ctx.resume();
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(MAX_LEVEL * level, now + 1);
}

/** Fade out and let go of everything that was playing. */
export async function stopRain(): Promise<void> {
  if (ticking) clearInterval(ticking);
  ticking = null;
  if (!ctx || !master) return;
  if (ctx.state === 'suspended') await ctx.resume();
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(0, now + FADE_OUT_S);
  const ending = layers;
  layers = [];
  for (const layer of ending) layer.voice?.source.stop(now + FADE_OUT_S + 0.1);
  setTimeout(() => {
    if (layers.length === 0 && ctx?.state === 'running') void ctx.suspend();
  }, FADE_OUT_S * 1000 + 200);
}

function stopVoices(): void {
  for (const layer of layers) {
    try {
      layer.voice?.source.stop();
    } catch {
      // Already stopped.
    }
  }
  layers = [];
}

export function setRainVolume(volume: number): void {
  level = clampVolume(volume);
  if (!ctx || !master || ctx.state !== 'running') return;
  master.gain.setTargetAtTime(MAX_LEVEL * level, ctx.currentTime, 0.2);
}

function clampVolume(volume: number): number {
  return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.5;
}

/** What the rain sounds like this moment, for the ring of bars: one value per band, 0 to 1. */
export function rainBands(into: Float32Array): void {
  if (!analyser || !ctx || ctx.state !== 'running') {
    into.fill(0);
    return;
  }
  if (bins.length !== analyser.frequencyBinCount) bins = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(bins);
  // Rain is mostly upper-mid hiss; the lowest and highest bins say little, so
  // the bands are taken from the part of the spectrum where it moves.
  const from = 2;
  const to = Math.floor(bins.length * 0.75);
  const per = (to - from) / into.length;
  for (let band = 0; band < into.length; band += 1) {
    let sum = 0;
    let count = 0;
    for (let i = Math.floor(from + band * per); i < Math.floor(from + (band + 1) * per); i += 1) {
      sum += bins[i] as number;
      count += 1;
    }
    into[band] = count > 0 ? sum / count / 255 : 0;
  }
}
