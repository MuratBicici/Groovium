/**
 * Every string the interface shows, in English.
 *
 * The source of truth in both senses: it holds the text, and its type defines
 * what counts as a key. Adding a string here and forgetting `tr.ts` is caught
 * by the test rather than by someone finding English in a Turkish window.
 *
 * Keys read `area.thing`. Not deeply nested — a flat map keeps the lookup a
 * lookup, keeps `keyof` honest, and means the plural convention below is just
 * a suffix rather than a shape.
 */
export const en = {
  // Window chrome
  'chrome.pin': 'Keep on top',
  'chrome.unpin': 'Unpin from top',
  'chrome.minimize': 'Minimize',
  'chrome.hide': 'Hide to tray',
  'chrome.collapse': 'Show controls only',
  'chrome.expand': 'Show the whole player',

  // Shared verbs. Worth sharing precisely because they are single words: the
  // same button reading "Save" in one panel and "Store" in another is how an
  // interface starts sounding like several people wrote it.
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.saving': 'Saving',
  'common.create': 'Create',
  'common.delete': 'Delete',
  'common.back': 'Back',
  'common.remove': 'Remove',
  'common.dismiss': 'Dismiss',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.keep': 'Keep',
  'common.on': 'on',
  'common.off': 'off',

  // Panels
  'panel.open': 'Open {name} panel',
  'panel.close': 'Close {name} panel',
  'panel.library': 'Library',
  'panel.playlists': 'Playlists',
  'panel.spotify': 'Spotify',
  'panel.settings': 'Settings',

  // Transport
  'transport.shuffle': 'Shuffle',
  'transport.previous': 'Previous',
  'transport.next': 'Next',
  'transport.play': 'Play',
  'transport.pause': 'Pause',
  'transport.repeat': 'Repeat: {mode}',
  'transport.station': 'Infinite play: {state}',
  'transport.seek': 'Seek',
  'transport.volume': 'Volume',
  'transport.mute': 'Mute',
  'transport.unmute': 'Unmute',
  'repeat.off': 'off',
  'repeat.one': 'one',
  'repeat.all': 'all',

  // What is playing
  // The record on the deck can be picked up and thrown away. The label says
  // what a press does, since a press is all a keyboard can offer.
  'deck.takeOff': 'Take the record off the deck',

  'status.IDLE': 'Ready',
  'status.LOADING': 'Loading',
  'status.PLAYING': 'Now Playing',
  'status.PAUSED': 'Paused',
  'status.ERROR': 'Error',
  'track.none': 'Nothing playing yet',
  'track.hint': 'Open a song to get started',

  // Library
  'library.heading': 'Library · {count}',
  'library.close': 'Close library',
  'library.addFiles': 'Add Files',
  'library.addFolder': 'Add Folder',
  'library.empty':
    'Nothing here yet. Add some music to get started — songs are copied in, so they keep playing even if you move or delete the original.',
  'library.confirmImport': 'Copy {count} file ({size}) into your library?',
  'library.confirmImport_plural': 'Copy {count} files ({size}) into your library?',
  'library.duplicates': '{count} already added.',
  'library.removeNamed': 'Remove {title} from library',
  'library.removeTitle': 'Remove from library',
  'library.confirmRemove':
    'Delete this song from your library? The copy this app keeps is removed for good.',
  'library.importing': 'Adding {done} of {total}',
  'library.cancelImport': 'Cancel import',

  // Playlists
  'playlists.close': 'Close playlists',
  'playlists.emptyPlaylist': 'Nothing here yet. Add songs from your library or from Spotify.',
  'playlists.none': 'No playlists yet. Make one to keep songs together.',
  'playlists.newPlaceholder': 'New playlist',
  'playlists.unavailable': 'Unavailable',
  'playlists.removedFromLibrary': 'Removed from library',
  'playlists.removeItem': 'Remove from playlist',
  'playlists.deleteNamed': 'Delete {name}',
  'playlists.deleteTitle': 'Delete playlist',
  'playlists.add': 'Add to playlist',
  'playlists.addNamed': 'Add {title} to a playlist',
  'playlists.pickerNone': 'No playlists yet — name one below.',
  'playlists.added': 'Added',

  // Spotify
  'spotify.heading': 'Spotify · {name}',
  'spotify.signOut': 'Sign out',
  'spotify.close': 'Close Spotify panel',
  'spotify.checking': 'Checking your Spotify setup…',
  'spotify.waiting': 'Waiting for authorisation in your browser…',
  'spotify.waitingHint': 'Approve the request, then come back here.',
  'spotify.savedId': 'Your Client ID is saved. Connect your Spotify account to start playing.',
  'spotify.connect': 'Connect Spotify Account',
  'spotify.changeId': 'Use a different Client ID',
  'spotify.searchPlaceholder': 'Search Spotify for a song',
  'spotify.searching': 'Searching…',
  'spotify.nothingFound': 'Nothing found.',
  'spotify.typeToFind': 'Type to find a song.',

  // Spotify setup
  'setup.optionalLead': 'Spotify is optional.',
  'setup.optionalRest':
    'Your own music plays without any of this — set it up only if you want to search Spotify from here.',
  'setup.oneTime':
    'Spotify requires every installation to register its own app. This is a one-time setup.',
  'setup.step1': 'Create an app',
  'setup.step1Body': 'Any name and description will do.',
  'setup.openDashboard': 'Open Spotify Dashboard ↗',
  'setup.step2': 'Add this redirect URI',
  'setup.step2Body': 'It must match exactly, with no trailing slash.',
  'setup.step3': 'Add yourself as a user',
  'setup.step3Body':
    'Open the app’s User Management tab and add your own Spotify account. Without this, Spotify will refuse the sign-in.',
  'setup.step4': 'Paste your Client ID',
  'setup.idPlaceholder': '32-character Client ID',
  'setup.premium': 'Spotify Premium is required for playback.',
  'setup.clipboardFailed':
    'Could not reach the clipboard. Select the address and copy it manually.',

  // Infinite play setup
  'station.heading': 'Infinite play',
  'station.dialog': 'Set up infinite play',
  'station.intro':
    'Keeps the music going once a playlist ends, by finding a track similar to the one playing. Suggestions come from Last.fm and need a free API key.',
  'station.optional': 'Entirely optional — everything else works without it.',
  'station.step1': 'Create an API account',
  'station.formIntro': 'The form has four fields. Only the first two matter:',
  'station.fieldName': 'Application name',
  'station.fieldNameValue': 'anything — “Groovium” will do',
  'station.fieldDescription': 'Application description',
  'station.fieldDescriptionValue': 'anything',
  'station.fieldHomepage': 'Application homepage',
  'station.fieldCallback': 'Callback URL',
  'station.fieldBlank': 'leave blank',
  'station.callbackNote':
    'The last two belong to Last.fm’s sign-in flow. Groovium never signs you in — it only asks which tracks are similar, and that needs the key alone.',
  'station.openLastfm': 'Open Last.fm ↗',
  'station.step2': 'Paste it here',
  'station.keyPlaceholder': '32-character API key',
  'station.footnote':
    'The key appears straight away — nothing to approve, no account to link. Tracks already in your library are preferred, so the station usually costs nothing to keep running.',

  // Settings
  'settings.close': 'Close settings',
  'settings.appearance': 'Appearance',
  'settings.theme': 'Theme',
  'settings.custom': 'Custom',
  'settings.customPrimary': 'Surface',
  'settings.customSecondary': 'Accent',
  'settings.customWarning':
    'Contrast ratios cannot be guaranteed for custom color combinations. All preset palettes are calibrated for optimal legibility.',
  'settings.language': 'Language',
  'settings.behaviour': 'Behaviour',
  'settings.reduceMotion': 'Reduce motion',
  'settings.reduceMotionHint': 'Stops the record spinning and the disc flying in.',
  'settings.alwaysOnTop': 'Keep window on top',
  'settings.alwaysOnTopHint': 'Stays above other windows, and is remembered.',
  'settings.connections': 'Connections',
  'settings.configured': 'Set up',
  'settings.notConfigured': 'Not set up',
  'settings.setUp': 'Set up',
  'settings.forget': 'Forget',
  'settings.spotifyHint': 'Search and play from Spotify.',
  'settings.lastfmHint': 'Finds the next song for infinite play.',

  // Tray menu. Held here rather than in Rust so one dictionary covers the whole
  // app; Rust is handed the finished strings.
  'tray.show': 'Show Groovium',
  'tray.previous': 'Previous',
  'tray.playPause': 'Play / Pause',
  'tray.next': 'Next',
  'tray.quit': 'Quit Groovium',

  // Errors the store raises
  'error.settingsNotSaved':
    'Settings are not being saved — volume and repeat will reset on restart.',
  'error.spotifyDisconnected':
    'Playback stopped because the Spotify connection ended. Connect your account to keep listening.',
  'error.notPlayable': 'That track cannot be saved to a playlist.',
  'error.startup': 'Could not start up: {message}',
  'error.providerUnavailable': '{provider} is unavailable.',
};
