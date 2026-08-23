interface VinylDiscProps {
  /** Outer diameter in px. Everything inside is proportional to it. */
  size: number;
  coverArtUrl?: string | undefined;
  /** The rotating light-catch. On for the platter; at row size it reads as noise. */
  sheen?: boolean;
  /**
   * Load the cover immediately. The flying clone needs it: a lazy image that
   * misses the cache pops in mid-arc, on the one disc the eye is following.
   */
  eager?: boolean;
  className?: string;
}

/** Label diameter as a fraction of the disc — 56/152, the platter's original ratio. */
const LABEL_RATIO = 56 / 152;

/**
 * A vinyl record at any size.
 *
 * One component draws the 152px platter disc, the 24px row thumbnails and the
 * flying clone in between, which is what makes the flight animation honest:
 * the thing that leaves a row and the thing that lands on the platter are the
 * same pixels at different scales, not two drawings that resemble each other.
 *
 * Deliberately animation-free. The platter spins it, the flight layer throws
 * it — both by wrapping it, so no transform in here can fight theirs.
 */
export function VinylDisc({ size, coverArtUrl, sheen, eager, className }: VinylDiscProps) {
  const label = Math.round(size * LABEL_RATIO);
  const spindle = Math.max(2, Math.round(size * 0.05));

  return (
    <div
      aria-hidden="true"
      className={`relative rounded-full ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        // At row size the 1px rings blur into vinyl texture, which is exactly
        // what a record looks like from across the room.
        background:
          'repeating-radial-gradient(circle at center, #1c1512 0px, #241b16 1px, #1a1310 2px, #241b16 3px)',
        boxShadow:
          size >= 96
            ? '0 3px 10px rgba(0,0,0,0.55), inset 0 0 24px rgba(0,0,0,0.7)'
            : '0 1px 2px rgba(0,0,0,0.5), inset 0 0 4px rgba(0,0,0,0.7)',
      }}
    >
      {sheen && (
        <div
          className="absolute inset-0 rounded-full opacity-40"
          style={{
            background:
              'conic-gradient(from 210deg, transparent 0deg, rgba(224,176,113,0.28) 34deg, transparent 78deg, transparent 190deg, rgba(224,176,113,0.16) 226deg, transparent 268deg)',
          }}
        />
      )}

      {/* Center label: cover art when there is any, brass paper when not. */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-brass-600 ring-1 ring-brass-400/40"
        style={{ width: label, height: label }}
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
            {size >= 96 && (
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
