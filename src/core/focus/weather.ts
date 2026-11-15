/**
 * The weather of a focus session: how hard it rains, how that changes, and
 * when the thunder comes and how close.
 *
 * Set before the session in four words, each a number from 0 to 1 so that a
 * slider could take it later:
 *
 * - `rain`: how hard it rains at rest, light to pouring.
 * - `change`: how much that wanders, and how often it pours down for a while.
 * - `thunder`: how often there is thunder, from none to often.
 * - `power`: how close the thunder is, far to overhead.
 *
 * Everything here is arithmetic on those and a source of chance, so it can be
 * tested without a sound being made; `sound.ts` does the playing.
 */

export interface Weather {
  rain: number;
  change: number;
  thunder: number;
  power: number;
}

export const CALM_WEATHER: Weather = { rain: 0.5, change: 0.5, thunder: 0.5, power: 0.5 };

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5);

export function heldWeather(value: Partial<Weather> | undefined): Weather {
  return {
    rain: clamp01(value?.rain ?? CALM_WEATHER.rain),
    change: clamp01(value?.change ?? CALM_WEATHER.change),
    thunder: clamp01(value?.thunder ?? CALM_WEATHER.thunder),
    power: clamp01(value?.power ?? CALM_WEATHER.power),
  };
}

/** How the rain sounds at an intensity from 0 to 1: its level in dB and how bright it is. */
export function rainSound(intensity: number): { gainDb: number; brightHz: number; heavyShare: number } {
  const i = clamp01(intensity);
  return {
    // Light rain is quieter as well as duller; a downpour a little louder than the recordings.
    gainDb: -8 + 11 * i,
    brightHz: 2400 * 7 ** i,
    // A third layer comes in for the heavy end, so a downpour is thicker, not only louder.
    heavyShare: Math.max(0, (i - 0.5) / 0.5),
  };
}

/** One spell of rain pouring down: how much it adds, and when it rises, holds and goes. */
export interface Downpour {
  from: number;
  peakAt: number;
  until: number;
  height: number;
}

/** How a downpour adds to the rain at time `t`, in seconds. */
export function downpourAt(spell: Downpour | null, t: number): number {
  if (!spell || t <= spell.from || t >= spell.until) return 0;
  if (t < spell.peakAt) return spell.height * ((t - spell.from) / (spell.peakAt - spell.from));
  // Holds most of its height and tails off over the last third.
  const tail = spell.until - (spell.until - spell.peakAt) / 3;
  if (t < tail) return spell.height;
  return spell.height * ((spell.until - t) / (spell.until - tail));
}

/** Whether a downpour starts in the next `dt` seconds, and what it is if so. */
export function maybeDownpour(weather: Weather, now: number, dt: number, random: () => number): Downpour | null {
  // About once every two to six minutes at the most changeable; never when it is not to change.
  const perSecond = weather.change * (1 / 120);
  if (random() >= perSecond * dt) return null;
  const rise = 5 + random() * 8;
  const length = 20 + random() * 50 * (0.5 + weather.change);
  return { from: now, peakAt: now + rise, until: now + rise + length, height: 0.18 + random() * 0.35 * (0.4 + weather.change) };
}

/** A new resting point for the rain's slow wander, and how long until the next. */
export function wander(weather: Weather, random: () => number): { by: number; forSeconds: number } {
  // Plus nought, so a still sky wanders by 0 and not by -0.
  return { by: (random() * 2 - 1) * 0.28 * weather.change + 0, forSeconds: 15 + random() * 45 };
}

/** How hard it rains this moment. */
export function intensity(weather: Weather, wandering: number, pouring: number): number {
  return clamp01(weather.rain + wandering + pouring);
}

/** Seconds until the next thunder, or null for none. Sooner while it pours. */
export function nextThunderIn(weather: Weather, pouring: boolean, random: () => number): number | null {
  if (weather.thunder <= 0.001) return null;
  // About a minute apart now and then, a quarter of a minute often; it was
  // two minutes and more, and a session could pass with nothing to hear.
  const mean = (75 - 60 * weather.thunder) / (pouring ? 1.8 : 1);
  // Spread out by chance, as thunder is: an exponential wait, never under six seconds.
  return Math.max(6, -Math.log(1 - random() * 0.999) * mean);
}

/** How one roll of thunder sounds: its level in dB over the evened clip, how much of its brightness is let through, and how fast it arrives. */
export function thunderSound(
  weather: Weather,
  pouring: boolean,
  random: () => number,
): { gainDb: number; brightHz: number; arriveS: number; pan: number } {
  // Mostly where the setting says, but any roll can be nearer or further than that.
  const near = clamp01(weather.power * 0.7 + random() * 0.6 - 0.15 + (pouring ? 0.15 : 0));
  return {
    gainDb: -6 + 10 * near,
    // Kept under the hiss: the recordings have rain of their own above a couple
    // of kilohertz, and it would fall on top of ours. Not much lower than that,
    // though — below a few hundred hertz is rumble a laptop cannot play at all.
    // Nearer thunder lets more of its crack through.
    brightHz: 450 * 5 ** near,
    arriveS: 0.9 - 0.8 * near,
    pan: (random() * 2 - 1) * 0.55,
  };
}
