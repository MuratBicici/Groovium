# Changelog

Newest first. Each section is the text shown in the app when it offers that
version, so it is written to be read there: plain prose, no markup, and the
point of the release before the detail of it.

## 1.3.1 — 2026-10-27

A front page made from what you play.

The Spotify drawer opens on what you heard lately, in Groovium and on your
other devices, with a mark for where; on shelves of the genres you play most,
new every day; and on the songs you liked. Press Edit and the shelves come
loose: carry them into the order you like. The genres come from Last.fm, so
they need its key, which Settings, Connections takes.

Search opens in a window of its own over the player, grown out of the
magnifier. The best match sits on one side and Enter plays it; on Spotify
albums come up too, and open and play inside the search. An empty search
offers the last ones you made.

A song pressed falls onto the deck like a meteor, and strikes it hard enough
to shake the window; Settings, General, Motion has the old throw if you prefer
it. Behind the turntable a light turns in the cover's colours with dust
drifting through it, breathing with the music, tuned in Settings, Lights. An
empty deck is brushed metal in the theme's colours.

And Groovium asks much less of your computer. Effects are drawn at most sixty
times a second, thirty while you work in another window or on battery saver,
and not at all when it is minimised or in the tray. Battery saver comes on by
itself on battery, and says so.

HIGHLIGHTS
· A Spotify front page: recently played, genre shelves and liked songs, in an
  order you choose.
· A new search window, with albums on Spotify and your recent searches.
· Songs fall onto the deck like meteors.
· A light behind the turntable in the cover's colours, with dust.
· Far less work for the graphics: a frame cap, rest when put away, and battery
  saver.

ALL CHANGES

Spotify front page
· Recently played lays Groovium's own log of what you heard over Spotify's,
  newest first. A small record marks a song heard in Groovium, a phone one
  heard elsewhere. Music on this computer gets its own Recently played shelf
  on the Local side.
· Three genre shelves, from the Last.fm tags of the artists you play most,
  with opinions and places left out. Each holds songs listened to most under
  its tag that you have not heard here, found on Spotify, and changes once a
  day. Without a Last.fm key the page says where to add one.
· Liked songs, with how many. It needs one more permission from Spotify, asked
  for on the shelf itself; the rest of the page works without it.
· Edit, beside the search, loosens the shelves: they wobble, and one picked up
  anywhere moves while the others make room. The arrow keys move one too.
  Done or Escape fixes them, and the order is kept.

Search
· Opens in a floating window over the whole player, out of the search button,
  and goes back into it when closed. Ctrl+F, or typing at the drawer, opens it.
· A best match with its record and Play, Enter to play it, and songs and
  playlists beside it. On Spotify, albums as well, which open inside the search
  and play whole or a song at a time.
· With nothing typed, your recent searches on that side, each with a button to
  forget it.
· Results slide in and out, and typing quickly no longer leaves them invisible.

The deck
· A song pressed anywhere falls onto the deck like a meteor, its light trailing
  behind, and the strike pushes the window's parts outward for a moment.
  Settings, General, Motion, Song pick animation brings the old throw back.
· The window takes a record's colours the moment its song is pressed.
· Picking a record up no longer stutters while the window's colours change.
· An empty deck is brushed metal in the theme's colours; the strobe dots are
  gone.

Background light
· Behind the deck the cover's colours turn with the record, and dust drifts in
  the light, surging with each hit. Brightness, spread, turning speed, breath
  and dust are in Settings, Lights, with a switch to turn it off.
· It stays still while the drawer opens and shuts.

Drawer
· One card for songs and playlists alike: the cover as a sleeve with the record
  in its opening, the name beneath. Shelf names written plainly with their
  count, rows that fade at the end that runs on, and arrows on shelves that
  scroll.
· Your account and signing out are in one menu beside the search.

Performance
· Moving pictures are drawn at most sixty times a second, however fast the
  screen. On a 240 Hz panel the graphics were two thirds busy with a song
  playing and the drawer open; a third of that now.
· Minimised or in the tray, nothing moves, the record included. With another
  window in use, effects are drawn thirty times a second.
· Battery saver, in Settings, General, Motion, draws effects thirty times a
  second. It turns on by itself on battery and says so, with a button to turn
  it off until the next time.
· The tonearm no longer redraws the window as it tracks, and the record turns
  in steps the window can afford.
· Shelves scrolled out of sight are not drawn, and a colour change restyles
  only what has to be seen changing.

Fixes
· Forgetting Spotify or the Last.fm key in Settings, Connections asks first.
· A record's sleeve shows once it has arrived, however it got there.

## 1.3.0 — 2026-10-22

Lyrics you can put right yourself.

A song on this computer gets its lyrics when you choose them. Open the lyrics
and Groovium offers to match some: search LRCLIB and NetEase at once, read
what a record holds, and pick the one that fits. They are kept beside the
song, so they are there tomorrow, offline too. A Spotify song is still looked
up for you, and when nothing is found, the sources are too busy to answer, or
the words are another song's, the same search lets you choose them yourself.

Timed lyrics can be moved to fit the recording. Timing opens a strip of the
song under the words: drag the block to move every line, its ends to stretch
them, and pin a line to move it on its own. Songs on this computer show their
sound behind the lines. A Spotify song's timing is kept in a file, and
Settings, General exports and imports it with the lyrics you chose. And where
a song goes quiet between verses, the wave shows the break now even when
whoever timed it did not mark one.

Music on this computer no longer has to be copied into the library. Add
without copying lists songs where they are, on a shelf of their own. Groovium
cannot answer for a file it does not hold, says so, and marks one that has
gone. Drag files or folders onto the window, or open a song with Groovium from
Explorer and it plays at once.

And on Spotify, a song not sold in your country plays as the release of it
that is, or is shown greyed out with Can't play rather than failing when
pressed. When something goes wrong it is said on a card that goes by itself,
in place of the red strip. And signing out asks first.

HIGHLIGHTS
· Lyrics matched by hand for songs on this computer, and chosen by hand for
  Spotify songs whose lyrics are missing or wrong.
· A timing strip to move lyrics to fit the recording.
· Breaks between verses shown even where nobody marked them.
· Songs on this computer added without copying, dropped on the window, or
  opened from Explorer.
· Spotify songs that will not play here shown as such.
· A quieter notice in place of the red strip.
· Signing out of Spotify asks first.

