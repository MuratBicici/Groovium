import { beforeEach, describe, expect, it } from 'vitest';
import { usePlayerStore } from './playerStore';
import { registerProvider } from '@/core/providers/registry';
import type { AudioProvider, PlaybackState, TrackMetadata } from '@/core/types';

/**
 * The music turned down for something else to be heard over it — the weather
 * card's sound — and back up again, without the volume that was set moving.
 */

const sent: number[] = [];
class Listening implements AudioProvider {
  readonly id = 'local' as const;
  readonly displayName = 'Listening';
  async initialize(): Promise<boolean> {
    return true;
  }
  async authenticate() {
    return { success: true } as const;
  }
  async play(): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async seek(): Promise<void> {}
  async setVolume(amplitude: number): Promise<void> {
    sent.push(amplitude);
  }
  getState(): PlaybackState {
    return 'PLAYING';
  }
  getCurrentTrack(): TrackMetadata | null {
    return null;
  }
  subscribe(): () => void {
    return () => {};
  }
  dispose(): void {}
}

const store = () => usePlayerStore.getState();

describe('turning the music down under something else', () => {
  beforeEach(async () => {
    registerProvider(new Listening());
    await store().setActiveProvider('local');
    usePlayerStore.setState({ volume: 0.8, muted: false, ducked: 1 });
    sent.length = 0;
  });

  it('turns it down to the factor asked, in steps, and leaves the volume alone', async () => {
    await store().setVolume(0.8);
    const full = sent.at(-1) as number;
    sent.length = 0;
    await store().duck(0.25);
    expect(store().ducked).toBe(0.25);
    expect(store().volume).toBe(0.8);
    expect(sent.length).toBeGreaterThan(2);
    expect(sent.at(-1)).toBeCloseTo(full * 0.25, 6);
    for (let i = 1; i < sent.length; i += 1) expect(sent[i]).toBeLessThan(sent[i - 1] as number);
  });

  it('comes back to exactly where it was', async () => {
    await store().setVolume(0.8);
    const full = sent.at(-1) as number;
    await store().duck(0.25);
    await store().duck(1);
    expect(store().ducked).toBe(1);
    expect(sent.at(-1)).toBeCloseTo(full, 6);
  });

  it('lets a newer move take over from one still stepping', async () => {
    const down = store().duck(0.25);
    await store().duck(1);
    await down;
    expect(store().ducked).toBe(1);
  });

  it('stays silent while muted', async () => {
    await store().toggleMute();
    await store().duck(0.25);
    expect(sent.at(-1)).toBe(0);
  });
});
