import { useEffect, useState } from 'react';
import { useSheet } from '@/core/utils/useSheet';
import { openAccountPage, setApiKey } from '@/core/station';
import { useT } from '@/core/i18n';

interface StationSetupProps {
  open: boolean;
  onClose: () => void;
  /** Called once a key has been accepted and stored. */
  onConfigured: () => void;
}

/**
 * One-time setup for infinite play.
 *
 * A third per-installation key is not something to inflict on someone lightly,
 * so this deliberately appears at the moment it becomes relevant — the first
 * time the station button is pressed — rather than as another panel sitting in
 * the row waiting to be discovered.
 *
 * It is far lighter than the Spotify setup: no redirect URI, no app to
 * register, no account to link. Last.fm hands out an API key immediately, and
 * it authorises quota rather than an account, which is why it lives in
 * `config.json` next to the Spotify Client ID rather than in the keyring.
 */
export function StationSetup({ open, onClose, onConfigured }: StationSetupProps) {
  const t = useT();
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { present, shown } = useSheet(open);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Same reasoning as the playlist picker: `stopPropagation` would not
        // stop the shell's own listener on `window`, only the immediate variant
        // does, and it has to run in the capture phase to get there first.
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!present) return null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await setApiKey(key.trim());
      onConfigured();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-5">
      <button
        type="button"
        aria-label={t('common.cancel')}
        onClick={onClose}
        className={`absolute inset-0 cursor-default bg-shell-900/70 backdrop-blur-[2px] transition-opacity duration-[180ms] ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div
        role="dialog"
        aria-label={t('station.dialog')}
        className={`relative flex max-h-full w-full flex-col groove-surface overflow-hidden rounded-lg ring-1 ring-[var(--color-edge)] transition-all duration-[180ms] ease-out ${
          shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-[0.97] opacity-0'
        }`}
      >
        <div className="shrink-0 px-3 pt-2.5 pb-1">
          <p className="text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
            {t('station.heading')}
          </p>
          <p className="mt-1 text-body leading-relaxed text-cream-200">{t('station.intro')}</p>
          <p className="mt-1 text-meta leading-relaxed text-cream-400">{t('station.optional')}</p>
        </div>

        {/* Scrolls rather than overflows. It fits at 340×480 as written, but a
            larger system font would push the Save button off the bottom of a
            window this small, and a sheet you cannot submit is worse than one
            you have to scroll. */}
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 pt-1.5 pb-3 text-body text-cream-200">
          <Step number={1} title={t('station.step1')}>
            <p className="text-cream-400">{t('station.formIntro')}</p>
            {/* The field names stay in English in every language: they are
                what Last.fm's own form says, and a translated label would
                send someone looking for a field that is not there. */}
            <dl className="mt-1 space-y-0.5 text-meta">
              <Field name={t('station.fieldName')}>{t('station.fieldNameValue')}</Field>
              <Field name={t('station.fieldDescription')}>
                {t('station.fieldDescriptionValue')}
              </Field>
              <Field name={t('station.fieldHomepage')}>{t('station.fieldBlank')}</Field>
              <Field name={t('station.fieldCallback')}>{t('station.fieldBlank')}</Field>
            </dl>
            <p className="mt-1 text-cream-400">{t('station.callbackNote')}</p>
            <button
              type="button"
              onClick={() => void openAccountPage()}
              className="mt-1 rounded-full bg-shell-700 px-2.5 py-1 text-meta tracking-wide text-cream-200 uppercase transition-colors hover:bg-shell-600 hover:text-cream-50"
            >
              {t('station.openLastfm')}
            </button>
          </Step>

          <Step number={2} title={t('station.step2')}>
            <div className="mt-1 flex items-center gap-1.5">
              <input
                type="text"
                value={key}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                placeholder={t('station.keyPlaceholder')}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && key.trim()) void save();
                }}
                className="min-w-0 flex-1 groove-inset rounded px-2 py-1 text-meta text-cream-50 outline-none ring-1 ring-[var(--color-edge)] focus:ring-brass-500"
              />
              <button
                type="button"
                disabled={!key.trim() || saving}
                onClick={() => void save()}
                className="shrink-0 rounded-full bg-brass-600 px-2.5 py-1 text-meta font-medium tracking-wide text-on-accent uppercase transition-colors hover:bg-brass-500 disabled:opacity-40"
              >
                {saving ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </Step>

          {error && (
            <p className="rounded bg-red-950/70 px-2 py-1.5 text-meta leading-snug text-red-200">
              {error}
            </p>
          )}

          <p className="text-meta leading-snug text-cream-400/70 italic">
            {t('station.footnote')}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * One field of Last.fm's form.
 *
 * Spelled out because the form asks for more than this app needs, and a blank
 * that is meant to stay blank looks like a mistake — the callback URL in
 * particular invites inventing an address, which then quietly does nothing.
 */
function Field({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-cream-200">{name}</dt>
      <dd className="min-w-0 flex-1 text-cream-400">{children}</dd>
    </div>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-shell-700 text-label font-semibold text-brass-400">
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-cream-50">{title}</p>
        {children}
      </div>
    </div>
  );
}
