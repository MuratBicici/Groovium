import { useCallback, useEffect, useRef, useState } from 'react';
import { getProvider, SpotifyProvider } from '@/core/providers';
import { myPlaylists, search, type SearchKind, type SearchResult } from '@/core/providers/spotifyApi';
import { usePlayerStore } from '@/core/store';

const KINDS: { value: SearchKind; label: string }[] = [
  { value: 'track', label: 'Tracks' },
  { value: 'album', label: 'Albums' },
  { value: 'playlist', label: 'Playlists' },
];

/** Wait for typing to settle before spending a request. */
const DEBOUNCE_MS = 350;

/**
 * Search Spotify and send the results to the queue.
 *
 * Everything lands in Groovium's own queue rather than handing control to
 * Spotify's. That is what makes playback continue by itself — picking a track
 * queues the rest of the results behind it, and picking an album or playlist
 * queues all of its tracks — while next, previous, repeat, shuffle and removal
 * keep working exactly as they do for local files.
 *
 * One category at a time: at 340px a mixed list would leave no way to tell what
 * clicking a row is about to do.
 */
export function SpotifySearch() {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<SearchKind>('track');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const enqueue = usePlayerStore((s) => s.enqueue);
  const playAt = usePlayerStore((s) => s.playAt);

  // Ignore responses from a query the user has already typed past.
  const requestSeq = useRef(0);

  const run = useCallback(async (text: string, within: SearchKind) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setProblem(null);
    try {
      // An empty box shows the user's own playlists — more useful than nothing,
      // and it needs no search at all.
      const found = text.trim() ? await search(text, within) : await myPlaylists();
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
    const timer = setTimeout(() => void run(query, kind), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, kind, run]);

  async function choose(result: SearchResult, index: number) {
    const provider = getProvider('spotify');
    if (!(provider instanceof SpotifyProvider)) return;

    setBusyId(result.id);
    setProblem(null);
    try {
      const startIndex = usePlayerStore.getState().queue.length;
      const chosen = await provider.resolve(result);
      if (chosen.length === 0) {
        setProblem('Nothing playable in there.');
        return;
      }

      // Queue the remaining track results behind the chosen one, so a single
      // pick keeps the music going instead of stopping after three minutes.
      const followOn =
        result.kind === 'track'
          ? results
              .slice(index + 1)
              .flatMap((r) => (r.kind === 'track' && r.track ? [r.track] : []))
          : [];

      enqueue([...chosen, ...followOn]);

      // Start playback without holding the list disabled. Spotify can take a
      // moment to register the device, and the user should be able to keep
      // browsing meanwhile; a failure surfaces on the store's error bar.
      void playAt(startIndex);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <input
        type="text"
        value={query}
        spellCheck={false}
        placeholder="Search Spotify"
        onChange={(e) => setQuery(e.target.value)}
        className="shrink-0 rounded bg-shell-900 px-2 py-1.5 text-[11px] text-cream-50 outline-none ring-1 ring-shell-600 focus:ring-brass-500"
      />

      <div className="flex shrink-0 gap-1">
        {KINDS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
            className={`flex-1 rounded-full py-1 text-[9px] font-medium tracking-wide uppercase transition-colors ${
              kind === value
                ? 'bg-brass-600 text-shell-900'
                : 'bg-shell-700 text-cream-400 hover:text-cream-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {problem && (
        <p className="shrink-0 rounded bg-red-950/70 px-2 py-1.5 text-[10px] leading-snug text-red-200">
          {problem}
        </p>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {loading && results.length === 0 && <Hint>Searching…</Hint>}

        {!loading && results.length === 0 && (
          <Hint>{query.trim() ? 'Nothing found.' : 'Search, or pick one of your playlists.'}</Hint>
        )}

        {results.map((result, index) => (
          <li key={`${result.kind}:${result.id}`}>
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => void choose(result, index)}
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-shell-700/60 disabled:opacity-50"
            >
              {result.coverUrl ? (
                <img
                  src={result.coverUrl}
                  alt=""
                  loading="lazy"
                  className="h-7 w-7 shrink-0 rounded-sm object-cover"
                />
              ) : (
                <span className="h-7 w-7 shrink-0 rounded-sm bg-shell-700" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] text-cream-100">{result.title}</span>
                <span className="block truncate text-[9px] text-cream-400">{result.subtitle}</span>
              </span>
              {busyId === result.id && <span className="text-[9px] text-brass-400">…</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <li className="px-2 py-4 text-center text-[10px] leading-relaxed text-cream-400/70">
      {children}
    </li>
  );
}
