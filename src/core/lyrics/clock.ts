/**
 * How far into the song, to the millisecond, between the player's reports.
 *
 * The player reports its position every quarter second. Lyrics that only move
 * on those reports step late by up to that much, so this runs its own clock
 * from the last report and the time since. A report that disagrees with it by
 * more than `SEEK_GAP_MS` is a seek, or the player catching up after a stall,
 * and the clock jumps to it. Anything less is the two clocks' ordinary jitter,
 * and following it would make the highlight stutter backwards.
 *
 * `now` is passed in — `performance.now()` in the app — so this can be tested.
 */
export const SEEK_GAP_MS = 400;

export class LyricsClock {
  private anchorMs = 0;
  private anchorAt = 0;
  private playing = false;

  /** Where the song is at `now`. */
  at(now: number): number {
    return this.playing ? this.anchorMs + (now - this.anchorAt) : this.anchorMs;
  }

  /** Start again from a known position. */
  anchor(positionMs: number, playing: boolean, now: number): void {
    this.anchorMs = positionMs;
    this.anchorAt = now;
    this.playing = playing;
  }

  /** A report from the player. */
  observe(positionMs: number, playing: boolean, now: number): void {
    if (playing !== this.playing || Math.abs(positionMs - this.at(now)) > SEEK_GAP_MS) {
      this.anchor(positionMs, playing, now);
    }
  }

  /** Jump there at once, ahead of the player confirming it. */
  seekTo(positionMs: number, now: number): void {
    this.anchor(positionMs, this.playing, now);
  }
}
