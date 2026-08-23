/**
 * The light falling on the record.
 *
 * Rendered as a **sibling** of whatever spins the disc, never a child, which is
 * the whole point of it existing. This used to be a `sheen` prop inside
 * `VinylDisc`, so it turned with the record — a window reflection orbiting the
 * room once every 4.5 seconds. Light does not do that. The record turns
 * underneath it and the grooves pass through it, which is how you read the
 * rotation of a real one.
 *
 * One source, upper left, modelled in the three parts a glossy black surface
 * actually shows: a broad lobe where the light lands, a tight reflection inside
 * it, and a rim that is bright only on the arc facing the light. The first pass
 * had the reflection alone — a straight-edged stripe laid across the whole disc
 * and chopped off square where the circle ended, which is why the edge read as
 * painted on rather than lit.
 */

/** Where the light is coming from, as a fraction of the disc's box. */
const SOURCE = { x: '31%', y: '23%' };

export function DiscLight({ size }: { size: number }) {
  // Below platter size the record does not spin and the band reads as grime.
  if (size < 96) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full">
      {/* The lobe: the soft pool of light around where it lands. Sized
          explicitly, because a radial gradient's default extent is the box's
          diagonal, not its edge. */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            `radial-gradient(66% 56% at ${SOURCE.x} ${SOURCE.y},` +
            ' rgba(255,247,235,0.125) 0%,' +
            ' rgba(255,247,235,0.05) 46%,' +
            ' rgba(255,247,235,0) 78%)',
        }}
      />

      {/* The reflection itself — a window's worth of light, narrow enough to
          have edges the grooves can cross. Masked back toward the source so it
          dissolves before the rim instead of ending in a straight chord. */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            'linear-gradient(118deg,' +
            ' rgba(255,247,235,0) 31%,' +
            ' rgba(255,247,235,0.09) 40%,' +
            ' rgba(255,247,235,0.17) 45.5%,' +
            ' rgba(255,247,235,0.045) 50.5%,' +
            ' rgba(255,247,235,0) 58%)',
          maskImage:
            `radial-gradient(74% 74% at ${SOURCE.x} ${SOURCE.y},` +
            ' #000 0%, rgba(0,0,0,0.55) 46%, rgba(0,0,0,0) 84%)',
        }}
      />

      {/* The rim. An edge that curves away from a single source is bright on
          one arc and dark on the opposite one; the old version put the same
          glow all the way round, which is light from everywhere at once. */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            'conic-gradient(from 0deg,' +
            ' rgba(255,247,235,0.11) 0deg,' +
            ' rgba(255,247,235,0.02) 48deg,' +
            ' rgba(0,0,0,0.2) 120deg,' +
            ' rgba(0,0,0,0.26) 168deg,' +
            ' rgba(0,0,0,0.16) 228deg,' +
            ' rgba(255,247,235,0.05) 282deg,' +
            ' rgba(255,247,235,0.28) 318deg,' +
            ' rgba(255,247,235,0.11) 360deg)',
          maskImage:
            'radial-gradient(circle closest-side at center,' +
            ' rgba(0,0,0,0) 86%, rgba(0,0,0,0.7) 94%, #000 99%, #000 100%)',
        }}
      />

      {/* Where the record meets the well: the shadow it sits in. */}
      <div
        className="absolute inset-0 rounded-full"
        style={{ boxShadow: 'inset 0 -2px 5px rgba(0,0,0,0.45)' }}
      />
    </div>
  );
}
