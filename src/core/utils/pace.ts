/**
 * How often the window's moving pictures are drawn, whatever the screen does.
 *
 * Every canvas here — the light behind the record, the dust, the grooves, the
 * glow at the edges — used to draw on every frame the screen asked for. On a
 * 60 Hz screen that is sixty a second. On the 240 Hz panel this was measured
 * on it was two hundred and forty, and every one of those frames sent the
 * whole window through the GPU again: with a song playing, the integrated GPU
 * sat at two thirds busy. Held to sixty, the same song cost less than half of
 * that, and nothing on screen moves fast enough for the difference to show.
 *
 * Measured, not guessed — see the commit that brought this in.
 */
export const FRAME_RATE = 60;

/** How early a frame may come and still count as on time: the screen's own timing wobbles. */
const SLACK_MS = 2;

/**
 * A gate for one drawing loop: asked on every animation frame, it says yes
 * about `rate` times a second.
 *
 * Kept on a grid rather than measured from the last yes, so a screen whose
 * frames do not divide evenly into sixty — 144 Hz takes every second, then
 * every third — still averages sixty instead of settling on forty-eight. A
 * loop that fell far behind (a hidden window, a long stall) starts the grid
 * again from now rather than drawing a burst to catch up.
 */
export function pacer(rate = FRAME_RATE): (now: number) => boolean {
  const interval = 1000 / rate;
  let due = -Infinity;
  return (now: number) => {
    if (now + SLACK_MS < due) return false;
    due = now - due > interval ? now + interval : due + interval;
    return true;
  };
}
