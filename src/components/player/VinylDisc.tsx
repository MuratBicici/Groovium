interface VinylDiscProps {
  /** Outer diameter in px. Everything inside is proportional to it. */
  size: number;
  coverArtUrl?: string | undefined;
  /**
   * Load the cover immediately. The flying clone needs it: a lazy image that
   * misses the cache pops in mid-arc, on the one disc the eye is following.
   */
  eager?: boolean;
  className?: string;
}

/** Label diameter as a fraction of the disc — 56/152, the platter's original ratio. */
const LABEL_RATIO = 56 / 152;

/** Below this, the detail below is invisible and the instances are many. */
const DETAILED_FROM = 96;

/**
 * Where the pitch widens between tracks, as a fraction of the disc's radius.
 *
 * Hand-placed and deliberately **not** evenly spaced. Even spacing is a
 * repeating pattern, and a repeating pattern of rings is the thing that beats
 * against the pixel grid; irregular radii cannot beat with anything. They are
 * also what a real side looks like — tracks are not the same length.
 */
const SEPARATIONS = [42.5, 49, 58, 64.5, 74, 83.5, 89.5];

/** Half-width of a separation ring, in the same units. ~1px at platter size. */
const SEPARATION_HALF = 1.3;

/**
 * A vinyl record at any size.
 *
 * One component draws the 152px platter disc, the 24px row thumbnails and the
 * flying clone in between, which is what makes the flight animation honest:
 * the thing that leaves a row and the thing that lands on the platter are the
 * same pixels at different scales, not two drawings that resemble each other.
 *
 * **The record only — not the light on it.** The highlight used to live in
 * here, which meant it rotated with the disc: a light source orbiting the room.
 * It is `DiscLight` now, a fixed sibling of whatever spins this.
 *
 * That move exposed the real problem it had been covering. Concentric rings are
 * rotationally symmetric, so a disc drawn from them cannot show that it is
 * turning — the sheen was the only thing betraying rotation, and it was
 * betraying it wrongly. Hence the spiral seam and the pressing variation below:
 * they are what actually turns.
 *
 * Deliberately animation-free, and deliberately exactly `size` px square with
 * nothing bleeding outside it — the flight scales a row disc to platter size by
 * the ratio of their boxes, so a filter or an overflowing edge would land the
 * clone at the wrong apparent size.
 */
