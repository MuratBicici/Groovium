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
  // diagonal, so 100% was 107.5px on a 152px disc rather than the 76px radius,
  // and every ring landed somewhere other than where it was written.
  const extent = 'circle closest-side at center';

  // The body of the record: a pressing is darkest where it turns away at the
  // rim and holds a little more light across the middle.
  const body = detailed
    ? `radial-gradient(${extent}, #241c17 0%, #1e1714 42%, #171211 76%, #1c1613 92%, #120e0d 100%)`
    : '#1c1512';

  // Groove texture. The old one stepped between two colours every 1px, which
  // at 152px is a square wave against the pixel grid — it read as corduroy and
  // aliased into rings. This ramps instead of stepping, over a longer period,
  // at a fraction of the contrast: grooves are meant to register as a sheen
  // that catches the light, not as drawn lines.
  const grooves = detailed
    ? 'repeating-radial-gradient(circle at center,' +
      ' rgba(255,246,232,0) 0px,' +
      ' rgba(255,246,232,0.045) 1.1px,' +
      ' rgba(0,0,0,0.16) 2.2px,' +
      ' rgba(255,246,232,0) 3.1px)'
    : 'repeating-radial-gradient(circle at center,' +
      ' rgba(255,246,232,0) 0px,' +
      ' rgba(255,246,232,0.05) 1.2px,' +
      ' rgba(0,0,0,0.2) 2.4px,' +
      ' rgba(255,246,232,0) 3.4px)';

  // The bands between tracks: on a real pressing these are the rings where the
  // groove pitch widens. Written with the highlight colour at zero alpha
  // rather than `transparent` — `transparent` is *black* at zero alpha, so
  // ramping to it drags a grey edge through the middle of every band.
  const bands =
    `repeating-radial-gradient(${extent},` +
    ' rgba(255,246,232,0) 0%,' +
    ' rgba(255,246,232,0) 9.4%,' +
    ' rgba(255,246,232,0.03) 11.6%,' +
    ' rgba(255,246,232,0.03) 12.6%,' +
    ' rgba(255,246,232,0) 14.8%)';

  return (
    <div
      aria-hidden="true"
      className={`relative rounded-full ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        background: detailed ? `${bands}, ${grooves}, ${body}` : `${grooves}, ${body}`,
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
