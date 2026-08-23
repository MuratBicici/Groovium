import { useCallback, useEffect, useRef, useState } from 'react';
import { searchTracks } from '@/core/providers/spotifyApi';
import type { TrackMetadata } from '@/core/types';
import { usePlayerStore } from '@/core/store';
import { AddToPlaylist } from '@/components/playlists/AddToPlaylist';
import { useDiscFlight } from '@/components/player/DiscFlight';
import { VinylDisc } from '@/components/player/VinylDisc';

/** Wait for typing to settle before spending a request. */
const DEBOUNCE_MS = 350;

/**
 * Find one song on Spotify.
 *
 * Deliberately just tracks. Browsing albums and playlists belongs to Spotify's
 * own client; keeping music belongs to this app's library and playlists. A
 * result plays on its own and stops — saving it to a playlist is what makes it
 * part of something that keeps going.
 */
interface SpotifySearchProps {
  /** Raised when a result starts playing, so the panel can fold away and let
      the disc's flight to the platter be seen. */
  onTrackPlayed?: (() => void) | undefined;
}

export function SpotifySearch({ onTrackPlayed }: SpotifySearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TrackMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const playSingle = usePlayerStore((s) => s.playSingle);
  const { flyToPlatter } = useDiscFlight();

  // Ignore responses from a query the user has already typed past.
  const requestSeq = useRef(0);

  const run = useCallback(async (text: string) => {
    if (!text.trim()) {
      setResults([]);
      setProblem(null);
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
        setProblem(err instanceof Error ? err.message : String(err));
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <input
        type="text"
        value={query}
        spellCheck={false}
        placeholder="Search Spotify for a song"
        onChange={(e) => setQuery(e.target.value)}
        className="shrink-0 groove-inset rounded px-2 py-1.5 text-body text-cream-50 outline-none ring-1 ring-shell-600 focus:ring-brass-500"
      />

      {problem && (
        <p className="shrink-0 rounded bg-red-950/70 px-2 py-1.5 text-meta leading-snug text-red-200">
          {problem}
        </p>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {loading && results.length === 0 && <Hint>Searching…</Hint>}
        {!loading && results.length === 0 && (
          <Hint>{query.trim() ? 'Nothing found.' : 'Type to find a song.'}</Hint>
        )}

        {results.map((track) => (
          <li key={track.id} className="group/row flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                const disc = e.currentTarget.querySelector<HTMLElement>('[data-disc]');
                if (disc) flyToPlatter(disc, track);
                onTrackPlayed?.();
                void playSingle(track);
              }}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-shell-700/60"
            >
              <span data-disc className="shrink-0">
                <VinylDisc size={24} coverArtUrl={track.coverArtUrl} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-cream-100">{track.title}</span>
                <span className="block truncate text-label text-cream-400">{track.artist}</span>
              </span>
            </button>
            <span className="shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
              <AddToPlaylist track={track} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <li className="px-2 py-4 text-center text-meta leading-relaxed text-cream-400/70">
      {children}
    </li>
  );
}