export function VinylDisc({ size, coverArtUrl, eager, className }: VinylDiscProps) {
  const label = Math.round(size * LABEL_RATIO);
  const spindle = Math.max(2, Math.round(size * 0.05));
  const detailed = size >= DETAILED_FROM;

  // Every radial gradient here says `closest-side`, which is the difference
  // between a percentage meaning what it reads as and meaning something 41%
  // larger. The default is `farthest-corner`: on a square box that is the
  // diagonal, so 100% was 107.5px on a 152px disc rather than the 76px radius.
  const extent = 'circle closest-side at center';

  // The body of the record: darkest where it turns away at the rim, holding a
  // little more light across the middle.
  const body =
    `radial-gradient(${extent},` +
    ' #262019 0%, #221b16 34%, #1e1714 52%,' +
    ' #191312 74%, #1d1613 90%, #15100e 97%, #100c0b 100%)';

  /*
    The groove field, as a broad sheen rather than as grooves.

    This is the second rewrite of this texture and the first one that can
    actually work, because the previous two were drawing something that does
    not exist at this size. A 12" side has a groove pitch around 0.125mm; at
    152px across a 302mm record that is **0.063px** — a sixteenth of a pixel.
    Individual grooves are not visible on a record this small, and the 25 rings
    that were being drawn were not a fine texture, they were a coarse one.

    Worse, they could not be made to look right by adjusting them. A ring
    pattern is periodic, the rasteriser point-samples it, and the two beat: at
    a 3.1px period on this display the rings landed 6.2 device px apart against
    a whole-pixel grid, detuned by 0.2px per ring, which folds into moiré bands
    ~31px wide. Those bands were the harsh rings in the screenshot. Changing
    the period only moves the beat — and moves it differently on every display
    scaling, so it cannot be tuned once and left.

    So there is no periodic content on this disc any more, at any frequency.
    What is left is what you actually see on a record at thumbnail size: a
    smooth sheen across the grooved band, brighter at the lead-in, with the
    separations between tracks placed individually.
  */
  const field =
    `radial-gradient(${extent},` +
    ' rgba(255,246,232,0) 34%,' +
    ' rgba(255,246,232,0.012) 38%,' +
    ' rgba(255,246,232,0.042) 53%,' +
    ' rgba(255,246,232,0.022) 69%,' +
    ' rgba(255,246,232,0.05) 87%,' +
    ' rgba(255,246,232,0.01) 93%,' +
    ' rgba(255,246,232,0) 96%)';

  // Zero alpha is written with the highlight's own colour, never `transparent`
  // — `transparent` is *black* at zero alpha, and ramping to it drags a grey
  // edge through the middle of every band.
  const separations =
    `radial-gradient(${extent},` +
    SEPARATIONS.flatMap((r) => [
      ` rgba(255,246,232,0) ${(r - SEPARATION_HALF).toFixed(1)}%`,
      ` rgba(255,246,232,0.05) ${r.toFixed(1)}%`,
      ` rgba(255,246,232,0) ${(r + SEPARATION_HALF).toFixed(1)}%`,
    ]).join(',') +
    ')';

  return (
    <div
      aria-hidden="true"
      className={`relative rounded-full ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        background: detailed ? `${separations}, ${field}, ${body}` : `${field}, ${body}`,
        // No rim highlight here any more: a glow on all sides at once is light
        // arriving from everywhere, which is what made the edge read as drawn
        // rather than lit. `DiscLight` puts it on the arc facing the light.
        boxShadow: detailed
          ? '0 4px 12px rgba(0,0,0,0.5), inset 0 0 26px rgba(0,0,0,0.45)'
          : '0 1px 2px rgba(0,0,0,0.5), inset 0 0 4px rgba(0,0,0,0.7)',
      }}
    >
      {detailed && (
        <>
          {/*
            The spiral seam. A record's groove is one continuous spiral, so
            there is a point where it steps inward and the surface visibly
            breaks — the single most legible sign that a record is turning,
            and the reason the disc no longer needs the light to move.

            Softened and faded at both ends since the first pass, where it was
            a 0.45-alpha black edge running rim to label: at that contrast it
            stopped reading as a step in the groove and started reading as a
            crack across the record.
          */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                'conic-gradient(from 8deg,' +
                ' rgba(255,246,232,0.075) 0deg,' +
                ' rgba(255,246,232,0.02) 2.5deg,' +
                ' rgba(255,246,232,0) 6deg,' +
                ' rgba(255,246,232,0) 351deg,' +
                ' rgba(0,0,0,0.06) 355deg,' +
                ' rgba(0,0,0,0.2) 360deg)',
              maskImage: `radial-gradient(${extent}, rgba(0,0,0,0) 34%, #000 44%,` +
                ' #000 88%, rgba(0,0,0,0.35) 97%, rgba(0,0,0,0) 100%)',
            }}
          />

          {/*
            Pressing variation. Vinyl is not perfectly uniform; some sectors
            hold the light a little differently, and that unevenness turning
            under a fixed reflection is what a spinning record actually looks
            like. Very low contrast on purpose — it should register as movement
            rather than as a pattern.
          */}
          <div
            className="absolute inset-0 rounded-full opacity-70"
            style={{
              background:
                'conic-gradient(from 130deg,' +
                ' rgba(255,246,232,0.03) 0deg, rgba(255,246,232,0) 60deg,' +
                ' rgba(0,0,0,0.05) 140deg, rgba(0,0,0,0) 220deg,' +
                ' rgba(255,246,232,0.02) 290deg, rgba(255,246,232,0) 360deg)',
            }}
          />
        </>
      )}

      {/* Center label: cover art when there is any, brass paper when not. */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-brass-600 ring-1 ring-brass-400/40"
        style={{
          width: label,
          height: label,
          // The lip where paper meets vinyl. A real label is glued on, and the
          // edge of it is a small step, not a printed circle.
          boxShadow: detailed
            ? '0 0 0 1px rgba(0,0,0,0.55), 0 1px 2px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,246,232,0.18)'
            : undefined,
        }}
      >
        {coverArtUrl ? (
          <img
            src={coverArtUrl}
            alt=""
            loading={eager ? 'eager' : 'lazy'}
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brass-500 to-brass-600">
            {/* The wordmark is unreadable below platter size; a plain brass
                label is what a real unlabeled pressing looks like anyway. */}
            {detailed && (
              <span className="text-micro font-bold tracking-widest text-shell-900 uppercase">
                Groove
              </span>
            )}
          </div>
        )}
      </div>

      {/* Spindle hole. */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-shell-900 shadow-[inset_0_1px_2px_rgba(0,0,0,0.9)]"
        style={{ width: spindle, height: spindle }}
      />
    </div>
  );
}
