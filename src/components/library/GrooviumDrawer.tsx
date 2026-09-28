import { useCallback, useEffect, useState } from 'react';
import { useLibrary, usePlaylists, usePlayerStore } from '@/core/store';
import {
  libraryTrackToMetadata,
  playlistItemToMetadata,
  type LibraryTrack,
  type Playlist,
  type ScanSummary,
} from '@/core/library';
import { AddToPlaylist } from '@/components/playlists/AddToPlaylist';
import { Shelf } from '@/components/spotify/Shelf';
import { RecordCard, RECORD_SIZE } from '@/components/spotify/RecordCard';
import { Crate, NewCrate, useCrateCarry, type CrateFace } from '@/components/spotify/SpotifyCrates';
import { COVER_FAILURES, CrateLayer, type CrateSource } from '@/components/spotify/OpenCrate';
import { CoverCrop, SheetPresence, SongDetailsSheet } from '@/components/spotify/CrateSheets';
import { pickCoverImage, type CoverPickFailure } from '@/core/spotify/cover';
import { isTauri } from '@/core/utils/env';
import { useCarriedTrack } from '@/components/player/DiscHold';
import type { AddOutcome } from '@/core/spotify/store';
import type { TrackMetadata } from '@/core/types';
import { DRAWER_WIDTH } from '@/platform/window';
import { useT } from '@/core/i18n';

/**
 * The library drawer's Groovium side: the music on this computer, and the
 * playlists Groovium keeps.
 *
 * These were two panels laid over the deck, each with a button of its own.
 * They live in the drawer now, beside the player, on the same shelves Spotify's
 * records and crates are on — so a record is a record wherever it came from,
 * and picking one out does not cover the thing it is about to play on.
 */
