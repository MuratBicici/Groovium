import { grooveTexture } from './grooveTexture';

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
 * betraying it wrongly. What turns now is the label, which carries the cover
 * art, and the pressing variation below.
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
  const texture = detailed ? grooveTexture() : null;

  // Every radial gradient here says `closest-side`, which is the difference
  // between a percentage meaning what it reads as and meaning something 41%
  // larger. The default is `farthest-corner`: on a square box that is the
  // diagonal, so 100% was 107.5px on a 152px disc rather than the 76px radius.
  const extent = 'circle closest-side at center';

  // The body of the record. Near black on purpose: measured off the render,
  // the previous surface sat at luminance 35-50 everywhere, which is the
  // reading of matte plastic. Vinyl is dark and *glossy* — the black has to go
  // low so the reflection has somewhere to be bright against.
  const body =
    `radial-gradient(${extent},` +
    // the run-out, smooth, between label and first groove
    ' #191311 0%, #181310 35%,' +
    // the grooved band begins: a real one starts at a visible edge
    ' #131010 39%, #120f0e 60%, #0e0c0b 82%,' +
    // and runs almost to the edge. The land outside the last groove is a
    // couple of pixels on a disc this size; it had been a seventh of the
    // radius, which read as one big sweep where the texture should have been.
    ' #0e0c0b 94.5%, #151110 96.5%, #0b0908 98.5%, #060505 100%)';

  /*
    The groove field.

    This is the third rewrite of this texture and the first two were both
    drawing something that is not there. A 12" side has a groove pitch around
    0.125mm; at 152px across a 302mm record that is **0.063px** — a sixteenth
    of a pixel. Individual grooves are not visible at this size, and the rings
    that were being drawn were not a fine texture, they were a coarse one.

    They also could not be tuned. A ring pattern is periodic, the rasteriser
    point-samples it, and the two beat: at a 3.1px period the rings landed 6.2
    device px apart against a whole-pixel grid, detuned 0.2px per ring, folding
    into moiré bands ~31px wide. Changing the period only moves the beat, and
    moves it differently on every display scaling.

    So nothing here repeats. All that is left on the record itself is the
    faintest hint that the grooved band is not as smooth as the lead-in and the
    run-out around it — the *reflection* off that band is what you actually
    see, and it lives in `DiscLight`, because it does not turn with the record.
  */
  return (
    <div
      aria-hidden="true"
      className={`relative rounded-full ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        background: detailed && texture ? `url(${texture}), ${body}` : body,
        backgroundSize: '100% 100%',
        // No rim highlight here any more: a glow on all sides at once is light
        // arriving from everywhere, which is what made the edge read as drawn
        // rather than lit. `DiscLight` puts it on the arc facing the light.
        boxShadow: detailed
          ? '0 2px 6px rgba(0,0,0,0.45), inset 0 0 18px rgba(0,0,0,0.35)'
          : '0 1px 2px rgba(0,0,0,0.5), inset 0 0 4px rgba(0,0,0,0.7)',
      }}
    >
      {detailed && (
        <>
          {/*
            Pressing variation, and the only asymmetric thing on the record.

            A spiral seam used to sit here too — the step where a groove turns
            inward, which is real, and which was the strongest cue that the
            disc was turning. It had to go: a conic gradient whose 360° value
            differs from its 0° value is a step of zero width, and measured off
            the render that one was a 6.35 luminance jump along a single ray.
            That is the hard vertical edge, and no amount of softening the
            stops removes it, because the discontinuity is at the wrap and not
            in the ramp.

            Rotation does not need it. The label carries the cover art, and a
            turning record with a turning cover is not ambiguous. What is left
            here is a slow swell that begins and ends on the same value, so
            there is no ray anywhere on this disc where the surface steps.
          */}
          <div
            className="absolute inset-0 rounded-full opacity-70"
            style={{
              background:
                'conic-gradient(from 130deg,' +
                ' rgba(255,246,232,0.022) 0deg,' +
                ' rgba(255,246,232,0) 74deg,' +
                ' rgba(0,0,0,0.03) 148deg,' +
                ' rgba(0,0,0,0.012) 214deg,' +
                ' rgba(255,246,232,0.014) 286deg,' +
                ' rgba(255,246,232,0.022) 360deg)',
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
