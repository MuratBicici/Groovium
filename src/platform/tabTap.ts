import { log } from './log';

/**
 * The tab's own sound, captured inside the browser and sent to the equaliser.
 *
 * This is the only way to it that comes before Windows: the capture is taken
 * from the browser's own audio, DRM or not, so a sound card's effects have not
 * been applied yet and are only applied once, on the way out from Rust. It also
 * silences the tab's output, and so everything else in it, this included; the
 * filtered sound has nowhere to leave from but Rust.
 *
 * The page would not be able to keep the sound coming on its own thread: a long
 * render would be a gap in the music. So a worklet takes it off the audio thread
 * and a worker sends it (`public/equaliser-tap-*.js`), and neither waits on this.
 *
 * Choosing the tab and allowing it are done by browser arguments in
 * `tauri.conf.json`, so nobody is asked, and the same arguments lift the browser's
 * rule that somebody has to have pressed something first: with the equaliser left
 * on, it starts as the app does. Those are not promises anybody has made, so a
 * browser that insists after all only delays it to the first press, below.
 */

interface Tap {
  stream: MediaStream;
  context: AudioContext;
  worker: Worker;
}

/** How long to wait for Rust to be listening, and how often to look. */
const FEED_TRIES = 30;
const FEED_LOOK_MS = 100;

let tap: Tap | null = null;
/** Counted up by each change of mind, so a slow start cannot overtake a stop. */
let turn = 0;
let goesAway: ReturnType<typeof setTimeout> | null = null;
let waitingForPress: (() => void) | null = null;

interface Feed {
  port: number;
  word: string;
}

async function feedFromRust(): Promise<Feed | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  for (let tries = 0; tries < FEED_TRIES; tries++) {
    const feed = await invoke<Feed | null>('equaliser_feed');
    if (feed) return feed;
    await new Promise((resolve) => setTimeout(resolve, FEED_LOOK_MS));
  }
  return null;
}

function stopWaitingForPress(): void {
  if (!waitingForPress) return;
  window.removeEventListener('pointerdown', waitingForPress, true);
  window.removeEventListener('keydown', waitingForPress, true);
  waitingForPress = null;
}

function close(held: Tap): void {
  held.stream.getTracks().forEach((track) => track.stop());
  held.worker.terminate();
  void held.context.close();
}

async function begin(mine: number, onLost: () => void): Promise<void> {
  const feed = await feedFromRust();
  if (mine !== turn || !feed) return;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        // Off, so what is heard is what Rust plays, and not both.
        suppressLocalAudioPlayback: true,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      systemAudio: 'exclude',
    } as DisplayMediaStreamOptions);
  } catch (err) {
    // A browser insisting on a press after all. The sound carries on the ordinary way.
    if (mine !== turn) return;
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      const again = () => {
        stopWaitingForPress();
        if (mine === turn) void begin(mine, onLost);
      };
      waitingForPress = again;
      window.addEventListener('pointerdown', again, true);
      window.addEventListener('keydown', again, true);
      return;
    }
    log('warn', 'equaliser', 'could not capture the tab', err);
    onLost();
    return;
  }

  // It was only ever the sound that was wanted.
  stream.getVideoTracks().forEach((track) => track.stop());
  if (mine !== turn) {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }

  const context = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' });
  const worker = new Worker('/equaliser-tap-worker.js');
  const held: Tap = { stream, context, worker };
  try {
    await context.audioWorklet.addModule('/equaliser-tap-worklet.js');
    await context.resume();
  } catch (err) {
    log('warn', 'equaliser', 'could not start the tap', err);
    close(held);
    onLost();
    return;
  }
  if (mine !== turn) {
    close(held);
    return;
  }

  const lost = () => {
    if (tap !== held) return;
    tap = null;
    close(held);
    onLost();
  };
  stream.getAudioTracks().forEach((track) => track.addEventListener('ended', lost));
  worker.addEventListener('message', lost);

  const channel = new MessageChannel();
  worker.postMessage({ url: `ws://127.0.0.1:${feed.port}/?word=${feed.word}`, port: channel.port1 }, [channel.port1]);
  const node = new AudioWorkletNode(context, 'equaliser-tap', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: 'explicit',
    processorOptions: {},
  });
  node.port.postMessage({ port: channel.port2 }, [channel.port2]);
  context.createMediaStreamSource(stream).connect(node);
  // Nothing goes out of it. It has to lead somewhere to be run at all.
  node.connect(context.destination);
  tap = held;
}

/** Start capturing the tab and sending it, for as long as Rust is listening. */
export function tapTab(onLost: () => void): void {
  const mine = ++turn;
  if (goesAway) clearTimeout(goesAway);
  goesAway = null;
  stopWaitingForPress();
  if (tap) {
    // Turned back on inside the fade: what is there is still good.
    return;
  }
  void begin(mine, onLost).catch((err) => {
    log('warn', 'equaliser', 'could not begin the tap', err);
    onLost();
  });
}

/** Stop, after this long. The tab has its own sound again as the capture ends. */
export function letGoOfTab(afterMs: number): void {
  turn++;
  stopWaitingForPress();
  if (goesAway) clearTimeout(goesAway);
  goesAway = setTimeout(() => {
    goesAway = null;
    if (!tap) return;
    const held = tap;
    tap = null;
    close(held);
  }, afterMs);
}
