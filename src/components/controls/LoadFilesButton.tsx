import { useState } from 'react';
import { getProvider, LocalAudioProvider } from '@/core/providers';
import { usePlayerStore } from '@/core/store';

/**
 * Adds local files to the queue.
 *
 * Importing from disk is meaningful only for the local provider, so this reaches
 * for `LocalAudioProvider` directly instead of pushing a file-picking method
 * onto the shared `AudioProvider` contract that Spotify could never implement.
 */
export function LoadFilesButton() {
  const [busy, setBusy] = useState(false);
  const enqueue = usePlayerStore((s) => s.enqueue);
  const playAt = usePlayerStore((s) => s.playAt);

  async function loadFiles() {
    const provider = getProvider('local');
    if (!(provider instanceof LocalAudioProvider)) return;

    setBusy(true);
    try {
      const startIndex = usePlayerStore.getState().queue.length;
      const tracks = await provider.pickAndAddFiles();
      if (tracks.length === 0) return;

      enqueue(tracks);
      // Only take over playback if nothing is going on.
      if (usePlayerStore.getState().playbackState === 'IDLE') {
        await playAt(startIndex);
      }
    } catch (err) {
      usePlayerStore.setState({
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void loadFiles()}
      className="flex items-center gap-1.5 rounded-full bg-shell-700 px-3 py-1.5 text-[10px] font-medium tracking-wide text-cream-200 uppercase transition-colors hover:bg-shell-600 hover:text-cream-50 disabled:opacity-50"
    >
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 5v14M5 12h14" strokeLinecap="round" />
      </svg>
      {busy ? 'Loading' : 'Add Files'}
    </button>
  );
}
