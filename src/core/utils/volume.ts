import { clamp } from './time';

/**
 * Curve exponent mapping the volume control to output amplitude.
 *
 * `HTMLMediaElement.volume` (and every streaming SDK's equivalent) is a linear
 * amplitude multiplier, but loudness is perceived roughly logarithmically. Fed
 * a slider position directly, half volume is only -6 dB — audibly closer to
 * three-quarters — so the entire usable range bunches up at the bottom of the
 * control and the top half does almost nothing.
 *
 * Stevens' power law puts perceived loudness at about amplitude^0.6, which
 * makes ~1.67 the exponent for a perfectly linear-feeling control. 2 is a touch
 * steeper on purpose: at low settings, room noise masks quiet playback, so a
 * slightly faster fade near the bottom feels more natural than the theoretical
 * curve. Tune here if it still feels off — this is the only place it is set.
 */
const VOLUME_CURVE = 2;

/**
 * Convert a control position (0..1, what the user sees as a percentage) into the
 * linear amplitude an audio engine expects.
 *
 *   0.00 -> 0.0000   silent
 *   0.25 -> 0.0625   -24 dB
 *   0.50 -> 0.2500   -12 dB
 *   0.75 -> 0.5625    -5 dB
 *   1.00 -> 1.0000     0 dB
 */
export function volumeToAmplitude(volume: number): number {
  return clamp(volume, 0, 1) ** VOLUME_CURVE;
}