export function GrooviumDrawer({
  id,
  switcher,
  onClose,
}: {
  id: string;
  /** The Groovium | Spotify choice, drawn where a heading would be. */
  switcher: React.ReactNode;
  onClose: () => void;
}) {
  const t = useT();
  const library = useLibrary();
  const playlists = usePlaylists();

  const chooseFiles = usePlayerStore((s) => s.chooseFiles);
  const chooseFolder = usePlayerStore((s) => s.chooseFolder);
  const runImport = usePlayerStore((s) => s.runImport);
  const removeTrack = usePlayerStore((s) => s.removeTrack);
  const playFrom = usePlayerStore((s) => s.playFrom);
  const newPlaylist = usePlayerStore((s) => s.newPlaylist);
  const addTrackToPlaylist = usePlayerStore((s) => s.addTrackToPlaylist);
  /** A playlist made a moment ago, which arrives on the shelf rather than just being there. */
  const [justMade, setJustMade] = useState<string | null>(null);
  const arrived = useCallback(() => setJustMade(null), []);
  const inHand = useCarriedTrack();
  // Carried to the deck, a crate plays from its first song.
  const playWhole = useCallback(
    (face: CrateFace) => void playFrom(`playlist:${face.id}`, 0),
    [playFrom],
  );
  const carry = useCrateCarry(playWhole);

  /**
   * A song put into a sleeve by hand. Any song will do — a Groovium playlist
   * holds this computer's music and Spotify's alike — and the one thing the
   * sleeve has to be told is whether it was there already.
   */
  async function putIn(playlistId: string, track: TrackMetadata): Promise<AddOutcome> {
    const errorBefore = usePlayerStore.getState().error;
    if (await addTrackToPlaylist(playlistId, track)) return 'added';
    return usePlayerStore.getState().error !== errorBefore ? 'failed' : 'already';
  }

  /** Files chosen and counted, waiting for a yes: copying costs disk space. */
  const [pending, setPending] = useState<ScanSummary | null>(null);
  /** A song somebody asked to take out of the library, waiting for a yes. */
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  /** The song whose details are open, by its library id. */
  const [editingSong, setEditingSong] = useState<string | null>(null);
  const song = editingSong ? (library.find((track) => track.id === editingSong) ?? null) : null;
  /** A picture chosen for that song's cover, while its square is chosen. */
  const [songCover, setSongCover] = useState<string | null>(null);
  const [songCoverNotice, setSongCoverNotice] = useState<string | null>(null);
  const renameTrack = usePlayerStore((s) => s.renameTrack);
  const setTrackCover = usePlayerStore((s) => s.setTrackCover);

  const closeSong = useCallback(() => {
    setEditingSong(null);
    setSongCover(null);
    setSongCoverNotice(null);
  }, []);

  function chooseSongCover() {
    setSongCoverNotice(null);
    pickCoverImage().then(
      (picked) => {
        if (picked) setSongCover(picked);
      },
      (failure: CoverPickFailure) => setSongCoverNotice(t(COVER_FAILURES[failure])),
    );
  }

  // Escape takes the topmost thing away: the crop, then the sheet. Captured
  // and kept, as every sheet here does, so it closes this and not the drawer.
  useEffect(() => {
    if (!editingSong) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      if (songCover) setSongCover(null);
      else closeSong();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [editingSong, songCover, closeSong]);

  /** The playlist opened over the shelves, if one is, and where its crate was. */
  const [open, setOpen] = useState<{ id: string; origin: Origin } | null>(null);
  const opened = open ? (playlists.find((p) => p.id === open.id) ?? null) : null;

  async function choose(which: 'files' | 'folder') {
    const summary = which === 'folder' ? await chooseFolder() : await chooseFiles();
    if (!summary || summary.paths.length === 0) return;
    setPending(summary);
  }

  async function confirmImport() {
    const summary = pending;
    setPending(null);
    if (summary) await runImport(summary.paths);
  }

  return (
    <aside
      id={id}
      className="relative isolate flex h-full shrink-0 flex-col border-l border-[var(--color-edge)]"
      style={{ width: `${DRAWER_WIDTH}px`, ['--fade-colour' as string]: 'var(--color-shell-900)' }}
    >
      {/* Marked, so changing sides moves what is under it and not this. */}
      <div data-drawer-head className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        {switcher}
        <CloseButton label={t('library.close')} onPress={onClose} />
      </div>

      {/* Copying duplicates the audio on disk, so the size is shown before it
          starts rather than discovered afterwards. */}
      {pending && (
        <div className="mx-3 mb-2 shrink-0 rounded bg-shell-900/80 p-2 text-meta leading-snug text-cream-200">
          <p>
            {t('library.confirmImport', {
              count: pending.paths.length,
              size: formatBytes(pending.totalBytes),
            })}
            {pending.duplicates > 0 && (
              <span className="text-cream-400">
                {' '}
                {t('library.duplicates', { count: pending.duplicates })}
              </span>
            )}
          </p>
          <div className="mt-1.5 flex gap-1.5">
            <SmallButton onClick={() => void confirmImport()} primary>
              {t('common.copy')}
            </SmallButton>
            <SmallButton onClick={() => setPending(null)}>{t('common.cancel')}</SmallButton>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-2">
        <Shelf heading={t('library.onThisComputer', { count: library.length })}>
          <AddMusic onChoose={(which) => void choose(which)} />
          {library.length === 0 && (
            <p className="max-w-[260px] self-center px-1 text-meta leading-relaxed text-cream-400/70">
              {t('library.empty')}
            </p>
          )}
          {library.map((track, index) => (
            <LocalRecord
              key={track.id}
              track={track}
              onPlay={() => void playFrom('library', index)}
              onRemove={() => setConfirmRemove(track.id)}
              onEdit={() => setEditingSong(track.id)}
            />
          ))}
        </Shelf>

        <Shelf heading={t('library.lists')}>
          <NewCrate
            onCreate={async (name) => {
              const created = await newPlaylist(name);
              if (created) setJustMade(created.id);
              return !!created;
            }}
          />
          {playlists.length === 0 && (
            <p className="max-w-[260px] self-center px-1 text-meta leading-relaxed text-cream-400/70">
              {t('playlists.none')}
            </p>
          )}
          {playlists.map((playlist) => (
            <Crate
              key={playlist.id}
              face={faceOf(playlist, library)}
              accepts={(track) => !track.id.startsWith('crate:')}
              add={(track) => putIn(playlist.id, track)}
              arriving={justMade === playlist.id}
              onArrived={arrived}
              starting={false}
              away={inHand === `crate:${playlist.id}`}
              onCarry={carry}
              onOpen={(origin) => setOpen({ id: playlist.id, origin })}
            />
          ))}
        </Shelf>
      </div>

      {/* Deleting the app's copy is not reversible, so it is confirmed. */}
      {confirmRemove && (
        <div className="shrink-0 bg-red-950/80 px-3 py-2 text-meta leading-snug text-red-100">
          <p>{t('library.confirmRemove')}</p>
          <div className="mt-1.5 flex gap-1.5">
            <SmallButton
              onClick={() => {
                const doomed = confirmRemove;
                setConfirmRemove(null);
                void removeTrack(doomed);
              }}
              primary
            >
              {t('common.delete')}
            </SmallButton>
            <SmallButton onClick={() => setConfirmRemove(null)}>{t('common.keep')}</SmallButton>
          </div>
        </div>
      )}

      <SheetPresence show={song !== null}>
        {song && (
          <SongDetailsSheet
            key={song.id}
            names={{ title: song.title, artist: song.artist, album: song.album }}
            coverUrl={song.coverArtUrl}
            {...(isTauri() && { onCover: chooseSongCover })}
            coverProblem={songCoverNotice}
            onClose={closeSong}
            onSave={(names) => {
              closeSong();
              void renameTrack(song.id, names);
            }}
          />
        )}
      </SheetPresence>
      {/* Over the song's sheet, and back to it: the new cover shows there at
          once, beside the names. */}
      <SheetPresence show={song !== null && songCover !== null}>
        {song && songCover && (
          <CoverCrop
            image={songCover}
            onClose={() => setSongCover(null)}
            onFailed={(message) => {
              setSongCover(null);
              setSongCoverNotice(message);
            }}
            onUpload={(base64) => {
              setSongCover(null);
              void setTrackCover(song.id, base64);
            }}
          />
        )}
      </SheetPresence>

      {opened && open && (
        <GrooviumCrate
          playlist={opened}
          library={library}
          origin={open.origin}
          onClose={() => setOpen(null)}
        />
      )}
    </aside>
  );
}

/**
 * A record from this computer on the shelf, with its two chores beside it.
 *
 * The card is the same one Spotify's shelves use; what differs is what playing
 * it means. It starts the library at this song, so Next carries on through the
 * library rather than stopping after one.
 */
function LocalRecord({
  track,
  onPlay,
  onRemove,
  onEdit,
}: {
  track: LibraryTrack;
  onPlay: () => void;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const t = useT();
  const meta = libraryTrackToMetadata(track);
  return (
    <div className="group/record relative shrink-0">
      <RecordCard track={meta} onPlay={onPlay} />
      <span className="absolute top-0.5 right-0.5 z-10 flex items-center rounded-full bg-shell-900/80 opacity-0 backdrop-blur-sm transition-opacity group-hover/record:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          aria-label={t('library.editSong', { title: track.title })}
          title={t('library.songDetails')}
          onClick={onEdit}
          className="flex h-5 w-5 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
        >
          {/* A pencil: what the song is called, and its cover. */}
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8.6 1.9l1.5 1.5-6 6-2 .5.5-2z" />
            <path d="M7.5 3l1.5 1.5" />
          </svg>
        </button>
        <AddToPlaylist track={meta} />
        <button
          type="button"
          aria-label={t('library.removeNamed', { title: track.title })}
          title={t('library.removeTitle')}
          onClick={onRemove}
          className="flex h-5 w-5 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-red-300"
        >
          <svg viewBox="0 0 10 10" className="h-2 w-2" aria-hidden="true">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </span>
    </div>
  );
}

/** An empty sleeve at the start of the shelf, for bringing music in. */
function AddMusic({ onChoose }: { onChoose: (which: 'files' | 'folder') => void }) {
  const t = useT();
  return (
    <div className="flex shrink-0 flex-col" style={{ width: RECORD_SIZE }}>
      <div
        className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-cream-400/40 px-1"
        style={{ height: RECORD_SIZE }}
      >
        <button
          type="button"
          onClick={() => onChoose('files')}
          className="w-full rounded-full bg-shell-700 px-1 py-0.5 text-label font-medium tracking-wide text-cream-200 uppercase transition-colors hover:bg-shell-600 hover:text-brass-400"
        >
          {t('library.files')}
        </button>
        <button
          type="button"
          onClick={() => onChoose('folder')}
          className="w-full rounded-full bg-shell-700 px-1 py-0.5 text-label font-medium tracking-wide text-cream-200 uppercase transition-colors hover:bg-shell-600 hover:text-brass-400"
        >
          {t('library.folder')}
        </button>
      </div>
      <span className="mt-1 truncate text-center text-meta text-cream-400">
        {t('library.addMusic')}
      </span>
    </div>
  );
}

/**
 * A Groovium playlist as the sleeve draws it.
 *
 * It has no cover of its own, so it wears its songs': one fills the sleeve,
 * four make a mosaic, none leaves the blank sleeve with the list's initial —
 * the same sleeve Spotify's playlists are on, dressed from the inside.
 */
function faceOf(playlist: Playlist, library: LibraryTrack[]): CrateFace {
  const covers = new Set<string>();
  // A cover chosen by hand is the cover.
  if (playlist.coverArtUrl) covers.add(playlist.coverArtUrl);
  for (const item of playlist.items) {
    if (covers.size > 0 && playlist.coverArtUrl) break;
    const cover = playlistItemToMetadata(item, library)?.coverArtUrl;
    if (cover) covers.add(cover);
    if (covers.size === 4) break;
  }
  return {
    id: playlist.id,
    name: playlist.name,
    trackCount: playlist.items.length,
    covers: [...covers],
  };
}

/** Where a crate was on screen, for its page to grow out of. */
type Origin = { x: number; y: number; width: number; height: number };

/**
 * A Groovium playlist opened: the same page a Spotify crate opens to.
 *
 * The records fly out of the sleeve and back into it, are taken to the deck by
 * hand, and come out in edit mode, exactly as Spotify's do; only what they are
 * and what changing them means are Groovium's. A song that has left the
 * library cannot play and is not laid out, and its place is remembered so
 * taking a record out removes the right item from the file.
 */
function GrooviumCrate({
  playlist,
  library,
  origin,
  onClose,
}: {
  playlist: Playlist;
  library: LibraryTrack[];
  origin: Origin;
  onClose: () => void;
}) {
  const playFrom = usePlayerStore((s) => s.playFrom);
  const removePlaylist = usePlayerStore((s) => s.removePlaylist);
  const removePlaylistItem = usePlayerStore((s) => s.removePlaylistItem);
  const movePlaylistItem = usePlayerStore((s) => s.movePlaylistItem);
  const renamePlaylist = usePlayerStore((s) => s.renamePlaylist);
  const setPlaylistCover = usePlayerStore((s) => s.setPlaylistCover);
  const [editing, setEditing] = useState(false);

  const entries: { track: TrackMetadata; item: number }[] = [];
  playlist.items.forEach((item, at) => {
    const track = playlistItemToMetadata(item, library);
    if (track) entries.push({ track, item: at });
  });

  const source: CrateSource = {
    name: playlist.name,
    trackCount: playlist.items.length,
    tracks: entries.map((entry) => entry.track),
    loading: false,
    cursor: null,
    error: null,
    more: () => {},
    editing,
    editCapped: false,
    setEditing,
    takeOut: (_track, index) => {
      const entry = entries[index];
      if (entry) void removePlaylistItem(playlist.id, entry.item);
    },
    // By place in the file: a song that can no longer play is not laid out,
    // so the page's positions and the file's are not always the same.
    move: (from, to) => {
      const a = entries[from];
      const b = entries[to];
      if (a && b) void movePlaylistItem(playlist.id, a.item, b.item);
    },
    rename: (name) => renamePlaylist(playlist.id, name),
    setCover: (jpeg) => setPlaylistCover(playlist.id, jpeg),
    ...(playlist.coverArtUrl ? { coverUrl: playlist.coverArtUrl } : {}),
    // In the playlist's own order, so Next carries on through it: the index
    // among the songs that can play is the playlist's place in the queue.
    play: (_track, index) => playFrom(`playlist:${playlist.id}`, index),
    writeError: null,
    clearWriteError: () => {},
    deleteCrate: () => removePlaylist(playlist.id),
  };

  return <CrateLayer source={source} origin={origin} onClose={onClose} />;
}

function CloseButton({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={label}
      title={t('common.close')}
      onClick={onPress}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
    >
      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
        <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function SmallButton({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2 py-1 text-label font-medium tracking-wide uppercase transition-colors ${
        primary
          ? 'bg-brass-600 text-on-accent hover:bg-brass-500'
          : 'bg-shell-700 text-cream-200 hover:bg-shell-600 hover:text-cream-50'
      }`}
    >
      {children}
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