ALL CHANGES

Lyrics
· A song on this computer is never looked up on its own: its tags are too often
  wrong to search by. With none matched, the lyrics view asks whether to match
  some. The search asks LRCLIB and NetEase together, lists the likeliest first
  by length and by whether they have timings, and shows a record's opening
  lines before it is chosen. What is chosen is saved in the library folder
  beside the song, and Groovium says it does not check it.
· A Spotify song's lyrics can be chosen the same way: under "No lyrics found",
  under "No lyrics found for this song just now", and from Choose… in the
  drawer's header while lyrics are showing. The choice answers for that song
  from then on, kept in lyrics-chosen.json beside the settings, until it is
  removed from the same search.
· Timing: a strip of the song with its lines on it. Drag the block to move
  every line, its ends to stretch or squeeze them, and double-click a line to
  pin it and move it alone. The wheel zooms in, and an overview underneath
  moves along. For songs on this computer the shape of the sound is drawn
  behind the lines. In the player the strip opens out of the progress bar, and
  the line being sung stays where it is.
· A Spotify song's timing is kept in lyrics-timing.json beside the settings.
  Settings → General exports and imports it, with the lyrics chosen by hand.
· A break nobody marked is shown as a wave wherever a line runs on well past
  what its words take. Measured against 294 LRCLIB records whose timers did
  mark theirs, with the marks taken out: every break of ten seconds or more
  is found again.
· A lyrics timer's signature, a web address on a line of its own, is no longer
  shown as words; its moment is kept as a pause.
· LRCLIB answering that it is busy is asked again twice, a moment apart. When
  no source answers, the lyrics say none were found just now, rather than that
  they could not be loaded, with Retry and Match lyrics beneath.
· A song's details say "Not matched" for a local song with no lyrics, rather
  than "Looked for automatically".

Music on this computer
· Add without copying, beside Copy, whenever files are added. Linked songs sit
  on a shelf of their own, Linked · outside the library, and play from where
  they are. One whose file was moved or deleted is dimmed and marked File
  missing, and says where it was when pressed. Copy into the library, in a
  song's details, makes it a copy after all, keeping its lyrics, its timing and
  its places in playlists. Removing a link never touches the file.
· Files and folders dragged onto the window are asked about the same way; the
  record lifts to meet them.
· Open with → Groovium in Explorer, which the installer offers for the audio
  types, links the song and plays it, whether Groovium is running or not. It
  does not make Groovium the default player for anything.
· WebM, MP4, M4B and Matroska audio can be added as well.

Spotify
· Search and playlists are asked with your account's country, so each song
  comes as the release of it that plays there. A song refused anyway, as one
  from the top tracks shelf can be, is asked for again that way and played as
  that release.
· A song that does not play here stays where it is, greyed out with Can't
  play: on the shelves, in search and in playlists. Pressed, it says why: not
  sold in your country, explicit content turned off on your account, or not on
  your kind of account. Playing a playlist through passes over it.
· Signing out asks first, and says what it does.

Fixes
· When something goes wrong it is said on a card in the window's own colours,
  just above the controls, which goes by itself after a few seconds and waits
  while the pointer is on it. The red strip that pushed the controls up and
  stayed until clicked is gone.

## 1.2.3 — 2026-10-13

The music behind the deck, drawn as grooves.

Behind the turntable, the visualiser has a new look: a few soft grooves of
light that rise and fall with the music, a light running along each of them,
quicker the louder it gets. They keep the punch of every kick and settle
smoothly after it. When the music stops they lie flat and sink away, and they
rise again when it plays. With the lyrics record open in the drawer, they draw
in to the part of the window the record leaves. The blocks are still there,
under Settings, Lights, Look, and a new Brightness setting turns either of
them up or down.

Settings is divided into pages now. It opens on a list, Appearance, Lights,
General, Connections and About, each saying where it stands, so most visits
end there. A page slides in when you open it, and Escape takes you back.

And a handful of fixes. With the drawer on the left, the empty space beside the
player sometimes kept clicks that were meant for the window behind it; they go
through every time now. The record could be picked up from just outside its
edge, where the cursor turned into a hand as it spun; now only the record
itself can. Closing the lyrics on the deck, the song's title and artist faded
on their way back and then appeared at once; they stay solid and settle into
place, the album sliding in beside the artist. And on a light palette the
lyrics on the black record were written in dark ink and could not be read;
there they are written in light grey.

HIGHLIGHTS
· A new look for the visualiser, Grooves: soft lines of light that rise and
  fall with the music.
· Brightness for the visualiser, in Settings.
· Settings in pages: Appearance, Lights, General, Connections and About.
· Clicks beside a shut left drawer reach the window behind it, every time.
· The record is picked up only on the record.
· The title and artist settle smoothly when the lyrics close.
· Lyrics on the black record readable on a light palette.

ALL CHANGES

Visualiser
· Grooves, the new look and the default: four soft grooves with a faint glow
  filling in under them, and a light running along each that goes faster as
  the music gets louder. Blocks, the old look, is kept under Settings → Lights
  → Look.
· Brightness, a few notches either way, for either look.
· Quick to answer the music: each band rises with a kick's punch and falls
  back softly, with almost no smoothing left between the sound and the line.
· As the music goes quiet the grooves sink below the foot of the window, and
  rise again when it comes back. On pause they lie flat first, then sink.
· Drawn at one pixel per pixel of the page whatever the window's size, so a
  larger window costs no more to draw than a small one.
· With the lyrics record in the drawer, the grooves squeeze into the part of
  the window the record leaves, short of where it covers them.

Settings
· Five pages instead of one long list: Appearance (theme, colours from the
  cover, window size, border, legibility), Lights (the visualiser and the edge
  light), General (language, keep on top, drawer side, motion), Connections and
  About. The list says where each stands.
· Rows that belong together sit on cards, with small headings over them.
· Escape on a page goes back to the list; Settings opens on the list again.
· The notch marks under the sliders show; only the middle one could be seen.

Fixes
· With the drawer on the left, clicks beside the player reach the window
  behind it every time. After the drawer had opened or shut on its own, they
  could be kept until the cursor next crossed the player.
· The record takes the pointer only within its round edge. It turned on a
  square whose corners reached up to 1.4 times its radius, so the cursor
  became a hand beside it, and a press there lifted it.
