import { useEffect, useState } from 'react';
import { DiskPlatter } from '@/components/player/DiskPlatter';
import { TrackDisplay } from '@/components/player/TrackDisplay';
import { ProgressBar } from '@/components/player/ProgressBar';
import { LibraryPanel } from '@/components/library/LibraryPanel';
import { ImportProgress } from '@/components/library/ImportProgress';
import { PlaylistsPanel } from '@/components/playlists/PlaylistsPanel';
import { PlaylistPickerProvider } from '@/components/playlists/PlaylistPicker';
import { DiscFlightProvider } from '@/components/player/DiscFlight';
import { DiscHoldProvider } from '@/components/player/DiscHold';
import { SpotifyPanel } from '@/components/spotify/SpotifyPanel';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { StationSetup } from '@/components/station/StationSetup';
import { ColourPicker } from '@/components/settings/ColourPicker';
import { TransportControls } from '@/components/controls/TransportControls';
import { VolumeKnob } from '@/components/controls/VolumeKnob';
import { PanelButton } from '@/components/controls/PanelButton';
import { WindowChrome } from '@/components/controls/WindowChrome';
import { usePlayerError, usePlayerStore } from '@/core/store';
import { useSettingsStore } from '@/core/settings/store';
import { useCompactShell } from '@/components/controls/useCompactShell';
import { useT } from '@/core/i18n';
import { useLanguage } from '@/core/settings/store';
import { isTauri } from '@/core/utils/env';
import { startCommandBridge } from '@/platform/commandBridge';
import { syncTrayLabels } from '@/platform/tray';

