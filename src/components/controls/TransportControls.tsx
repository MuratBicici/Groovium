import {
  usePlaybackState,
  usePlayerStore,
  useHasPlayback,
  useRepeatMode,
  useShuffle,
  useStation,
  useStationSearching,
} from '@/core/store';

interface TransportControlsProps {
  /** Raised when infinite play is switched on before a Last.fm key exists. */
  onStationNeedsSetup: () => void;
}

/** Prev / play-pause / next, plus the shuffle, repeat and station toggles. */
export function TransportControls({ onStationNeedsSetup }: TransportControlsProps) {
  const playbackState = usePlaybackState();
  const hasQueue = useHasPlayback();
  const repeat = useRepeatMode();
  const shuffle = useShuffle();
  const station = useStation();
  const stationSearching = useStationSearching();

  const togglePlayPause = usePlayerStore((s) => s.togglePlayPause);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const toggleStation = usePlayerStore((s) => s.toggleStation);

  const isPlaying = playbackState === 'PLAYING';
  const isLoading = playbackState === 'LOADING';

  async function onStationClick() {
    // False means there is no API key yet, which is a setup prompt rather than
    // a failure — the sheet asks for one and switches the station on after.
    if (!(await toggleStation())) onStationNeedsSetup();
  }

  return (
    <div className="flex items-center justify-center gap-2 px-4">
      {/* Balances the station toggle at the far right. Without it the row still
          centres as a group, but the play button — the one control the eye
          actually lines up on — sits 18px off centre. */}
      <span aria-hidden="true" className="h-7 w-7 shrink-0" />

      <ToggleButton
        label="Shuffle"
        active={shuffle}
        disabled={!hasQueue}
        onClick={toggleShuffle}
      >
        <ShuffleIcon />
      </ToggleButton>

      <TactileButton label="Previous" disabled={!hasQueue} onClick={() => void previous()}>
        <SkipIcon direction="back" />
      </TactileButton>

      <button
        type="button"
        aria-label={isPlaying ? 'Pause' : 'Play'}
        disabled={!hasQueue}
        onClick={() => void togglePlayPause()}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-b from-brass-400 to-brass-600 text-shell-900 shadow-[0_3px_0_var(--color-brass-600),0_5px_10px_rgba(0,0,0,0.5)] transition-all active:translate-y-[2px] active:shadow-[0_1px_0_var(--color-brass-600),0_2px_5px_rgba(0,0,0,0.5)] disabled:opacity-40 disabled:shadow-none"
      >
        {isLoading ? <SpinnerIcon /> : isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>

      <TactileButton label="Next" disabled={!hasQueue} onClick={() => void next()}>
        <SkipIcon direction="forward" />
      </TactileButton>

      <ToggleButton
        label={`Repeat: ${repeat}`}
        active={repeat !== 'off'}
        disabled={!hasQueue}
        onClick={cycleRepeat}
      >
        <RepeatIcon mode={repeat} />
      </ToggleButton>

      {/* Sits beside repeat because the two answer the same question — what
          happens when the track ends — and unlike the rest of the row it stays
          enabled with nothing playing, so it can be armed in advance. */}
      <ToggleButton
        label={`Infinite play: ${station ? 'on' : 'off'}`}
        active={station}
        onClick={() => void onStationClick()}
      >
        <InfinityIcon searching={station && stationSearching} />
      </ToggleButton>
    </div>
  );
}

function TactileButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-full bg-shell-700 text-cream-200 shadow-[0_2px_0_var(--color-shell-900)] transition-all hover:text-cream-50 active:translate-y-[2px] active:shadow-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function ToggleButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors disabled:opacity-35 ${
        active ? 'text-brass-400' : 'text-cream-400 hover:text-cream-200'
      }`}
    >
      {children}
    </button>
  );
}

// --- Icons ------------------------------------------------------------------

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M12 3a9 9 0 019 9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function SkipIcon({ direction }: { direction: 'back' | 'forward' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="currentColor"
      aria-hidden="true"
      style={direction === 'back' ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="M6 6v12l9-6zM16.5 6H19v12h-2.5z" />
    </svg>
  );
}

function ShuffleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M4 7h3.5l9 10H20M4 17h3.5l9-10H20" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.5 4.5L20 7l-2.5 2.5M17.5 14.5L20 17l-2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Pulses while a suggestion is being looked up, so the wait is visible. */
function InfinityIcon({ searching }: { searching: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 ${searching ? 'animate-pulse' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      aria-hidden="true"
    >
      <path
        d="M7.5 9a3 3 0 100 6c2.5 0 4-6 6.5-6a3 3 0 110 6c-2.5 0-4-6-6.5-6z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RepeatIcon({ mode }: { mode: 'off' | 'one' | 'all' }) {
  return (
    <span className="relative flex items-center justify-center">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
        <path d="M17 3l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M20 6H7a3 3 0 00-3 3v1" strokeLinecap="round" />
        <path d="M7 21l-3-3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 18h13a3 3 0 003-3v-1" strokeLinecap="round" />
      </svg>
      {mode === 'one' && (
        <span className="absolute -right-1 -bottom-1 text-[8px] font-bold leading-none">1</span>
      )}
    </span>
  );
}
