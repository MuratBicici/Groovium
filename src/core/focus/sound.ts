import { log } from '@/platform/log';
import {
  CALM_WEATHER,
  downpourAt,
  heldWeather,
  intensity,
  maybeDownpour,
  nextThunderIn,
  rainSound,
  thunderSound,
  wander,
  type Downpour,
  type Weather,
} from './weather';

/**
 * A focus session's sound: rain, from recordings, and thunder now and then.
 *
 * Two attempts at making rain from noise both sounded made, so this plays four
 * real recordings (see `public/ambient/rain/CREDITS.md`). Each is under a
 * minute, and a loop that short is heard as a loop. So two layers play at once,
 * each a stretch of a recording picked by chance from a point picked by
 * chance, and each crossfades into another before its stretch is up. The two
 * turn over at different moments, and nothing ever repeats on a beat. A third
 * layer joins only for the heavy end.
 *
 * The rain is not one level. How hard it falls wanders slowly, and now and
 * then it pours down for a while — how much of either is the session's
 * weather, see `weather.ts` — heard as the rain getting louder, brighter and
 * thicker together. Thunder comes at chance moments, nearer or further each
 * time. The thunder recordings have rain of their own in them, which would
 * land on top of this rain, so they are let through only below a few hundred
 * hertz, where the rumble is and their rain is not.
 *
 * Its own audio context, not the music's: the equaliser's graph has its own
 * rules about gain, and nothing here should be able to touch them.
 *
 * Built to be gentle on ears first. It starts from silence and comes up over
 * three seconds; its level has a ceiling well under full scale; and a limiter
 * sits last, so no downpour and no thunder can go past it. Every recording is
 * brought to the same average before it plays, so nothing jumps in loudness
 * because of which file it came from.
 */

const CLIPS = ['1', '2', '3', '4'].map((name) => `/ambient/rain/${name}.ogg`);
const THUNDER = ['a', 'b', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'].map(
  (name) => `/ambient/thunder/thunder-${name}.webm`,
);

/** The ceiling on the gain at the top of the volume control. */
export const MAX_LEVEL = 0.35;
/** The average every recording is brought to, and the room left above its loudest moment. */
const TARGET_RMS = 10 ** (-26 / 20);
const PEAK_ROOM = 10 ** (-1 / 20);
/** The same for a roll of thunder, measured through the filter that takes its rain out. */
const THUNDER_RMS = 10 ** (-24 / 20);
const THUNDER_PEAK = 10 ** (-5 / 20);
const THUNDER_MEASURED_HZ = 1000;
const FADE_IN_S = 3;
const FADE_OUT_S = 1.5;
const PAUSE_FADE_S = 0.6;
const CROSS_S = 4;
/** How long one stretch plays before the next comes in. */
const STRETCH_MIN_S = 18;
const STRETCH_SPREAD_S = 14;
/** Each layer's share, so two together sit where one alone would. */
const LAYER_SHARE = 0.7;
const TICK_MS = 250;

const dbToGain = (db: number) => 10 ** (db / 20);

function measure(channels: readonly Float32Array[]): { rms: number; peak: number } {
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
  return { rms: n === 0 ? 0 : Math.sqrt(sum / n), peak };
}

