/**
 * A focus session's clock, as arithmetic on wall-clock times.
 *
 * Nothing here ticks. A session is when it began, how long it was meant to
 * be, and how long it has spent paused; what is left is worked out from those
 * whenever it is asked for. A timer that counted down by itself would drift
 * with every late frame and stop dead behind a hidden window.
 */

export interface SessionClock {
  /** When it began, in ms since the epoch. */
  startedAt: number;
  /** How long it was meant to last, in ms. */
  lengthMs: number;
  /** Time spent paused before the current pause, in ms. */
  pausedFor: number;
  /** When the current pause began, or null while running. */
  pausedAt: number | null;
}

/** The lengths offered, in minutes. */
export const FOCUS_LENGTHS = [15, 25, 45, 60] as const;
export const MIN_MINUTES = 5;
export const MAX_MINUTES = 180;

/** A length somebody asked for, held to whole minutes the stepper can reach. */
export function heldMinutes(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 25;
  return Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, n));
}

export function beginClock(now: number, minutes: number): SessionClock {
  return { startedAt: now, lengthMs: heldMinutes(minutes) * 60_000, pausedFor: 0, pausedAt: null };
}

/** How long the session has actually run: paused time does not count. */
export function elapsed(clock: SessionClock, now: number): number {
  const until = clock.pausedAt ?? now;
  return Math.max(0, until - clock.startedAt - clock.pausedFor);
}

/** What is left. Below zero once the session is over: it keeps counting. */
export function remaining(clock: SessionClock, now: number): number {
  return clock.lengthMs - elapsed(clock, now);
}

export function pauseClock(clock: SessionClock, now: number): SessionClock {
  return clock.pausedAt === null ? { ...clock, pausedAt: now } : clock;
}

export function resumeClock(clock: SessionClock, now: number): SessionClock {
  if (clock.pausedAt === null) return clock;
  return { ...clock, pausedFor: clock.pausedFor + Math.max(0, now - clock.pausedAt), pausedAt: null };
}

/** How much of the session is still ahead, from 1 down to 0, and 0 after. */
export function share(clock: SessionClock, now: number): number {
  if (clock.lengthMs <= 0) return 0;
  return Math.max(0, Math.min(1, remaining(clock, now) / clock.lengthMs));
}

/**
 * The time as shown: mm:ss, or h:mm:ss past an hour, with a minus sign once
 * the session is over.
 *
 * Whole seconds, rounded up while counting down so the clock reads 00:01 for
 * the last second and only says 00:00 when there is nothing left; and down
 * after, so the overtime grows a second at a time from −00:01.
 */
export function formatClock(ms: number): string {
  const over = ms < 0;
  const seconds = over ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  const body = h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
  return over && seconds > 0 ? `−${body}` : body;
}
