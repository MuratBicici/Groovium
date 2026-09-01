import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/core/i18n';
import { useSettingsStore } from '@/core/settings/store';
import { CUSTOM_DEFAULTS, CUSTOM_THEME, DEFAULT_THEME, THEMES } from '@/core/settings/themes';
import { clearApiKey, hasApiKey } from '@/core/station/lastfm';
import { clearClientId, hasClientId } from '@/core/security/spotifyAuth';
import { derivePalette } from '@/core/utils/contrast';
import { isTauri } from '@/core/utils/env';
import { useUpdateStore } from '@/core/updates/store';
import { APP_VERSION } from '@/core/version';

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
  onPickColour,
}: SettingsPanelProps) {
  const t = useT();
  const theme = useSettingsStore((s) => s.theme ?? DEFAULT_THEME);
  const language = useSettingsStore((s) => s.language ?? 'en');
  const reduceMotion = useSettingsStore((s) => s.reduceMotion);
  const alwaysOnTop = useSettingsStore((s) => s.alwaysOnTop);
  const boostContrast = useSettingsStore((s) => s.boostContrast);
  const windowBorder = useSettingsStore((s) => s.windowBorder);
  const setBoostContrast = useSettingsStore((s) => s.setBoostContrast);
  const setWindowBorder = useSettingsStore((s) => s.setWindowBorder);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const customPrimary = useSettingsStore((s) => s.customPrimary ?? CUSTOM_DEFAULTS.primary);
  const customSecondary = useSettingsStore((s) => s.customSecondary ?? CUSTOM_DEFAULTS.secondary);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const setReduceMotion = useSettingsStore((s) => s.setReduceMotion);
  const setAlwaysOnTop = useSettingsStore((s) => s.setAlwaysOnTop);

  // Measured from the two chosen colours rather than assumed from either. The
  // derivation makes everything else read against the surface; the accent is
  // the one colour it will not move, so it is the one that can still fail.
  const accentUnreadable =
    derivePalette(customPrimary, customSecondary, boostContrast)?.accentUnreadable ?? false;

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
                {theme === CUSTOM_THEME
                  ? t('settings.custom')
                  : THEMES.find((entry) => entry.id === theme)?.name}
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
                      : 'ring-[var(--color-edge)] hover:ring-cream-400/50'
                  }`}
                >
                  <span className="flex h-full w-full">
                    <span className="h-full w-2/3" style={{ background: entry.swatch[0] }} />
                    <span className="h-full w-1/3" style={{ background: entry.swatch[1] }} />
                  </span>
                </button>
              ))}

              {/* Last, and drawn from what was picked rather than from a
                  fixed pair — it is the only swatch whose colours are an
                  answer rather than a definition. */}
              <button
                type="button"
                aria-label={t('settings.custom')}
                title={t('settings.custom')}
                aria-pressed={theme === CUSTOM_THEME}
                onClick={() => setTheme(CUSTOM_THEME)}
                className={`h-7 flex-1 overflow-hidden rounded-md ring-1 transition-all ${
                  theme === CUSTOM_THEME
                    ? 'ring-2 ring-brass-400'
                    : 'ring-[var(--color-edge)] hover:ring-cream-400/50'
                }`}
              >
                <span className="flex h-full w-full">
                  <span className="h-full w-2/3" style={{ background: customPrimary }} />
                  <span className="h-full w-1/3" style={{ background: customSecondary }} />
                </span>
              </button>
            </div>

            {theme === CUSTOM_THEME && (
              <div className="space-y-1.5 rounded-md bg-shell-900/50 p-2">
                <div className="flex gap-2">
                  <Colour
                    label={t('settings.customPrimary')}
                    value={customPrimary}
                    onClick={() => onPickColour('primary')}
                  />
                  <Colour
                    label={t('settings.customSecondary')}
                    value={customSecondary}
                    onClick={() => onPickColour('secondary')}
                  />
                </div>
                {/* Only when it is true. The ramp is measured now, so the
                    one thing left that cannot be fixed for somebody is an
                    accent that does not read against their own surface —
                    fixing that would mean overruling a colour they chose. */}
                {accentUnreadable ? (
                  <p className="text-meta leading-snug text-amber-300/90">
                    {t('settings.accentWarning')}
                  </p>
                ) : (
                  <p className="text-meta leading-snug text-cream-400">
                    {t('settings.customHint')}
                  </p>
                )}
              </div>
            )}
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

          <Toggle
            label={t('settings.boostContrast')}
            hint={t('settings.boostContrastHint')}
            on={boostContrast}
            onChange={setBoostContrast}
          />

          <Toggle
            label={t('settings.windowBorder')}
            hint={t('settings.windowBorderHint')}
            on={windowBorder}
            onChange={setWindowBorder}
          />
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

        <Section title={t('settings.about')}>
          <Updates />
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

/**
 * One colour of a hand-rolled palette: a swatch that opens the picker.
 *
 * This was a native `<input type="color">`, on the argument that the platform
 * already has a picker and it is the one people know. True, and still the
 * wrong call here — the one Windows opens is a system dialog wearing system
 * colours, and it arrived in the middle of a widget built to look like a
 * physical object. `ColourPicker` is the replacement.
 */
function Colour({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-brass-400"
    >
      <span
        aria-hidden="true"
        className="h-6 w-8 shrink-0 rounded ring-1 ring-[var(--color-edge)]"
        style={{ background: value }}
      />
      <span className="min-w-0 truncate text-meta text-cream-200">{label}</span>
    </button>
  );
}

/**
 * The version, and whether there is a newer one.
 *
 * The check itself already ran, quietly, at startup — this is where its answer
 * is, and the only place a failure is ever shown. A launch with no network is
 * not a failure anybody asked about; a button somebody pressed is.
 */
function Updates() {
  const t = useT();
  const status = useUpdateStore((s) => s.status);
  const version = useUpdateStore((s) => s.version);
  const notes = useUpdateStore((s) => s.notes);
  const progress = useUpdateStore((s) => s.progress);
  const error = useUpdateStore((s) => s.error);
  const checkNow = useUpdateStore((s) => s.checkNow);
  const download = useUpdateStore((s) => s.download);
  const restartNow = useUpdateStore((s) => s.restartNow);

  return (
    <div className="space-y-1.5">
      <p className="text-body text-cream-200">{t('settings.version', { version: APP_VERSION })}</p>

      {status === 'idle' && (
        <button
          type="button"
          onClick={() => void checkNow()}
          className="text-meta text-cream-400 underline-offset-2 transition-colors hover:text-brass-400 hover:underline"
        >
          {t('update.check')}
        </button>
      )}

      {status === 'checking' && <p className="text-meta text-cream-400">{t('update.checking')}</p>}

      {status === 'available' && version && (
        <div className="space-y-1.5 rounded-md bg-shell-900/50 p-2">
          <p className="text-meta text-cream-200">{t('update.available', { version })}</p>
          {/* Whatever the release said, kept as written and left to scroll:
              notes are the author's words, and truncating them is deciding
              which half of a warning somebody gets. */}
          {notes && (
            <p className="max-h-40 overflow-y-auto text-meta leading-snug whitespace-pre-line text-cream-400">
              {notes}
            </p>
          )}
          <button
            type="button"
            onClick={() => void download()}
            className="rounded-full bg-brass-600 px-3 py-1 text-meta font-medium tracking-wide text-on-accent uppercase transition-colors hover:bg-brass-500"
          >
            {t('update.download')}
          </button>
        </div>
      )}

      {status === 'downloading' && (
        <div className="space-y-1">
          <p className="text-meta text-cream-400">
            {progress === null
              ? t('update.downloadingUnknown')
              : t('update.downloading', { percent: Math.round(progress * 100) })}
          </p>
          {progress !== null && (
            <div className="groove-inset h-1 w-full overflow-hidden rounded-full">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brass-600 to-brass-400 transition-[width] duration-150"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {status === 'ready' && (
        <div className="space-y-1.5 rounded-md bg-shell-900/50 p-2">
          <p className="text-meta leading-snug text-cream-200">{t('update.ready')}</p>
          <button
            type="button"
            onClick={() => void restartNow()}
            className="rounded-full bg-brass-600 px-3 py-1 text-meta font-medium tracking-wide text-on-accent uppercase transition-colors hover:bg-brass-500"
          >
            {t('update.restart')}
          </button>
        </div>
      )}

      {status === 'error' && (
        <div className="space-y-1.5">
          <p className="rounded bg-red-950/70 px-2 py-1.5 text-meta leading-snug text-red-200">
            {t('update.failed', { message: error ?? '' })}
          </p>
          <button
            type="button"
            onClick={() => void checkNow()}
            className="text-meta text-cream-400 underline-offset-2 transition-colors hover:text-brass-400 hover:underline"
          >
            {t('update.tryAgain')}
          </button>
        </div>
      )}
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
          ? 'bg-brass-600 text-on-accent'
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
