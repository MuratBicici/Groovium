import { useT } from '@/core/i18n';
import { openLogFolder, reportProblem } from '@/platform/report';
import { useUpdateStore } from '@/core/updates/store';
import { isTauri } from '@/core/utils/env';
import { APP_VERSION, AUTHOR } from '@/core/version';
import { ERRAND, Group, NotesIcon, RefreshIcon } from '../parts';

/**
 * What Groovium is: its version and whether there is a newer one, what changed
 * in it, where to go when something goes wrong, and who made it. Last in the
 * list, because it is the least often wanted — everything above is something to
 * change; this is something to look up.
 */
export function AboutPage({ onShowWhatsNew }: { onShowWhatsNew?: (() => void) | undefined }) {
  const t = useT();

  return (
    <>
      <Group>
        <div className="space-y-1.5 px-1 py-1">
          <Updates />
          {/* Its own row rather than a third thing on the version line: two
              pills and a version do not fit across 340px, and the one that
              would have been squeezed is the one somebody is looking for. */}
          {onShowWhatsNew && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onShowWhatsNew}
                // The outlined pill, matching Check for updates. Both are
                // errands beside the filled brass of Download and Restart.
                className={ERRAND}
              >
                <NotesIcon />
                {t('whatsNew.title')}
              </button>
            </div>
          )}
        </div>
      </Group>

      {/* For when something went wrong. The log is the most useful thing
          anybody can send, and it is buried in AppData; this is the way to it
          and to somewhere to send it. Nothing is sent by either button. */}
      {isTauri() && (
        <Group title={t('report.title')}>
          <div className="space-y-2 px-1 py-1">
            <p className="text-meta leading-snug text-cream-400">{t('report.hint')}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => void openLogFolder()} className={ERRAND}>
                {t('report.openLog')}
              </button>
              <button type="button" onClick={() => void reportProblem()} className={ERRAND}>
                {t('report.open')}
              </button>
            </div>
          </div>
        </Group>
      )}

      {/* Last line in the panel, and quiet on purpose: a name belongs in the
          app, but not competing with anything somebody came here to do. */}
      <p className="pt-1 text-center text-meta leading-snug text-cream-400">
        {t('settings.credit', { author: AUTHOR })}
      </p>
    </>
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
  const progress = useUpdateStore((s) => s.progress);
  const error = useUpdateStore((s) => s.error);
  const checkNow = useUpdateStore((s) => s.checkNow);
  const download = useUpdateStore((s) => s.download);
  const restartNow = useUpdateStore((s) => s.restartNow);

  const looking = status === 'checking';
  /** Nothing is on offer, so the row is just a version and a way to ask. */
  const resting = status === 'idle' || status === 'checking' || status === 'current';

  return (
    <div className="space-y-1.5">
      {/* One row rather than two stacked fragments: the version and the way to
          check it are the same thought, and reading them as separate lines is
          what made this corner look unfinished. */}
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-body text-cream-200">
          {t('settings.version', { version: APP_VERSION })}
        </p>

        {resting && (
          <div className="flex shrink-0 items-center gap-2">
            {/* Beside the button rather than under the row. It is the answer to
                pressing that button, and an answer belongs next to the thing it
                answers — on its own line it read as a separate announcement. */}
            {status === 'current' && (
              <span className="text-meta text-cream-400">{t('update.upToDate')}</span>
            )}
            <button
              type="button"
              onClick={() => void checkNow()}
              disabled={looking}
              // Outlined rather than filled, on purpose. Download and Restart are
              // the filled brass pills because they are the actions that matter;
              // this one is an errand. `--color-edge` rather than a shell shade
              // so the outline survives a very dark palette.
              className={ERRAND}
            >
              <RefreshIcon spinning={looking} />
              {looking ? t('update.checking') : t('update.check')}
            </button>
          </div>
        )}
      </div>

      {status === 'available' && version && (
        <div className="space-y-1.5 rounded-md bg-shell-800/70 p-2">
          <p className="text-meta text-cream-200">{t('update.available', { version })}</p>
          {/* The version and a way to get it, and nothing else. Every word of
              the release used to sit here in a little scrolling box, which is
              the wrong shape for it twice over: this corner of Settings is a
              status line, and nobody reads four hundred lines of changelog
              through a slot four lines tall. What the release said is told
              properly, once, by `WhatsNew` after it is installed. */}
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
        <div className="space-y-1.5 rounded-md bg-shell-800/70 p-2">
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
            className={`${ERRAND} self-start`}
          >
            <RefreshIcon spinning={false} />
            {t('update.tryAgain')}
          </button>
        </div>
      )}
    </div>
  );
}
