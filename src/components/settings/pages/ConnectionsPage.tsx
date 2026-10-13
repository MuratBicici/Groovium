import { useT } from '@/core/i18n';
import { clearApiKey } from '@/core/station/lastfm';
import { usePlayerStore } from '@/core/store';
import { CardDivider, Connection, Group } from '../parts';

/**
 * The services Groovium can use, whether each is set up, and the way to the
 * setup that already exists for it — keys are never entered here.
 */
export function ConnectionsPage({
  spotifyReady,
  stationReady,
  onSetUpSpotify,
  onSetUpStation,
  refresh,
}: {
  spotifyReady: boolean;
  stationReady: boolean;
  onSetUpSpotify: () => void;
  onSetUpStation: () => void;
  /** Read both again, after one has been forgotten. */
  refresh: () => Promise<void>;
}) {
  const t = useT();

  return (
    <Group>
      <Connection
        name={t('panel.spotify')}
        hint={t('settings.spotifyHint')}
        ready={spotifyReady}
        onSetUp={onSetUpSpotify}
        onForget={async () => {
          // Signing out as well as forgetting the ID, so the tokens, a
          // Spotify track on the deck and the drawer all go with it.
          await usePlayerStore.getState().forgetSpotify();
          await refresh();
        }}
      />
      <CardDivider />
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
    </Group>
  );
}