· Closing the lyrics on the deck, the title and artist stay solid all the way
  back and hand over in place, and opening, the other way round. The artist
  lands on its own name and the album slides in beside it.
· On a light palette, the words, the lit line and the silences on the lyrics
  record are written in light grey.

## 1.2.2 — 2026-10-08

What comes next, where you can see it.

The new Up next button opens a round palette beside the player. The records
still to come stand on its rim in the order they will play: the one on the
deck a step above, the next song level with it, the rest going round below,
with faint arrows between them showing the way it runs. Scroll to turn it.
Press a record to play it now, move it to the front or take it out, or hold
it and move it to another place on the palette, or carry it onto the deck.
Songs you queue yourself wear a brass ring and play before the rest of what
is playing; the station's finds come last, marked with an infinity sign. To
queue a song, pick its record up in the drawer: the palette comes out with two
places on it, Play next and Add to queue, and the song goes into whichever you
let it go over. Or drop any record on the Up next button.

Both sides of the library drawer can be searched now: the songs on this
computer and your Groovium playlists on one, your Spotify playlists and all
of Spotify on the other. Press the magnifier, Ctrl+F, or just start typing.

On a slow connection, Spotify songs used to stop every so often and start
again a few seconds later. Part of that was Groovium itself: a check that did
not come back in time was taken as the connection being gone, and the music
was stopped while it was still coming in. That no longer happens. When the
sound really does run out, the bar and the lyrics wait for it instead of
running on through the silence, and the window says the connection is slow.
A song now shows as loading from the moment you choose it, and with no
network at all the Spotify side says so instead of offering shelves that
cannot play.

The edge light can listen to the bass alone now — Settings, Edge light,
Listens to: Bass — and the window's border swells on every kick and falls
back between them.

Putting a whole playlist on now switches infinite play off until it has
played: it was that playlist you asked for. A song picked out of one leaves
infinite play as it was.

And if something does go wrong, Settings has a new Report a problem section:
it opens the folder the log is in, and a report on GitHub ready to attach it
to. The log stays on your computer unless you send it.

HIGHLIGHTS
· Up next: a palette of what will play, in order, to turn, reorder and edit.
· Carry a song from the drawer onto Play next or Add to queue on the palette;
  or drop a record on the Up next button to queue it.
· Search both sides of the library drawer.
· Songs no longer stopped by Groovium on a slow connection.
· The bar and lyrics wait when the sound runs out, and "Slow connection" says
  why.
· Loading shown from the moment a song is chosen.
· A plain message on the Spotify side when there is no network.
· Report a problem, in Settings.
· Infinite play keeps out of a playlist put on whole.
· The edge light can listen to the bass alone.

ALL CHANGES

Up next
· An Up next button in the row at the bottom right opens the queue over the
  drawer, and opens the drawer if it was shut. What the drawer was showing
  stays in view and in reach beside it, so a record can be carried from a
  shelf straight onto the palette.
· The palette is felt with a brass rim, in the window's colours. Records stand
  on its rim, the one playing a step above the level and the next one on it.
  Scroll turns it a record a notch, and it stays where it was turned to. It
  reaches up under the window's title bar, as the lyrics record does.
· The lyrics record and its lines open the way the palette does, turning in
  from the player's side, and turn on the same point as the palette.
· Songs queued by hand play first, then the rest of the collection, then the
  station's finds when the station is on.
· Press a record to play it now. Its buttons move it to the front, or take it
  out; a song of the collection is only skipped this once and stays in its
  playlist.
· Hold a record to move it to another place on the palette, or carry it off
  the drawer and onto the deck to play it.
· Picking up a song from the drawer brings the palette out beside it, with
  two places on the felt: Play next above, Add to queue below. Let it go over
  one to queue it there, or on the deck to play it now. The palette goes again
  when the record is put down.
· A record carried from anywhere and let go over the Up next button goes on
  the end of the queue.
· A queued song is a detour: what was playing carries on from where it was
  afterwards. Previous goes back to it; repeat-one repeats the queued song.
· The queue is kept when you choose something else to play, and cleared with
  Clear the queue or when the record is thrown away.

Search
· The local side of the drawer has its own search: songs by title, artist or
  album, and Groovium playlists by name, answered as you type.
· Spotify's search also finds your Spotify playlists, above the songs.
· Opened by the magnifier, Ctrl+F, or typing at the drawer.
· Case and accents are ignored, words can come in any order, and every I is
  an i, so a title in capitals is found whatever keyboard typed the search.
· A playlist found opens from the result; a song plays from it.

Slow connections
· An unanswered check is no longer enough to stop the music: it takes two in
  a row, eight seconds apart, and even then the music is not stopped.
· Spotify answering that it is busy is not taken as the connection failing.
· When the sound runs out mid-song, the bar and the lyrics wait and the window
  says it is loading, until the sound comes back. It is heard rather than
  guessed at: while the visualiser runs, what the app actually plays out is
  listened to, and the bar goes back to where the sound stopped.
· "Slow connection" appears beside the state over a Spotify song after two
  slow starts, stops or answers within three minutes, and goes once fewer
  than two are left in the last three minutes.
· A song shows as loading from the moment it is chosen, including the first
  Spotify song after the app starts.
· A play request lost to a dropped connection is waited out rather than shown
  as an error.
· With no internet, the Spotify side shows a message and the local side plays
  as usual. Windows is asked whether there is internet, not only whether there
  is a network: a virtual adapter — VMware's, Hyper-V's, WSL's, a VPN's — is
  always a network, and on a machine with one the message never showed.

Reporting a problem
· Settings → Report a problem opens the log's folder, and a new GitHub issue
  with the version and system filled in, in the app's language.
· The log is more detailed about playback and the connection, so a report
  says what actually happened.

Edge light
· A new Listens to choice: All of it, as before, or Bass. Bass hears only the
  bottom third of the spectrum, about 45–300 Hz — the kick and the bass line —
  and reads it against its own last few seconds, so the edge rises on each
  kick and falls back between them rather than sitting at full under a loud
  low end. The flare is always the deep brass. Every slider works the same in
  either.

Infinite play
· Playing a whole playlist — its crate played, or carried to the deck —
  switches infinite play off, and its button stays off, saying why, until the
  playlist has played to its end or something else is played.
· A song picked out of a playlist, or anywhere else, leaves infinite play as
  it was.

