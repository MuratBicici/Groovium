# Privacy

Groovium has no servers, no accounts of its own, no analytics and no telemetry.
Nothing about you or how you use it is sent to the people who make it.

It does talk to a few outside services. One of them it contacts on its own; the
others only once you have set them up or turned them on yourself. This page
says which, when, and what goes to each.

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

### LRCLIB and NetEase — only while lyrics are on

Lyrics are off until you press the lyrics button. While they are on, the title,
artist, album and length of the Spotify song that is playing are sent to
`lrclib.net`, an open lyrics database, to find its lyrics. If LRCLIB has no
timed lyrics for it, the title (with things like "Remastered" or "feat." taken off) and the first
artist are also sent to `music.163.com`, NetEase Cloud Music, a music service
based in China. Groovium uses the same address NetEase's own web player uses; it
is not a published API. See [LRCLIB](https://lrclib.net) and
[NetEase Cloud Music](https://music.163.com).

If you switch a song to the other source ("Get them from … instead"), only that
source is asked for it from then on — NetEase too, even when LRCLIB has timed
lyrics. Which source you chose for which song is kept in the app's own browser
storage on your computer.

Nothing is sent while lyrics are off. The lyrics found are kept in memory while
the app is open and are not written anywhere.

If you move a song's lyrics to fit it ("Timing"), where you put them is kept on
your computer: for a Spotify song in `lyrics-timing.json` in
`%APPDATA%\com.groovium.desktop`, for a song on this computer in the file its
lyrics are saved in. It is not sent anywhere. Settings › General can export the
Spotify songs' timings to a file you choose and import them from one, to carry
them to another computer. To draw the shape of a song on this computer behind
the lines, Groovium reads its own copy of the file; that stays on your computer
too.

**Matching lyrics by hand.** A song on this computer is never looked up on its
own: it has no lyrics until you search for them yourself and choose some.
Whatever you type in that search is sent to `lrclib.net` and `music.163.com`,
and so are requests for the lyrics of the results NetEase lists, to show which
have timings. The lyrics you choose are saved on your
computer, in the library folder beside the song, and deleted when you clear the
match or remove the song. Groovium does not check them and does not guarantee
that they are correct.

## What stays on your computer

- **Your music files.** Local tracks are copied into Groovium's library folder
  and played from there — or, if you add them without copying, played from
  where they are, with their place on your disk written in the library index.
  Either way they are never uploaded anywhere. A song added without copying
  keeps its cover and any lyrics you matched in the library folder; removing
  it from Groovium removes those and leaves the file itself alone.
- **Settings, playlists, the library index, the last session, the window's
  position and the Spotify songs' lyrics timings**, in
  `%APPDATA%\com.groovium.desktop`. The Spotify Client ID and the
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
