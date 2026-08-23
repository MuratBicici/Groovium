# Theme pack format — draft

> **Nothing here is implemented, and none of it is settled.** Groovium cannot
> install a theme pack today. This is published early on purpose: a format is a
> contract, and the useful time to hear that a contract is wrong is before
> anybody's work depends on it. If you would write packs against this, say what
> is missing or awkward — that is what this document is for.
>
> Targeted for 1.1, after the installer and in-app updates land. The reasoning
> is in [`character-themes.md`](character-themes.md).

A theme pack is a `.zip` holding a `theme.json` and some images. It can recolour
the player and place artwork in it. It cannot run code — see *What a pack may
not do*.

---

## Shape

```
my-theme.zip
├── theme.json
├── bg.png
├── peek.png
├── wave.png
└── label.png
```

Every image sits beside `theme.json` at the top level. No subdirectories: file
names are validated as plain names, so `art/peek.png` is refused.

## `theme.json`

```jsonc
{
  "format": 1,
  "name": "Night Shift",
  "author": "you",

  // Two colours. The rest of the palette is derived from them the same way the
  // built-in custom theme derives its ramp.
  "palette": { "surface": "#241c33", "accent": "#7ad1ff" },

  // Optional. Fills the whole window behind everything.
  "backdrop": { "image": "bg.png", "scrim": 0.55 },

  // Optional. The middle of the record, used only when a track has no cover art.
  "label": { "image": "label.png" },

  // Optional. Artwork placed anywhere in the window.
  "decals": [
    {
      "x": 248, "y": 4, "width": 64,
      "edge": "top",
      "depth": "over-chrome",
      "image": { "idle": "peek.png", "playing": "wave.png", "paused": "nap.png" }
    }
  ]
}
```

### Coordinates

The window is **340 wide**. Open it is **480 tall**; collapsed to its controls
it is about **193**. Coordinates are in those units, measured from the top left,
and they mean the same thing on every machine because the window never resizes.

Useful room, if it helps to compose against:

| Where | Space |
|---|---|
| Either side of the record | 86×168 each |
| The titlebar | 340×32 — also the window's drag region |
| The record label | 56px across, centred, empty without cover art |

### `decals[]`

| Field | Meaning |
|---|---|
| `x`, `y` | Top-left corner, in window units |
| `width` | Drawn width. Height follows the image's aspect ratio; there is no `height` |
| `edge` | `top` or `bottom` — which edge the decal holds on to when the window collapses. Top-held stays put; bottom-held rides the bottom edge up |
| `depth` | `behind-deck`, `in-front-of-deck`, or `over-chrome` |
| `image` | One file name, or an object with `idle` / `playing` / `paused` |
| `compact` | Optional `{ "x": …, "y": … }` used only when collapsed, if `edge` does not place it where you want |

Array order is paint order: later decals draw over earlier ones.

Giving `image` an object makes the artwork answer to playback — the app already
knows those three states, and it crossfades between them (or cuts, if the
person has motion reduced).

### `backdrop.scrim`

A darkening layer between the backdrop and the interface, `0`–`0.85`. It has a
floor: you can raise it, you cannot remove it. Text has to stay readable over
whatever the image is.

---

## What a pack may not do

Not a policy — a property of the format. A pack is data that gets validated,
never code that gets run.

- **No CSS, no JavaScript, no HTML.** There is no field that takes any of them
  and there will not be one.
- **No file outside the pack.** Images are served from the pack's own installed
  directory and nowhere else.
- **No blocking a control.** Decals take no clicks, so artwork can cover a
  button visually but can never stop it working, and a decal over the titlebar
  cannot stop the window being dragged.

Packs are checked when they are installed, not when they are drawn. A pack that
installs is a pack that renders.

## What gets a pack refused

- A file name that is not a plain name — anything with `/`, `\` or `..`
- An archive entry that would land outside the destination, an absolute path,
  or a symlink
- An image whose contents are not actually PNG or WebP, whatever the extension
  says, or one past the size and dimension caps
- A colour that is not `#rgb` or `#rrggbb`
- A number outside its range

Unknown keys are ignored rather than refused, so a pack written for a later
version still installs on an earlier one — minus whatever it could not
understand.

---

## Legal, briefly

Groovium ships no character art and never will. Game characters belong to the
people who made the games, and bundling them into a distributed application is
infringement. That is the whole reason packs install separately instead of
coming with the app.

What you make and what you share is yours to judge. Do not assume that a format
existing is permission.

---

## Making one, for now

By hand: write `theme.json`, put the images beside it, zip the folder's
*contents* — the `.zip` should contain `theme.json` at its top level, not a
folder containing it.

A drag-and-drop editor with a live preview is planned and is the larger half of
this feature. Keeping the format writable by hand is a deliberate test of it:
if it cannot be written by a person, it is too complicated.