/** The gain that brings one recording to the common average without letting its peak past −1 dB. */
export function evenOut(channels: readonly Float32Array[]): number {
  const { rms, peak } = measure(channels);
  if (rms === 0 || peak === 0) return 0;
  return Math.min(TARGET_RMS / rms, PEAK_ROOM / peak);
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
  /** Where its voices go: the rain, or the heavy rain's own share of it. */
  into: GainNode;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let rainBus: GainNode | null = null;
let rainTone: BiquadFilterNode | null = null;
let heavyBus: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let buffers: AudioBuffer[] = [];
let trims: number[] = [];
let thunder: AudioBuffer[] = [];
let thunderTrims: number[] = [];
let lastThunder = -1;
let layers: Layer[] = [];
let ticking: ReturnType<typeof setInterval> | null = null;
let level = 0.5;
let loading: Promise<boolean> | null = null;
let bins = new Uint8Array(0);

let weather: Weather = CALM_WEATHER;
let wandering = 0;
let wanderTo = 0;
let wanderNext = 0;
let spell: Downpour | null = null;
let thunderAt: number | null = null;
let lastTick = 0;

function lowpass(context: BaseAudioContext, hz: number): BiquadFilterNode {
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = hz;
  filter.Q.value = 0.6;
  return filter;
}

/** Read and decode the rain once. False when it could not be. */
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
      rainBus = ctx.createGain();
      rainTone = ctx.createBiquadFilter();
      rainTone.type = 'lowpass';
      rainTone.Q.value = 0.5;
      heavyBus = ctx.createGain();
      heavyBus.gain.value = 0;
      heavyBus.connect(rainBus);
      rainBus.connect(rainTone);
      rainTone.connect(master);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      master.connect(limiter);
      limiter.connect(analyser);
      analyser.connect(ctx.destination);
      // The thunder after, and not waited for: the rain should not wait on it.
      void loadThunder();
      return true;
    } catch (err) {
      log('warn', 'focus', 'could not load the rain', err);
      loading = null;
      return false;
    }
  })();
  return loading;
}

