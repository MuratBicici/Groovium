import { useEffect, useState } from 'react';
import { DiskPlatter } from '@/components/player/DiskPlatter';
import { TrackDisplay } from '@/components/player/TrackDisplay';
import { ProgressBar } from '@/components/player/ProgressBar';
import { QueuePanel } from '@/components/player/QueuePanel';
import { SpotifyPanel } from '@/components/spotify/SpotifyPanel';
import { TransportControls } from '@/components/controls/TransportControls';
import { VolumeKnob } from '@/components/controls/VolumeKnob';
import { LoadFilesButton } from '@/components/controls/LoadFilesButton';
import { QueueToggleButton } from '@/components/controls/QueueToggleButton';
import { SpotifyButton } from '@/components/controls/SpotifyButton';
import { WindowChrome } from '@/components/controls/WindowChrome';
import { usePlayerError, usePlayerStore } from '@/core/store';
import { isTauri } from '@/core/utils/env';
import { startCommandBridge } from '@/platform/commandBridge';

const QUEUE_PANEL_ID = 'groovium-queue';
const SPOTIFY_PANEL_ID = 'groovium-spotify';

/**
 * Only one overlay covers the stage at a time. A pair of booleans would let both
 * open at once and stack unreadably.
 */
type Overlay = 'none' | 'queue' | 'spotify';

export default function App() {
  const initialize = usePlayerStore((s) => s.initialize);
  const error = usePlayerError();
  const clearError = usePlayerStore((s) => s.clearError);

  const [overlay, setOverlay] = useState<Overlay>('none');
  const toggle = (which: Exclude<Overlay, 'none'>) =>
    setOverlay((current) => (current === which ? 'none' : which));

  useEffect(() => {
    // No teardown on unmount by design: providers live for the lifetime of the
    // window, and disposing here would tear them down between StrictMode's
    // double-invoked effects in dev, leaving a dead audio element behind.
    // `disposeAllProviders()` exists for tests and for a future multi-window setup.
    void initialize();
  }, [initialize]);

  useEffect(() => {
    // Tray menu and global media keys arrive as events from Rust. Unlike the
    // providers, this one does tear down cleanly, so StrictMode's double-invoke
    // is harmless.
    return startCommandBridge();
  }, []);

  useEffect(() => {
    if (overlay === 'none') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverlay('none');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [overlay]);

  return (
    // The shell is the only opaque surface — the window behind it is transparent.
    <div className="flex h-full flex-col overflow-hidden rounded-[var(--radius-widget)] bg-gradient-to-b from-shell-700 to-shell-900 ring-1 ring-black/50">
      <WindowChrome />

      <main className="flex min-h-0 flex-1 flex-col gap-3 pb-3">
        {/*
          The stage. Everything an overlay is allowed to cover lives here, and
          overlays take it over rather than competing for a slice of the column —
          at this window size that slice was under one row tall.
        */}
        <div className="relative flex min-h-0 flex-1 flex-col justify-center gap-3">
          <DiskPlatter />
          <TrackDisplay />
          <QueuePanel
            id={QUEUE_PANEL_ID}
            open={overlay === 'queue'}
            onClose={() => setOverlay('none')}
          />
          <SpotifyPanel
            id={SPOTIFY_PANEL_ID}
            open={overlay === 'spotify'}
            onClose={() => setOverlay('none')}
          />
        </div>

        {/* Always reachable, including while an overlay is open. */}
        <ProgressBar />
        <TransportControls />

        <div className="flex items-center justify-between px-4">
          <VolumeKnob />
          <div className="flex items-center gap-1.5">
            <LoadFilesButton />
            <QueueToggleButton
              open={overlay === 'queue'}
              onToggle={() => toggle('queue')}
              controls={QUEUE_PANEL_ID}
            />
            {/* Spotify needs the loopback listener and the OS credential store,
                neither of which exists in a plain browser. */}
            {isTauri() && (
              <SpotifyButton
                open={overlay === 'spotify'}
                onToggle={() => toggle('spotify')}
                controls={SPOTIFY_PANEL_ID}
              />
            )}
          </div>
        </div>
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
