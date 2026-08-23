# Character themes — a design note

Not built, and **not in 1.0** — see *When* below. This is a record of a design
conversation, kept so it does not have to happen twice.

The want: themes where a game character is **part of the design** rather than a
colour scheme, installed **separately** from the app.

---

## When: after 1.0, not in it

Asked directly: should this be in 1.0.0, so people can make themes the moment
the repo is public? The answer is no, and the reason is the other two things
1.0 carries — an installer and in-app updates.

- **An updater is the one thing an update cannot fix.** Ship it broken and
  everyone is stranded on the version they installed, with no remedy but
  asking them to download again by hand. It deserves a release's whole
  attention, and as of this decision it is entirely unbuilt: no plugin, no
  signing key, no endpoint.
- **A working updater inverts the cost of waiting.** The usual argument for
  cramming a feature into 1.0 is that later versions do not reach people.
  Once updates work, 1.1 reaches everyone by itself, so waiting costs almost
  nothing.
- **A format is a contract, and contracts want users first.** Freezing the
  pack format in 1.0 freezes it before a single real pack has been written
  against it. The first ten packs will show what is wrong with it. Changing it
  today breaks nobody's work; changing it after release breaks other people's.
- **The loader alone does not deliver the ask.** "People can make themes"
  means loader *and* editor, and the editor is the largest single piece
  described in this note.
- **Security timing.** 1.0 is when the app first meets strangers. Introducing
  its largest new attack surface — archive extraction, third-party art, asset
  scope — in that same release, before the existing surface has had any
  exposure, is the wrong order.

Worth saying plainly: people can already make themes. The custom palette
shipped before this decision. What is missing is art, not themability.

---

## Why separate installation is the right shape

Not a technical preference. Game characters belong to whoever made the game,
and art shipped inside a distributed application is infringement — the kind
that gets a project taken down rather than the kind that gets a letter. So:

**Groovium carries a format and a loader. It carries no art.** Packs are made
and shared by the people using it.

That constraint decides most of the architecture below, which is why it comes
first.

---

## The core idea: a freely placed decal

Two things asked for at different moments turn out to be the same thing — a
character PNG sitting over the titlebar, and building a theme by dragging
images around. Neither wants a fixed set of slots. Both want **images placed
where the author puts them**, sized, and unable to take a click.

Free coordinates are safe here because the window never changes width: 340
across, 480 tall open. A decal is `x`, `y`, `width`, and it lands in the same
place on every installation.

Measured room, so this is not wishful:

| Where | Space |
|---|---|
| Either side of the record | **86×168** each |
| Slack in the stage | ~52px |
| The titlebar | 340×32, and it is the drag region |
| The record label | 56px, empty when a track has no cover art |

Free placement has to answer three questions.

**Depth.** A character leaning on the deck reads far better if it can stand
*behind* the record. Each decal carries a depth slot — behind the deck, in
front of it, over the chrome — which maps onto the z-index table already
written down in `App.tsx`. In an editor this is one "front/back" control.

**Order.** Decals overlap, so array order is paint order, and an editor offers
bring-forward and send-back.

**Compact mode.** Collapsed, the window is 193px; a decal placed at y=300 has
nowhere to be. The answer is that each decal records which edge it holds on to.
Top-held decals stay put through a collapse; bottom-held ones ride the bottom
edge up. An editor can guess from where it was dropped and let the author
override, with a compact preview to check against.

Two more layers that are not decals: a full-bleed **backdrop**, and the
**palette**, which reuses the `color-mix` ramp already written for custom
themes in `styles.css`.

### Manifest sketch

```jsonc
{
  "format": 1,
  "name": "…", "author": "…",
  "palette":  { "surface": "#241c33", "accent": "#7ad1ff" },
  "backdrop": { "image": "bg.png", "scrim": 0.55 },
  "label":    { "image": "label.png" },
  "decals": [
    { "x": 248, "y": 4, "width": 64, "edge": "top", "depth": "over-chrome",
      "image": { "idle": "peek.png", "playing": "wave.png", "paused": "nap.png" },
      "compact": { "x": 248, "y": 4 }        // optional; `edge` decides otherwise
    }
  ]
}
```

Aspect ratio comes from the image and only width is stored. No free stretching:
it looks bad and doubles the state to keep.

State art hangs off the three states the app already knows — idle, playing,
paused. Crossfade between them, cut instead when motion is reduced.

---

## Three constraints that shape the work

### A pack is data, never code

A theme pack is third-party content entering the webview, which is exactly the
surface the security pass on 2026-08-23 tightened. One sentence: **no CSS, no
JS, no HTML in the format, ever.** Known keys, validated values, nothing else.

