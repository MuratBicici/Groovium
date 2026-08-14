import { useCurrentTrack, useIsPlaying } from '@/core/store';

/**
 * The spinning disk. Placeholder geometry for now — grooves, label and a
 * stand-in tonearm — but the spin state is already driven by real playback.
 */
export function DiskPlatter() {
  const isPlaying = useIsPlaying();
  const track = useCurrentTrack();

  return (
    <div className="relative mx-auto flex h-[168px] w-[168px] items-center justify-center">
      {/* Well the platter sits in, so the disk reads as recessed into the shell. */}
      <div className="absolute inset-0 rounded-full bg-shell-900 shadow-[inset_0_2px_8px_rgba(0,0,0,0.8)]" />

      <div
        className="groove-platter relative h-[152px] w-[152px] rounded-full"
        data-spinning={isPlaying}
        style={{
          background:
            'repeating-radial-gradient(circle at center, #1c1512 0px, #241b16 1px, #1a1310 2px, #241b16 3px)',
          boxShadow: '0 3px 10px rgba(0,0,0,0.55), inset 0 0 24px rgba(0,0,0,0.7)',
        }}
      >
        {/* Sheen that rotates with the disk, the way light catches vinyl. */}
        <div
          className="absolute inset-0 rounded-full opacity-40"
          style={{
            background:
              'conic-gradient(from 210deg, transparent 0deg, rgba(224,176,113,0.28) 34deg, transparent 78deg, transparent 190deg, rgba(224,176,113,0.16) 226deg, transparent 268deg)',
          }}
        />

        {/* Center label: cover art when a provider supplies it. */}
        <div className="absolute top-1/2 left-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-brass-600 ring-1 ring-brass-400/40">
          {track?.coverArtUrl ? (
            <img
              src={track.coverArtUrl}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brass-500 to-brass-600">
              <span className="text-[8px] font-bold tracking-widest text-shell-900 uppercase">
                Groove
              </span>
            </div>
          )}
        </div>

        {/* Spindle hole. */}
        <div className="absolute top-1/2 left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-shell-900 shadow-[inset_0_1px_2px_rgba(0,0,0,0.9)]" />
      </div>

      <Tonearm engaged={isPlaying} />
    </div>
  );
}

/** Placeholder tonearm. Swings in when playback starts. */
function Tonearm({ engaged }: { engaged: boolean }) {
  return (
    <div
      className="absolute top-2 right-0 origin-top-right transition-transform duration-700 ease-out"
      style={{ transform: `rotate(${engaged ? 22 : 0}deg)` }}
      aria-hidden="true"
    >
      <div className="flex flex-col items-center">
        <div className="h-3 w-3 rounded-full bg-brass-500 shadow-[0_1px_3px_rgba(0,0,0,0.6)]" />
        <div className="h-16 w-[3px] rounded-full bg-gradient-to-b from-brass-400 to-brass-600" />
        <div className="h-2.5 w-1.5 rounded-sm bg-cream-400" />
      </div>
    </div>
  );
}
