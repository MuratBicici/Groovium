import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/core/i18n';
import { useSettingsStore } from '@/core/settings/store';
import { DEFAULT_THEME } from '@/core/settings/themes';
import { hasApiKey } from '@/core/station/lastfm';
import { hasClientId } from '@/core/security/spotifyAuth';
import { isTauri } from '@/core/utils/env';
import { useUpdateStore } from '@/core/updates/store';
import { APP_VERSION } from '@/core/version';
import { CATEGORIES, CATEGORY_NAME, summarise } from './categories';
import type { SettingsCategory } from './categories';
import {
  AboutIcon,
  CategoryRow,
  ChevronIcon,
  ConnectionsIcon,
  GeneralIcon,
  LightsIcon,
  PaletteIcon,
} from './parts';
import { AboutPage } from './pages/AboutPage';
import { AppearancePage } from './pages/AppearancePage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { GeneralPage } from './pages/GeneralPage';
import { LightsPage } from './pages/LightsPage';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  id: string;
  /** Connections send people to the setup that already exists, rather than repeating it. */
  onSetUpSpotify: () => void;
  onSetUpStation: () => void;
  /**
   * Open the colour picker. Raised rather than rendered here: the picker is a
   * sheet over the whole window, and this panel only covers the stage.
   */
  onPickColour: (which: 'primary' | 'secondary') => void;
  /**
   * Open the summary of what changed in this version — the same sheet shown on
   * the first launch after an update, for anyone who closed it too soon.
   *
   * Undefined on a build whose version has no changelog section, and the button
   * is then not drawn at all rather than drawn and inert.
   */
  onShowWhatsNew?: (() => void) | undefined;
  /**
   * A sheet opened from here is over the window — the colour picker, the
   * station's setup, What's new. Escape is that sheet's then, not this panel's.
   */
  covered?: boolean;
}

const ICONS: Record<SettingsCategory, React.ReactNode> = {
  appearance: <PaletteIcon />,
  lights: <LightsIcon />,
  general: <GeneralIcon />,
  connections: <ConnectionsIcon />,
  about: <AboutIcon />,
};

/** How long a page takes to slide in or out; `.groove-settings-layer` in styles.css. */
const SLIDE_MS = 260;

/**
 * Preferences, a page for each kind: how it looks, what lights up, how the
 * window behaves, what it is connected to, and what it is.
 *
 * It opens on the list of those pages, each with a line saying where it stands
 * now, so a visit to check something usually ends there. A page slides in over
 * the list and back out again; Escape on a page goes back to the list, and on
 * the list closes the panel as it always has. Closed, it forgets the page, so
 * it always opens on the list.
 *
 * Deliberately not where a key is entered. Spotify and Last.fm each already
 * have a setup flow that explains what the key is for and what the form asks
 * for, written at the moment it becomes relevant; a second, shorter copy in
 * here would be the one people found first and the worse of the two. What this
 * shows is whether each is set up, and the way to the real thing.
 */
