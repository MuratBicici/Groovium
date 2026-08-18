import { useState } from 'react';
import { usePlayback, usePlaylists, usePlayerStore } from '@/core/store';
import { playlistItemToMetadata, type LibraryTrack, type PlaylistItem } from '@/core/library';
import { useDiscFlight } from '@/components/player/DiscFlight';
import { VinylDisc } from '@/components/player/VinylDisc';
import { formatDuration } from '@/core/utils/time';

interface PlaylistsPanelProps {
  open: boolean;
  onClose: () => void;
  id: string;
}

/**
 * The app's own playlists — what replaced the queue.
 *
 * A queue was edited once and lost on restart. These are saved, and they can
 * hold local files and Spotify tracks side by side, which is what makes a
 * Spotify search result worth keeping rather than a one-off.
 */
export function PlaylistsPanel({ open, onClose, id }: PlaylistsPanelProps) {
  const playlists = usePlaylists();
  const playback = usePlayback();
  const library = usePlayerStore((s) => s.library);

  const newPlaylist = usePlayerStore((s) => s.newPlaylist);
  const removePlaylist = usePlayerStore((s) => s.removePlaylist);
  const removePlaylistItem = usePlayerStore((s) => s.removePlaylistItem);
  const playFrom = usePlayerStore((s) => s.playFrom);
  const { flyToPlatter } = useDiscFlight();

  const [openId, setOpenId] = useState<string | null>(null);
  const [name, setName] = useState('');

  const current = playlists.find((p) => p.id === openId) ?? null;

  async function create() {
    const created = await newPlaylist(name);
    if (created) {
      setName('');
      setOpenId(created.id);
    }
  }

  return (
    <div
      id={id}
      aria-hidden={!open}
      className={`absolute inset-0 flex flex-col rounded-t-lg bg-shell-800/95 backdrop-blur-sm transition-all duration-200 ease-out ${
        open ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
      }`}
    >
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <span className="min-w-0 truncate text-[9px] font-medium tracking-[0.18em] text-brass-400/80 uppercase">
          {current ? current.name : `Playlists · ${playlists.length}`}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {current && (
            <button
              type="button"
              onClick={() => setOpenId(null)}
              className="text-[9px] tracking-wide text-cream-400 uppercase transition-colors hover:text-brass-400"
            >
              Back
            </button>
          )}
          <button
            type="button"
            aria-label="Close playlists"
            title="Close"
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
          >
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {current ? (
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {current.items.length === 0 && (
            <li className="px-2 py-4 text-center text-[10px] leading-relaxed text-cream-400/70">
              Nothing here yet. Add songs from your library or from Spotify.
            </li>
          )}
          {current.items.map((item, index) => {
            const track = playlistItemToMetadata(item, library);
            // The store drops unplayable items when it resolves the context, so
            // a row's position here is not its position there. Counting the
            // playable items before this one converts between them — without
            // it, a playlist holding a deleted track plays the wrong song.
            const playableIndex = playableBefore(current.items, library, index);
            const playing =
              playback.id === `playlist:${current.id}` && playback.index === playableIndex;
            return (
              <li key={`${index}`} className="group/row flex items-center gap-1">
                <button
                  type="button"
                  disabled={!track}
                  onClick={(e) => {
                    const disc = e.currentTarget.querySelector<HTMLElement>('[data-disc]');
                    if (disc && track) flyToPlatter(disc, track);
                    onClose();
                    void playFrom(`playlist:${current.id}`, playableIndex);
                  }}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors disabled:opacity-40 ${
                    playing ? 'bg-shell-700 text-brass-400' : 'text-cream-200 hover:bg-shell-700/60'
                  }`}
                >
                  <span data-disc className="shrink-0">
                    <VinylDisc size={24} coverArtUrl={track?.coverArtUrl} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px]">
                      {track?.title ?? 'Unavailable'}
                    </span>
                    <span className="block truncate text-[9px] text-cream-400">
                      {track ? `${track.artist} · ${track.source}` : 'Removed from library'}
                    </span>
                  </span>
                  {track && (
                    <span className="shrink-0 text-[10px] tabular-nums text-cream-400">
                      {formatDuration(track.duration)}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  aria-label="Remove from playlist"
                  title="Remove"
                  onClick={() => void removePlaylistItem(current.id, index)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-cream-400 opacity-0 transition-all group-hover/row:opacity-100 hover:bg-shell-600 hover:text-red-300 focus-visible:opacity-100"
                >
                  <svg viewBox="0 0 10 10" className="h-2 w-2" aria-hidden="true">
                    <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-1.5 px-3 pb-2">
            <input
              type="text"
              value={name}
              placeholder="New playlist"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) void create();
              }}
              className="min-w-0 flex-1 rounded bg-shell-900 px-2 py-1 text-[10px] text-cream-50 outline-none ring-1 ring-shell-600 focus:ring-brass-500"
            />
            <button
              type="button"
              disabled={!name.trim()}
              onClick={() => void create()}
              className="shrink-0 rounded-full bg-brass-600 px-2.5 py-1 text-[9px] font-medium tracking-wide text-shell-900 uppercase transition-colors hover:bg-brass-500 disabled:opacity-40"
            >
              Create
            </button>
          </div>

          <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {playlists.length === 0 && (
              <li className="px-2 py-4 text-center text-[10px] leading-relaxed text-cream-400/70">
                No playlists yet. Make one to keep songs together.
              </li>
            )}
            {playlists.map((playlist) => (
              <li key={playlist.id} className="group/row flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setOpenId(playlist.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-cream-200 transition-colors hover:bg-shell-700/60"
                >
                  <span className="min-w-0 flex-1 truncate text-[11px]">{playlist.name}</span>
                  <span className="shrink-0 text-[9px] text-cream-400">
                    {playlist.items.length}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${playlist.name}`}
                  title="Delete playlist"
                  onClick={() => void removePlaylist(playlist.id)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-cream-400 opacity-0 transition-all group-hover/row:opacity-100 hover:bg-shell-600 hover:text-red-300 focus-visible:opacity-100"
                >
                  <svg viewBox="0 0 10 10" className="h-2 w-2" aria-hidden="true">
                    <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * How many playable items sit before `index`.
 *
 * Mirrors the filter in the store's `resolveContext`: a playlist entry whose
 * library track was deleted cannot play, so the store leaves it out of the
 * context entirely. This panel still renders it — greyed out, so the user can
 * see what went missing and remove it — which means the two lists disagree on
 * every position after the first dead entry.
 */
function playableBefore(items: PlaylistItem[], library: LibraryTrack[], index: number): number {
  let count = 0;
  for (let i = 0; i < index; i++) {
    const item = items[i];
    if (item && playlistItemToMetadata(item, library)) count++;
  }
  return count;
}
