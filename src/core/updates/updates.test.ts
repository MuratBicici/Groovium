import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QUIET_GAP_MS, useUpdateStore } from './store';
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

/**
 * The clock, because the quiet check keeps time.
 *
 * It holds its answer for six hours and these tests run in a millisecond, so
 * without a clock to move the second quiet check in the file would return
 * without doing anything and the test around it would pass for that reason
 * rather than for the one it was written for. Two of them already did.
 */
let clock = QUIET_GAP_MS;
vi.spyOn(Date, 'now').mockImplementation(() => clock);

/** Far enough on that a quiet check is willing to ask again. */
const laterOn = () => {
  clock += QUIET_GAP_MS;
};

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
  // Each test starts able to ask, whatever the one before it asked.
  laterOn();
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

  it('answers a pressed check even when there is nothing newer', async () => {
    // The fault this fixes. `idle` used to mean both "nobody asked" and
    // "somebody asked and there is nothing", so the panel showed the same
    // button before and after — the press produced no answer at all, and the
    // `update.upToDate` string sat unused in both languages.
    asMock.mockResolvedValue(null);
    await useUpdateStore.getState().checkNow();

    expect(useUpdateStore.getState().status).toBe('current');
    expect(useUpdateStore.getState().version).toBeNull();
  });

  it('says nothing when the look was its own idea', async () => {
    // The other half, and the reason the two are not one function. Nobody
    // asked at startup, so nothing may appear on screen because of it.
    asMock.mockResolvedValue(null);
    await useUpdateStore.getState().checkQuietly();

    expect(useUpdateStore.getState().status).toBe('idle');
  });

  it('holds its answer rather than asking again straight away', async () => {
    // Called on the way in and then on a timer, so it is called far more often
    // than it should ask. Deciding how often to ask is its own job — a caller
    // that had to keep the time would be a second place to get it wrong.
    asMock.mockResolvedValue(null);
    await useUpdateStore.getState().checkQuietly();
    await useUpdateStore.getState().checkQuietly();
    await useUpdateStore.getState().checkQuietly();

    expect(asMock).toHaveBeenCalledTimes(1);
  });

  it('asks again once enough time has gone by', async () => {
    // The point of the timer. Closing the window hides this app to the tray
    // for weeks, so a check that only ever ran at startup ran almost never,
    // and an installed base could sit on an old release indefinitely.
    asMock.mockResolvedValue(null);
    await useUpdateStore.getState().checkQuietly();
    laterOn();
    await useUpdateStore.getState().checkQuietly();

    expect(asMock).toHaveBeenCalledTimes(2);
  });

  it('stops asking once something has been found', async () => {
    // An update in hand is an answer. Asking over the top of it would replace
    // the handle the download needs with an identical one, for nothing.
    asMock.mockResolvedValue(offering('1.1.0'));
    await useUpdateStore.getState().checkQuietly();
    laterOn();
    await useUpdateStore.getState().checkQuietly();

    expect(asMock).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().status).toBe('available');
  });

  it('is not something waiting to be installed', async () => {
    // The settings button wears a dot for an update in hand. Being up to date
    // is the opposite of that.
    asMock.mockResolvedValue(null);
    await useUpdateStore.getState().checkNow();

    const s = useUpdateStore.getState();
    expect(s.status === 'available' || s.status === 'downloading' || s.status === 'ready').toBe(
      false,
    );
  });

  it('forgets an answer nobody is looking at any more', async () => {
    // Reopening the panel must not show a check that did not just happen.
    asMock.mockResolvedValue(null);
    await useUpdateStore.getState().checkNow();
    useUpdateStore.getState().forgetResult();

    expect(useUpdateStore.getState().status).toBe('idle');
  });

  it('does not tidy away an update that is actually waiting', async () => {
    useUpdateStore.setState({ status: 'ready' });
    useUpdateStore.getState().forgetResult();

    expect(useUpdateStore.getState().status).toBe('ready');
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

    expect(useUpdateStore.getState().status).toBe('current');
  });
});
