import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { TrackMetadata } from '@/core/types';
import type { PlaylistItem } from '@/core/library';
import { usePlaylists, usePlayerStore } from '@/core/store';

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

export function PlaylistPickerProvider({ children }: { children: React.ReactNode }) {
  const [track, setTrack] = useState<TrackMetadata | null>(null);
  const [newName, setNewName] = useState('');
  const [saved, setSaved] = useState<string | null>(null);

  const playlists = usePlaylists();
  const addTrackToPlaylist = usePlayerStore((s) => s.addTrackToPlaylist);
  const newPlaylist = usePlayerStore((s) => s.newPlaylist);

  const pick = useCallback((next: TrackMetadata) => {
    setNewName('');
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

  async function addTo(playlistId: string, name: string) {
    if (!track) return;
    const added = await addTrackToPlaylist(playlistId, track);
    close();
    // Being told it is already there is information, not an error.
    setSaved(added ? `Added to ${name}` : `Already in ${name}`);
    setTimeout(() => setSaved(null), 1800);
  }

  async function createAndAdd() {
    const created = await newPlaylist(newName);
    if (created) await addTo(created.id, created.name);
  }

  return (
    <Context.Provider value={{ pick }}>
      {children}

      {/* Confirmation lives outside the sheet so it survives the close. */}
      {saved && (
        <div className="pointer-events-none absolute inset-x-0 bottom-14 z-40 flex justify-center">
          <span className="rounded-full bg-shell-900/95 px-3 py-1 text-[10px] text-brass-400 shadow">
            {saved}
          </span>
        </div>
      )}

      {track && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-5">
          <button
            type="button"
            aria-label="Cancel"
            onClick={close}
            className="absolute inset-0 cursor-default bg-shell-900/70 backdrop-blur-[2px]"
          />

          <div
            role="dialog"
            aria-label="Add to playlist"
            className="relative flex max-h-full w-full flex-col overflow-hidden rounded-lg bg-shell-800 ring-1 ring-shell-600"
          >
            <div className="shrink-0 px-3 pt-2.5 pb-1.5">
              <p className="text-[9px] font-medium tracking-[0.18em] text-brass-400/80 uppercase">
                Add to playlist
              </p>
              <p className="mt-0.5 truncate text-[11px] text-cream-100">{track.title}</p>
            </div>

            <ul className="min-h-0 flex-1 overflow-y-auto px-1.5">
              {playlists.length === 0 && (
                <li className="px-1.5 py-2 text-center text-[10px] text-cream-400/70">
                  No playlists yet — name one below.
                </li>
              )}
              {playlists.map((playlist) => {
                const already = track ? containsTrack(playlist.items, track) : false;
                return (
                  <li key={playlist.id}>
                    <button
                      type="button"
                      disabled={already}
                      onClick={() => void addTo(playlist.id, playlist.name)}
                      className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1.5 text-left transition-colors hover:bg-shell-700 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span
                        className={`min-w-0 flex-1 truncate text-[11px] ${
                          already ? 'text-cream-400/60' : 'text-cream-200'
                        }`}
                      >
                        {playlist.name}
                      </span>
                      {/* Saying so up front beats clicking and being told. */}
                      <span className="shrink-0 text-[9px] text-cream-400">
                        {already ? 'Added' : playlist.items.length}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="flex shrink-0 items-center gap-1.5 border-t border-shell-700 px-3 py-2">
              <input
                type="text"
                value={newName}
                autoFocus
                placeholder="New playlist"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newName.trim()) void createAndAdd();
                }}
                className="min-w-0 flex-1 rounded bg-shell-900 px-2 py-1 text-[10px] text-cream-50 outline-none ring-1 ring-shell-600 focus:ring-brass-500"
              />
              <button
                type="button"
                disabled={!newName.trim()}
                onClick={() => void createAndAdd()}
                className="shrink-0 rounded-full bg-brass-600 px-2.5 py-1 text-[9px] font-medium tracking-wide text-shell-900 uppercase transition-colors hover:bg-brass-500 disabled:opacity-40"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </Context.Provider>
  );
}