- File names must be bare names — `is_bare_name` in `library.rs` already does
  this and should be reused.
- Images validated by magic bytes rather than extension, with size and pixel
  caps.
- Colours only `#rgb`/`#rrggbb`; numbers clamped (`scrim` 0–0.85, `width`
  bounded).
- Unknown keys ignored, so a newer pack degrades on an older build.
- Unzipping rejects any entry whose normalised path escapes the destination,
  plus absolute paths, symlinks, and absurd entry counts or sizes — zip-slip
  and zip bombs.
- Asset access granted at runtime to that pack's directory alone, the same
  `allow_directory` pattern `library_load` uses.

### Art must not swallow the interface

The backdrop's scrim is mandatory with a floor: a pack may raise it, not remove
it. Decals are `pointer-events: none` and sit below the panel layer, so a decal
over the titlebar cannot break window dragging. And the same kind of warning
the custom palette carries applies here, more so — legibility cannot be
promised over arbitrary art.

### The window's edge (open decision)

A character's head poking *outside* the widget's rounded top edge is not
possible today: the shell clips, and the window is exactly the widget. Allowing
it means reserving transparent padding in the window, which moves the layout
and the compact height arithmetic.

Recommendation: first version keeps the character inside. It can sit **over**
the titlebar, not outside it. Overflow is a separate job.

---

## The pack-making tool

Asked for: an environment where someone drags their images into place and gets
a `theme.zip` out. A direct-manipulation canvas, not a file drop box.

**Practical, and unusually cheap here.** `src/core` was written to run in two
places — the Tauri webview and a plain browser — so the tool can be a web page
whose preview is not a drawing that resembles the player but `DiskPlatter`,
`TrackDisplay` and `styles.css` themselves. What-you-see-is-what-you-get
becomes structural rather than aspirational.

That also makes it the cheapest of the three options: embedding an authoring UI
in a 340×480 music widget is absurd, and a second desktop binary is a second
thing to sign, ship and update.

The canvas is a transparent layer over that preview: absolutely positioned
boxes, pointer events, selection handles. Ordinary browser work. Edit while it
plays — the record spins, switch between idle/playing/paused to place each
state, flip to compact to see what the composition does there.

Producing a `.zip` in a browser needs no dependency. The contents are already
compressed, so **stored** entries are enough: a few dozen lines of container
writing, then a `Blob` and a download. No 100KB zip library.

**The real cost is the editor itself.** Selection, move, resize, layer order,
snapping, undo — each small, together the largest single piece of this feature
and probably more work than the settings panel was. Assuming the tool is "a
small page" would be underestimating it.

One thing the tool cannot prevent: decals take no clicks, so they can never
disable a control, but they can cover one. Warn, do not forbid — composition is
the author's call.

**The risk worth naming: two validators.** Rust's is authoritative; the tool's
would be TypeScript. If they drift, the tool starts producing packs that will
not install, and the person who finds out is a user. The fix is not a shared
implementation — different languages — but shared examples: a
`fixtures/theme-packs/` directory of packs that must pass and must fail, read
by both test suites. Drift breaks whichever side drifted.

**Order:** the app has to consume packs before anything can make them. Until
then `docs/theme-packs.md` and a hand-written `theme.json` is enough for early
adopters — and keeping the format writable by hand is a good test of it.

---

## If this gets built

| Area | Work |
|---|---|
| `src-tauri/src/themes.rs` _(new)_ | Unzip, validate, list, remove, grant asset access |
| `src-tauri/capabilities/default.json` | Permissions for the new commands |
| `src/core/themes/` _(new)_ | Manifest type, validator, installed-pack state |
| `src/components/player/` | Backdrop layer, decal component, label hook |
| `src/components/settings/SettingsPanel.tsx` | Install, list, remove, warn |
| `src/core/i18n/` | New strings, both languages |
| `docs/theme-packs.md` _(new)_ | Format reference for pack authors |

Sequence: Rust side and the manifest, then one decal end to end, then backdrop
and label, then the settings UI. A single decal over the titlebar is enough to
prove the whole path.

Verification would start with hostile packs — a zip entry containing `../`, an
absolute path, a symlink, a huge file, a PNG extension over something that is
not a PNG, `scrim: 5`, `width: 99999`, a colour of `#<script>` — all refused at
**install** time rather than at render time. Then: no pack can serve a file
outside its own directory; the window still drags with a decal over the
titlebar; body text still measures above the contrast floor over the most
aggressive backdrop; compact mode drops what it cannot place; and the build
output contains no character art at all.
