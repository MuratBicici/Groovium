import { useEffect, useRef, useState } from 'react';
import type { TrackMetadata } from '@/core/types';
import { useDiscHold } from '@/components/player/DiscHold';
import { RECORD_SIZE } from './palette';

/** What a well does with what is let go over it. */
export type WellKind = 'next' | 'last' | 'link';

/**
 * A place to let go of a record: a dashed ring the size of one, with what it
 * does written beside it, that lights when a record it will take is held over.
 *
 * The queue's palette has had two since a record could be carried — play it
 * next, put it at the end — and the dock has the same ones, so they are one
 * thing, placed by whoever holds them. Taking it is the well's: the record is
 * handed back where it came from afterwards, as it always was.
 */
export function DropWell({
  kind,
  label,
  labelFirst = false,
  accepts,
  onTake,
  className = '',
  style,
  size = RECORD_SIZE,
}: {
  kind: WellKind;
  label: string;
  /** The name above the ring rather than below it. */
  labelFirst?: boolean;
  accepts: (track: TrackMetadata) => boolean;
  onTake: (track: TrackMetadata) => void;
  className?: string;
  style?: React.CSSProperties;
  /** The ring's width: a record's on the palette, smaller on the dock. */
  size?: number;
}) {
  const el = useRef<HTMLDivElement | null>(null);
  const [offered, setOffered] = useState(false);
  const { registerReceiver } = useDiscHold();

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    return registerReceiver({
      el: node,
      accepts,
      onHover: (state) => setOffered(state === 'accept'),
      refuse: () => {},
      approach: { x: 0, y: -30 },
      handOverAt: 0,
      takeIn: (track, _from, handBack) => {
        onTake(track);
        handBack({ x: 0, y: 0 });
      },
    });
  }, [registerReceiver, accepts, onTake]);

  return (
    <div
      className={`groove-queue-well pointer-events-none flex items-center gap-1.5 ${
        labelFirst ? 'flex-col-reverse' : 'flex-col'
      } ${className}`}
      style={{ width: size + 40, ...style }}
    >
      <div
        ref={el}
        aria-hidden="true"
        className={`pointer-events-auto flex items-center justify-center rounded-full border-[1.5px] border-dashed transition-[transform,box-shadow,background-color,border-color] duration-150 ease-out ${
          offered
            ? 'groove-queue-offered border-transparent bg-brass-600/30 text-brass-400'
            : 'border-brass-400/55 bg-shell-900/55 text-brass-400/80'
        }`}
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 24 24"
          className={size < RECORD_SIZE ? 'h-5 w-5' : 'h-6 w-6'}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {kind === 'next' && <path d="M6 4h12M12 20V8M7 13l5-5 5 5" />}
          {kind === 'last' && <path d="M6 20h12M12 4v12M7 11l5 5 5-5" />}
          {kind === 'link' && (
            <>
              <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
              <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
            </>
          )}
        </svg>
      </div>
      <span
        className={`text-label font-medium tracking-[0.18em] uppercase transition-colors ${
          offered ? 'text-brass-400' : 'text-cream-200'
        }`}
      >
        {label}
      </span>
    </div>
  );
}
