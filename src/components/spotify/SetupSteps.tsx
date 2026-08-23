import { useEffect, useState } from 'react';
import { openDashboard, redirectUri, setClientId } from '@/core/security/spotifyAuth';
import { describeAuthError } from '@/core/security/authErrors';
import { useT } from '@/core/i18n';

interface SetupStepsProps {
  /** Called once a Client ID has been accepted and stored. */
  onConfigured: () => void;
}

/**
 * One-time setup for a user who has never registered a Spotify app.
 *
 * This exists because Spotify makes it unavoidable. Extended Quota Mode — the
 * tier where one shared Client ID would serve everybody — is restricted to
 * organisations with 250k+ monthly users, so every installation has to register
 * its own app. That is a strange thing to ask of someone who just wanted to play
 * music, which is why the steps are in the app rather than buried in a README
 * nobody opens.
 *
 * The redirect URI comes from Rust and is copyable: typing it by hand is the
 * most common way this whole flow fails.
 */
export function SetupSteps({ onConfigured }: SetupStepsProps) {
  const t = useT();
  const [uri, setUri] = useState('');
  const [copied, setCopied] = useState(false);
  const [clientId, setClientIdInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void redirectUri().then(setUri);
  }, []);

  async function copyUri() {
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError(t('setup.clipboardFailed'));
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await setClientId(clientId.trim());
      onConfigured();
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 px-3 pb-3 text-body leading-relaxed text-cream-200">
      <p className="text-cream-400">
        <span className="text-cream-200">{t('setup.optionalLead')}</span> {t('setup.optionalRest')}
      </p>
      <p className="text-cream-400">{t('setup.oneTime')}</p>

      <Step number={1} title={t('setup.step1')}>
        <p className="text-cream-400">{t('setup.step1Body')}</p>
        <button
          type="button"
          onClick={() => void openDashboard()}
          className="mt-1 rounded-full bg-shell-700 px-2.5 py-1 text-meta tracking-wide text-cream-200 uppercase transition-colors hover:bg-shell-600 hover:text-cream-50"
        >
          {t('setup.openDashboard')}
        </button>
      </Step>

      <Step number={2} title={t('setup.step2')}>
        <p className="text-cream-400">{t('setup.step2Body')}</p>
        <div className="mt-1 flex items-center gap-1.5">
          <code className="min-w-0 flex-1 truncate groove-inset rounded px-2 py-1 text-meta text-brass-400 select-all">
            {uri || '…'}
          </code>
          <button
            type="button"
            onClick={() => void copyUri()}
            className="shrink-0 rounded-full bg-shell-700 px-2.5 py-1 text-meta tracking-wide text-cream-200 uppercase transition-colors hover:bg-shell-600 hover:text-cream-50"
          >
            {copied ? t('common.copied') : t('common.copy')}
          </button>
        </div>
      </Step>

      <Step number={3} title={t('setup.step3')}>
        <p className="text-cream-400">{t('setup.step3Body')}</p>
      </Step>

      <Step number={4} title={t('setup.step4')}>
        <div className="mt-1 flex items-center gap-1.5">
          <input
            type="text"
            value={clientId}
            spellCheck={false}
            autoComplete="off"
            placeholder={t('setup.idPlaceholder')}
            onChange={(e) => setClientIdInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && clientId.trim()) void save();
            }}
            className="min-w-0 flex-1 groove-inset rounded px-2 py-1 text-meta text-cream-50 outline-none ring-1 ring-shell-600 focus:ring-brass-500"
          />
          <button
            type="button"
            disabled={!clientId.trim() || saving}
            onClick={() => void save()}
            className="shrink-0 rounded-full bg-brass-600 px-2.5 py-1 text-meta font-medium tracking-wide text-shell-900 uppercase transition-colors hover:bg-brass-500 disabled:opacity-40"
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

      <p className="text-meta text-cream-400/70 italic">
        {t('setup.premium')}
      </p>
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
