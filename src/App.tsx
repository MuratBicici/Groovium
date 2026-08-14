import { useEffect } from 'react';
import { DiskPlatter } from '@/components/player/DiskPlatter';
import { TrackDisplay } from '@/components/player/TrackDisplay';
import { ProgressBar } from '@/components/player/ProgressBar';
import { QueuePanel } from '@/components/player/QueuePanel';
import { TransportControls } from '@/components/controls/TransportControls';
import { VolumeKnob } from '@/components/controls/VolumeKnob';
import { LoadFilesButton } from '@/components/controls/LoadFilesButton';
import { WindowChrome } from '@/components/controls/WindowChrome';
import { usePlayerError, usePlayerStore } from '@/core/store';

export default function App() {
  const initialize = usePlayerStore((s) => s.initialize);
  const error = usePlayerError();
  const clearError = usePlayerStore((s) => s.clearError);

  useEffect(() => {
    // No teardown on unmount by design: providers live for the lifetime of the
    // window, and disposing here would tear them down between StrictMode's
    // double-invoked effects in dev, leaving a dead audio element behind.
    // `disposeAllProviders()` exists for tests and for a future multi-window setup.
    void initialize();
  }, [initialize]);

  return (
    // The shell is the only opaque surface — the window behind it is transparent.
    <div className="flex h-full flex-col overflow-hidden rounded-[var(--radius-widget)] bg-gradient-to-b from-shell-700 to-shell-900 ring-1 ring-black/50">
      <WindowChrome />

      <main className="flex min-h-0 flex-1 flex-col gap-3 pb-3">
        <DiskPlatter />
        <TrackDisplay />
        <ProgressBar />
        <TransportControls />

        <div className="flex items-center justify-between px-4">
          <VolumeKnob />
          <LoadFilesButton />
        </div>

        <QueuePanel />
      </main>

      {error && (
        <button
          type="button"
          onClick={clearError}
          title="Dismiss"
          className="shrink-0 bg-red-950/80 px-3 py-1.5 text-left text-[10px] leading-snug text-red-200"
        >
          {error}
        </button>
      )}
    </div>
  );
}
