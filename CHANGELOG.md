# Changelog

Newest first. Each section is the text shown in the app when it offers that
version, so it is written to be read there: plain prose, no markup, and the
point of the release before the detail of it.

## 1.0.5 — 2026-09-03

A repair release, and most of it is about something that broke without anyone
being able to see it.

Spotify cleared out a large part of its Web API in February, and one of the
endpoints it removed was the one infinite play leaned on as its last resort:
what to suggest after a track Last.fm has never heard of. Spotify postponed the
change for registrations that already existed, so it kept working here while
quietly failing for anyone who set Groovium up after February. That gap is
closed, and the same step now works by searching instead.

The other half of that clean-up removed the field that said whether an account
was Premium, so the warning built on it started firing at everyone — including
the Premium accounts it was never meant for. It is gone. If a Spotify account
is connected, Groovium now assumes Premium and lets playback speak for itself.

The Spotify setup instructions were also short of a few things people needed,
including one answer on Spotify's own form that fails silently when it is
missed. And there are four fixes to how the window is drawn.

HIGHLIGHTS
· Infinite play's last resort works again for anyone who set Spotify up after
  February. It had been failing silently, and only for new installations.
· The "Premium required" warning no longer appears for people who have
  Premium. Connecting an account is now taken as proof of it.
· Setup now says which APIs to tick when creating the Spotify app. Missing the
  Web Playback SDK registers fine and then never plays anything.
· Setup says where to find the Client ID, and why every installation has to
  register an app of its own.
· The window's outline is no longer covered by whatever opens over it.
· Panels no longer cast a shadow into the gap above the controls.
· Lists fade out at the bottom edge while there is more to scroll, and stop
  fading once there is not.
· Buttons show a pointer again when the mouse is over them.

ALL CHANGES
· Infinite play: the genre tier's last step no longer calls
  `/artists/{id}/top-tracks`, which Spotify removed in February 2026 with no
  replacement. It searches for the artist's tracks instead, and checks the
  results against the artist's id — the search filter matches on name, and
  without the check a common name would return the wrong artist's music.
· Infinite play: nothing else in the tier changed. Finding the seed artist's
  genre and its other artists always went through search, which still works.
· Spotify: the subscription level is no longer read from the account profile.
  Spotify removed the field, so it arrived empty and the warning built on it
  showed to everyone.
· Spotify: setup explains that Premium is needed for the registration itself
  and not only for playback, and that the app stops working if the
  subscription lapses.
· Spotify: setup says to tick both Web API and Web Playback SDK on the
  creation form.
· Spotify: setup says the Client ID is on the new app's own page, next to a
  Client Secret that Groovium never asks for and never stores.
· Spotify: setup explains why each installation registers its own app rather
  than sharing one.
· Window: the outline is drawn above everything else. Opening a panel used to
  cover it down both sides, and a dialog covered all four.
· Panels: the shadow under a panel is gone. It fell into the gap above the
  transport row with no surface beneath it to explain it, and read as a smudge.
  Dialogs, which float over a backdrop, keep theirs.
· Panels: a list fades over its last ten pixels while there is more below, and
  the fade disappears once the end is reached, so the last row is never dimmed
  for no reason.
· Controls: buttons show a pointer cursor. Tailwind v4 dropped the rule that
  used to do this, and every control in the app had been showing an arrow.

## 1.0.4 — 2026-08-29

Mostly a repair to 1.0.3, in two places.

The colours are yours again. That release made contrast measurable and then
used the measurement to change the colours you had picked, which is the
opposite of what a colour picker is for: a dark blue accent produced a pale
blue play button, a light yellow produced a dark olive one, and switching on
"increase readability" repainted the accent. Your two colours are now used
exactly as chosen, and the only thing that adapts to them is the text and icons
drawn on top.

And infinite play stays infinite. Closing the dead ends in 1.0.3 introduced a
new way to run out — coming back to the same song a few times exhausted what it
had to suggest — and made the search noticeably slow on tracks Last.fm does not
know. Both are fixed, and there is a test now that plays five hundred tracks
without stopping.

Settings also had a tidy: About is at the bottom where it belongs, and checking
for updates tells you when there is nothing new. Updates now speak for
themselves at both ends. A version that is waiting is offered when you open the
app, with the point of it and a choice, instead of being left as a dot to
notice; and the first launch after installing one says what changed.

HIGHLIGHTS
· The accent you pick is the accent you see. Its lighter and darker shades are
  now shades of your colour rather than colours chosen for contrast.
· Text and icons flip between light and dark to stay readable on whatever you
  chose — white on a dark blue, black on a light yellow.
· "Increase readability" no longer changes a single palette colour. It only
  strengthens text and icons.
· Colours now ease from one palette to the next instead of jumping.
· Search boxes and other inputs stay visible on a very dark palette, where
  they used to disappear into the background entirely.
· The window outline is drawn on all four edges. It was only ever visible at
  the corners.
· Infinite play breathes slowly while it is on, so you can see it is armed
  without going looking.
· Infinite play keeps going. Returning to the same song a few times used to
  leave it with nothing to suggest by about the third time.
· Finding the next song is faster on tracks Last.fm does not know — it took
  well over a second and now does not.
· About moved to the bottom of Settings, and checking for updates now tells
  you when there is nothing new.
· A waiting update is offered on opening the app, with what it is for and a
  Download or Later. It used to be a dot on the settings button and nothing
  else, which most people never found.
· The first launch after an update says what changed, in your own language,
  and only once. It is in Settings afterwards for anyone who closed it early.

ALL CHANGES
· Custom palettes: the accent's lighter and darker shades hold its hue and its
  saturation, and only move in lightness. They were previously derived by
  contrast, which turned a dark accent pale and a light one dark.
