import type { AuthResult, SourceType } from '@/core/types';
import { BaseProvider } from '@/core/providers/BaseProvider';
import { clamp } from '@/core/utils/time';
import { trackById } from './catalogue';

/**
 * A player for the demo: it keeps time and makes no sound.
 *
 * Everything that follows a song — the bar, the turning record, the lyrics —
 * follows the provider's clock and state, not the audio, so a clock is all a
 * demo needs. It starts a song after a moment's loading, as a real one does,
 * ends it when its time is up, and while it plays it hands the visualiser a
 * made-up beat (`beat` below), since there is no sound for Rust to listen to.
 */

/** How often the clock reports, as the real players do. */
const TICK_MS = 250;

/** A beat for the visualiser and the edge lights, from a song's id. */
function tempoOf(trackId: string): number {
  let h = 0;
  for (let i = 0; i < trackId.length; i += 1) h = (h * 31 + trackId.charCodeAt(i)) >>> 0;
  return 92 + (h % 40);
}

type Feed = (bars: number[]) => void;

/** The development hook the visualiser listens on — see `core/visualizer`. */
function feed(): Feed | null {
  const hook = (window as unknown as { __grooviumBars?: Feed }).__grooviumBars;
  return typeof hook === 'function' ? hook : null;
}

/** Twenty-four bands of a made-up spectrum at `seconds` into a song. */
function spectrum(seconds: number, bpm: number, level: number): number[] {
  const beat = (seconds * bpm) / 60;
  const kick = Math.pow(1 - (beat % 1), 3);
  const snare = Math.pow(1 - ((beat + 0.5) % 1), 5) * (Math.floor(beat) % 2);
  return Array.from({ length: 24 }, (_, band) => {
    const low = Math.max(0, 1 - band / 6);
    const high = Math.max(0, (band - 12) / 12);
    const drift =
      0.25 +
      0.18 * Math.sin(seconds * 1.7 + band * 0.8) +
      0.12 * Math.sin(seconds * 3.1 + band * 1.9);
    const value = drift * (1 - band / 40) + kick * low * 0.75 + snare * high * 0.45;
    return clamp(value * level, 0, 1);
  });
}

export class DemoProvider extends BaseProvider {
  readonly displayName: string;
  private playing: string | null = null;
  private positionMs = 0;
  private durationMs = 0;
  private lastTickAt = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private starting: ReturnType<typeof setTimeout> | null = null;
  private frame = 0;
  private volume = 1;

  constructor(readonly id: SourceType) {
    super();
    this.displayName = id === 'spotify' ? 'Spotify' : 'Local';
  }

  async initialize(): Promise<boolean> {
    return true;
  }

  async authenticate(): Promise<AuthResult> {
    return { success: true };
  }

  async play(trackId: string): Promise<void> {
    this.stopClock();
    if (this.starting) clearTimeout(this.starting);
    this.playing = trackId;
    this.positionMs = 0;
    this.durationMs = trackById(trackId)?.duration ?? 210_000;
    this.setState('LOADING');
    this.emitProgress();
    // A moment's loading, so the start looks like one.
    this.starting = setTimeout(() => {
      this.starting = null;
      if (this.playing === trackId) this.startClock();
    }, 450);
  }

  async pause(): Promise<void> {
    this.stopClock();
    this.setState('PAUSED');
  }

  async resume(): Promise<void> {
    if (this.playing) this.startClock();
  }

  async seek(positionMs: number): Promise<void> {
    this.positionMs = clamp(positionMs, 0, this.durationMs || positionMs);
    this.lastTickAt = performance.now();
    this.emitProgress();
  }

  async setVolume(volume: number): Promise<void> {
    this.volume = clamp(volume, 0, 1);
  }

  override dispose(): void {
    this.stopClock();
    super.dispose();
  }

  private startClock(): void {
    this.setState('PLAYING');
    this.lastTickAt = performance.now();
    this.ticker = setInterval(() => {
      const now = performance.now();
      this.positionMs = Math.min(this.positionMs + (now - this.lastTickAt), this.durationMs);
      this.lastTickAt = now;
      this.emitProgress();
      if (this.positionMs >= this.durationMs) {
        const ended = this.playing;
        this.stopClock();
        this.setState('IDLE');
        this.emit({ type: 'ended', trackId: ended });
      }
    }, TICK_MS);
    this.beat();
  }

  private stopClock(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    cancelAnimationFrame(this.frame);
    feed()?.(new Array<number>(24).fill(0));
  }

  /** The made-up beat, a frame at a time while the clock runs. */
  private beat(): void {
    const bpm = tempoOf(this.playing ?? '');
    const draw = () => {
      if (!this.ticker) return;
      const seconds = (this.positionMs + (performance.now() - this.lastTickAt)) / 1000;
      feed()?.(spectrum(seconds, bpm, 0.35 + this.volume * 0.65));
      this.frame = requestAnimationFrame(draw);
    };
    this.frame = requestAnimationFrame(draw);
  }

  private emitProgress(): void {
    this.emit({ type: 'progress', positionMs: this.positionMs, durationMs: this.durationMs });
  }
}
