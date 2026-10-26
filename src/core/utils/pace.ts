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

/**
 * Thirty, for when the window is not what somebody is working in and for
 * battery saver. Measured on the same panel: a song playing with the drawer
 * open went from about 38% of the GPU at sixty to 23% at thirty.
 */
export const SAVING_RATE = 30;

/** How early a frame may come and still count as on time: the screen's own timing wobbles. */
const SLACK_MS = 2;

/** The rate every loop is held to just now; set by `useFrameRate`. */
let rate = FRAME_RATE;

/** Change the rate every loop is held to, from the next frame each one asks about. */
export function setFrameRate(next: number): void {
  rate = next;
}

/** The rate every loop is held to just now. */
export function frameRate(): number {
  return rate;
}

/**
 * A gate for one drawing loop: asked on every animation frame, it says yes
 * about as many times a second as the window's rate — or `fixed`, if given.
 *
 * Kept on a grid rather than measured from the last yes, so a screen whose
 * frames do not divide evenly into sixty — 144 Hz takes every second, then
 * every third — still averages sixty instead of settling on forty-eight. A
 * loop that fell far behind (a hidden window, a long stall) starts the grid
 * again from now rather than drawing a burst to catch up.
 */
export function pacer(fixed?: number): (now: number) => boolean {
  let due = -Infinity;
  return (now: number) => {
    // The window's rate unless this gate was given its own; read every time,
    // so a change reaches every loop on its next frame.
    const interval = 1000 / (fixed ?? rate);
    if (now + SLACK_MS < due) return false;
    due = now - due > interval ? now + interval : due + interval;
    return true;
  };
}

/**
 * Which rate, given what is true of the window and the power.
 *
 * Sixty while somebody is working in this window on mains power or with
 * battery saver off. Thirty when they are working in another window — this
 * one sits over the others on purpose and is still glanced at, so it slows
 * rather than stops — and thirty whenever battery saver is on.
 */
export function rateFor(focused: boolean, saving: boolean): number {
  return focused && !saving ? FRAME_RATE : SAVING_RATE;
}