· Custom palettes: text and icons drawn on an accent-filled button are measured
  against that button rather than assumed to be dark. Twelve places used a
  fixed dark colour that happened to suit the five built-in accents.
· Custom palettes: the surface keeps its own colour in every shade, with
  recesses mixed toward black the way the built-in palettes do.
· Settings: "increase readability" leaves the surface, the accent and all their
  shades untouched. It pushes text and icons toward pure white or black and
  does nothing else.
· Appearance: switching palettes, or editing a custom one, now eases between
  colours. The easing is skipped while you drag in the colour picker, so the
  preview keeps up with the cursor, and it is off entirely when "reduce motion"
  is on.
· Appearance: an accent too close to your surface to stand out is given a thin
  outline in the colour drawn over it. The fill stays exactly what you chose.
· Appearance: the outline around the window is drawn inside its edge rather
  than outside it. Being outside, it fell beyond the window on all four
  straight sides and was clipped away — only the rounded corners left room for
  it to show, which is why the border looked like four corners. This applies to
  the default dark outline as well as to the accent one.
· Transport: the infinite play button pulses slowly while infinite play is on.
  The faster pulse still means a track is being looked up, and neither runs
  when "reduce motion" is on.
· Inputs, sheets and swatches are outlined with a hairline measured against
  what it separates. Everything that marked a box out was darker than its
  surroundings — the fill, the inner shadow, the outline — and on a very dark
  surface there is nothing darker, so the box vanished. The outline now goes
  lighter when there is nowhere darker to go. The five built-in palettes keep
  the edge they were drawn with.
· "Increase readability" also strengthens those outlines, to the contrast a
  user interface boundary is meant to have.
· The colour picker's own heading and focus ring stayed readable at every
  accent colour; they previously came apart as you dragged.
· Infinite play: the pool of suggestions thins out instead of emptying.
  Coming back to the same song repeatedly used to exhaust it after about
  three rounds, because the artist tier offered only four different artists
  while the last three played are held back to stop a run clustering. It now
  draws on eight, and when the spread rule would leave nothing it relaxes
  rather than falling silent — repeating an artist, and then a song heard
  longest ago, before ever handing back nothing.
· Infinite play: no single artist can spend the whole search budget, so a
  fill can still reach the suggestions it was going to fall back on.
· Infinite play: finding a successor for a song Last.fm does not know was
  taking well over a second. Every request built its own connection, paying
  for a fresh handshake each time — 514ms against 54ms on a warm one — and
  the eight artist lookups ran one after another. The connection is now kept,
  and those lookups run four at a time.
· Settings: About is the last section rather than sitting above Connections.
· Settings: pressing "check for updates" says "up to date" when there is
  nothing new. It previously went quiet and showed the button again, which
  looked like nothing had happened. The check that runs at startup still says
  nothing, because nobody asked it.
· Settings: the check button is an outlined pill with a turning arrow rather
  than a bare underlined link.
· Settings: the About section is signed.
· What's new: the summary of the version now running appears once, on the
  first launch after it is installed, and a record of having seen it is kept
  so it does not appear again. It waits while the window is collapsed rather
  than being spent on a window it does not fit in.
· What's new: the text is this changelog, built into the app rather than
  fetched, so it is the same on a machine that installed the .exe by hand and
  on one that has never been online. A Turkish translation of each summary
  ships alongside it, and a release without one falls back to English.
· What's new: Settings has a way back to it, next to the version.
· Updates: a version that is waiting is offered on opening, showing the point
  of the release and asking to install it or not. Saying "later" is kept
  against that version and it is not asked again for it; the mark on the
  settings button stays, and Settings still installs it whenever you like.
· Updates: closing that window with the cross, the backdrop or Escape puts it
  aside for now and records nothing, which is a different thing from "later"
  and behaves like one.
· Updates: the download runs in that window, with its own progress, so
  accepting an update no longer means going to find it in Settings. A download
  that fails says so where it was started, instead of vanishing and leaving
  the reason filed away.

## 1.0.3 — 2026-08-28

This one is about custom palettes. Text and surfaces are now worked out by
measuring the contrast rather than by mixing and hoping, so a palette built
from your own two colours stays legible whatever you pick — including a pale
surface, which used to produce light text on a light background and only a
warning to say so. There is also a setting to push contrast further than the
default, and an optional hairline around the window in your accent colour.

HIGHLIGHTS
· A custom palette is now readable at any colour, including light ones. The
  text flips dark on a pale surface, and the deck's own shadows and highlights
  are relit to match.
· A new "increase readability" setting strengthens text on every palette,
  secondary text most of all.
· A new "window border" setting draws a hairline around the widget in the
  accent colour. Off by default.

ALL CHANGES
· Custom palettes: every colour is derived by measuring contrast against the
  surfaces it will actually sit on, instead of by a fixed blend that could not
  check its own result.
· Custom palettes: choosing a light surface now works. Text turns dark, and
  the recesses, edge highlights and the light on the platter all invert with
  it, rather than staying tuned for a dark shell.
· Custom palettes: a recess stays darker than the surface around it on any
  colour, so wells and inputs still read as cut into the shell.
· Custom palettes: a palette built from the two Espresso colours now produces
  Espresso exactly, so the custom option remains a sane place to start.
· Custom palettes: the warning about contrast now appears only when something
  is actually wrong — an accent too close to your surface to stand out. Your
  two chosen colours are never altered; everything else is adjusted around
  them.
· Settings: "increase readability" raises the contrast target on every
  palette, including the five built-in ones. It only ever strengthens text; no
  other colour changes.
· Settings: "window border" replaces the dark ring around the widget with a
  hairline in the accent colour.
· Documentation: the README was reorganised around what the app actually does,
  and no longer describes YouTube Music or Apple Music as sources.

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
