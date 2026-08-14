import type {
  AudioProvider,
  AuthResult,
  PlaybackState,
  ProviderEvent,
  ProviderEventListener,
  SourceType,
  TrackMetadata,
} from '@/core/types';

/**
 * Shared listener plumbing and state bookkeeping for providers.
 *
 * Subclasses call `setState` / `setCurrentTrack` / `emit` rather than managing
 * their own listener sets, so every provider reports progress and errors through
 * exactly the same channel.
 */
export abstract class BaseProvider implements AudioProvider {
  abstract readonly id: SourceType;
  abstract readonly displayName: string;

  protected state: PlaybackState = 'IDLE';
  protected currentTrack: TrackMetadata | null = null;

  private readonly listeners = new Set<ProviderEventListener>();

  abstract initialize(): Promise<boolean>;
  abstract authenticate(): Promise<AuthResult>;
  abstract play(trackId: string): Promise<void>;
  abstract pause(): Promise<void>;
  abstract resume(): Promise<void>;
  abstract seek(positionMs: number): Promise<void>;
  abstract setVolume(volume: number): Promise<void>;

  getState(): PlaybackState {
    return this.state;
  }

  getCurrentTrack(): TrackMetadata | null {
    return this.currentTrack;
  }

  subscribe(listener: ProviderEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.listeners.clear();
  }

  protected emit(event: ProviderEvent): void {
    // Iterate a copy: a listener may unsubscribe while being notified.
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (err) {
        console.error(`[${this.id}] provider listener threw`, err);
      }
    }
  }

  /** Update state and notify, skipping no-op transitions. */
  protected setState(next: PlaybackState): void {
    if (this.state === next) return;
    this.state = next;
    this.emit({ type: 'state', state: next });
  }

  protected setCurrentTrack(track: TrackMetadata | null): void {
    this.currentTrack = track;
    this.emit({ type: 'track', track });
  }

  /** Move to ERROR and report the reason. */
  protected fail(error: string): void {
    this.state = 'ERROR';
    this.emit({ type: 'state', state: 'ERROR' });
    this.emit({ type: 'error', error });
  }
}