/** The thunder, each roll evened out as it will be heard: through the filter that takes its rain out. */
async function loadThunder(): Promise<void> {
  if (!ctx || thunder.length > 0) return;
  try {
    const decoded = await Promise.all(
      THUNDER.map(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${url}: ${response.status}`);
        return (ctx as AudioContext).decodeAudioData(await response.arrayBuffer());
      }),
    );
    const measured = await Promise.all(
      decoded.map(async (buffer) => {
        const rate = 22_050;
        const offline = new OfflineAudioContext(buffer.numberOfChannels, Math.ceil(buffer.duration * rate), rate);
        const source = offline.createBufferSource();
        source.buffer = buffer;
        const first = lowpass(offline, THUNDER_MEASURED_HZ);
        const second = lowpass(offline, THUNDER_MEASURED_HZ);
        source.connect(first);
        first.connect(second);
        second.connect(offline.destination);
        source.start();
        const heard = await offline.startRendering();
        const { rms, peak } = measure(Array.from({ length: heard.numberOfChannels }, (_, ch) => heard.getChannelData(ch)));
        return rms === 0 || peak === 0 ? 0 : Math.min(THUNDER_RMS / rms, THUNDER_PEAK / peak);
      }),
    );
    thunder = decoded;
    thunderTrims = measured;
  } catch (err) {
    log('warn', 'focus', 'could not load the thunder; the rain goes on without it', err);
  }
}

function pick(count: number, avoid: number): number {
  if (count < 2) return 0;
  let index = avoid;
  while (index === avoid) index = Math.floor(Math.random() * count);
  return index;
}

/** Start a new stretch on a layer, fading the old one out as this comes in. */
function turn(layer: Layer, fadeS: number): void {
  if (!ctx) return;
  const now = ctx.currentTime;
  const index = pick(buffers.length, layer.last);
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
  gain.connect(layer.into);
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

/** One roll of thunder, from a recording picked by chance, near or far by chance. */
function roll(pouring: boolean): void {
  if (!ctx || !master || thunder.length === 0) return;
  const index = pick(thunder.length, lastThunder);
  lastThunder = index;
  const buffer = thunder[index] as AudioBuffer;
  const sound = thunderSound(weather, pouring, Math.random);
  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const first = lowpass(ctx, sound.brightHz);
  const second = lowpass(ctx, sound.brightHz);
  const gain = ctx.createGain();
  const loud = (thunderTrims[index] ?? 0) * dbToGain(sound.gainDb);
  const tail = Math.min(1.5, buffer.duration / 3);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(loud, now + sound.arriveS);
  gain.gain.setValueAtTime(loud, now + buffer.duration - tail);
  gain.gain.linearRampToValueAtTime(0, now + buffer.duration);
  const pan = ctx.createStereoPanner();
  pan.pan.value = sound.pan;
  source.connect(first);
  first.connect(second);
  second.connect(gain);
  gain.connect(pan);
  pan.connect(master);
  source.start(now);
}

/**
 * Turns layers over, moves the weather on and brings the thunder, all by the
 * context's own clock, which stands still while the sound is paused — a timer
 * on the wall clock would carry on through a pause and do everything it
 * missed at once on resuming.
 */
function tick(): void {
  if (!ctx || ctx.state !== 'running' || !rainBus || !rainTone || !heavyBus) return;
  const now = ctx.currentTime;
  const dt = Math.max(0, Math.min(1, now - lastTick));
  lastTick = now;
  for (const layer of layers) {
    if (now >= layer.turnAt) turn(layer, CROSS_S);
  }

  if (now >= wanderNext) {
    const next = wander(weather, Math.random);
    wanderTo = next.by;
    wanderNext = now + next.forSeconds;
  }
  wandering += (wanderTo - wandering) * (1 - Math.exp(-dt / 8));
  if (spell && now >= spell.until) spell = null;
  spell ??= maybeDownpour(weather, now, dt, Math.random);
  const pouring = downpourAt(spell, now);
  const sound = rainSound(intensity(weather, wandering, pouring));
  rainBus.gain.setTargetAtTime(dbToGain(sound.gainDb), now, 1.5);
  rainTone.frequency.setTargetAtTime(Math.min(18_000, sound.brightHz), now, 1.5);
  heavyBus.gain.setTargetAtTime(sound.heavyShare, now, 2);

  if (thunderAt !== null && now >= thunderAt) {
    roll(pouring > 0.05);
    const wait = nextThunderIn(weather, pouring > 0.05, Math.random);
    thunderAt = wait === null ? null : now + wait;
  }
}

/** Begin, from silence. False when the recordings could not be read. */
export async function startRain(volume: number, chosen: Partial<Weather> = CALM_WEATHER): Promise<boolean> {
  if (!(await load()) || !ctx || !master || !rainBus || !rainTone || !heavyBus) return false;
  stopVoices();
  level = clampVolume(volume);
  weather = heldWeather(chosen);
  if (ctx.state === 'suspended') await ctx.resume();
  const now = ctx.currentTime;
  layers = [
    { voice: null, last: -1, turnAt: now, into: rainBus },
    // The second comes in later, so the two never turn over together.
    { voice: null, last: -1, turnAt: now + 9, into: rainBus },
    // The heavy rain's, heard only as much as the rain is heavy.
    { voice: null, last: -1, turnAt: now + 4, into: heavyBus },
  ];
  turn(layers[0] as Layer, 0.05);
  // Where the weather starts: as set, without wandering or pouring yet.
  wandering = 0;
  wanderTo = 0;
  wanderNext = now + 20;
  spell = null;
  lastTick = now;
  const start = rainSound(weather.rain);
  rainBus.gain.setValueAtTime(dbToGain(start.gainDb), now);
  rainTone.frequency.setValueAtTime(Math.min(18_000, start.brightHz), now);
  heavyBus.gain.setValueAtTime(start.heavyShare, now);
  // The first soon, so the weather is heard for what it is — but not in the
  // first moments, which belong to the rain coming up.
  thunderAt = weather.thunder <= 0.001 ? null : now + 6 + Math.random() * 10;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(MAX_LEVEL * level, now + FADE_IN_S);
  ticking ??= setInterval(tick, TICK_MS);
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
  lastTick = now;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(MAX_LEVEL * level, now + 1);
}

/** Fade out and let go of everything that was playing. */
export async function stopRain(): Promise<void> {
  if (ticking) clearInterval(ticking);
  ticking = null;
  thunderAt = null;
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