Fixes
· In the small window, a song changing no longer flashes the deck's large
  record over the bar; the bar's own small record drops on instead.
· The volume knob's line keeps to the pointer for the whole turn, however far
  the pointer goes and wherever it comes back from. It used to add up the
  pointer's movements, and drifted from it after a stop, a pass across the
  middle, or a trip out of the window.
· No wave after a song's last words: the last line stays lit until the song
  ends. The waves between lines are as they were.
· A Spotify song that fades out is no longer taken for the sound running out,
  and a song that ends while its sound is out goes on to the next one, instead
  of rewinding to its start and stopping there.
· The Spotify shelf called On repeat is now Your top tracks lately, which is
  what it shows: Spotify's own ranking of the last few weeks, not its On
  Repeat playlist, which apps like this one can no longer read. It is asked
  for afresh rather than taken from the window's cache.

## 1.2.1 — 2026-09-28

Everything you can play, in one drawer.

The library, the playlists and Spotify had a button each, for what is one
question: what to play next. Now there is one Library button in the row at the
bottom right, and one drawer beside the player with two sides, Local and
Spotify, chosen at the top. The drawer opens on the side you left it on, and
each side keeps its place while you look at the other.

The local side is the songs on this computer, laid out as records on a shelf,
and your Groovium playlists as crates on the shelf beneath them, drawn, opened
and played exactly as Spotify's are. Open one and its records come out of the
crate. Press a record to play it, carry it to the deck, or carry it onto
another crate to file it there. The pencil on an open playlist renames it,
gives it a cover of its own, or deletes it, and in edit mode its records can be
put in a new order. The pencil on a song renames it, title, artist and album,
and gives it a cover. Only Groovium's record of the song changes; the file
itself is left as it was.

The whole window can be made larger or smaller now, from 80% to 150%, with a
slider in Settings. Everything grows together, and the size is kept.

The rest is small. At the end of what there is to play, Next can take a few
seconds to find a song, and the window now says it is searching, with a light
that parts from the middle of the progress bar. When a song's lyrics are out of
time, the source's name in the lyrics drawer switches to the other source, and
the choice is kept for that song. A thin line that crept down the right edge of
the window at 125% and 150% display scaling is gone, the records in an open
crate no longer have arcs of a larger record drawn across them, and the
settings gear has even teeth.

HIGHLIGHTS
· One Library button, and one drawer with a Local side and a Spotify side.
· Your Groovium playlists are crates on a shelf, opened and played exactly
  like Spotify's.
· Rename a playlist, give it a cover, or put its songs in a new order.
· Rename a song on this computer and give it a cover.
· A window size slider in Settings, from 80% to 150%.
· "Searching" while Next is finding a song.
· Lyrics that are out of time can come from the other source.
· The line down the window's right edge at 125% and 150% scaling is gone.

ALL CHANGES

The drawer
· One Library button takes the place of the separate library, playlists and
  Spotify buttons.
· The drawer has two sides, Local and Spotify, switched at the top. The brass
  under the chosen side slides to the other, and the side coming in slides in
  from its direction.
· The drawer opens on the side it was left on. Both sides keep their scroll and
  what they have loaded while the other is showing.

This computer
· The songs on this computer are records on a shelf. Press one to play the
  library from it. Music is added from files or from a whole folder, as
  before.
· The pencil on a song opens its details: title, artist, album and cover. A
  song on the deck shows the change at once. The audio file's own tags are not
  touched.

Groovium playlists
· Groovium playlists are crates on a shelf, showing their songs' covers, or a
  cover of their own. A new one is made from the empty sleeve at the start of
  the shelf.
· Opening one works as a Spotify playlist does: the records fly out of the
  crate onto a page, and back into it when it closes.
· Press a record to play the playlist from it, or carry it to the deck by hand.
  Carry a record onto a crate to add it to that playlist, and carry a crate to
  the deck to play the whole playlist.
· The pencil on an open playlist opens its details: its name, its cover, cropped
  to a square as a Spotify playlist's is, and deleting it.
· In edit mode a song can be taken out, or held and moved to a new place.

Window size
· A Window size slider in Settings, from 80% to 150%. It is applied when the
  slider is let go of, and kept between launches.
· The sliders in Settings glide between their stops instead of jumping.

Playback
· While Next waits for the station to find a song, the status says
  "Searching" and a light parts from the middle of the progress bar to both
  ends. A song ending with nothing lined up does the same.
· A second press of Next during that wait no longer skips past the song found.
· A playlist started during that wait is no longer started over from its first
  song when the station comes back with nothing.

Lyrics
· The source's name in the lyrics drawer is a switch to the other source, for
  lyrics that are out of time. The choice is kept for that song, and a source
  with nothing for the song says so, with the way back beside it.

Fixes
· A one-pixel line down the right edge of the window, which crept to white as
  a song played, at 125% and 150% display scaling.
· Records in an open crate, drawn with arcs of a larger record across them
  when the drawer was wide.
· A failure that could be reported as "[object Object]". Every error now says
  what went wrong.
· The settings gear, which was drawn with teeth of four different sizes.

## 1.2.0 — 2026-09-25

The words, in time with the record.

Press the new lyrics button and the song's words appear, lit as they are sung.
In the player they sit under the record: the line being sung and the one to
come, with the title and artist moved to the foot of the window. Or open them
in the drawer, where the lines lie round a large record carrying the song's
cover, and the record turns a line at a time as the song goes on. Each line is
lit from its first letter to its last over the time it is sung, and syllable
by syllable where the lyrics are timed that finely. A pause between words is a
wave that fills as the silence runs out. Press a line to go to that point in
the song, or scroll to read ahead; the lyrics come back to the singing on their
own. With the window's edge lighting on, its lights go round the cover on the
label while the lyrics are open, so the beat is kept where you are looking.

Lyrics are off until you turn them on. While they are on, the song's title,
artist, album and length go to LRCLIB, an open lyrics database, and to NetEase
Cloud Music if LRCLIB has no timings for it. Nothing is sent while they are
off, and nothing is written to disk.

The window also rests when nobody can see it. Put away, minimised, or under a
full-screen window, it draws nothing and stops listening to the music for the
visualiser, which takes a real load off a laptop's graphics. A switch in
Settings keeps everything moving if you would rather it did.

