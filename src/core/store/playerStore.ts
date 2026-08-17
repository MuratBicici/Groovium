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
import { hasApiKey as hasLastfmKey, resolveNextTrack, trackKey } from '@/core/station';
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
  /** The track lined up to follow this one, found while it still plays. */
  stationNext: TrackMetadata | null;
  /** Name-based keys of what has played, so the station does not loop. */
  stationHistory: string[];
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
  stationNext: null,
  stationHistory: [],
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
   * Look up what should follow the current track, while it is still playing.
   *
   * Done ahead of time on purpose: the user asked for the next song to play
   * "hemen sonrasında", and a Last.fm round trip plus a Spotify search started
   * at the moment of silence would be audible as a gap.
   */
  async function prefetchStationTrack(): Promise<void> {
    const { station, currentTrack } = get();
    if (!station || !currentTrack) return;

    const seedKey = trackKey(currentTrack);
    // Already looked up for this track, or looking right now. Not retried when
    // it came back empty either: a second call would return the same nothing.
    if (prefetchSeedKey === seedKey) return;

    prefetchSeedKey = seedKey;
    set({ stationSearching: true, stationNext: null });

    try {
      const { library, stationHistory } = get();
      const found = await resolveNextTrack({
        seed: currentTrack,
        library,
        exclude: new Set([...stationHistory, seedKey]),
        spotifyAvailable: await spotifyIsAuthenticated(),
        searchSpotify: searchTracks,
      });

      // The user may have moved on or switched the station off mid-lookup.
      if (!get().station || prefetchSeedKey !== seedKey) return;
      set({ stationNext: found });
    } catch (err) {
      // A station that cannot find anything should fall quiet, not interrupt
      // playback with an error banner over a background lookup.
      console.warn('[station] could not find a next track', err);
      if (prefetchSeedKey === seedKey) set({ stationNext: null });
    } finally {
      if (prefetchSeedKey === seedKey) set({ stationSearching: false });
    }
  }

  /**
   * Extend the current context with the station's pick and play it.
   *
   * Appending rather than replacing keeps `previous` working: a station run
   * reads back as one growing collection, which is what it sounds like.
   */
  async function playStationTrack(): Promise<boolean> {
    if (!get().station) return false;

    if (!get().stationNext) {
      // Nothing prefetched — a very short track, or the station was just turned
      // on. Look it up now and accept the gap.
      await prefetchStationTrack();
    }
    const track = get().stationNext;
    if (!track) return false;

    const { playback, shuffle, shuffleOrder } = get();
    const tracks = [...playback.tracks, track];
    const index = tracks.length - 1;

    set({
      playback: { ...playback, tracks, index },
      // `playbackOrder` falls back to sequential unless these stay the same
      // length, which would silently undo shuffle for the rest of the run.
      shuffleOrder: shuffle && shuffleOrder.length > 0 ? [...shuffleOrder, index] : shuffleOrder,
      stationNext: null,
    });
    prefetchSeedKey = null;

    await startTrack(index);
    return true;
  }

  function rememberPlayed(track: TrackMetadata): void {
    const key = trackKey(track);
    const history = get().stationHistory.filter((entry) => entry !== key);
    history.push(key);
    set({ stationHistory: history.slice(-STATION_MEMORY) });
  }

  async function handleTrackEnded(): Promise<void> {
    const { repeat, playback } = get();

    if (repeat === 'one' && playback.index >= 0) {
      await startTrack(playback.index);
      return;
    }

    const nextIndex = neighborIndex(1);
    if (nextIndex !== null) {
      await startTrack(nextIndex);
      return;
    }

    // The collection is finished. With the station on, keep going; without it,
    // stop — which is exactly the switch the button controls.
    if (await playStationTrack()) return;
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
        void handleTrackEnded();
        break;
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
      if (get().initialized) return;

      registerProvider(new LocalAudioProvider());
      registerProvider(new SpotifyProvider());
      registerProvider(new YTMusicProvider());
      registerProvider(new AppleMusicProvider());

      set({ initialized: true });
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
    },

    async refreshPlaylists() {
      set({ playlists: await loadPlaylists() });
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
      // Same rule as reaching the end naturally: with the station on, pressing
      // next at the end of a collection continues rather than doing nothing.
      await playStationTrack();
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
        set({ station: false, stationNext: null, stationSearching: false });
        prefetchSeedKey = null;
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
      return pickFilesToImport();
    },

    async chooseFolder() {
      return pickFolderToImport();
    },

    async runImport(paths) {
      if (paths.length === 0) return;

      set({ importing: { done: 0, total: paths.length, currentName: '' } });
      try {
        await importPaths(paths);
        await get().refreshLibrary();
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
      } finally {
        set({ importing: null });
      }
    },

    async cancelImport() {
      await cancelImportFile();
    },

    async removeTrack(libraryId) {
      await removeFromLibrary(libraryId);
      await get().refreshLibrary();
      // Playlists may have referenced it; Rust already pruned them.
      await get().refreshPlaylists();
    },

    async newPlaylist(name) {
      try {
        const playlist = await createPlaylistFile(name);
        await get().refreshPlaylists();
        return playlist;
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
        return null;
      }
    },

    async removePlaylist(id) {
      await deletePlaylistFile(id);
      await get().refreshPlaylists();
    },

    async addTrackToPlaylist(playlistId, track) {
      const item = toPlaylistItem(track);
      if (!item) {
        set({ error: 'That track cannot be saved to a playlist.' });
        return false;
      }
      try {
        const added = await addToPlaylistFile(playlistId, item);
        if (added) await get().refreshPlaylists();
        return added;
      } catch (err) {
        // A rejected payload used to surface as an unhandled promise rejection
        // and nothing else, so the track just quietly failed to appear.
        set({ error: err instanceof Error ? err.message : String(err) });
        return false;
      }
    },

    async removePlaylistItem(playlistId, index) {
      await removeFromPlaylistFile(playlistId, index);
      await get().refreshPlaylists();
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
