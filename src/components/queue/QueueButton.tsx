import { useEffect, useRef, useState } from 'react';
import { PanelButton } from '@/components/controls/PanelButton';
import { useDiscHold } from '@/components/player/DiscHold';
import { usePlayerStore } from '@/core/store';

/**
 * The Up next button, which is also somewhere to drop a record.
 *
 * Carrying a record — from a shelf, a crate, search, or the deck itself — and
 * letting go of it over this puts it on the end of the queue, and the record
 * goes back to where it came from, as one filed in a crate does. So a song can
 * be queued from anywhere in the window by the same gesture that plays one.
 */
export function QueueButton({
  open,
  onToggle,
  controls,
}: {
  open: boolean;
  onToggle: () => void;
  controls: string;
}) {
  const button = useRef<HTMLButtonElement | null>(null);
  const [offered, setOffered] = useState(false);
  const { registerReceiver } = useDiscHold();
  const queueLast = usePlayerStore((s) => s.queueLast);

  useEffect(() => {
    const el = button.current;
    if (!el) return;
    return registerReceiver({
      el,
      // A crate in the hand is a whole playlist, not a song.
      accepts: (track) => !track.id.startsWith('crate:'),
      onHover: (state) => setOffered(state === 'accept'),
      refuse: () => {},
      approach: { x: 0, y: -40 },
      handOverAt: 0,
      takeIn: (track, _from, handBack) => {
        queueLast(track);
        handBack({ x: 0, y: 0 });
      },
    });
  }, [registerReceiver, queueLast]);

  return (
    <PanelButton
      panel="queue"
      open={open}
      onToggle={onToggle}
      controls={controls}
      buttonRef={button}
      offered={offered}
    />
  );
}