And a change of song is one change on screen. The next record's cover is
loaded before its turn, so it arrives on the deck with its sleeve on, and the
window takes its colours at the same moment rather than ten seconds later. A
sleeve with no colour in it turns the window black or white. A Spotify song
that is still loading now says so, with a light running along the bar, instead
of counting through silence and then jumping back to the start.

HIGHLIGHTS
· Lyrics, lit as they are sung: under the record in the player, or round a
  large record in the drawer.
· Syllable by syllable where the lyrics are timed that finely, and a wave
  through the pauses.
· Press a line to go to it; scroll to read ahead.
· With edge lighting on, the lyrics record's label keeps the beat.
· The window draws nothing while it is out of sight. On by default, with a
  switch in Settings.
· A new song's cover and colours arrive together, straight away.
· Covers with no colour in them turn the window black or white.
· A Spotify song says it is loading until the music actually starts.
· The words and the progress bar stay in step with Spotify.

ALL CHANGES

Lyrics
· A lyrics button in the row at the bottom right. Off until pressed, and
  remembered between launches.
· In the player: the line being sung and the next one, between the record and
  the title and artist, which move to the foot of the window. A button in the
  corner opens them in the drawer.
· In the drawer: the lines lie like spokes round a large record, with the
  cover on its label. The record and the lines turn together, a line at a
  time. A button moves them back to the player.
· The Spotify button stays lit while the lyrics have the drawer, because the
  drawer is still out. Pressing it closes the drawer, and the lyrics go back
  under the record.
· The line being sung fills with light from its first letter to its last, over
  the time until the next line. A line that wraps fills along its words, row by
  row.
· Where the lyrics time each syllable, each lights as it is sung.
· Each line is sized to fit its row. The line being sung sits in the middle of
  its row.
· Before the first words, between verses, and on lines marked only with ♪ or
  similar, a wave fills as the silence runs out.
· Press a line to go to that point in the song.
· Scroll to read ahead or back: a notch is a line. Five seconds after the last
  scroll, the lyrics wind back to the line being sung.
· With the window's edge lighting on, its lights go round the cover on the
  lyrics record while the lyrics are open in the drawer, and the rim flashes
  on each hit, tuned by the same dials. They
  keep to the rim and never reach the words.
· Songs with words but no timings show the words to read. Instrumentals, songs
  with no lyrics found, and failed lookups each say so, and a failed lookup can
  be tried again.

Finding the right lyrics
· LRCLIB is asked by exact match first, then without extras such as
  "Remastered", "feat." or a track number, then by search. NetEase is asked
  only when none of those has timings.
· A result has to be the same song by the same artist, and within a few
  seconds of the same length, before its timings are used.
· Lyrics in the song's own script are preferred to a romanization of it, and
  lyrics timed a line at a time to lyrics timed a syllable per line.
· A translation written after a caret on every line, as some records do, is
  left out, so only what is sung is shown.
· Credits lines from NetEase ("作词 : …") are left out.
· An answer that arrives after the song has been skipped is dropped.
· Answers are kept in memory while the app is open, so a song played again
  shows its lyrics at once.

Resting out of sight
· While the window is put away to the tray, minimised, or entirely under
  another window that is not see-through, nothing on it is drawn: not the
  visualiser, the window's edge, the record's lights or the lyrics. The audio
  capture for the visualiser stops with them.
· Clicking or typing in the window always wakes it.
· "Rest out of sight" in Settings, on by default, turns this off.
· Overlays from graphics drivers, game launchers and voice chats do not count
  as covering the window.

Lighter on the graphics card
· The window's edge paints nothing when there is nothing lit, and only the
  strips along the edges rather than the whole window.
· The lyrics wheel turns without being drawn again.
· The lights on the lyrics record cover only the label and its rim.

Covers and colours
· Every cover is fetched once, in one way, and shared by the record, the bar
  and the palette. It had been fetched twice, and the second request could
  hang until the palette gave up on it, which is what held a song's colours
  back and showed the chosen theme in between.
· The covers of the next and previous songs, and the station's next song, are
  loaded and their colours read before their turn.
· Until a new cover's colours are read, the window keeps the colours it has,
  rather than going to the chosen theme on the way.
· A cover still on its way fades onto the label when it arrives.
· A cover with no colour in it turns the window black, or white if it is
  mostly light, instead of leaving the chosen theme.
· The record on the deck is always the song that is playing. A record put on
  while the player is still starting stays on the deck, and the previous
  song's cover is no longer painted onto the next one.

Playback
· A Spotify song is shown as loading, with a light running along the progress
  bar and a spinner on the play button, until Spotify is actually playing it.
  The bar had counted through the silence and then jumped back to the start.
· Spotify's position is checked against the app's own count on the regular
  check, and put right when they drift more than about a second apart. The
  count runs on a clock the system time cannot move.
· The station stops asking Spotify for the rest of a search once Spotify says
  to slow down.

Security
· rustls, which every HTTPS request goes through, is updated past
  RUSTSEC-2026-0285.
· Timestamps and offsets in lyrics files cannot overflow, whatever a file says.

Privacy
· PRIVACY.md says what is sent to LRCLIB and NetEase, and when.

## 1.1.2 — 2026-09-19

Your playlists, yours to change.

Until now the crates in the drawer could be played and nothing else. This
release lets you edit them from where they already are. Carry a record onto a
crate on the shelf and the song goes into that playlist — even the one on the
deck, which comes back and carries on playing when it has been filed. Open a
crate and the pencil beside its name opens its details: the name, the cover,
the description, whether it shows on your profile, and removing it from your
library. The list icon next to the pencil lets you drag the songs into a new
order and take any of them out. An empty sleeve at the start of the shelf makes
a new playlist, and the add-to-playlist sheet offers your Spotify playlists
beside Groovium's own.

A new cover is cropped before it is sent. Choose a picture, drag it and zoom
until the square is the one you want, and the crate shows it straight away
while Spotify makes its own copy.

Everything happens on screen first and is sent to Spotify afterwards, so
nothing waits on the network. If Spotify says no, the change is undone and the
crate says why.

The drawer also remembers. Your playlists and the crates you have opened are kept
between launches, so the drawer opens on what you had rather than on an empty
room, and all of it is forgotten the moment you sign out. And what goes wrong
is now written to a log file, because an installed app has no console for
anyone to read.

