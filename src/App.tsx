import { useCallback, useEffect, useMemo, useState } from 'react';
import { DiskPlatter } from '@/components/player/DiskPlatter';
import { TrackDisplay } from '@/components/player/TrackDisplay';
import { ProgressBar } from '@/components/player/ProgressBar';
import { LibraryPanel } from '@/components/library/LibraryPanel';
import { ImportProgress } from '@/components/library/ImportProgress';
import { PlaylistsPanel } from '@/components/playlists/PlaylistsPanel';
import { PlaylistPickerProvider } from '@/components/playlists/PlaylistPicker';
import { DiscFlightProvider } from '@/components/player/DiscFlight';
import { DiscHoldProvider } from '@/components/player/DiscHold';
import { Visualizer } from '@/components/player/Visualizer';
import { WindowGlow } from '@/components/player/WindowGlow';
import { SpotifyDrawer } from '@/components/spotify/SpotifyDrawer';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { useUpdateStore, useUpdateWaiting } from '@/core/updates/store';
import { StationSetup } from '@/components/station/StationSetup';
import { ColourPicker } from '@/components/settings/ColourPicker';
import { WhatsNew } from '@/components/release/WhatsNew';
import { UpdateOffer } from '@/components/release/UpdateOffer';
import { summaryForThisVersion } from '@/core/release';
import { APP_VERSION } from '@/core/version';
import { TransportControls } from '@/components/controls/TransportControls';
import { VolumeKnob } from '@/components/controls/VolumeKnob';
import { PanelButton } from '@/components/controls/PanelButton';
import { WindowChrome } from '@/components/controls/WindowChrome';
import { usePlayerError, usePlayerStore } from '@/core/store';
import { useSettingsStore } from '@/core/settings/store';
import { SETTLE_MS, SWAP_MS, SWAP_PAUSE_MS, useShellSize } from '@/components/controls/useShellSize';
import { prefersReducedMotion } from '@/core/utils/motion';
import { useT } from '@/core/i18n';
import { useLanguage } from '@/core/settings/store';
import { isTauri } from '@/core/utils/env';
import { startCommandBridge } from '@/platform/commandBridge';
import { syncTrayLabels } from '@/platform/tray';
import { PLAYER_WIDTH } from '@/platform/window';

const PANEL_IDS = {
  library: 'groovium-library',
  playlists: 'groovium-playlists',
  settings: 'groovium-settings',
} as const;

/**
 * The drawer is not one of the stage overlays.
 *
 * `Overlay` is a union of things that cover the platter, one at a time. Spotify
 * used to be one of them and is not any more: it stands beside the player
 * instead, so it can be open while a panel is, and it has its own place to be
 * remembered — on disk, next to `compact`.
 */
const DRAWER_ID = 'groovium-spotify';

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
 * | z-50   | The window's edge and its light, which nothing may cover |
 *
 * Below all of it, at `-z-10`, is the visualiser. A negative index is the one
 * way to be under an element's content and still over its background, which is
 * exactly where an ornament belongs. It is also the reason the shell isolates:
 * a negative index resolves against the nearest stacking context, and without
 * one it would have meant "under the shell" — which is under the shell's own
 * gradient, where nothing can be seen. Everything in this table lives inside
 * the shell, so isolating changes nothing else about their order.
 *
 * A record is part of the deck, so it belongs under whatever covers the deck.
 * The shell below has no transform and no opacity, so nothing but that
 * `isolate` puts a boundary anywhere, and every number here resolves against
 * it — which is what lets a panel inside `main` sit above a layer that comes
 * after `main` in the DOM.
 *
 * The Spotify drawer is the one thing deliberately outside this table: it
 * isolates, and an opened crate stacks inside it. That layer covers the drawer
 * and nothing else, so it has no business holding a number in a scale about
 * what covers the deck — and while it did, it sat above the disc-motion layer
 * and hid a record being carried out of it.
 */