export function SettingsPanel({
  open,
  onClose,
  id,
  onSetUpSpotify,
  onSetUpStation,
  onPickColour,
  onShowWhatsNew,
  covered = false,
}: SettingsPanelProps) {
  const t = useT();
  const theme = useSettingsStore((s) => s.theme ?? DEFAULT_THEME);
  const themeFromCover = useSettingsStore((s) => s.themeFromCover);
  const scale = useSettingsStore((s) => s.scale);
  const visualizer = useSettingsStore((s) => s.visualizer);
  const windowGlow = useSettingsStore((s) => s.windowGlow);
  const language = useSettingsStore((s) => s.language ?? 'en');
  const drawerSide = useSettingsStore((s) => s.drawerSide);
  const forgetResult = useUpdateStore((s) => s.forgetResult);
  const updateStatus = useUpdateStore((s) => s.status);
  const updateVersion = useUpdateStore((s) => s.version);

  const [spotifyReady, setSpotifyReady] = useState(false);
  const [stationReady, setStationReady] = useState(false);

  const refresh = useCallback(async () => {
    const [spotify, station] = await Promise.all([hasClientId(), hasApiKey()]);
    setSpotifyReady(spotify);
    setStationReady(station);
  }, []);

  // Re-read on every open: a key can be added from the Spotify panel or from
  // the station sheet while this is closed, and stale "Not set up" next to a
  // working connection is worse than not showing the state at all.
  //
  // Written out rather than calling `refresh`, for the guard. Opening and
  // closing quickly leaves two lookups in flight, and the slower one would
  // otherwise land last and overwrite the newer answer with the older one.
  useEffect(() => {
    if (!open) return;
    // The answer to a check nobody is looking at any more. "Up to date"
    // pressed an hour ago would otherwise still be sitting there, claiming a
    // check that did not just happen.
    forgetResult();

    let current = true;
    void Promise.all([hasClientId(), hasApiKey()]).then(([spotify, station]) => {
      if (!current) return;
      setSpotifyReady(spotify);
      setStationReady(station);
    });
    return () => {
      current = false;
    };
  }, [open, forgetResult]);

  /** The page open over the list, or null for the list itself. */
  const [page, setPage] = useState<SettingsCategory | null>(null);
  /**
   * The page last opened: the one on show, and the one still drawn while it
   * slides back out, after `page` has already gone back to null.
   */
  const [lastPage, setLastPage] = useState<SettingsCategory>('appearance');
  const backRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef<Partial<Record<SettingsCategory, HTMLButtonElement | null>>>({});
  /** Set by a move somebody made, so focus follows it; not by the reset on closing. */
  const moved = useRef(false);

  const openPage = (category: SettingsCategory) => {
    moved.current = true;
    setLastPage(category);
    setPage(category);
  };
  const goBack = useCallback(() => {
    moved.current = true;
    setPage(null);
  }, []);

  // Focus goes where the eye does: to the way back on arriving at a page, and
  // to the row of the page just left on coming back to the list.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    if (page) backRef.current?.focus({ preventScroll: true });
    else rowRefs.current[lastPage]?.focus({ preventScroll: true });
  }, [page, lastPage]);

  // Escape on a page goes back to the list; on the list it is left to the
  // shell, which closes the panel. Captured and kept, as the sheets do, and
  // only while a page is open — an always-listening handler would swallow
  // Escapes meant for everything else. Not while a sheet opened from here is
  // over the window: that Escape is the sheet's.
  useEffect(() => {
    if (!open || page === null || covered) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      goBack();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, page, covered, goBack]);

  // Back to the list once the panel has gone, so it opens there next time —
  // after its way out rather than during it, which would show the list
  // sliding in under a panel that is fading away.
  useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => setPage(null), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  const categories = CATEGORIES.filter(
    // Outside Tauri there are no keys to keep, so nothing to connect.
    (category) => category !== 'connections' || isTauri(),
  );
  const facts = {
    theme,
    themeFromCover,
    scale,
    visualizer,
    windowGlow,
    language,
    drawerSide,
    spotifyReady,
    stationReady,
    version: APP_VERSION,
    offered:
      updateStatus === 'available' || updateStatus === 'downloading' || updateStatus === 'ready'
        ? updateVersion
        : null,
  };

  function pageFor(category: SettingsCategory) {
    switch (category) {
      case 'appearance':
        return <AppearancePage onPickColour={onPickColour} />;
      case 'lights':
        return <LightsPage />;
      case 'general':
        return <GeneralPage />;
      case 'connections':
        return (
          <ConnectionsPage
            spotifyReady={spotifyReady}
            stationReady={stationReady}
            onSetUpSpotify={onSetUpSpotify}
            onSetUpStation={onSetUpStation}
            refresh={refresh}
          />
        );
      case 'about':
        return <AboutPage onShowWhatsNew={onShowWhatsNew} />;
    }
  }

  return (
    <div
      id={id}
      inert={!open}
      // `invisible` while closed, not only transparent. This carries a
      // backdrop blur, and a blur is the most expensive thing per pixel a
      // compositor does: three of these are mounted at all times over the
      // whole stage, and one that is merely transparent can still be asked for
      // it on every frame. Visibility is in `transition-all`, so it holds
      // `visible` for the length of the way out and flips at once on the way
      // in — the panel still slides and fades exactly as it did.
      className={`absolute inset-0 z-20 groove-surface groove-dock flex flex-col rounded-t-lg backdrop-blur-sm transition-all duration-200 ease-out ${
        open ? 'translate-y-0 opacity-100' : 'invisible translate-y-3 opacity-0'
      }`}
    >
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        {page ? (
          <button
            ref={backRef}
            type="button"
            onClick={goBack}
            aria-label={t('settings.back')}
            className="-ml-1 flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-body font-medium text-brass-400 transition-colors outline-none hover:text-cream-50 focus-visible:ring-2 focus-visible:ring-brass-400"
          >
            <ChevronIcon direction="left" />
            <span className="truncate">{t(CATEGORY_NAME[page])}</span>
          </button>
        ) : (
          <span className="text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
            {t('panel.settings')}
          </span>
        )}
        <button
          type="button"
          aria-label={t('settings.close')}
          title={t('common.close')}
          onClick={onClose}
          className="flex h-5 w-5 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
        >
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* The list, stepping back and fading under a page laid over it. */}
        <nav
          inert={page !== null}
          aria-label={t('panel.settings')}
          className={`groove-settings-layer absolute inset-0 space-y-1 overflow-y-auto px-3 pt-1 pb-3 groove-scroll-fade ${
            page ? 'groove-settings-behind' : ''
          }`}
        >
          {categories.map((category) => (
            <CategoryRow
              key={category}
              ref={(row) => {
                rowRefs.current[category] = row;
              }}
              icon={ICONS[category]}
              name={t(CATEGORY_NAME[category])}
              summary={summarise(category, facts, t)}
              onOpen={() => openPage(category)}
            />
          ))}
        </nav>

        {/* The page, in from the right. Drawn for the page last opened, so it
            is still there while it slides back out. */}
        <section
          inert={page === null}
          aria-label={t(CATEGORY_NAME[lastPage])}
          className={`groove-settings-layer absolute inset-0 space-y-3 overflow-y-auto px-3 pt-1 pb-3 groove-scroll-fade ${
            page ? '' : 'groove-settings-ahead'
          }`}
        >
          {pageFor(lastPage)}
        </section>
      </div>
    </div>
  );
}