HIGHLIGHTS
· Carry a record onto a crate to add the song to that playlist. The playing
  record goes back to the deck and the music carries on.
· Your Spotify playlists are in the add-to-playlist sheet, next to Groovium's
  own.
· A pencil in an open crate opens its details: name, cover, description,
  whether it is on your profile, and removing it from your library.
· The list icon beside it lets you reorder the songs by dragging and take any
  of them out.
· New playlists from an empty sleeve at the start of the shelf, or from the
  sheet. They start private.
· New covers are cropped square before upload and shown at once.
· Records in an open crate lie on their sleeves, as on the shelves above, and
  are lifted straight off them.
· Your playlists and opened crates are kept between launches and forgotten
  when you sign out.
· Problems are written to a log file in the app's data folder.

ALL CHANGES

Adding songs
· Hold a Spotify record over a crate on the playlist shelf: the sleeve lifts
  and opens. Let go and it takes the record, flashes, and its count goes up by
  one. The record then goes back where it came from.
· The record on the deck can be carried too. The music pauses while it is in
  your hand and resumes when it lands back on the deck.
· A crate that cannot take the record — a song from this computer — dims and
  stays shut.
· A song already in the playlist is not added twice. The crate says it is
  already there.
· Hold a record against either end of the shelf and the shelf scrolls, so a
  crate off the edge can still be reached.
· The add-to-playlist sheet has two sections: Groovium's playlists and your
  Spotify ones. A song from this computer shows the Spotify section with the
  reason it cannot go there.
· Each section can make a new playlist from its own row, and the song goes
  straight in.

Inside a crate
· A pencil opens the playlist's details. A list icon beside it starts editing
  the songs.
· Editing: drag a record to a new place, and the others make room. Letting go
  sends one move.
· Each record has a × to take it out. A song that is in the playlist twice says
  so, because Spotify takes every copy out together.
· Escape closes one thing at a time: the topmost sheet, then editing, then the
  crate.
· Records lie on top of their sleeves rather than half inside them, and are
  picked up and put back without sliding in and out.
· The crate opens as a page rising from the crate you pressed, with the records
  coming out one after another, and closes the same way in reverse.

Details
· Name, description and whether the playlist is on your profile, saved
  together. Only what changed is sent.
· Point at the cover and a pencil appears. Press it to choose a picture.
· Removing from your library asks first, and says what happens: Spotify keeps
  the playlist for 90 days, and it can be brought back from your account page.
· The sheets fade and rise in and ease away, and the dimming behind them fades
  out at its edges rather than stopping at a line.
· The public switch is the one from Settings, and slides.

Covers
· JPEG, PNG or WebP up to 20 MB.
· Drag to move, scroll or use the slider to zoom. The picture always covers the
  square.
· It is brought under Spotify's 256 KB limit by lowering the quality first and
  the size after.
· The new cover shows on the crate at once, and Spotify's own copy replaces it
  once it is ready.

New playlists
· An empty sleeve at the start of the shelf. Press it, type a name, press
  Enter, and the new crate arrives beside it.
· New playlists are private. Spotify's default is public.

Keeping in step with Spotify
· Every change shows at once and is sent afterwards, one at a time per
  playlist.
· A change Spotify refuses is undone on screen, along with anything queued
  behind it, and the reason is shown.
· What Spotify sends back is written everywhere the playlist is kept, so
  nothing has to be read again.
· Spotify moves songs by their place in the whole playlist, including songs
  that cannot play here and are not shown. Positions are worked out against
  that, not the grid.

Kept between launches
· The playlist shelf and the crates you have opened are saved in the app's data
  folder and shown on the next launch while Spotify is asked again.
· Signing out forgets all of it, and the drawer shows the connect screen at
  once, without being closed and reopened.
· Forgetting the Client ID signs out too, which it had not.

The log file
· The app keeps a log in %LOCALAPPDATA%\com.groovium.desktop\logs: that it
  started, and what went wrong. Tokens, codes and search text are removed
  before anything is written.
· Only this app's own lines are kept, and warnings and errors from the
  libraries under it.

Privacy
· PRIVACY.md says what the app sends and where, and what it keeps on your
  computer.

## 1.1.1 — 2026-09-16

The drawer, as it was meant to be.

1.1.0 put your Spotify playlists in a drawer beside the player and left them
there as a wall of sleeves with a search box above them. This is the same
drawer with the room used properly. Two shelves sit above the crates now —
what you have on repeat, and what you played last — so it opens on the music
you are actually listening to rather than on everything you have ever made.
The playlists are a shelf themselves rather than the thing that took whatever
height was left over. Each of the three has a pair of arrows at its top right,
because a row you run along is only a row you can run along if there is a wheel
under your fingers, and a mouse has no sideways.

The search moved out to make that room. It had been a box sitting in the drawer
permanently, taking half the height from somebody who was not using it. It
opens over the drawer instead — on the magnifier, on Ctrl+F, or on you simply
starting to type, with the letter you typed already in the box.

The rest is what a release build had been doing that a development one never
did. Playlist covers you uploaded yourself did not appear. The records were
rendering smooth, with no grooves on them at all. A cover that failed to load
once was remembered as a cover with no colour in it, so the palette never
arrived. The edge light was answering the volume knob rather than the music, so
turning the music down turned the flares off with it. And a record in flight
jumped sideways if the drawer closed underneath it.

One more, the quietest and the worst. Very rarely the sound stopped while the
record went on turning and the bar went on filling, and only pausing and
playing again would fix it. There is a watchdog for exactly that, and it had a
way of dying without saying so: it books each check from the end of the last
one, and a single request that never came back ended the chain for as long as
the window stayed open. Requests to Spotify have a deadline now, and the clock
is no longer allowed to run unwatched.

HIGHLIGHTS
· Two shelves above the crates: what you have on repeat, and what you played
  last. Press a record to play it, or carry it to the deck by hand, exactly as
  in a crate.
· The playlists are a shelf as well, so the drawer is three rows of the same
  thing rather than a strip on top of a wall.
· Every shelf has arrows at its top right. A mouse can move along one now
  without a sideways wheel.
· Search opens over the drawer instead of sitting inside it — on the magnifier,
  on Ctrl+F, or on simply starting to type.
· Playlist covers you uploaded yourself now appear. They had been blocked in
  the installed app and nowhere else.
