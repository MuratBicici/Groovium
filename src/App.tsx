import { useEffect, useState } from 'react';
import { DiskPlatter } from '@/components/player/DiskPlatter';
import { TrackDisplay } from '@/components/player/TrackDisplay';
import { ProgressBar } from '@/components/player/ProgressBar';
import { LibraryPanel } from '@/components/library/LibraryPanel';
import { ImportProgress } from '@/components/library/ImportProgress';
import { PlaylistsPanel } from '@/components/playlists/PlaylistsPanel';
import { PlaylistPickerProvider } from '@/components/playlists/PlaylistPicker';
import { DiscFlightProvider } from '@/components/player/DiscFlight';
import { SpotifyPanel } from '@/components/spotify/SpotifyPanel';
import { StationSetup } from '@/components/station/StationSetup';
import { TransportControls } from '@/components/controls/TransportControls';
import { VolumeKnob } from '@/components/controls/VolumeKnob';
import { PanelButton } from '@/components/controls/PanelButton';
import { WindowChrome } from '@/components/controls/WindowChrome';
import { usePlayerError, usePlayerStore } from '@/core/store';
import { isTauri } from '@/core/utils/env';
import { startCommandBridge } from '@/platform/commandBridge';

const PANEL_IDS = {
  library: 'groovium-library',
  playlists: 'groovium-playlists',
  spotify: 'groovium-spotify',
} as const;

/** Only one overlay covers the stage at a time; two would stack unreadably. */
type Overlay = 'none' | keyof typeof PANEL_IDS;

/**
 * How this window stacks, written down because the numbers live in five files
 * and drifted once already — a rising disc was thrown over an open menu.
 *
 * | Layer  | What                                            |
 * | ------ | ----------------------------------------------- |
 * | (auto) | The stage: platter, tonearm, track display      |
 * | z-10   | Disc motion: the flight layer and the ghost     |
 * | z-20   | Panels: Library, Playlists, Spotify             |
 * | z-30   | Modal sheets: playlist picker, station setup    |
 * | z-40   | The picker's confirmation, over its own sheet   |
 *
 * A record is part of the deck, so it belongs under whatever covers the deck.
 * The shell below is `relative` with no z-index, no transform and no opacity,
 * so it creates no stacking context and every number here resolves against the
 * same root — which is what lets a panel inside `main` sit above a layer that
 * comes after `main` in the DOM.
 */

export default function App() {
  const initialize = usePlayerStore((s) => s.initialize);
  const error = usePlayerError();
  const clearError = usePlayerStore((s) => s.clearError);
  const toggleStation = usePlayerStore((s) => s.toggleStation);

  const [overlay, setOverlay] = useState<Overlay>('none');
  // Not an `Overlay`: it is raised by the transport row rather than a panel
  // button, and it may sit over whichever panel happens to be open.
  const [stationSetup, setStationSetup] = useState(false);
  const toggle = (which: Exclude<Overlay, 'none'>) =>
    setOverlay((current) => (current === which ? 'none' : which));

  useEffect(() => {
    // No teardown on unmount by design: providers live for the lifetime of the
    // window, and disposing here would tear them down between StrictMode's
    // double-invoked effects in dev, leaving a dead audio element behind.
    void initialize();
  }, [initialize]);

  useEffect(() => {
    // Tray menu and global media keys arrive as events from Rust.
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
    // `relative` so the playlist picker can cover the whole widget: rendering it
    // inside a scrolling list is what made it clip and misbehave.
    <div className="relative flex h-full flex-col overflow-hidden rounded-[var(--radius-widget)] bg-gradient-to-b from-shell-700 to-shell-900 ring-1 ring-black/50">
      <PlaylistPickerProvider>
      <DiscFlightProvider>
      <WindowChrome />

      <main className="flex min-h-0 flex-1 flex-col gap-3 pb-3">
        {/* The stage. Overlays take it over rather than competing for a slice of
            the column — at this window size that slice was under one row tall. */}
        <div className="relative flex min-h-0 flex-1 flex-col justify-center gap-3">
          <DiskPlatter />
          <TrackDisplay />

          <LibraryPanel
            id={PANEL_IDS.library}
            open={overlay === 'library'}
            onClose={() => setOverlay('none')}
          />
          <PlaylistsPanel
            id={PANEL_IDS.playlists}
            open={overlay === 'playlists'}
            onClose={() => setOverlay('none')}
          />
          <SpotifyPanel
            id={PANEL_IDS.spotify}
            open={overlay === 'spotify'}
            onClose={() => setOverlay('none')}
          />
        </div>

        {/* Always reachable, including while an overlay is open. */}
        <ProgressBar />
        <TransportControls onStationNeedsSetup={() => setStationSetup(true)} />

        <div className="flex items-center justify-between px-4">
          <VolumeKnob />
          <div className="flex items-center gap-1.5">
            <PanelButton
              label="Library"
              open={overlay === 'library'}
              onToggle={() => toggle('library')}
              controls={PANEL_IDS.library}
            />
            <PanelButton
              label="Playlists"
              open={overlay === 'playlists'}
              onToggle={() => toggle('playlists')}
              controls={PANEL_IDS.playlists}
            />
            {/* Spotify needs the loopback listener and the OS credential store,
                neither of which exists in a plain browser. */}
            {isTauri() && (
              <PanelButton
                label="Spotify"
                open={overlay === 'spotify'}
                onToggle={() => toggle('spotify')}
                controls={PANEL_IDS.spotify}
              />
            )}
          </div>
        </div>
      </main>

      <StationSetup
        open={stationSetup}
        onClose={() => setStationSetup(false)}
        onConfigured={() => {
          setStationSetup(false);
          // The key exists now, so the press that opened this can take effect.
          void toggleStation();
        }}
      />

      <ImportProgress />

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
      </DiscFlightProvider>
      </PlaylistPickerProvider>
    </div>
  );
}
