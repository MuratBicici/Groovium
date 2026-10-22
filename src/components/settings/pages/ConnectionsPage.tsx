import { useEffect, useState } from 'react';
import { useT } from '@/core/i18n';
import { clearApiKey } from '@/core/station/lastfm';
import { usePlayerStore } from '@/core/store';
import { RemoveSheet, SheetPresence } from '@/components/spotify/CrateSheets';
import { CardDivider, Connection, Group } from '../parts';

type Service = 'spotify' | 'lastfm';

/**
 * The services Groovium can use, whether each is set up, and the way to the
 * setup that already exists for it — keys are never entered here.
 *
 * Forgetting one is asked first. It is a press away from the row's status and
 * undoes a setup that took finding a key on another site: the Spotify Client
 * ID, or the Last.fm API key. One press used to throw either away.
 */
export function ConnectionsPage({
  spotifyReady,
  stationReady,
  onSetUpSpotify,
  onSetUpStation,
  refresh,
  onAsking,
}: {
  spotifyReady: boolean;
  stationReady: boolean;
  onSetUpSpotify: () => void;
  onSetUpStation: () => void;
  /** Read both again, after one has been forgotten. */
  refresh: () => Promise<void>;
  /** A question is over the page, or has gone: Escape is its while it is there. */
  onAsking: (asking: boolean) => void;
}) {
  const t = useT();
  const [asking, setAsking] = useState<Service | null>(null);

  useEffect(() => onAsking(asking !== null), [asking, onAsking]);

  // Escape puts the question away, before the panel hears it as going back.
  useEffect(() => {
    if (!asking) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      setAsking(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [asking]);

  async function forget(service: Service) {
    setAsking(null);
    if (service === 'spotify') {
      // Signing out as well as forgetting the ID, so the tokens, a Spotify
      // track on the deck and the drawer all go with it.
      await usePlayerStore.getState().forgetSpotify();
    } else {
      await clearApiKey();
    }
    await refresh();
  }

  return (
    <>
      <Group>
        <Connection
          name={t('panel.spotify')}
          hint={t('settings.spotifyHint')}
          ready={spotifyReady}
          onSetUp={onSetUpSpotify}
          onForget={async () => setAsking('spotify')}
        />
        <CardDivider />
        <Connection
          name="Last.fm"
          hint={t('settings.lastfmHint')}
          ready={stationReady}
          onSetUp={onSetUpStation}
          onForget={async () => setAsking('lastfm')}
        />
      </Group>

      <SheetPresence show={asking !== null}>
        {asking && (
          <RemoveSheet
            label={t('settings.forget')}
            title={asking === 'spotify' ? t('settings.forgetSpotifyTitle') : t('settings.forgetLastfmTitle')}
            body={asking === 'spotify' ? t('settings.forgetSpotifyBody') : t('settings.forgetLastfmBody')}
            action={t('settings.forget')}
            onClose={() => setAsking(null)}
            onRemove={() => void forget(asking)}
          />
        )}
      </SheetPresence>
    </>
  );
}