export default function App() {
  const t = useT();
  const initialize = usePlayerStore((s) => s.initialize);
  const initializeSettings = useSettingsStore((s) => s.initialize);
  const checkForUpdates = useUpdateStore((s) => s.checkQuietly);
  const updateWaiting = useUpdateWaiting();
  const language = useLanguage();
  const error = usePlayerError();
  const clearError = usePlayerStore((s) => s.clearError);
  const toggleStation = usePlayerStore((s) => s.toggleStation);

  const compact = useSettingsStore((s) => s.compact);
  const drawerOpen = useSettingsStore((s) => s.drawerOpen);
  const chosenSide = useSettingsStore((s) => s.drawerSide);
  /**
   * The side the window is laid out for, which lags the setting through a swap.
   *
   * Changing sides with the drawer already out used to move the whole window
   * sideways in one go, and a window teleporting six hundred and eighty pixels
   * is not an animation. It reads as what it is instead: the drawer shuts on
   * the side it was on, and opens on the other one.
   */
  const [drawerSide, setDrawerSide] = useState(chosenSide);
  const [swapping, setSwapping] = useState(false);
  const setDrawerOpen = useSettingsStore((s) => s.setDrawerOpen);
  const settingsReady = useSettingsStore((s) => s.ready);
  const windowBorder = useSettingsStore((s) => s.windowBorder);
  const visualizer = useSettingsStore((s) => s.visualizer);
  const windowGlow = useSettingsStore((s) => s.windowGlow);
  const lastSeenVersion = useSettingsStore((s) => s.lastSeenVersion);
  const markVersionSeen = useSettingsStore((s) => s.markVersionSeen);
  const declinedVersion = useSettingsStore((s) => s.declinedVersion);
  const declineVersion = useSettingsStore((s) => s.declineVersion);
  const offeredVersion = useUpdateStore((s) => s.version);
  // What was chosen, and what is on screen. Collapsing hides the drawer without
  // answering for it, the same way `shown` hides a panel without forgetting
  // which one was open — so expanding brings back whatever was out.
  const wide = drawerOpen && !compact && !swapping;

  // Adjusted during render rather than in an effect, which is React's own
  // guidance for state derived from something else — and the shape the drawer's
  // own close already uses in `useShellSize`.
  if (chosenSide !== drawerSide && !swapping) {
    // Nothing on screen to move: take the new side straight away.
    if (drawerOpen && !compact) setSwapping(true);
    else setDrawerSide(chosenSide);
  }

  useEffect(() => {
    if (!swapping) return;

    // Three beats, and they must not run into each other.
    //
    // The drawer shuts on the side it was on. Then the widget changes sides,
    // which `useShellSize` does behind a fade because the window itself has to
    // move. Only then does the drawer open again — it used to start the moment
    // the side flipped, so a drawer was growing out of a shell that was fading
    // and a window that was travelling.
    //
    // `SETTLE_MS` rather than the animation's own length: the window is put
    // right a little after the shell stops moving, and anything that starts
    // before that is working from a window that is still the old size.
    //
    // With motion turned down there are no beats: both land in the same tick,
    // in this order, and the drawer is simply on the other side.
    const quick = prefersReducedMotion();
    const swap = setTimeout(() => setDrawerSide(chosenSide), quick ? 0 : SETTLE_MS);
    const reopen = setTimeout(
      () => setSwapping(false),
      quick ? 0 : SETTLE_MS + SWAP_MS + SWAP_PAUSE_MS,
    );
    return () => {
      clearTimeout(swap);
      clearTimeout(reopen);
    };
  }, [swapping, chosenSide]);
  const { shellRef, stageRef, trackRef, bottomRef, drawerPresent } = useShellSize(
    compact,
    wide,
    settingsReady,
    drawerSide,
  );

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
  /** Null on a build whose version has no section written for it. */
  const summary = useMemo(() => summaryForThisVersion(language), [language]);
  /** Asked for from Settings, after this version had already been shown once. */
  const [reopened, setReopened] = useState(false);
  /**
   * Whether this version's summary is still owed to whoever is sitting here.
   *
   * Each clause is a way of not lying. Nothing before the stored answer has
   * been read. Nothing while the window is collapsed, where a dialog would not
   * fit and would be marked read having been seen by nobody — it opens the
   * moment the window is expanded instead. And nothing once the version is
   * recorded, which is what makes the record itself the dismissal: closing
   * writes it, so no second piece of state is needed to remember that this
   * happened.
   */
  const owed = settingsReady && !compact && lastSeenVersion !== APP_VERSION;
  const closeWhatsNew = useCallback(() => {
    setReopened(false);
    markVersionSeen();
  }, [markVersionSeen]);
  const whatsNewOpen = !!summary && (owed || reopened);

  /**
   * The version put away for this launch without being answered.
   *
   * Keyed by version rather than a flag, for the same reason `declinedVersion`
   * is: putting one offer aside is not asking to be left alone about every
   * later one. Not persisted — the cross means "not now", and next launch is
   * not now.
   */
  const [putAwayVersion, setPutAwayVersion] = useState<string | null>(null);
  /**
   * Whether to offer the update that is waiting.
   *
   * The same guards the summary has — read the stored answer first, and not
   * over a collapsed window — plus two of its own. It queues behind the
   * summary, because on the launch that shows both, what you have just been
   * given comes before what you are being offered next. And it is asked once
   * per release: `declinedVersion` is what somebody said last time, and asking
   * again would be not listening.
   *
   * A version on offer is the whole of the first condition, rather than a list
   * of the statuses that count. `version` is set when a check finds something
   * and cleared when one does not, so it stays put through downloading, through
   * being installed, and through a download that failed — which is the point:
   * pressing Download and then watching the window vanish, with the reason for
   * it filed in Settings, is not a way to be told that something went wrong.
   */
  const offerUpdate =
    settingsReady &&
    !compact &&
    !whatsNewOpen &&
    offeredVersion !== null &&
    putAwayVersion !== offeredVersion &&
    declinedVersion !== offeredVersion;
  // Both read the version at the moment they are called rather than closing
  // over the one this render saw. A press lands on the DOM of whichever render
  // is committed, and if the offer had changed underneath it the closure would
  // put away the version that is no longer being offered — leaving the sheet
  // open on a question that had just been answered.
  const putOfferAway = useCallback(() => {
    setPutAwayVersion(useUpdateStore.getState().version);
  }, []);
  const declineUpdate = useCallback(() => {
    const offered = useUpdateStore.getState().version;
    setPutAwayVersion(offered);
    if (offered) declineVersion(offered);
  }, [declineVersion]);
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
    // Last of the three, and quiet. Startup already reads the library and the
    // session, and music starting must not wait behind a network request that
    // nobody asked for — a failure here is not an event, it is an offline
    // launch. The mark on the settings button is the whole of the report.
    void checkForUpdates();
  }, [checkForUpdates]);

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
      // `ml-auto` when the drawer is on the left, which is what makes the shell
      // grow leftwards inside a window that is already wide enough. The window
      // moves at the same instant it is resized, so the far edge — the one the
      // player is drawn against — never moves at all. Without this the shell
      // would stay pinned to the window's left edge and the player would jump
      // there with it.
      className={`relative isolate flex h-full flex-col overflow-hidden rounded-[var(--radius-widget)] bg-gradient-to-b from-shell-700 to-shell-900 ${
        drawerSide === 'left' ? 'ml-auto' : ''
      }`}
    >
      <PlaylistPickerProvider>
      <Visualizer on={visualizer} />

      <DiscFlightProvider>
      <DiscHoldProvider>
      <WindowChrome />

      {/* The window's two halves. The titlebar above spans both, so the drawer
          is part of the same window rather than a thing parked beside it.

          A row inside the shell rather than turning the shell itself sideways:
          `useCompactShell` reads the shell's height as chrome + stage + bottom,
          and that arithmetic only holds while the shell is a column. */}
      <div className={`flex min-h-0 flex-1 ${drawerSide === 'left' ? 'flex-row-reverse' : ''}`}>
      {/* The player keeps its designed width whatever else is open, so that
          the shell narrowing around it during the drawer's animation moves
          nothing inside it.

          No `flex-1` here, and that is the whole point. It used to mean "take
          the rest of the height", because the shell was a column; in a row it
          means take the rest of the *width*, and it sets `flex-basis: 0%`,
          which overrides the width below. The player then measured whatever
          was left over — 340 only by arithmetic coincidence at rest, and less
          than that on every frame the shell was still opening. Height comes
          from the row's own stretch, which needs nothing said about it. */}
      <main
        style={{ width: `${PLAYER_WIDTH}px` }}
        className="flex min-h-0 shrink-0 flex-col gap-3 pb-3"
      >
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
          <SettingsPanel
            id={PANEL_IDS.settings}
            open={shown === 'settings'}
            onClose={() => setOverlay('none')}
            onSetUpSpotify={() => setDrawerOpen(true)}
            onSetUpStation={() => setStationSetup(true)}
            onPickColour={setPickingColour}
            onShowWhatsNew={summary ? () => setReopened(true) : undefined}
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
                open={drawerOpen}
                onToggle={() => setDrawerOpen(!drawerOpen)}
                controls={DRAWER_ID}
              />
            )}
            <PanelButton
              panel="settings"
              open={shown === 'settings'}
              onToggle={() => toggle('settings')}
              controls={PANEL_IDS.settings}
              badge={updateWaiting ? t('update.waiting') : undefined}
            />
          </div>
        </div>
      </main>

      {drawerPresent && <SpotifyDrawer id={DRAWER_ID} onClose={() => setDrawerOpen(false)} />}
      </div>

      {/* Out here rather than inside the settings panel, for the reason the
          station's setup is: these cover the whole window, and the panel only
          covers the stage. */}
      {/* Not keyed. A key per colour would remount on every open, which is a
          tidy way to seed the picker's state and destroys the instance that
          was supposed to animate the sheet out. It seeds itself instead. */}
      <ColourPicker editing={pickingColour} onClose={() => setPickingColour(null)} />

      <StationSetup
        open={stationSetup}
        onClose={() => setStationSetup(false)}
        onConfigured={() => {
          setStationSetup(false);
          // The key exists now, so the press that opened this can take effect.
          void toggleStation();
        }}
      />

      {/* Only ever rendered with something to say — `summary` being null is
          what keeps a version with no changelog section from opening an empty
          dialog, and it is checked here rather than inside so the component can
          take a summary rather than a maybe-summary. */}
      {summary && (
        <WhatsNew open={whatsNewOpen} summary={summary} onClose={closeWhatsNew} />
      )}

      <UpdateOffer
        open={offerUpdate}
        onDismiss={putOfferAway}
        onLater={declineUpdate}
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
      {/* The window's own edge, drawn last and over everything.

          It is what separates a frameless transparent window from the desktop
          behind it, so there is always exactly one. The accent replaces the
          black rather than stacking on it: two rings is a 2px edge, and on a
          340px widget that reads as a border somebody drew rather than as the
          edge of an object.

          `ring-inset` is load-bearing, not decoration. A ring is a box-shadow
          drawn *outside* the element, and this fills the window — so on all
          four straight edges the line would land outside the window and be
          clipped away, leaving a border made of four corners.

          Its own layer rather than a ring on the shell, because the shell
          paints below its children: a panel is `inset-0` across the full width
          and covered the line down both sides for as long as it was open, and
          a sheet's backdrop did the same to all four. An edge that a menu can
          switch off is not an edge. Nothing is above this, and
          `pointer-events-none` means nothing has to be. */}
      {/* Under the edge and on the same layer, so the hairline stays crisp on
          top of the light rather than being drawn through it. */}
      <WindowGlow on={windowGlow} />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 z-50 rounded-[var(--radius-widget)] ring-1 ring-inset ${
          windowBorder ? 'ring-brass-500/70' : 'ring-black/50'
        }`}
      />
      </DiscHoldProvider>
      </DiscFlightProvider>
      </PlaylistPickerProvider>
    </div>
  );
}
