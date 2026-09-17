# Privacy

Groovium has no servers, no accounts of its own, no analytics and no telemetry.
Nothing about you or how you use it is sent to the people who make it.

It does talk to three outside services. One of them it contacts on its own; the
other two only once you have set them up yourself. This page says which, when,
and what goes to each.

## What it contacts

### GitHub — automatically, to check for updates

At launch, and then at most once every six hours while it is running, Groovium
fetches a small file from this repository's releases on `github.com` to see
whether a newer version exists. If one does and you choose to install it, the
installer is downloaded from the same place.

Nothing is sent with that request beyond what any web request carries — your IP
address and a user agent. Groovium does not add anything to it. GitHub's own
[privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)
covers what GitHub does with requests it receives.

This is the only network request Groovium makes without you having set
something up first. There is currently no setting to turn it off.

### Spotify — only after you connect an account

Nothing goes to Spotify until you enter a Client ID and sign in. After that,
Groovium talks to `accounts.spotify.com` to sign you in and keep the session
alive, to `api.spotify.com` for searching, playing, your playlists and what you
have recently played or have on repeat, and loads Spotify's Web Playback SDK
and cover art from Spotify's own servers. What Spotify does with that is covered
by [Spotify's privacy policy](https://www.spotify.com/legal/privacy-policy/).

Signing out stops all of it.

### Last.fm — only after you enter an API key

Infinite play is off until you give it a Last.fm API key. Once it is on, the
artist and title of tracks you play are sent to `ws.audioscrobbler.com` to find
similar songs. Nothing is scrobbled and no Last.fm account is involved. See
[Last.fm's privacy policy](https://www.last.fm/legal/privacy).

## What stays on your computer

- **Your music files.** Local tracks are copied into Groovium's library folder
  and played from there. They are never uploaded anywhere.
- **Settings, playlists, the library index, the last session and the window's
  position**, in `%APPDATA%\com.groovium.desktop`. The Spotify Client ID and the
  Last.fm API key you entered are kept here too.
- **Spotify's sign-in tokens**, in Windows Credential Manager rather than in a
  file.
- **A copy of your Spotify playlists**, in
  `%LOCALAPPDATA%\com.groovium.desktop\spotify-cache.json`: the list of
  playlists you made, and the songs in the last twelve you opened or played,
  so the drawer opens without waiting and a playlist is not read again when it
  has not changed. It is checked against Spotify whenever it is used. Signing
  out of Spotify deletes it.
- **A log file**, in `%LOCALAPPDATA%\com.groovium.desktop\logs`, recording what
  went wrong so a fault can be looked into afterwards. It never leaves your
  computer unless you send it to someone. Tokens, keys, the Client ID and what
  you searched for are removed from it before it is written.

Uninstalling removes the app. Tick "Delete the application data" in the
uninstaller to remove both folders above as well. Spotify's sign-in tokens are
not in either folder and the uninstaller leaves them, so sign out of Spotify in
Groovium before uninstalling — signing out deletes them from Credential
Manager.

## Questions

Open an [issue](https://github.com/MuratBicici/Groovium/issues).
