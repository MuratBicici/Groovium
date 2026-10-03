import { useMemo, useState } from 'react';
import { libraryTrackToMetadata, type LibraryTrack, type Playlist } from '@/core/library';
import { findIn } from '@/core/library/search';
import { usePlayerStore } from '@/core/store';
import { useT } from '@/core/i18n';
import {
  CrateResult,
  Hint,
  ResultHeading,
  SearchBox,
  TrackResult,
  type Rect,
} from '@/components/spotify/SearchParts';

/**
 * How many songs are listed at once.
 *
 * A library can be thousands of songs and a couple of letters match most of
 * them; every row is a record with a cover on it. The best come first, so the
 * ones past this are the ones a few more letters would have found anyway.
 */
const SHOWN_SONGS = 100;

/**
 * Find a song on this computer, or one of Groovium's playlists.
 *
 * Nothing is asked of anybody: it is a filter over the library and the
 * playlists the app already holds, so it answers on every letter rather than
 * waiting for typing to settle. A song is found by its title, artist or album,
 * a playlist by its name.
 */
export function LocalSearch({
  library,
  playlists,
  coverOf,
  opensWith,
  onOpenPlaylist,
  onChosen,
}: {
  library: readonly LibraryTrack[];
  playlists: readonly Playlist[];
  /** What a playlist's crate shows on its front, for the row to show too. */
  coverOf: (playlist: Playlist) => string | undefined;
  opensWith?: string | undefined;
  onOpenPlaylist: (id: string, from: Rect) => void;
  /** A result was chosen: the search can fold away. */
  onChosen: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState(opensWith ?? '');
  const playFrom = usePlayerStore((s) => s.playFrom);

  const lists = useMemo(() => findIn(playlists, query, (p) => [p.name]), [playlists, query]);
  const songs = useMemo(
    () => findIn(library, query, (track) => [track.title, track.artist, track.album]),
    [library, query],
  );
  const shown = songs.slice(0, SHOWN_SONGS);

  const typed = query.trim().length > 0;
  const nothing = songs.length === 0 && lists.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <SearchBox value={query} onChange={setQuery} placeholder={t('library.searchPlaceholder')} />

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {nothing && (
          <Hint>{typed ? t('spotify.nothingFound') : t('library.typeToFind')}</Hint>
        )}

        {lists.length > 0 && <ResultHeading>{t('search.playlists')}</ResultHeading>}
        {lists.map((playlist) => (
          <CrateResult
            key={playlist.id}
            name={playlist.name}
            cover={coverOf(playlist)}
            trackCount={playlist.items.length}
            onOpen={(from) => {
              onChosen();
              onOpenPlaylist(playlist.id, from);
            }}
          />
        ))}

        {songs.length > 0 && lists.length > 0 && <ResultHeading>{t('search.songs')}</ResultHeading>}
        {shown.map((track) => (
          <TrackResult
            key={track.id}
            track={libraryTrackToMetadata(track)}
            onPlay={() => {
              onChosen();
              // The library from this song, as pressing it on the shelf does:
              // Next carries on through the library rather than stopping.
              const index = library.indexOf(track);
              if (index >= 0) void playFrom('library', index);
            }}
          />
        ))}
        {songs.length > shown.length && (
          <Hint>{t('search.more', { count: songs.length - shown.length })}</Hint>
        )}
      </ul>
    </div>
  );
}
