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

  // Groove texture. Finer at platter size, where the old 4px period read as
  // corduroy rather than vinyl; the coarse one stays for small discs, where a
  // 2px period would alias into noise.
  const grooves = detailed
    ? 'repeating-radial-gradient(circle at center, #191310 0px, #241b16 1px, #191310 2px)'
    : 'repeating-radial-gradient(circle at center, #1c1512 0px, #241b16 1px, #1a1310 2px, #241b16 3px)';

  // The bands between tracks, and the lead-in at the rim: on a real pressing
  // these are the smooth rings where the groove pitch widens, and they catch
  // light differently from the music between them.
  const bands =
    'repeating-radial-gradient(circle at center,' +
    ' transparent 0%, transparent 11.5%,' +
    ' rgba(255,246,232,0.055) 11.9%, rgba(255,246,232,0.055) 12.4%,' +
    ' transparent 12.8%)';

  return (
    <div
      aria-hidden="true"
      className={`relative rounded-full ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        background: detailed ? `${bands}, ${grooves}` : grooves,
        boxShadow: detailed
          ? '0 3px 10px rgba(0,0,0,0.55), inset 0 0 24px rgba(0,0,0,0.75), inset 0 0 2px rgba(255,246,232,0.14)'
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
          */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                'conic-gradient(from 8deg,' +
                ' rgba(255,246,232,0.16) 0deg, rgba(255,246,232,0.03) 1.2deg,' +
                ' transparent 2.4deg, transparent 358deg,' +
                ' rgba(0,0,0,0.45) 359deg, rgba(0,0,0,0.2) 360deg)',
              maskImage: 'radial-gradient(circle at center, transparent 21%, #000 23%, #000 100%)',
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
                ' rgba(255,246,232,0.035) 0deg, transparent 60deg,' +
                ' rgba(0,0,0,0.06) 140deg, transparent 220deg,' +
                ' rgba(255,246,232,0.022) 290deg, transparent 360deg)',
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
