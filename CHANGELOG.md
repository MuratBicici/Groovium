# Changelog

Newest first. Each section is the text shown in the app when it offers that
version, so it is written to be read there: plain prose, no markup, and the
point of the release before the detail of it.

## 1.0.4 — 2026-08-29

A repair to 1.0.3. That release made contrast measurable and then used the
measurement to change the colours you had picked, which is the opposite of what
a colour picker is for. Choosing a dark blue accent produced a pale blue play
button; choosing a light yellow produced a dark olive one; and switching on
"increase readability" repainted the accent. Your two colours are now used
exactly as chosen, and the only thing that adapts to them is the text and icons
drawn on top.

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