· The records have their grooves back. They had been rendering smooth in a
  release build, and only there.
· A cover that fails to load once is no longer remembered as having no colour
  in it, so the palette arrives when the window comes back to the front.
· The edge light no longer answers the volume knob. Turn the music down and the
  flares are still there.
· A record in flight stays on its way to the deck when the drawer closes
  underneath it.
· The sound stopping while the record kept turning is fixed. Requests to
  Spotify have a deadline, and the clock is never left unwatched.

ALL CHANGES

The shelves
· Two new rows above the crates, from what Spotify knows you have been playing:
  one for what is on repeat and one for what was played last.
· The recent row is a log rather than a list — the same song three times in an
  evening is three entries — so it is folded down to one of each, newest first.
· Each row is one request, capped and never paged, and kept for its own length:
  five minutes for what was played last, an hour for what is on repeat. Opening
  and shutting the drawer costs nothing.
· Neither row spends the quota this app actually runs out of. Searching is
  metered apart from the rest, and these are not searches.
· A row still being fetched is shared rather than fetched twice, which it was
  when a drawer was shut and reopened while one was loading.
· A row that arrives after somebody has signed out is discarded rather than
  kept and shown to whoever signs in next.
· The playlists are a horizontal shelf rather than a scrolling wall, and pages
  of them arrive as the shelf is scrolled rather than as it is scrolled down.
· All three rows are sized to fit the drawer together, measured rather than
  estimated: 404 pixels of shelves in the 412 the drawer has.

The arrows
· A pair at the top right of each shelf, and none at all on a shelf that
  already fits — two arrows that can never do anything are furniture.
· An arrow goes out when there is nothing left that way.
· One press moves almost a screenful, keeping a card and a bit in view, so
  there is something in common between before and after.
· An end counts as reached a pixel early. Scroll positions are fractional, and
  an exact comparison leaves an arrow lit that does nothing when pressed.

Search
· Opens over the drawer and fills it, rather than living in it and halving it.
· Three ways in: the magnifier in the drawer's header, Ctrl+F, and typing.
· A letter typed at the drawer opens the search with that letter in the box and
  the caret after it.
· A key with a modifier on it, a named key, and the space bar are all left
  alone, as is anything already being typed into a field.
· Escape closes the search without also closing the drawer behind it.

Covers and records
· Playlist covers that Spotify serves from its upload and mosaic hosts now
  appear. The policy the installed app runs under listed only one of Spotify's
  image hosts, which is why some covers arrived and others did not, and why a
  development build showed all of them.
· The grooves on a record are drawn into the image the app generates, and that
  kind of image was blocked by the same policy. Records had been smooth in
  every installed build since the grooves were added.
· A cover that fails to load is no longer remembered as a cover with no colour
  in it. It is not remembered at all, and it is tried again when the window
  comes back to the front — which is where this was usually noticed, because it
  usually happened while the app was in the background.

The edge light
· The flares answer the music rather than how loud it is. What decides one is
  how much the sound changed, which is a difference rather than a level, so
  quiet music flares exactly as readily as loud music.
· Turning the volume knob down no longer turns the lighting off with it.

Playback
· A record flying to the deck stays on its way there when the drawer closes
  underneath it. It is tracked against the deck each frame rather than aimed
  once at where the deck used to be.

When Spotify goes quiet
· Every request has a ten-second deadline. It had none, and a socket that is
  open but will never deliver — a laptop that changed network, a VPN that went
  away — left one pending for as long as Windows kept the connection.
· That was enough to stop the watchdog for good, because it books each check
  from the end of the last one. Nothing was booked again, and the clock, which
  is a separate timer and knows nothing about audio, went on filling the bar
  over silence until somebody pressed pause.
· The clock now checks, four times a second, that something is watching it, and
  starts the watching again if nothing is.
· A check that fails is caught and reported rather than left to end the chain
  silently, which in a build with no console is the same thing as nothing.

## 1.1.0 — 2026-09-09

The window opens.

Groovium was a deck: one record at a time and a search box to find the next
one. This release gives it a room. Your Spotify playlists live in a drawer that
pulls out beside the player, as crates of records rather than as a list, and
you take a record out of a sleeve and carry it to the deck to play it. A whole
crate travels the same way. The drawer opens on whichever side of the screen
has room for it, and Settings says which side that is.

The deck listens now. Bars rise behind the record, driven by what this app is
sending to the speakers rather than by whatever else is playing on the machine
— on Windows that is asked for one process at a time, so a video in another
window does not move them. The window's own edges answer too. The light there
keeps time with the song: it hears the spectrum in four parts and flares on the
largest thing near each beat, so a snare in a track with no bass in it lights
the window the way a kick does. Six settings sit under the switch if the
default is not to your taste. And the palette can be taken from the sleeve on
the deck — one surface colour and one accent out of the cover art, held to the
same contrast rules a pair you picked by hand goes through.

Underneath that, a great deal of repair.

Losing the network no longer leaves the record turning over silence. Playback
comes back where it stopped rather than at the top of the track, and it gives
up after enough failures instead of trying forever. The window comes back where
you left it — properly this time, including a widget parked in the left half of
the screen, which the old scheme forgot without a word. And the app asks
Spotify for a great deal less: the largest thing it was spending went on a
feature that was switched off.

HIGHLIGHTS
· Your Spotify playlists are here, in a drawer that opens beside the player.
  They are crates of records rather than rows of text.
· Take a record out of its sleeve with the pointer and carry it to the deck to
  play it. Let go anywhere else and it goes back where it came from.
· Carry a whole crate to the deck to play the lot, or press a crate to play it
  in order or shuffled without opening it.
· The drawer opens on the left or the right. Settings has the choice, so the
  widget can sit against whichever edge of the screen you keep it on.
· Bars rise behind the record, moving to this app's own sound. Nothing else
  playing on the machine reaches them.
· The window's edges light with the music — an aura that swells with the low
  end and flares on the beat, with six settings under its switch.
· The palette can be taken from the cover of whatever is playing. Pick the
  record up off the deck and the colours you chose come back until you put it
  down.
· The window is remembered where you left it. It was being saved only on a
  clean exit, which for an app that hides to the tray is almost never.
· A dropped connection no longer restarts the track. Playback resumes at the
  position it stopped at, and stops trying after six failures in two minutes
  rather than retrying for as long as the window is open.
