import { create } from 'zustand';
import type {
  AudioProvider,
  PlaybackState,
  ProviderEvent,
  SourceType,
  TrackMetadata,
} from '@/core/types';
import {
  LocalAudioProvider,
  SpotifyProvider,
  YTMusicProvider,
  AppleMusicProvider,
  registerProvider,
  getProvider,
} from '@/core/providers';
import {
  addToPlaylist as addToPlaylistFile,
  attachCoverArtUrls,
  cancelImport as cancelImportFile,
  createPlaylist as createPlaylistFile,
  deletePlaylist as deletePlaylistFile,
  importPaths,
  libraryStoreDir,
  libraryTrackToMetadata,
  loadLibrary,
  loadPlaylists,
  pickFilesToImport,
  pickFolderToImport,
  playlistItemToMetadata,
  removeFromLibrary,
  removeFromPlaylist as removeFromPlaylistFile,
  type ImportProgress,
  type LibraryTrack,
  type Playlist,
  type PlaylistItem,
  type ScanSummary,
} from '@/core/library';
import { loadSession, saveSession } from '@/core/session';
import { isAuthenticated as spotifyIsAuthenticated } from '@/core/security/spotifyAuth';
import { artistKey, hasApiKey as hasLastfmKey, resolveNextTracks, trackKey } from '@/core/station';
import { searchTracks } from '@/core/providers/spotifyApi';
import { clamp } from '@/core/utils/time';
import { volumeToAmplitude } from '@/core/utils/volume';

export type RepeatMode = 'off' | 'one' | 'all';

/**
 * What playback is running over.
 *
 * `library` and `playlist:<id>` are saved collections; `single` is one track
 * played on its own, which is what a Spotify search result does — it plays and
 * stops. Continuing afterwards means putting it in a playlist first.
 */
export type ContextId = 'library' | 'single' | `playlist:${string}`;

/** Treat a `previous` press past this point as "restart the track" instead. */
const RESTART_THRESHOLD_MS = 3000;

/** Quiet period before playback settings are written. */
const SESSION_SAVE_DEBOUNCE_MS = 800;

/**
 * How many recently played tracks the station refuses to suggest again.
 *
 * Without this the station ping-pongs between two songs that each name the
 * other as their closest match, which is common near the top of Last.fm's
 * results. Capped so a long run does not grow without bound.
 */
const STATION_MEMORY = 60;

/**
 * How many recent artists are held back from the next suggestion.
 *
 * Spreading artists inside one queue fill was not enough: the lookup that
 * refills it is seeded from the track that just played, whose own artist tops
 * what Last.fm returns, so the same band came straight back around. Three is
 * enough to break a run without starving a library where one band holds most
 * of the music — that case falls back to allowing repeats rather than going
 * silent.
 */
const STATION_ARTIST_MEMORY = 3;

/**
 * How far back a station run stays walkable with Previous.
 *
 * Each suggestion is appended to the playing collection, so an overnight run
 * grew the array — and the shuffle order beside it — without limit, copying
 * both on every advance. The other two station collections were capped from
 * the start; this one was not.
 */
const STATION_TRAIL = 100;

export interface PlaybackContext {
  id: ContextId;
  /** Resolved view of the collection being played. */
  tracks: TrackMetadata[];
  index: number;
}

export interface PlayerState {
  activeProviderId: SourceType;
  currentTrack: TrackMetadata | null;
  playbackState: PlaybackState;
  positionMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  error: string | null;
  initialized: boolean;

  /** Imported local tracks, owned by the app. */
  library: LibraryTrack[];
  playlists: Playlist[];
  /** Absolute path of the app's audio store, for building asset URLs. */
  storeDir: string;

  playback: PlaybackContext;
  /** Playback order when shuffle is on. Indices into `playback.tracks`. */
  shuffleOrder: number[];
  /** Non-null while files are being copied in. */
  importing: ImportProgress | null;

