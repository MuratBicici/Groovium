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
 * A single hard-edged band rather than a soft glow: a sharp reflection is what
 * gives the surface somewhere to move *against*. Diffuse light on a disc drawn
 * from concentric rings shows nothing at all.
 */
export function DiscLight({ size }: { size: number }) {
  // Below platter size the record does not spin and the band reads as grime.
  if (size < 96) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full">
      {/* The reflection itself: a window's worth of light across the upper
          left, narrow enough to have edges the grooves can cross. */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            'linear-gradient(118deg,' +
            ' transparent 30%,' +
            ' rgba(255,247,235,0.10) 40%,' +
            ' rgba(255,247,235,0.19) 45.5%,' +
            ' rgba(255,247,235,0.05) 49%,' +
            ' transparent 55%)',
        }}
      />

      {/* The warm bounce the brass shell throws back from below, much softer —
          a second light in the room rather than a second reflection. */}
      <div
        className="absolute inset-0 rounded-full opacity-60"
        style={{
          background:
            'linear-gradient(118deg, transparent 62%, rgba(224,176,113,0.10) 78%, transparent 92%)',
        }}
      />

      {/* The rim catches the same light where the edge turns away. */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          boxShadow:
            'inset 0 1px 1px rgba(255,247,235,0.16), inset 0 -1px 2px rgba(0,0,0,0.55)',
        }}
      />
    </div>
  );
}
