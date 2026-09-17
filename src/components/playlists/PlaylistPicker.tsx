import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { TrackMetadata } from '@/core/types';
import type { PlaylistItem } from '@/core/library';
import { usePlaylists, usePlayerStore } from '@/core/store';
import { useSpotifyPlaylistsStore } from '@/core/spotify/store';
import { hasClientId, isAuthenticated } from '@/core/security/spotifyAuth';
import { useSheet } from '@/core/utils/useSheet';
import { useT } from '@/core/i18n';

/**
 * One playlist picker for the whole window.
 *
 * It used to be a popover rendered inside each row. That broke in two ways at
 * once: the rows live in an `overflow-y-auto` list, which clipped the popover
 * out of sight, and each row owned its own open state, so one never closed
 * another — an open menu whose row was no longer hovered would reappear over a
 * different row as the mouse moved, looking like it had opened by itself.
 *
 * A single sheet at shell level fixes all of that by construction: nothing
 * clips it, only one can be open, and a backdrop gives it somewhere to be
 * dismissed from.
 *
 * Two kinds of playlist, in two sections of the same sheet: Groovium's own,
 * which can hold anything, and the account's Spotify playlists, which can only
 * hold what Spotify can play. A song from this computer shows the Spotify
 * section with the reason it cannot go there, rather than hiding it — a section
 * that is sometimes missing reads as a bug.
 */

interface PickerContext {
  /** Open the picker for a track. */
  pick: (track: TrackMetadata) => void;
}

/**
 * The default deliberately complains.
 *
 * A silent no-op here is indistinguishable from a dead button: if the provider
 * is ever missing from the tree — or a stale module leaves a consumer bound to
 * a different context object — the only symptom is that clicking does nothing,
 * with no clue why. Saying so costs nothing and turns a mystery into a message.
 */
const Context = createContext<PickerContext>({
  pick: () => {
    console.error(
      '[playlists] AddToPlaylist was used outside PlaylistPickerProvider — the picker cannot open.',
    );
  },
});

export function usePlaylistPicker(): PickerContext {
  return useContext(Context);
}

/**
 * Whether a playlist already holds this track.
 *
 * Mirrors `same_track` in `src-tauri/src/playlists.rs`: identity only, because
 * two lookups of one Spotify track can carry different cached metadata.
 */
function containsTrack(items: PlaylistItem[], track: TrackMetadata): boolean {
  return items.some((item) =>
    item.source === 'spotify'
      ? track.source === 'spotify' && item.uri === track.id
      : track.id === `library:${item.libraryId}`,
  );
}

/** How long a confirmation stays up. */
const SAID_FOR_MS = 1800;

