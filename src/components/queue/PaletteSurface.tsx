import { feltTexture } from './feltTexture';
import { PALETTE_RADIUS } from './palette';

/**
 * The palette itself: what the queue's records lie on.
 *
 * Felt for now — a turntable mat, dark and matt, in the window's own colour,
 * with a brass rim and a hub. Everything about the surface is in this one
 * component and the `.groove-palette-felt` rule, so trying brass, wood or
 * glass instead is changing this and nothing else: the records, the arrows and
 * the turning do not know what they are lying on.
 *
 * The felt turns with the palette, so turning it is something you see; the
 * light on it does not, the way it does not on the deck.
 */
export function PaletteSurface({ angle, transition }: { angle: number; transition: string }) {
  const felt = feltTexture();
  const size = PALETTE_RADIUS * 2;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full">
      <div
        className="groove-palette-felt absolute inset-0 rounded-full"
        style={{
          // Longhands only: see the note on `background` in `VinylDisc`.
          backgroundImage: felt ? `url(${felt})` : undefined,
          backgroundSize: `${size}px ${size}px`,
          transform: `rotate(${angle}deg)`,
          transition,
          willChange: 'transform',
        }}
      />
      {/* The light, fixed: one soft source from above, as on the deck. */}
      <div className="groove-palette-light absolute inset-0 rounded-full" />
      {/* The hub the palette turns on. */}
      <div className="groove-palette-hub absolute top-1/2 left-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full" />
    </div>
  );
}
