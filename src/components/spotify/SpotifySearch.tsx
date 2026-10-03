import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { searchTracks } from '@/core/providers/spotifyApi';
import type { TrackMetadata } from '@/core/types';
import { usePlayerStore } from '@/core/store';
import { useSpotifyPlaylistsStore } from '@/core/spotify/store';
import { findIn } from '@/core/library/search';
import { errorText } from '@/core/utils/errorText';
import { useT } from '@/core/i18n';
import { CrateResult, Hint, ResultHeading, SearchBox, TrackResult, type Rect } from './SearchParts';

/**
 * Wait for typing to settle before spending a request.
 *
 * Longer than it was. Searching is the quota this app runs out of, and at 350ms
 * an ordinary typing speed spends one on most of the word's prefixes; the extra
 * hundred milliseconds costs nobody anything they notice and asks Spotify a
 * good deal less.
 */
const DEBOUNCE_MS = 450;

/**
 * Below this, a search is not worth making.
 *
 * A single letter matches most of Spotify and tells nobody anything, and it is
 * the first thing typed every single time — so it is a request spent on every
 * search anyone ever makes, for a result they will not read.
 */
const SHORTEST_QUERY = 2;

/**
 * Find a song on Spotify, or one of your own playlists there.
 *
 * Songs are Spotify's whole catalogue, asked for. Playlists are only the ones on
 * the shelf below — yours and the ones you follow — found by name among what
 * the drawer has already loaded, so they answer as each letter is typed and cost
 * nothing. Albums and other people's playlists are not here: browsing those
 * belongs to Spotify's own client, and keeping music belongs to this app's
 * library and playlists.
 *
 * This used to sit in the drawer permanently, sharing the height evenly with
 * the crates because both were `flex-1`. That meant a person who was not
 * searching gave up half the drawer to a box that said "type to find a song",
 * and a person who *was* searching read the results through a slot half the
 * height of the one they are read in now. It opens on request instead.
 */
interface SpotifySearchProps {
  /**
   * Raised when a result is chosen — a song played or a playlist opened — so
   * the search can fold away and let what happens next be seen.
   */
  onChosen: () => void;
  /**
   * What to start with, for a search opened by typing rather than by pressing.
   *
   * The letter that opened it is the first letter of the word somebody is
   * typing, and throwing it away would make the shortcut feel like it ate
   * something.
   */
  opensWith?: string | undefined;
}

export function SpotifySearch({ onChosen, opensWith }: SpotifySearchProps) {
  const t = useT();
  const [query, setQuery] = useState(opensWith ?? '');
  const [results, setResults] = useState<TrackMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const playSingle = usePlayerStore((s) => s.playSingle);

  const playlists = useSpotifyPlaylistsStore((s) => s.playlists);
  const cursor = useSpotifyPlaylistsStore((s) => s.cursor);
  const shelfLoading = useSpotifyPlaylistsStore((s) => s.loading);
  const more = useSpotifyPlaylistsStore((s) => s.more);
  const openCrate = useSpotifyPlaylistsStore((s) => s.openCrate);

  /**
   * The rest of the shelf, while somebody is searching it.
   *
   * The shelf loads a page at a time as it is scrolled to, so a playlist far
   * along it may not have been read yet — and a search that cannot find
   * something because nobody scrolled past it is a search that lies. Each page
   * is asked for once: a page that fails is not asked for again and again while
   * the box stays open.
   */
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!cursor || shelfLoading || asked.current === cursor) return;
    asked.current = cursor;
    void more();
  }, [cursor, shelfLoading, more]);

  const lists = useMemo(() => findIn(playlists, query, (p) => [p.name]), [playlists, query]);

  // Ignore responses from a query the user has already typed past.
  const requestSeq = useRef(0);

  const run = useCallback(async (text: string) => {
    if (text.trim().length < SHORTEST_QUERY) {
      requestSeq.current += 1;
      setResults([]);
      setProblem(null);
      setLoading(false);
      return;
    }

    const seq = ++requestSeq.current;
    setLoading(true);
    setProblem(null);
    try {
      const found = await searchTracks(text);
      if (seq === requestSeq.current) setResults(found);
    } catch (err) {
      if (seq === requestSeq.current) {
        setProblem(errorText(err));
        setResults([]);
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void run(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, run]);

  const typed = query.trim().length > 0;
  const nothing = !loading && results.length === 0 && lists.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <SearchBox value={query} onChange={setQuery} placeholder={t('spotify.searchPlaceholder')} />

      {problem && (
        <p className="shrink-0 rounded bg-red-950/70 px-2 py-1.5 text-meta leading-snug text-red-200">
          {problem}
        </p>
      )}

      {/* No `groove-scroll-fade` here, or anywhere else in the drawer. That
          fade works by painting the surface's own colour over the end of a
          list, which is invisible on a panel with an opaque surface and is a
          dark stripe here: the drawer has no surface, the visualiser is behind
          it, and the one opaque thing in the whole column was the fade. */}
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {nothing && <Hint>{typed ? t('spotify.nothingFound') : t('spotify.typeToFind')}</Hint>}

        {lists.length > 0 && <ResultHeading>{t('search.playlists')}</ResultHeading>}
        {lists.map((playlist) => (
          <CrateResult
            key={playlist.id}
            name={playlist.name}
            cover={playlist.coverArtUrl}
            trackCount={playlist.trackCount}
            onOpen={(from: Rect) => {
              onChosen();
              void openCrate(playlist.id, from);
            }}
          />
        ))}

        {(results.length > 0 || (loading && typed)) && lists.length > 0 && (
          <ResultHeading>{t('search.songs')}</ResultHeading>
        )}
        {loading && results.length === 0 && <Hint>{t('spotify.searching')}</Hint>}
        {results.map((track) => (
          <TrackResult
            key={track.id}
            track={track}
            onPlay={() => {
              onChosen();
              void playSingle(track);
            }}
          />
        ))}
      </ul>
    </div>
  );
}
