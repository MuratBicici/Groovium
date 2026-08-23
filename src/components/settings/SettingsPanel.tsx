import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/core/i18n';
import { useSettingsStore } from '@/core/settings/store';
import { DEFAULT_THEME, THEMES } from '@/core/settings/themes';
import { clearApiKey, hasApiKey } from '@/core/station/lastfm';
import { clearClientId, hasClientId } from '@/core/security/spotifyAuth';
import { isTauri } from '@/core/utils/env';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  id: string;
  /** Connections send people to the setup that already exists, rather than repeating it. */
  onSetUpSpotify: () => void;
  onSetUpStation: () => void;
}

/**
 * Preferences.
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
}: SettingsPanelProps) {
  const t = useT();
  const theme = useSettingsStore((s) => s.theme ?? DEFAULT_THEME);
  const language = useSettingsStore((s) => s.language ?? 'en');
  const reduceMotion = useSettingsStore((s) => s.reduceMotion);
  const alwaysOnTop = useSettingsStore((s) => s.alwaysOnTop);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const setReduceMotion = useSettingsStore((s) => s.setReduceMotion);
  const setAlwaysOnTop = useSettingsStore((s) => s.setAlwaysOnTop);

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
    let current = true;
    void Promise.all([hasClientId(), hasApiKey()]).then(([spotify, station]) => {
      if (!current) return;
      setSpotifyReady(spotify);
      setStationReady(station);
    });
    return () => {
      current = false;
    };
  }, [open]);

  return (
    <div
      id={id}
      inert={!open}
      className={`absolute inset-0 z-20 groove-surface flex flex-col rounded-t-lg backdrop-blur-sm transition-all duration-200 ease-out ${
        open ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
      }`}
    >
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <span className="text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
          {t('panel.settings')}
        </span>
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

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
        <Section title={t('settings.appearance')}>
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-body text-cream-200">{t('settings.theme')}</span>
              <span className="truncate text-meta text-cream-400">
                {THEMES.find((entry) => entry.id === theme)?.name}
              </span>
            </div>
            <div className="flex gap-1.5">
              {THEMES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  // The palette's name, not a translation of it: these are
                  // proper names, and Verdigris is Verdigris in any language.
                  aria-label={entry.name}
                  title={entry.name}
                  aria-pressed={entry.id === theme}
                  onClick={() => setTheme(entry.id)}
                  className={`h-7 flex-1 overflow-hidden rounded-md ring-1 transition-all ${
                    entry.id === theme
                      ? 'ring-2 ring-brass-400'
                      : 'ring-shell-600 hover:ring-cream-400/50'
                  }`}
                >
                  <span className="flex h-full w-full">
                    <span className="h-full w-2/3" style={{ background: entry.swatch[0] }} />
                    <span className="h-full w-1/3" style={{ background: entry.swatch[1] }} />
                  </span>
                </button>
              ))}
            </div>
          </div>

          <Toggle
            label={t('settings.reduceMotion')}
            hint={t('settings.reduceMotionHint')}
            on={reduceMotion}
            onChange={setReduceMotion}
          />

          {/* Outside Tauri there is no window to pin. */}
          {isTauri() && (
            <Toggle
              label={t('settings.alwaysOnTop')}
              hint={t('settings.alwaysOnTopHint')}
              on={alwaysOnTop}
              onChange={setAlwaysOnTop}
            />
          )}
        </Section>

        <Section title={t('settings.language')}>
          <div className="flex gap-1.5">
            {/* Each language names itself. Someone who has landed in a language
                they cannot read needs to recognise their own, not read this
                one's word for it. */}
            <Choice active={language === 'en'} onClick={() => setLanguage('en')}>
              English
            </Choice>
            <Choice active={language === 'tr'} onClick={() => setLanguage('tr')}>
              Türkçe
            </Choice>
          </div>
        </Section>

        {isTauri() && (
          <Section title={t('settings.connections')}>
            <Connection
              name={t('panel.spotify')}
              hint={t('settings.spotifyHint')}
              ready={spotifyReady}
              onSetUp={onSetUpSpotify}
              onForget={async () => {
                await clearClientId();
                await refresh();
              }}
            />
            <Connection
              name="Last.fm"
              hint={t('settings.lastfmHint')}
              ready={stationReady}
              onSetUp={onSetUpStation}
              onForget={async () => {
                await clearApiKey();
                await refresh();
              }}
            />
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-label font-medium tracking-[0.16em] text-cream-400 uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Toggle({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-shell-700/60"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-body text-cream-200">{label}</span>
        <span className="block text-meta leading-snug text-cream-400">{hint}</span>
      </span>
      <span
        aria-hidden="true"
        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
          on ? 'bg-brass-600' : 'bg-shell-600'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-cream-50 transition-all ${
            on ? 'left-3.5' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex-1 rounded-full px-2 py-1 text-meta font-medium tracking-wide transition-colors ${
        active
          ? 'bg-brass-600 text-shell-900'
          : 'bg-shell-700 text-cream-200 hover:bg-shell-600 hover:text-cream-50'
      }`}
    >
      {children}
    </button>
  );
}

function Connection({
  name,
  hint,
  ready,
  onSetUp,
  onForget,
}: {
  name: string;
  hint: string;
  ready: boolean;
  onSetUp: () => void;
  onForget: () => Promise<void>;
}) {
  const t = useT();

  return (
    <div className="flex items-center gap-2 rounded-md px-1 py-1">
      <span className="min-w-0 flex-1">
        <span className="block text-body text-cream-200">{name}</span>
        <span className="block text-meta leading-snug text-cream-400">{hint}</span>
      </span>
      <span
        className={`shrink-0 text-meta ${ready ? 'text-brass-400' : 'text-cream-400/70'}`}
      >
        {ready ? t('settings.configured') : t('settings.notConfigured')}
      </span>
      <button
        type="button"
        onClick={() => (ready ? void onForget() : onSetUp())}
        className="shrink-0 rounded-full bg-shell-700 px-2 py-1 text-meta tracking-wide text-cream-200 uppercase transition-colors hover:bg-shell-600 hover:text-cream-50"
      >
        {ready ? t('settings.forget') : t('settings.setUp')}
      </button>
    </div>
  );
}
