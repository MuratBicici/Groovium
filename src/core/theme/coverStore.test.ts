import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetCovers, Late, loadCover, Refused, type CoverImage } from './coverStore';

/**
 * One request per cover, always the same kind.
 *
 * Two kinds of request for one address is what made a cover's colours arrive
 * ten seconds into the song: the second hung behind the first until it was
 * given up on. These are the rules that keep there from being a second.
 */

class FakeImage implements CoverImage {
  static made: FakeImage[] = [];
  crossOrigin: string | null = null;
  src = '';
  onload: ((event: Event) => unknown) | null = null;
  onerror: ((event: Event | string) => unknown) | null = null;
  constructor() {
    FakeImage.made.push(this);
  }
  decode(): Promise<void> {
    return Promise.resolve();
  }
  arrive() {
    this.onload?.({} as Event);
  }
  fail() {
    this.onerror?.('');
  }
}

const make = () => new FakeImage();

beforeEach(() => {
  FakeImage.made = [];
  forgetCovers();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('loading a cover', () => {
  it('asks with permission to read it, before it asks at all', () => {
    void loadCover('sleeve-a', make);
    const [image] = FakeImage.made;
    expect(image?.crossOrigin).toBe('anonymous');
    expect(image?.src).toBe('sleeve-a');
  });

  it('asks once, however many things want it', async () => {
    const first = loadCover('sleeve-a', make);
    const second = loadCover('sleeve-a', make);
    expect(FakeImage.made).toHaveLength(1);
    FakeImage.made[0]?.arrive();
    await expect(first).resolves.toBe(FakeImage.made[0]);
    await expect(second).resolves.toBe(FakeImage.made[0]);
  });

  it('forgets a failure, so the next ask is a fresh one', async () => {
    const first = loadCover('sleeve-a', make);
    FakeImage.made[0]?.fail();
    await expect(first).rejects.toBeInstanceOf(Refused);
    void loadCover('sleeve-a', make);
    expect(FakeImage.made).toHaveLength(2);
  });

  it('does not wait on a decode, which a hidden window never finishes', async () => {
    const waiting = loadCover('sleeve-a', () => {
      const image = new FakeImage();
      image.decode = () => new Promise<void>(() => {});
      return image;
    });
    FakeImage.made[0]?.arrive();
    await expect(waiting).resolves.toBe(FakeImage.made[0]);
  });

  it('gives up on a cover that does not come, and says it was late', async () => {
    const waiting = loadCover('sleeve-a', make);
    vi.advanceTimersByTime(10_000);
    await expect(waiting).rejects.toBeInstanceOf(Late);
  });

  it('keeps the last few, not every cover it has ever seen', () => {
    for (let n = 0; n < 40; n += 1) void loadCover(`sleeve-${n}`, make);
    const before = FakeImage.made.length;
    // The newest is still held; the oldest has been let go and is asked again.
    void loadCover('sleeve-39', make);
    expect(FakeImage.made).toHaveLength(before);
    void loadCover('sleeve-0', make);
    expect(FakeImage.made).toHaveLength(before + 1);
  });
});