  /**
   * Infinite play. When the current collection runs out, a similar track is
   * found and played instead of stopping.
   */
  station: boolean;
  /** True while a suggestion is being looked up. */
  stationSearching: boolean;
  /**
   * Suggestions lined up to follow, found while the current track still plays.
   *
   * A queue rather than a single track because one Last.fm call answers with
   * fifty candidates: keeping several costs nothing and spares the next few
   * presses a round trip.
   */
  stationQueue: TrackMetadata[];
  /** Name-based keys of what has played, so the station does not loop. */
  stationHistory: string[];
  /** Artists of the last few tracks, so runs do not settle on one band. */
  stationArtists: string[];
}

export interface PlayerActions {
  initialize: () => Promise<void>;
  setActiveProvider: (id: SourceType) => Promise<void>;

  refreshLibrary: () => Promise<void>;
  refreshPlaylists: () => Promise<void>;

  /** Play a saved collection from the given position. */
  playFrom: (contextId: ContextId, index: number) => Promise<void>;
  /** Play one track on its own — no continuation. */
  playSingle: (track: TrackMetadata) => Promise<void>;

  togglePlayPause: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  toggleMute: () => Promise<void>;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  /** Resolves false when there is no Last.fm key yet, so the UI can ask for one. */
  toggleStation: () => Promise<boolean>;
  clearError: () => void;

  /** Open a picker and report what importing would copy. */
  chooseFiles: () => Promise<ScanSummary | null>;
  chooseFolder: () => Promise<ScanSummary | null>;
  /** Copy the chosen files in. Progress lands on `importing`. */
  runImport: (paths: string[]) => Promise<void>;
  cancelImport: () => Promise<void>;
  removeTrack: (libraryId: string) => Promise<void>;

  newPlaylist: (name: string) => Promise<Playlist | null>;
  removePlaylist: (id: string) => Promise<void>;
  /** Resolves false when the track was already in that playlist. */
  addTrackToPlaylist: (playlistId: string, track: TrackMetadata) => Promise<boolean>;
  removePlaylistItem: (playlistId: string, index: number) => Promise<void>;
}

export type PlayerStore = PlayerState & PlayerActions;

let unsubscribeFromProvider: (() => void) | null = null;
let subscribedProvider: AudioProvider | null = null;

const EMPTY_CONTEXT: PlaybackContext = { id: 'single', tracks: [], index: -1 };

const initialState: PlayerState = {
  activeProviderId: 'local',
  currentTrack: null,
  playbackState: 'IDLE',
  positionMs: 0,
  durationMs: 0,
  volume: 0.8,
  muted: false,
  repeat: 'off',
  shuffle: false,
  error: null,
  initialized: false,
  library: [],
  playlists: [],
  storeDir: '',
  playback: EMPTY_CONTEXT,
  shuffleOrder: [],
  importing: null,
  station: false,
  stationSearching: false,
  stationQueue: [],
  stationHistory: [],
  stationArtists: [],
};