const PANEL_IDS = {
  library: 'groovium-library',
  playlists: 'groovium-playlists',
  spotify: 'groovium-spotify',
  settings: 'groovium-settings',
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
  const t = useT();
  const initialize = usePlayerStore((s) => s.initialize);
  const initializeSettings = useSettingsStore((s) => s.initialize);
  const language = useLanguage();
  const error = usePlayerError();
  const clearError = usePlayerStore((s) => s.clearError);
  const toggleStation = usePlayerStore((s) => s.toggleStation);

  const compact = useSettingsStore((s) => s.compact);
  const settingsReady = useSettingsStore((s) => s.ready);
  const { shellRef, stageRef, trackRef, bottomRef } = useCompactShell(compact, settingsReady);

  const [overlay, setOverlay] = useState<Overlay>('none');
  // Collapsing takes the panel buttons away with it, so nothing may be showing
  // over a bar that has no way to close it. Derived rather than reset: what was
  // open is still open when the player is opened back up, which is the same
  // answer any window gives after being minimised.
  const shown: Overlay = compact ? 'none' : overlay;
  // Not an `Overlay`: it is raised by the transport row rather than a panel
  // button, and it may sit over whichever panel happens to be open.
  const [stationSetup, setStationSetup] = useState(false);
  /** Which custom colour the picker is open on, if any. */
  const [pickingColour, setPickingColour] = useState<'primary' | 'secondary' | null>(null);
  const toggle = (which: Exclude<Overlay, 'none'>) =>
    setOverlay((current) => (current === which ? 'none' : which));

  useEffect(() => {
    // No teardown on unmount by design: providers live for the lifetime of the
    // window, and disposing here would tear them down between StrictMode's
    // double-invoked effects in dev, leaving a dead audio element behind.
    void initialize();
  }, [initialize]);

  useEffect(() => {
    // Separate from playback startup, and not awaited alongside it: a theme
    // should land as soon as it is read rather than behind provider setup, and
    // a failure to read preferences must not stop music from working.
    void initializeSettings();
  }, [initializeSettings]);

  useEffect(() => {
    // Tray menu and global media keys arrive as events from Rust.
    return startCommandBridge();
  }, []);

  useEffect(() => {
    // The tray is the one part of the interface Rust draws, so it has to be
    // told when the language changes rather than re-rendering with everything
    // else. Depends on `language` and not on `ready`: the first run writes the
    // default, and loading the stored language changes it, which runs it again.
    void syncTrayLabels();
  }, [language]);

  useEffect(() => {
    if (shown === 'none') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverlay('none');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shown]);

  return (
    // The shell is the only opaque surface — the window behind it is transparent.
    // `relative` so the playlist picker can cover the whole widget: rendering it
    // inside a scrolling list is what made it clip and misbehave.
    <div
      ref={shellRef}
      className="relative flex h-full flex-col overflow-hidden rounded-[var(--radius-widget)] bg-gradient-to-b from-shell-700 to-shell-900 ring-1 ring-black/50"
    >
      <PlaylistPickerProvider>
      <DiscFlightProvider>
      <DiscHoldProvider>
      <WindowChrome />

      <main className="flex min-h-0 flex-1 flex-col gap-3 pb-3">
        {/* The stage. Overlays take it over rather than competing for a slice of
            the column — at this window size that slice was under one row tall. */}
        <div
          ref={stageRef}
          className={`relative flex min-h-0 flex-col justify-center gap-3 ${
            compact ? 'flex-none' : 'flex-1'
          }`}
        >
          {/* Kept mounted through the collapse so it can fade rather than
              vanish, and taken out of flow at the same moment so the stage's
              height answers to the track display alone. It stays centred in
              the shrinking stage, which reads as the record being drawn down
              into the bar. */}
          {/* `data-leaving` while collapsed: the deck and the bar both carry a
              record, and without this the one on its way out would be animated
              into place alongside the one arriving. */}
          <div
            data-leaving={compact ? '' : undefined}
            className={
              compact
                ? 'pointer-events-none absolute inset-0 flex items-center justify-center'
                : undefined
            }
          >
            {/* The deck puts itself away rather than being faded out from here:
                its record has to vanish at once while its well fades and its
                arm swings clear, and one opacity on the lot cannot do that. */}
            <DiskPlatter stowed={compact} />
          </div>
          <div ref={trackRef}>
            <TrackDisplay compact={compact} />
          </div>

          <LibraryPanel
            id={PANEL_IDS.library}
            open={shown === 'library'}
            onClose={() => setOverlay('none')}
          />
          <PlaylistsPanel
            id={PANEL_IDS.playlists}
            open={shown === 'playlists'}
            onClose={() => setOverlay('none')}
          />
          <SpotifyPanel
            id={PANEL_IDS.spotify}
            open={shown === 'spotify'}
            onClose={() => setOverlay('none')}
          />
          <SettingsPanel
            id={PANEL_IDS.settings}
            open={shown === 'settings'}
            onClose={() => setOverlay('none')}
            onSetUpSpotify={() => setOverlay('spotify')}
            onSetUpStation={() => setStationSetup(true)}
            onPickColour={setPickingColour}
          />
        </div>

        {/* Always reachable, including while an overlay is open. */}
        <ProgressBar />
        <TransportControls onStationNeedsSetup={() => setStationSetup(true)} />

        <div
          ref={bottomRef}
          inert={compact}
          className={`flex items-center justify-between px-4 transition-opacity duration-200 ${
            compact ? 'h-0 overflow-hidden opacity-0' : 'opacity-100'
          }`}
        >
          <VolumeKnob />
          <div className="flex items-center gap-1.5">
            <PanelButton
              panel="library"
              open={shown === 'library'}
              onToggle={() => toggle('library')}
              controls={PANEL_IDS.library}
            />
            <PanelButton
              panel="playlists"
              open={shown === 'playlists'}
              onToggle={() => toggle('playlists')}
              controls={PANEL_IDS.playlists}
            />
            {/* Spotify needs the loopback listener and the OS credential store,
                neither of which exists in a plain browser. */}
            {isTauri() && (
              <PanelButton
                panel="spotify"
                open={shown === 'spotify'}
                onToggle={() => toggle('spotify')}
                controls={PANEL_IDS.spotify}
              />
            )}
            <PanelButton
              panel="settings"
              open={shown === 'settings'}
              onToggle={() => toggle('settings')}
              controls={PANEL_IDS.settings}
            />
          </div>
        </div>
      </main>

      {/* Out here rather than inside the settings panel, for the reason the
          station's setup is: these cover the whole window, and the panel only
          covers the stage. */}
      {/* Keyed, so each opening is a fresh mount: the picker seeds itself from
          the stored colour once and owns it from then on, which is an
          initialiser rather than an effect chasing a prop. */}
      {pickingColour && (
        <ColourPicker
          key={pickingColour}
          editing={pickingColour}
          onClose={() => setPickingColour(null)}
        />
      )}

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
          title={t('common.dismiss')}
          className="shrink-0 bg-red-950/80 px-3 py-1.5 text-left text-meta leading-snug text-red-200"
        >
          {error}
        </button>
      )}
      </DiscHoldProvider>
      </DiscFlightProvider>
      </PlaylistPickerProvider>
    </div>
  );
}
