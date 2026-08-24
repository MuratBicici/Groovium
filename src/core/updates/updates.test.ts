import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpdateStore } from './store';
import { checkForUpdate } from '@/core/updates';
import type { AvailableUpdate } from '@/core/updates';

// The platform boundary is what these are written against: the real module
// reaches Tauri, which is not here. Everything above it is what this is about.
vi.mock('@/core/updates', () => ({
  checkForUpdate: vi.fn(),
  restart: vi.fn(async () => {}),
}));

/**
 * Updating in place.
 *
 * The distinction these exist for is between the two ways a check can happen.
 * One runs on the way in, unasked, and a failure there is not an event —
 * nobody wanted to hear about updates while opening a music player. The other
 * is a button somebody pressed, and a button that fails silently is broken.
 */

const asMock = vi.mocked(checkForUpdate);

function offering(version: string, notes: string | null = null): AvailableUpdate {
  return { version, notes, install: async () => {} };
}

function reset() {
  useUpdateStore.setState({
    status: 'idle',
    version: null,
    notes: null,
    progress: null,
    error: null,
  });
}

describe('looking for an update', () => {
  beforeEach(() => {
    asMock.mockReset();
    reset();
  });

  it('carries the version and the notes when there is one', async () => {
    asMock.mockResolvedValue(offering('1.1.0', 'Fixed the tonearm.'));
    await useUpdateStore.getState().checkNow();

    const state = useUpdateStore.getState();
    expect(state.status).toBe('available');
    expect(state.version).toBe('1.1.0');
    expect(state.notes).toBe('Fixed the tonearm.');
  });

  it('stays quiet when there is nothing newer', async () => {
    asMock.mockResolvedValue(null);
    await useUpdateStore.getState().checkNow();

    expect(useUpdateStore.getState().status).toBe('idle');
    expect(useUpdateStore.getState().version).toBeNull();
  });

  it('swallows a failure on the way in', async () => {
    // The one that matters: an offline launch must look exactly like a launch
    // with nothing to install, because to the user it is one.
    asMock.mockRejectedValue(new Error('network unreachable'));
    await useUpdateStore.getState().checkQuietly();

    const state = useUpdateStore.getState();
    expect(state.status).toBe('idle');
    expect(state.error).toBeNull();
  });

  it('reports a failure somebody asked for', async () => {
    asMock.mockRejectedValue(new Error('network unreachable'));
    await useUpdateStore.getState().checkNow();

    const state = useUpdateStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toMatch(/network unreachable/);
  });

  it('does not go looking over the top of an update already found', async () => {
    // The quiet check is a launch's errand, and mounted components come and go.
    // One that fired again after an update had been found would throw away the
    // version on offer and, mid-download, the download with it.
    useUpdateStore.setState({ status: 'available', version: '1.1.0' });
    await useUpdateStore.getState().checkQuietly();

    expect(asMock).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().status).toBe('available');
    expect(useUpdateStore.getState().version).toBe('1.1.0');
  });
});

describe('downloading it', () => {
  beforeEach(() => {
    asMock.mockReset();
    reset();
  });

  /** Get the store into `available` with an update that reports `steps`. */
  async function offered(steps: Array<[number, number | null]>) {
    asMock.mockResolvedValue({
      version: '1.1.0',
      notes: null,
      install: async (onProgress) => {
        for (const [downloaded, total] of steps) onProgress(downloaded, total);
      },
    });
    await useUpdateStore.getState().checkNow();
  }

  it('follows the bytes and ends ready', async () => {
    await offered([
      [0, 1000],
      [500, 1000],
      [1000, 1000],
    ]);
    await useUpdateStore.getState().download();

    const state = useUpdateStore.getState();
    expect(state.status).toBe('ready');
    expect(state.progress).toBe(1);
  });

  it('reports no progress rather than inventing a total', async () => {
    // A manifest without a content length is not a reason to draw a bar that
    // is making its denominator up.
    await offered([[4096, null]]);

    const seen: Array<number | null> = [];
    const stop = useUpdateStore.subscribe((s) => {
      if (s.status === 'downloading') seen.push(s.progress);
    });
    await useUpdateStore.getState().download();
    stop();

    expect(seen.every((p) => p === null)).toBe(true);
    expect(useUpdateStore.getState().status).toBe('ready');
  });

  it('says so when the download fails', async () => {
    asMock.mockResolvedValue({
      version: '1.1.0',
      notes: null,
      install: async () => {
        throw new Error('signature did not verify');
      },
    });
    await useUpdateStore.getState().checkNow();
    await useUpdateStore.getState().download();

    const state = useUpdateStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toMatch(/signature did not verify/);
  });

  it('does nothing without an update to download', async () => {
    asMock.mockResolvedValue(null);
    await useUpdateStore.getState().checkNow();
    await useUpdateStore.getState().download();

    expect(useUpdateStore.getState().status).toBe('idle');
  });
});