· Groovium asks Spotify for far less. The single largest thing it spent went on
  suggesting a next track for a feature that was switched off.
· Updates are looked for every six hours rather than once a launch, so a widget
  that sits in the tray for a fortnight still hears about a release.
· The Turkish is rewritten. It had been translated clause by clause out of
  English, which in Turkish leaves the verb at the end of a queue.

ALL CHANGES

The drawer
· The window widens into a drawer beside the player rather than opening a panel
  over it. The player keeps its size and its place while the drawer moves.
· The drawer opens on the left or the right, set in Settings. On the left the
  window does not move at all: it is always as wide as the drawer needs and the
  shell grows inside it, which is the only arrangement that does not flicker.
· What that leaves beside the player is transparent window, and clicks pass
  through it to whatever is behind. The window's shape is untouched — cutting
  it turns off per-pixel transparency and paints a square corner past the
  rounded one.
· Changing sides while the drawer is out shuts it, moves the widget behind a
  fade, and opens it again on the other side, in three beats rather than all at
  once.
· Collapsing to the controls takes the drawer with it and gives it back on the
  way up.

Records and crates
· Playlists are drawn as sleeves with the record showing inside, and open into
  the whole drawer.
· A record can be picked up and carried: out of a sleeve, off the deck, or from
  one to the other. It follows the hand at the speed of an arm rather than at a
  constant one, and lands where it is let go or goes home if that is nowhere.
· A sleeve it came out of shows empty until it is back, and the deck shows
  empty while its own record is in the hand.
· An empty sleeve says so rather than handing over a record it does not have.
· A crate can be carried to the deck as a whole. It opens out over the deck and
  is gone, and the music it was carrying starts.
· A crate plays in order or shuffled from a press, without being opened.
· Records come out of a crate two dozen at a time rather than a hundred, and
  the rest arrive as the list is scrolled.
· Only the playlists this account can actually open are shelved.

The visualiser
· Bars behind the deck, twenty-four of them, spaced by octave rather than by
  hertz.
· The sound is read from Windows per-process, aimed at the webview that is
  actually playing it, so nothing else on the machine moves them.
· Bars rise instantly and fall over about half a second, at a rate that is the
  same whatever the frame rate.

The edge light
· Light along both edges of the window, mirrored, rising from the bottom.
· It swells with the low end and flares on a hit, and the flare's colour leans
  deep for a kick and pale for a cymbal.
· Hits are heard across the whole spectrum in four parts, each measured against
  its own history, so a track carried by a voice lights the window at all. The
  step a part takes is what counts rather than the level it reaches, which is
  the only thing that still works on a mastered low end sitting at the top of
  its range.
· Candidates are gathered for fifty milliseconds and the loudest goes, so the
  window flares on the beat rather than on whatever arrived first.
· How much of a moment a hit is comes from how loud its part of the spectrum
  has been over the last second, so a lull breathes where it used to burst and
  an even beat lights the window evenly.
· A hit has to be worth a fair share of what the last few seconds have been
  worth, which keeps the pulse and drops the chatter around it.
· Six settings under the switch: strength, sensitivity, speed, flash and flare,
  each from -4 to +4 with marks under the slider.

Colour
· The palette can be taken from the cover of the playing track: a surface and
  an accent, chosen for saturation and darkness and lifted until the accent can
  be read against its ground. A cover with no colour in it leaves your palette
  alone.
· Colours derived from the palette — the hairline between the player and the
  drawer, the text on a filled button — now change with the theme rather than a
  moment after it.
· The record's colours are lifted while the record is in your hand and come
  back as it settles on the deck.

The window
· The window is remembered with its size beside its position. Without the size,
  the check that decides whether a saved place is on screen tests a single
  point — the window's top left corner, which on the left side sits six hundred
  and eighty pixels from anything visible — so a widget in the left third of
  the screen came back in the middle.
· The place is written when it changes rather than on the way out. Closing
  hides this app to the tray, and what ends the process after that is rarely a
  clean exit.
· The widget no longer walks a drawer's width to the left on every launch. The
  stored side arriving out of the settings file was being read as somebody
  changing their mind about it.
· Windows is asked not to draw its own border and corner around a window that
  draws its own.
· The shell is not drawn at all until the settings are in, rather than for one
  frame against the wrong edge.

Spotify and Last.fm
· Playlists are read with the scopes they need, and a notice appears when they
  have not been granted — and goes when they are.
· Search keeps working while playlists are being asked for.
· Spotify's reason for a refusal is shown rather than a generic failure.
· A refusal is not retried on the other route unless the route was the problem.
· Searches are remembered for ten minutes, so the same question is not asked
  twice.
· A playlist is read once rather than once per play.
· Who is signed in is asked once a session.
· One access token is minted however many callers arrive at once.
· Playback state is asked for twice a minute rather than five times, and only
  when there is reason to.
· A 429 shuts only the quota Spotify actually refused, and backs off further
  each time it refuses without saying how long to wait.
· Infinite play spends one search budget per fill rather than one per seed, and
  stops spending searches to learn the same nothing.
· Infinite play no longer looks for a successor while it is switched off. It
  was the largest thing this app spent, and nothing held it.

Playback
· An outage is confirmed by asking Spotify rather than by trusting the browser.
· Playback resumes at the position it stopped at rather than at the top of the
  track.
· The device is waited for rather than assumed, and the music is confirmed by
  hearing the position move.
· A stall that keeps coming back is bounded: six in two minutes ends it, where
  the ceilings used to reset on every one.

Updates
· The check runs every six hours rather than once a launch.
· Settings announces the version and offers the download. Every word of the
  release used to sit there in a box four lines tall; what a release said is
  told properly by the summary shown after it installs.

Language
· The Turkish changelog and two of the setup strings are rewritten as Turkish
  rather than as a translation: shorter sentences, the verb where it can be
  reached, and "siz" throughout, which is what the rest of the interface says.

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
missed. And there are five fixes to how the window is drawn.

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
· Panels no longer cast a shadow into the gap above the controls, and their
  bottom edge no longer draws a line across the window — the surface now
  arrives at the shell instead of stopping on it.
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
· Panels: a panel's surface fades into the shell over its last thirty-two
  pixels rather than ending in one. The step there is about three parts in
  255, which is not enough to see as a colour and more than enough to see as a
  straight edge — so it is spread rather than corrected.
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
