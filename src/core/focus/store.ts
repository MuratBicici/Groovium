import { create } from 'zustand';
import { usePlayerStore } from '@/core/store';
import { beginClock, pauseClock, resumeClock, type SessionClock } from './clock';
import { pauseRain, resumeRain, setRainVolume, startRain, stopRain } from './sound';

/**
 * A focus session: the window goes under water, the music stops, and rain
 * plays with a clock in the middle.
 *
 * - `diving`: the water is rising over the window. The clock has started.
 * - `under`: the window is under water.
 * - `surfacing`: the water is going back down, and the session is over.
 *
 * The music that was playing is paused on the way in and left paused on the
 * way out — somebody coming up from an hour's work decides for themselves
 * what happens next.
 */
export type FocusPhase = 'idle' | 'diving' | 'under' | 'surfacing';

export interface FocusState {
  phase: FocusPhase;
  clock: SessionClock | null;
  /** The rain could not be read, so the session runs silent. */
  silent: boolean;
  start: (minutes: number, volume: number) => Promise<void>;
  /** The overlay says the water has covered the window. */
  dived: () => void;
  pause: () => void;
  resume: () => void;
  togglePause: () => void;
  /** Begin coming up. The overlay calls `surfaced` when the water has gone. */
  end: () => void;
  surfaced: () => void;
  setVolume: (volume: number) => void;
}

export const useFocusStore = create<FocusState>((set, get) => ({
  phase: 'idle',
  clock: null,
  silent: false,

  async start(minutes, volume) {
    if (get().phase !== 'idle') return;
    set({ phase: 'diving', clock: beginClock(Date.now(), minutes), silent: false });
    const player = usePlayerStore.getState();
    if (player.playbackState === 'PLAYING') await player.togglePlayPause();
    const playing = await startRain(volume);
    // Still under: a session ended while the rain was loading must not have
    // the rain start behind it.
    if (get().phase === 'idle' || get().phase === 'surfacing') {
      void stopRain();
      return;
    }
    if (!playing) set({ silent: true });
  },

  dived() {
    if (get().phase === 'diving') set({ phase: 'under' });
  },

  pause() {
    const { clock, phase } = get();
    if (!clock || clock.pausedAt !== null || phase === 'idle' || phase === 'surfacing') return;
    set({ clock: pauseClock(clock, Date.now()) });
    void pauseRain();
  },

  resume() {
    const { clock } = get();
    if (!clock || clock.pausedAt === null) return;
    set({ clock: resumeClock(clock, Date.now()) });
    void resumeRain();
  },

  togglePause() {
    const { clock } = get();
    if (clock?.pausedAt === null) get().pause();
    else get().resume();
  },

  end() {
    const { phase } = get();
    if (phase === 'idle' || phase === 'surfacing') return;
    set({ phase: 'surfacing' });
    void stopRain();
  },

  surfaced() {
    if (get().phase === 'surfacing') set({ phase: 'idle', clock: null, silent: false });
  },

  setVolume(volume) {
    setRainVolume(volume);
  },
}));

/** Under water in any way: the rest of the window is out of reach. */
export const inFocus = (phase: FocusPhase): boolean => phase !== 'idle';
