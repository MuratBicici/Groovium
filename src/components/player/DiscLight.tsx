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
 * One source, upper left. The part that makes it read as vinyl rather than as
 * a dark plastic disc is the **anisotropic** sheen: the grooves are circles, so
 * the surface does not scatter light evenly the way a smooth one would — it
 * throws it into two opposed arcs, which is the wide bright band you see across
 * a record in any photograph of one.
 *
 * That pattern belongs here, on the fixed layer, and not on the record, and the
 * reason is the same physics that made the old rotating sheen wrong. A field of
 * concentric grooves is rotationally symmetric, so the reflection off it is too:
 * it does not turn when the record turns. Spin a record under a lamp and the
 * sheen sits still while the label goes round.
 *
 * The colour is `--sheen` rather than a literal, so it follows the palette: a
 * warm cream reflection on a cold blue shell reads as a sticker stuck to the
 * record instead of light falling on it. The record's own black does not follow
 * the palette, because vinyl is black in every room.
 *
 * There was a tighter straight-edged reflection over the top of it for the
 * source itself, and it is gone. A linear gradient's bands are straight lines —
 * that one ran up to the right, across a disc whose every other feature follows
 * a circle, and a straight edge is the one thing a record's surface never
 * shows. The lobes and the rim are both circular, and the light reads better
 * for having nothing square in it.
 */

export function DiscLight({ size }: { size: number }) {
  // Below platter size the record does not spin and the band reads as grime.
  if (size < 96) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full">
      {/* The groove field's sheen: two opposed arcs, the near one stronger.
          Angular shape from the cone, radial extent from the mask — between
          them they multiply out to a band that lies across the grooved area
          and fades into the label and the rim. */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            'conic-gradient(from 0deg,' +
            ' rgb(var(--sheen) / 0.02) 0deg,' +
            ' rgb(var(--sheen) / 0.004) 62deg,' +
            ' rgb(var(--sheen) / 0.02) 108deg,' +
            ' rgb(var(--sheen) / 0.14) 135deg,' +
            ' rgb(var(--sheen) / 0.02) 162deg,' +
            ' rgb(var(--sheen) / 0.004) 248deg,' +
            ' rgb(var(--sheen) / 0.03) 288deg,' +
            ' rgb(var(--sheen) / 0.26) 315deg,' +
            ' rgb(var(--sheen) / 0.03) 342deg,' +
            ' rgb(var(--sheen) / 0.02) 360deg)',
          maskImage:
            // Edges kept crisp on purpose. Faded gently, the sheen reads as
            // the highlight on a sphere; the grooved band on a record has a
            // beginning and an end, and finding them is what tells the eye it
            // is looking at an annulus of texture rather than at a ball.
            'radial-gradient(circle closest-side at center,' +
            ' rgba(0,0,0,0) 36%, #000 40%, #000 93%,' +
            ' rgba(0,0,0,0.3) 96%, rgba(0,0,0,0) 98%)',
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
            ' rgb(var(--sheen) / 0.11) 0deg,' +
            ' rgb(var(--sheen) / 0.02) 48deg,' +
            ' rgba(0,0,0,0.2) 120deg,' +
            ' rgba(0,0,0,0.26) 168deg,' +
            ' rgba(0,0,0,0.16) 228deg,' +
            ' rgb(var(--sheen) / 0.05) 282deg,' +
            ' rgb(var(--sheen) / 0.28) 318deg,' +
            ' rgb(var(--sheen) / 0.11) 360deg)',
          maskImage:
            'radial-gradient(circle closest-side at center,' +
            ' rgba(0,0,0,0) 92%, rgba(0,0,0,0.7) 96.5%, #000 100%)',
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
