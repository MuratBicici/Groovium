# Changelog

Newest first. Each section is the text shown in the app when it offers that
version, so it is written to be read there: plain prose, no markup, and the
point of the release before the detail of it.

## 1.0.2 — 2026-08-26

Two faults people actually ran into. When the network dropped, Spotify kept
the record turning and the progress bar filling while nothing was coming out
of the speakers, and the position snapped backwards when the connection
returned; the outage is now noticed within about two seconds and the music
stops with the picture rather than several seconds after it. And infinite play
answered the same song with the same song every time, and stopped dead on any
track Last.fm had never heard of; it now picks at random with similarity as a
weight, and asks three different sources before it gives up.

HIGHLIGHTS
· A dropped connection stops the music instead of pretending it is still
  playing, and playback carries on from the right place when the network comes
  back.
· Infinite play no longer repeats itself. The same song leads somewhere
  different each time it plays.
· Infinite play no longer stops on a track Last.fm does not know. It asks
  about the artist, and then about the genre, before falling quiet.

ALL CHANGES
· Spotify: a network outage is noticed while there is still sound in the
  buffer, rather than after it has run out, so the app says it is waiting
  before the silence rather than after it.
· Spotify: the music is paused when the outage is noticed, so the picture and
  the sound stop together.
· Spotify: the record stops turning and the progress bar stops filling during
  an outage, instead of running on and jumping backwards on recovery.
· Spotify: when the connection returns, the track restarts from the position
  it froze at. It no longer needs a manual skip forwards and back to become
  playable again.
· Spotify: a dropped connection is no longer read as the song having ended, so
  the app does not skip to the next track and stop.
· Spotify: a playback error during an outage is treated as the outage, not as
  a fault worth interrupting the listener over.
· Spotify: whether audio is really playing is now settled by asking Spotify.
  Both of the local clocks keep counting through an outage, so neither could
  ever have answered it.
· Infinite play: suggestions are drawn at random with similarity as a weight,
  rather than taken in similarity order. This is what stops one song always
  leading to the same next song.
· Infinite play: the pool of candidates asked for was doubled, which the old
  ordering made pointless and the new one makes useful.
· Infinite play: the next suggestion is based on the last few tracks of the
  run rather than only the one that just finished, so a single unknown track
  can no longer end it.
· Infinite play: choosing a song by hand starts a new run, so a suggestion is
  never based on what was playing before that choice.
· Infinite play: when Last.fm does not know a track, it is asked about the
  artist instead — and when it knows neither, Spotify is asked which artists
  share the genre.
· Infinite play: one source failing no longer costs the whole answer, and the
  warning now names which source it was.
· Updates: the release notes for a version are shown in the app when it offers
  that version, and there is more room to read them.
· Documentation: what the live update test proved, that the updater needs the
  repository to be public, and which manual checks have been done.