export const usePlayerStore = create<PlayerStore>()((set, get) => {
  function outputAmplitude(): number {
    const { muted, volume } = get();
    return muted ? 0 : volumeToAmplitude(volume);
  }

  function playbackOrder(): number[] {
    const { shuffle, shuffleOrder, playback } = get();
    if (shuffle && shuffleOrder.length === playback.tracks.length) return shuffleOrder;
    return playback.tracks.map((_, index) => index);
  }

  function neighborIndex(step: number): number | null {
    const { playback, repeat } = get();
    if (playback.tracks.length === 0) return null;

    const order = playbackOrder();
    const current = order.indexOf(playback.index);
    const position = current === -1 ? 0 : current + step;

    if (position < 0 || position >= order.length) {
      if (repeat !== 'all') return null;
      const wrapped = ((position % order.length) + order.length) % order.length;
      return order[wrapped] ?? null;
    }
    return order[position] ?? null;
  }

  /** Turn a context id into the tracks it stands for. */
  function resolveContext(contextId: ContextId): TrackMetadata[] {
    const { library, playlists } = get();

    if (contextId === 'library') {
      return library.map((track) => libraryTrackToMetadata(track));
    }
    if (contextId.startsWith('playlist:')) {
      const id = contextId.slice('playlist:'.length);
      const playlist = playlists.find((p) => p.id === id);
      if (!playlist) return [];
      return playlist.items
        .map((item) => playlistItemToMetadata(item, library))
        .filter((track): track is TrackMetadata => track !== null);
    }
    return [];
  }

  // --- Station ---------------------------------------------------------------

  /** Guards against two lookups running at once for the same seed. */
  let prefetchSeedKey: string | null = null;
  /**
   * The running lookup, so a caller that needs its answer can wait for it.
   *
   * Without this, `playStationTrack`'s "look it up now" fallback was a no-op in
   * exactly the two cases it existed for — a lookup already in flight, and one
   * that had already come back — because the seed guard below returned early
   * and the press was swallowed.
   */
  let prefetchInFlight: Promise<void> | null = null;

  /**
   * Look up what should follow the current track, while it is still playing.
   *
   * Runs the same way whether or not infinite play is switched on. The toggle
   * decides one thing and one thing only — whether a track ending by itself
   * continues — and it is read in `handleTrackEnded`, nowhere else. Everything
   * here is what makes the answer ready before it is wanted, and Next wants it
   * just as much as an ending track does.
   *
   * Done ahead of time on purpose: a Last.fm round trip plus a Spotify search
   * started at the moment of silence would be audible as a gap, and under a
   * press it is felt as one.
   */
  /**
   * Rebuild the playing collection after the library or a playlist changed.
   *
   * `playback.tracks` is a snapshot taken when playback started, and nothing
   * used to refresh it. Deleting a song mid-listen left the snapshot holding a
   * track that no longer existed: the wrong row showed as playing, and Next
   * walked into it and raised "Unknown track" over the music.
   *
   * The playing track is followed to its new position rather than the index
   * being kept, because everything after a removal has shifted by one.
   */
  function reconcilePlayback(): void {
    const { playback, currentTrack, shuffle } = get();
    // A single track is not derived from a collection, so nothing can stale it.
    if (playback.id === 'single' || playback.tracks.length === 0) return;

    const tracks = resolveContext(playback.id);
    if (tracks.length === 0) {
      set({ playback: { ...playback, tracks, index: -1 }, shuffleOrder: [] });
      return;
    }

    const found = currentTrack ? tracks.findIndex((t) => t.id === currentTrack.id) : -1;
    // When the playing track is the one that went, hold the position so Next
    // carries on from about where the listener was.
    const index = found >= 0 ? found : Math.min(playback.index, tracks.length - 1);

    set({
      playback: { ...playback, tracks, index },
      // Rebuilt rather than kept: `playbackOrder` needs the two lengths to
      // match, and a stale order silently turns shuffle back into sequential.
      shuffleOrder: shuffle ? shuffledIndices(tracks.length, index) : [],
    });
  }

  async function prefetchStationTrack(): Promise<void> {
    const { currentTrack, stationQueue } = get();
    if (!currentTrack) return;
    // Already stocked. Refilling early would spend a lookup to replace answers
    // that have not been used yet.
    if (stationQueue.length > 0) return;

    const seedKey = trackKey(currentTrack);
    if (prefetchSeedKey === seedKey) {
      // Looking right now: wait for that answer rather than reporting nothing.
      // Already finished: the result stands, and asking again would only get
      // the same nothing back.
      if (prefetchInFlight) await prefetchInFlight;
      return;
    }

    prefetchSeedKey = seedKey;
    set({ stationSearching: true });

    let settle = () => {};
    const inFlight = new Promise<void>((resolve) => {
      settle = resolve;
    });
    prefetchInFlight = inFlight;

    try {
      const { library, stationHistory, stationArtists, stationQueue } = get();
      const found = await resolveNextTracks({
        seed: currentTrack,
        library,
        // Anything already queued is excluded too, or a refill would hand back
        // what is still waiting to play.
        exclude: new Set([...stationHistory, seedKey, ...stationQueue.map(trackKey)]),
        // The seed's own artist is included: it is the one most likely to come
        // back, since its other tracks head the similarity list.
        excludeArtists: new Set([...stationArtists, artistKey(currentTrack.artist)]),
        spotifyAvailable: await spotifyIsAuthenticated(),
        searchSpotify: searchTracks,
      });

      // The user may have moved on mid-lookup.
      if (prefetchSeedKey !== seedKey) return;
      set({ stationQueue: [...get().stationQueue, ...found] });
    } catch (err) {
      // A station that cannot find anything should fall quiet, not interrupt
      // playback with an error banner over a background lookup. But a failure
      // must not pin the seed either: leaving it set meant one network blip
      // silenced the station for that song for the rest of the session.
      console.warn('[station] could not find a next track', err);
      if (prefetchSeedKey === seedKey) prefetchSeedKey = null;
    } finally {
      // Only tidy up after ourselves. A newer lookup may already own these —
      // clearing them unconditionally destroyed its handle and switched off its
      // indicator while it was still running, which put the swallowed press
      // this handle exists to prevent straight back.
      if (prefetchInFlight === inFlight) {
        prefetchInFlight = null;
        set({ stationSearching: false });
      }
      settle();
    }
  }

  /**
   * Extend the current context with the station's pick and play it.
   *
   * Appending rather than replacing keeps `previous` working: a station run
   * reads back as one growing collection, which is what it sounds like.
   */
  async function playStationTrack(): Promise<boolean> {
    if (get().stationQueue.length === 0) {
      // Nothing queued — a very short track, or a press that arrived before the
      // lookup finished. Look it up now and accept the gap.
      await prefetchStationTrack();
    }
    const [track, ...rest] = get().stationQueue;
    if (!track) return false;

    const { playback, shuffle, shuffleOrder } = get();
    // Trim from the front once the trail is long enough. Previous still walks
    // back a hundred tracks, which is further than anyone reaches.
    const kept = [...playback.tracks, track].slice(-STATION_TRAIL);
    const dropped = playback.tracks.length + 1 - kept.length;
    const tracks = kept;
    const index = tracks.length - 1;

    set({
      playback: { ...playback, tracks, index },
      // `playbackOrder` falls back to sequential unless these stay the same
      // length, which would silently undo shuffle for the rest of the run.
      // Indices shift when the front is trimmed, so the order shifts with them.
      shuffleOrder:
        shuffle && shuffleOrder.length > 0
          ? [...shuffleOrder, playback.tracks.length]
              .map((i) => i - dropped)
              .filter((i) => i >= 0)
          : shuffleOrder,
      stationQueue: rest,
    });
    // Only re-open the lookup once the queue is spent; the entries still in it
    // are good answers for the seed they came from.
    if (rest.length === 0) prefetchSeedKey = null;

    await startTrack(index);
    return true;
  }

  function rememberPlayed(track: TrackMetadata): void {
    const artist = artistKey(track.artist);
    const artists = get().stationArtists.filter((entry) => entry !== artist);
    artists.push(artist);
    set({ stationArtists: artists.slice(-STATION_ARTIST_MEMORY) });

    const key = trackKey(track);
    const history = get().stationHistory.filter((entry) => entry !== key);
    history.push(key);
    set({ stationHistory: history.slice(-STATION_MEMORY) });
  }

  async function handleTrackEnded(trackId: string | null): Promise<void> {
    const { repeat, playback, currentTrack } = get();

    // A track ending a moment after the user clicked a different one arrives
    // here with the *outgoing* track's id, while the store has already moved
    // on. Acting on it advanced past the song that was just chosen.
    if (trackId !== null && currentTrack !== null && trackId !== currentTrack.id) return;

    if (repeat === 'one' && playback.index >= 0) {
      await startTrack(playback.index);
      return;
    }

    const nextIndex = neighborIndex(1);
    if (nextIndex !== null) {
      await startTrack(nextIndex);
      return;
    }

    // The collection is finished, and this is the one place the toggle is
    // read: with infinite play on, keep going; without it, stop. Everything
    // else about finding a successor runs the same either way.
    if (get().station && (await playStationTrack())) return;
    set({ playbackState: 'IDLE', positionMs: 0 });
  }

  function handleProviderEvent(event: ProviderEvent): void {
    switch (event.type) {
      case 'state':
        set({ playbackState: event.state });
        break;
      case 'progress':
        set({
          positionMs: event.positionMs,
          durationMs: event.durationMs > 0 ? event.durationMs : get().durationMs,
        });
        break;
      case 'track':
        set({ currentTrack: event.track });
        break;
      case 'error':
        set({ error: event.error });
        break;
      case 'ended':
        void handleTrackEnded(event.trackId);
        break;
    }
  }

  /**
   * Run an action that can fail, and show the user when it does.
   *
   * A policy rather than a habit. Error wrapping had been added one bug at a
   * time, so seven actions were still bare — including `removeTrack`, where the
   * user confirms an irreversible delete, the call fails, the row stays put and
   * nothing is said.
   */
  async function reporting<T>(action: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await action();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return fallback;
    }
  }

  async function withProvider(
    action: (provider: NonNullable<ReturnType<typeof getProvider>>) => Promise<void>,
  ): Promise<void> {
    const provider = getProvider(get().activeProviderId);
    if (!provider) {
      set({ error: `No provider registered for "${get().activeProviderId}".` });
      return;
    }
    try {
      await action(provider);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Play the track at `index` of the current context. */
  async function startTrack(index: number): Promise<void> {
    const track = get().playback.tracks[index];
    if (!track) return;

    // A collection can mix sources; the track says which provider owns it.
    if (track.source !== get().activeProviderId) {
      await withProvider((provider) => provider.pause());
      await get().setActiveProvider(track.source);
      if (get().error) return;
    }

    set({
      playback: { ...get().playback, index },
      currentTrack: track,
      positionMs: 0,
      durationMs: track.duration,
      error: null,
    });
    rememberPlayed(track);
    await withProvider((provider) => provider.play(track.id));

    // Deliberately not awaited: finding the successor must not delay playback.
    void prefetchStationTrack();
  }

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let persistenceStarted = false;
  /** Startup in progress. Separate from `initialized`, which means it worked. */
  let starting = false;

  function startPersisting(): void {
    if (persistenceStarted) return;
    persistenceStarted = true;

    usePlayerStore.subscribe((state, prev) => {
      const unchanged =
        state.volume === prev.volume &&
        state.muted === prev.muted &&
        state.repeat === prev.repeat &&
        state.shuffle === prev.shuffle &&
        state.station === prev.station;
      if (unchanged) return;

      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        const { volume, muted, repeat, shuffle, station } = get();
        void saveSession({ volume, muted, repeat, shuffle, station });
      }, SESSION_SAVE_DEBOUNCE_MS);
    });
  }

  return {
    ...initialState,

    async initialize() {
      if (get().initialized || starting) return;
      // A separate latch from `initialized`, which is now only set on success.
      // The flag used to be raised first, so anything below throwing left the
      // app looking normal with an empty library, no message, no way to retry,
      // and settings silently no longer being saved.
      starting = true;

      try {
        registerProvider(new LocalAudioProvider());
        registerProvider(new SpotifyProvider());
        registerProvider(new YTMusicProvider());
        registerProvider(new AppleMusicProvider());

        await get().setActiveProvider('local');

        const session = await loadSession();
        if (session) {
          const repeat: RepeatMode =
            session.repeat === 'all' || session.repeat === 'one' ? session.repeat : 'off';
          set({
            volume: clamp(session.volume, 0, 1),
            muted: session.muted,
            repeat,
            shuffle: session.shuffle,
            // Only restore it if the key is still there; a key cleared between
            // runs would otherwise leave the button lit and doing nothing.
            station: session.station === true && (await hasLastfmKey()),
          });
        }

        set({ storeDir: await libraryStoreDir() });
        await get().refreshLibrary();
        await get().refreshPlaylists();
        await withProvider((provider) => provider.setVolume(outputAmplitude()));
        startPersisting();
        set({ initialized: true });
      } catch (err) {
        set({
          error: `Could not start up: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        starting = false;
      }
    },

    async setActiveProvider(id) {
      const provider = getProvider(id);
      if (!provider) {
        set({ error: `No provider registered for "${id}".` });
        return;
      }
      if (subscribedProvider === provider) return;

      unsubscribeFromProvider?.();
      unsubscribeFromProvider = provider.subscribe(handleProviderEvent);
      subscribedProvider = provider;

      set({
        activeProviderId: id,
        currentTrack: null,
        playbackState: 'IDLE',
        positionMs: 0,
        durationMs: 0,
        error: null,
      });

      const ready = await provider.initialize();
      if (!ready) {
        if (!get().error) set({ error: `${provider.displayName} is unavailable.` });
        return;
      }
      await provider.setVolume(outputAmplitude());
    },

    async refreshLibrary() {
      // Cover URLs are derived here, once, so every consumer below —
      // rows, playlist mapping, the station — sees them for free.
      const library = await attachCoverArtUrls(await loadLibrary(), get().storeDir);
      set({ library });

      // Hand the provider everything it might be asked to play.
      const provider = getProvider('local');
      if (provider instanceof LocalAudioProvider) {
        await provider.useLibrary(library, get().storeDir);
      }
      reconcilePlayback();
    },

    async refreshPlaylists() {
      set({ playlists: await loadPlaylists() });
      reconcilePlayback();
    },

    async playFrom(contextId, index) {
      const tracks = resolveContext(contextId);
      if (tracks.length === 0) return;

      set({
        playback: { id: contextId, tracks, index },
        shuffleOrder: get().shuffle ? shuffledIndices(tracks.length, index) : [],
      });
      await startTrack(index);
    },

    async playSingle(track) {
      set({
        playback: { id: 'single', tracks: [track], index: 0 },
        shuffleOrder: [],
      });
      await startTrack(0);
    },

    async togglePlayPause() {
      const { playbackState, playback } = get();

      if (playbackState === 'PLAYING') {
        await withProvider((provider) => provider.pause());
        return;
      }
      if (playbackState === 'PAUSED') {
        await withProvider((provider) => provider.resume());
        return;
      }
      if (playback.tracks.length > 0) {
        await startTrack(playback.index >= 0 ? playback.index : 0);
      }
    },

    async next() {
      const index = neighborIndex(1);
      if (index !== null) {
        await startTrack(index);
        return;
      }

      // Out of tracks, but the button was pressed. Same machinery as infinite
      // play, toggle or no toggle — the toggle only governs an ending track.
      if (await playStationTrack()) return;

      // Nothing to suggest — no Last.fm key, or it knows nothing about this
      // track. Rather than leave the press unanswered, start the collection
      // again. Pointless for a lone track, which would just replay itself.
      const { playback } = get();
      if (playback.tracks.length > 1) {
        const order = playbackOrder();
        const first = order[0];
        if (first !== undefined) await startTrack(first);
      }
    },

    async previous() {
      if (get().positionMs > RESTART_THRESHOLD_MS) {
        await get().seek(0);
        return;
      }
      const index = neighborIndex(-1);
      if (index === null) {
        await get().seek(0);
        return;
      }
      await startTrack(index);
    },

    async seek(positionMs) {
      const target = clamp(positionMs, 0, get().durationMs || positionMs);
      set({ positionMs: target });
      await withProvider((provider) => provider.seek(target));
    },

    async setVolume(volume) {
      const next = clamp(volume, 0, 1);
      set({ volume: next, muted: next === 0 ? get().muted : false });
      await withProvider((provider) => provider.setVolume(outputAmplitude()));
    },

    async toggleMute() {
      set({ muted: !get().muted });
      await withProvider((provider) => provider.setVolume(outputAmplitude()));
    },

    cycleRepeat() {
      const order: RepeatMode[] = ['off', 'all', 'one'];
      const nextMode = order[(order.indexOf(get().repeat) + 1) % order.length];
      set({ repeat: nextMode ?? 'off' });
    },

    toggleShuffle() {
      const shuffle = !get().shuffle;
      const { playback } = get();
      set({
        shuffle,
        shuffleOrder: shuffle ? shuffledIndices(playback.tracks.length, playback.index) : [],
      });
    },

    async toggleStation() {
      if (get().station) {
        // The queue stays: with the toggle off the machinery is unchanged, so
        // discarding it would only make the next press pay for a lookup again.
        set({ station: false });
        return true;
      }

      // Turning it on needs a key. Report rather than throw, so the caller can
      // open the setup sheet instead of showing an error.
      if (!(await hasLastfmKey())) return false;

      set({ station: true });
      void prefetchStationTrack();
      return true;
    },

    clearError() {
      set({ error: null });
    },

    async chooseFiles() {
      return reporting(() => pickFilesToImport(), null);
    },

    async chooseFolder() {
      return reporting(() => pickFolderToImport(), null);
    },

    async runImport(paths) {
      if (paths.length === 0) return;

      set({ importing: { done: 0, total: paths.length, currentName: '' } });
      try {
        await reporting(async () => {
          await importPaths(paths);
          await get().refreshLibrary();
        }, undefined);
      } finally {
        set({ importing: null });
      }
    },

    async cancelImport() {
      await reporting(() => cancelImportFile(), undefined);
    },

    async removeTrack(libraryId) {
      await reporting(async () => {
        await removeFromLibrary(libraryId);
        await get().refreshLibrary();
        // Playlists may have referenced it; Rust already pruned them.
        await get().refreshPlaylists();
      }, undefined);
    },

    async newPlaylist(name) {
      return reporting(async () => {
        const playlist = await createPlaylistFile(name);
        await get().refreshPlaylists();
        return playlist;
      }, null);
    },

    async removePlaylist(id) {
      await reporting(async () => {
        await deletePlaylistFile(id);
        await get().refreshPlaylists();
      }, undefined);
    },

    async addTrackToPlaylist(playlistId, track) {
      const item = toPlaylistItem(track);
      if (!item) {
        set({ error: 'That track cannot be saved to a playlist.' });
        return false;
      }
      // A rejected payload used to surface as an unhandled promise rejection
      // and nothing else, so the track just quietly failed to appear.
      return reporting(async () => {
        const added = await addToPlaylistFile(playlistId, item);
        if (added) await get().refreshPlaylists();
        return added;
      }, false);
    },

    async removePlaylistItem(playlistId, index) {
      await reporting(async () => {
        await removeFromPlaylistFile(playlistId, index);
        await get().refreshPlaylists();
      }, undefined);
    },
  };
});

/**
 * Turn a playable track into something storable.
 *
 * Local tracks are stored as a reference into the library; Spotify tracks carry
 * their metadata because nothing else holds it.
 */
function toPlaylistItem(track: TrackMetadata): PlaylistItem | null {
  if (track.source === 'spotify') {
    const item: PlaylistItem = {
      source: 'spotify',
      uri: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationMs: track.duration,
    };
    if (track.coverArtUrl) item.coverArtUrl = track.coverArtUrl;
    return item;
  }

  if (track.source === 'local' && track.id.startsWith('library:')) {
    return { source: 'local', libraryId: track.id.slice('library:'.length) };
  }

  // A local file that never entered the library has nothing stable to point at.
  return null;
}

/** Fisher-Yates over context indices, pinning whatever is playing to the front. */
function shuffledIndices(length: number, pinnedIndex = -1): number[] {
  const indices = Array.from({ length }, (_, i) => i);

  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = indices[i] as number;
    const b = indices[j] as number;
    indices[i] = b;
    indices[j] = a;
  }

  if (pinnedIndex >= 0) {
    const at = indices.indexOf(pinnedIndex);
    if (at > 0) {
      indices.splice(at, 1);
      indices.unshift(pinnedIndex);
    }
  }
  return indices;
}