export function PlaylistPickerProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const [track, setTrack] = useState<TrackMetadata | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const { present, shown } = useSheet(track !== null);
  /**
   * The track the sheet is showing, which outlives the one it is *for*.
   * Closing clears `track` at once, and a sheet with 180ms left to live still
   * has to say whose playlist it was asking about.
   */
  const [showing, setShowing] = useState<TrackMetadata | null>(track);
  if (track && track !== showing) setShowing(track);

  const playlists = usePlaylists();
  const addTrackToPlaylist = usePlayerStore((s) => s.addTrackToPlaylist);
  const newPlaylist = usePlayerStore((s) => s.newPlaylist);

  const spotifyPlaylists = useSpotifyPlaylistsStore((s) => s.playlists);
  const spotifyStarted = useSpotifyPlaylistsStore((s) => s.started);
  const spotifyLoading = useSpotifyPlaylistsStore((s) => s.loading);
  const addToCrate = useSpotifyPlaylistsStore((s) => s.addToCrate);
  const createSpotifyPlaylist = useSpotifyPlaylistsStore((s) => s.createPlaylist);
  const knownToHold = useSpotifyPlaylistsStore((s) => s.knownToHold);

  /** Whether there is a Spotify account to offer playlists from, once known. */
  const [spotifyReady, setSpotifyReady] = useState(false);
  /** Spotify playlists already known to hold the track, by id. */
  const [held, setHeld] = useState<Record<string, boolean>>({});
  /** The Spotify playlist a song is on its way into. */
  const [adding, setAdding] = useState<string | null>(null);

  const saidTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((message: string) => {
    setSaved(message);
    if (saidTimer.current) clearTimeout(saidTimer.current);
    saidTimer.current = setTimeout(() => setSaved(null), SAID_FOR_MS);
  }, []);

  const pick = useCallback((next: TrackMetadata) => {
    setHeld({});
    setTrack(next);
  }, []);

  const close = useCallback(() => setTrack(null), []);

  useEffect(() => {
    if (!track) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // The shell listens for Escape on `window` too. `stopPropagation` would
        // not help — it does not stop other listeners on the same target — so
        // this has to be the immediate variant, in the capture phase, to close
        // only the topmost surface.
        e.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [track, close]);

  // Whether Spotify is there to offer, and its shelf if so. Asked each time the
  // sheet opens rather than once: somebody can connect or sign out between two
  // picks, and a section for an account that has gone would offer nothing real.
  useEffect(() => {
    if (!track) return;
    let live = true;
    void (async () => {
      const ready = (await hasClientId()) && (await isAuthenticated());
      if (!live) return;
      setSpotifyReady(ready);
      if (ready) void useSpotifyPlaylistsStore.getState().open();
    })();
    return () => {
      live = false;
    };
  }, [track]);

  // Which Spotify playlists already hold the song, where that is known without
  // asking. The rest are found out on press.
  useEffect(() => {
    if (!track || track.source !== 'spotify' || !spotifyReady) return;
    let live = true;
    void (async () => {
      const known: Record<string, boolean> = {};
      for (const playlist of spotifyPlaylists) {
        if ((await knownToHold(playlist.id, track.id)) === true) known[playlist.id] = true;
      }
      if (live) setHeld(known);
    })();
    return () => {
      live = false;
    };
  }, [track, spotifyReady, spotifyPlaylists, knownToHold]);

  async function addToLocal(playlistId: string, name: string) {
    if (!track) return;
    const added = await addTrackToPlaylist(playlistId, track);
    close();
    // Being told it is already there is information, not an error.
    say(added ? t('playlists.addedTo', { name }) : t('playlists.alreadyIn', { name }));
  }

  async function createLocal(name: string) {
    const created = await newPlaylist(name);
    if (created) await addToLocal(created.id, created.name);
  }

  async function addToSpotify(playlistId: string, name: string) {
    if (!track || adding) return;
    setAdding(playlistId);
    const outcome = await addToCrate(playlistId, track);
    setAdding(null);
    if (outcome === 'added') {
      close();
      say(t('playlists.addedTo', { name }));
    } else if (outcome === 'already') {
      setHeld((now) => ({ ...now, [playlistId]: true }));
      say(t('playlists.alreadyIn', { name }));
    } else if (outcome === 'refused') {
      say(t('playlists.localNotOnSpotify'));
    } else {
      // Read now, not from the render before the add: the reason is set by it.
      say(useSpotifyPlaylistsStore.getState().writeError ?? t('playlists.couldNotAdd', { name }));
    }
  }

  async function createOnSpotify(name: string) {
    const created = await createSpotifyPlaylist(name);
    if (created) await addToSpotify(created.id, created.name);
    else say(t('playlists.couldNotCreate'));
  }

  const localTrack = showing?.source !== 'spotify';

  return (
    <Context.Provider value={{ pick }}>
      {children}

      {/* Confirmation lives outside the sheet so it survives the close. */}
      {saved && (
        <div className="pointer-events-none absolute inset-x-0 bottom-14 z-40 flex justify-center px-4">
          <span className="rounded-full bg-shell-900/95 px-3 py-1 text-center text-meta text-brass-400 shadow">
            {saved}
          </span>
        </div>
      )}

      {present && showing && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-5">
          <button
            type="button"
            aria-label={t('common.cancel')}
            onClick={close}
            className={`absolute inset-0 cursor-default bg-shell-900/70 backdrop-blur-[2px] transition-opacity duration-[180ms] ${
              shown ? 'opacity-100' : 'opacity-0'
            }`}
          />

          <div
            role="dialog"
            aria-label={t('playlists.add')}
            className={`relative flex max-h-full w-full max-w-[300px] flex-col groove-surface groove-halo overflow-hidden rounded-lg ring-1 ring-[var(--color-edge)] transition-all duration-[180ms] ease-out ${
              shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-[0.97] opacity-0'
            }`}
          >
            <div className="shrink-0 px-3 pt-2.5 pb-1.5">
              <p className="text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
                {t('playlists.add')}
              </p>
              <p className="mt-0.5 truncate text-body text-cream-100">{showing.title}</p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
              {spotifyReady && <SectionLabel>{t('playlists.sectionGroovium')}</SectionLabel>}
              <ul>
                {playlists.length === 0 && (
                  <li className="px-1.5 py-2 text-center text-meta text-cream-400/70">
                    {t('playlists.pickerNone')}
                  </li>
                )}
                {playlists.map((playlist) => {
                  const already = containsTrack(playlist.items, showing);
                  return (
                    <li key={playlist.id}>
                      <Row
                        name={playlist.name}
                        detail={already ? t('playlists.added') : String(playlist.items.length)}
                        muted={already}
                        disabled={already}
                        onPress={() => void addToLocal(playlist.id, playlist.name)}
                      />
                    </li>
                  );
                })}
                <li>
                  <NewRow placeholder={t('playlists.newPlaceholder')} onCreate={createLocal} />
                </li>
              </ul>

              {spotifyReady && (
                <>
                  <SectionLabel>{t('playlists.sectionSpotify')}</SectionLabel>
                  {localTrack && (
                    <p className="px-1.5 pb-1 text-meta leading-snug text-cream-400/80">
                      {t('playlists.localNotOnSpotify')}
                    </p>
                  )}
                  <ul>
                    {spotifyPlaylists.length === 0 && (
                      <li className="px-1.5 py-2 text-center text-meta text-cream-400/70">
                        {spotifyStarted && !spotifyLoading
                          ? t('spotify.noPlaylists')
                          : t('spotify.loadingPlaylists')}
                      </li>
                    )}
                    {spotifyPlaylists.map((playlist) => {
                      const already = held[playlist.id] === true;
                      return (
                        <li key={playlist.id}>
                          <Row
                            name={playlist.name}
                            detail={already ? t('playlists.added') : String(playlist.trackCount)}
                            muted={already || localTrack}
                            disabled={already || localTrack || adding !== null}
                            busy={adding === playlist.id}
                            onPress={() => void addToSpotify(playlist.id, playlist.name)}
                          />
                        </li>
                      );
                    })}
                    {!localTrack && (
                      <li>
                        <NewRow placeholder={t('playlists.newSpotify')} onCreate={createOnSpotify} />
                      </li>
                    )}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </Context.Provider>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1.5 pt-2 pb-1 text-label font-medium tracking-[0.18em] text-cream-400/70 uppercase">
      {children}
    </p>
  );
}

function Row({
  name,
  detail,
  muted,
  disabled,
  busy = false,
  onPress,
}: {
  name: string;
  detail: string;
  muted: boolean;
  disabled: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPress}
      className={`flex w-full items-center justify-between gap-2 rounded px-1.5 py-1.5 text-left transition-colors hover:bg-shell-700 disabled:cursor-default disabled:hover:bg-transparent ${
        busy ? 'animate-pulse' : ''
      }`}
    >
      <span
        className={`min-w-0 flex-1 truncate text-body ${muted ? 'text-cream-400/60' : 'text-cream-200'}`}
      >
        {name}
      </span>
      {/* Saying so up front beats clicking and being told. */}
      <span className="shrink-0 text-label text-cream-400">{detail}</span>
    </button>
  );
}

/**
 * A row that becomes a name field.
 *
 * One per section, so a new playlist is made in the place it will live. Closed
 * until pressed: two open fields in one sheet is two places to type and no way
 * to tell which one Enter goes to.
 */
function NewRow({
  placeholder,
  onCreate,
}: {
  placeholder: string;
  onCreate: (name: string) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [working, setWorking] = useState(false);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || working) return;
    setWorking(true);
    await onCreate(trimmed);
    setWorking(false);
    setName('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 rounded px-1.5 py-1.5 text-left text-meta text-cream-400 transition-colors hover:bg-shell-700 hover:text-cream-100"
      >
        <span aria-hidden="true" className="text-brass-400">
          +
        </span>
        {placeholder}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-1.5 py-1">
      <input
        type="text"
        value={name}
        autoFocus
        placeholder={placeholder}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void create();
          if (e.key === 'Escape') {
            // Closing the field, not the sheet.
            e.stopPropagation();
            setOpen(false);
          }
        }}
        className="min-w-0 flex-1 groove-inset rounded px-2 py-1 text-meta text-cream-50 outline-none ring-1 ring-[var(--color-edge)] focus:ring-brass-500"
      />
      <button
        type="button"
        disabled={!name.trim() || working}
        onClick={() => void create()}
        className="shrink-0 rounded-full bg-brass-600 px-2.5 py-1 text-label font-medium tracking-wide text-on-accent uppercase transition-colors hover:bg-brass-500 disabled:opacity-40"
      >
        {t('common.create')}
      </button>
    </div>
  );
}
