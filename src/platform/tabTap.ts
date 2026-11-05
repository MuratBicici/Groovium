import { log } from './log';

/**
 * The tab's own sound, captured inside the browser and sent to the equaliser.
 *
 * This is the only way to it that comes before Windows: the capture is taken
 * from the browser's own audio, DRM or not, so a sound card's effects have not
 * been applied yet and are only applied once, on the way out from Rust.
 *
 * The page would not be able to keep the sound coming on its own thread: a long
 * render would be a gap in the music. So a worklet takes it off the audio thread
 * and a worker sends it (`public/equaliser-tap-*.js`), and neither waits on this.
 *
 * There are two captures, for going over without a gap. The first only listens,
 * and the tab goes on playing, so Rust can have the sound ready before anything
 * changes. Rust then fades itself in and the tab's session out together. The second
 * capture is what really silences the tab, which is a switch and cannot be faded,
 * and it is thrown while the session is down and nobody can hear it. The session
 * then goes back up: a level left down would outlive a crash, and the switch does
 * not. Coming back is the same the other way round.
 *
 * Choosing the tab and allowing it are done by browser arguments in
 * `tauri.conf.json`, so nobody is asked, and the same arguments lift the browser's
 * rule that somebody has to have pressed something first: with the equaliser left
 * on, it starts as the app does. Those are not promises anybody has made, so a
 * browser that insists after all only delays it to the first press, below.
 */

interface Tap {
  /** The capture that listens. */
  listening: MediaStream;
  /** The capture that silences the tab, once the session is down. */
  silencing: MediaStream | null;
  context: AudioContext;
  worker: Worker;
  /** Whether Rust has taken the sound over from the tab. */
  overInRust: boolean;
}

/** How long to wait for Rust to be listening, and how often to look. */
const FEED_TRIES = 30;
const FEED_LOOK_MS = 100;
/** How many times in a row the socket can close without opening, before giving up. */
const MOST_CLOSES = 5;

/** Whether the sound should be coming through Rust. */
let wanted = false;
/** Whether things are set up that way, or part way there. */
let up = false;
let settling = false;
let tap: Tap | null = null;
let tellLost: () => void = () => {};
let stopWaitingForPress: (() => void) | null = null;

interface Feed {
  port: number;
  word: string;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

const addressOf = (feed: Feed) => `ws://127.0.0.1:${feed.port}/?word=${feed.word}`;

async function feedFromRust(): Promise<Feed | null> {
  for (let tries = 0; tries < FEED_TRIES; tries++) {
    const feed = await call<Feed | null>('equaliser_feed');
    if (feed) return feed;
    await new Promise((resolve) => setTimeout(resolve, FEED_LOOK_MS));
  }
  return null;
}

function captureTab(silenceIt: boolean): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: {
      suppressLocalAudioPlayback: silenceIt,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    systemAudio: 'exclude',
  } as DisplayMediaStreamOptions);
}

const stopTracks = (stream: MediaStream) => stream.getTracks().forEach((track) => track.stop());

function close(held: Tap): void {
  stopTracks(held.listening);
  if (held.silencing) stopTracks(held.silencing);
  held.worker.terminate();
  void held.context.close();
}

/** Until the next press, or until it is no longer wanted. Says which. */
function nextPress(): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      window.removeEventListener('pointerdown', finish, true);
      window.removeEventListener('keydown', finish, true);
      stopWaitingForPress = null;
      resolve();
    };
    stopWaitingForPress = finish;
    window.addEventListener('pointerdown', finish, true);
    window.addEventListener('keydown', finish, true);
  });
}

/** The listening capture, however long that takes. Null if it went unwanted first. */
async function listenToTab(): Promise<MediaStream | null> {
  while (wanted) {
    try {
      const stream = await captureTab(false);
      // It was only ever the sound that was wanted.
      stream.getVideoTracks().forEach((track) => track.stop());
      return stream;
    } catch (err) {
      // A browser insisting on a press after all. The sound carries on the ordinary way.
      if (!(err instanceof DOMException && err.name === 'NotAllowedError')) throw err;
      await nextPress();
    }
  }
  return null;
}

/** The sound gone for good, on the way to the switch saying so. */
function lost(held: Tap, why: string): void {
  if (tap !== held || !wanted) return;
  log('warn', 'equaliser', `lost the tab's sound: ${why}`);
  wanted = false;
  tellLost();
  void settle();
}

function send(held: Tap, feed: Feed, stream: MediaStream): void {
  stream.getAudioTracks().forEach((track) => track.addEventListener('ended', () => lost(held, 'the capture ended')));

  // A socket closing is Rust's run ending, and it may only have gone round to start
  // another. So this goes and finds the new one before anything is given up on.
  let closes = 0;
  held.worker.addEventListener('message', (event: MessageEvent<string>) => {
    if (event.data === 'open') {
      closes = 0;
      return;
    }
    closes += 1;
    if (closes > MOST_CLOSES) {
      lost(held, 'the socket keeps closing');
      return;
    }
    void feedFromRust().then((next) => {
      if (tap !== held) return;
      if (next) held.worker.postMessage({ url: addressOf(next) });
      else lost(held, 'nobody is listening any more');
    });
  });

  const channel = new MessageChannel();
  held.worker.postMessage({ url: addressOf(feed), port: channel.port1 }, [channel.port1]);
  const node = new AudioWorkletNode(held.context, 'equaliser-tap', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: 'explicit',
    processorOptions: {},
  });
  node.port.postMessage({ port: channel.port2 }, [channel.port2]);
  held.context.createMediaStreamSource(stream).connect(node);
  // Nothing goes out of it. It has to lead somewhere to be run at all.
  node.connect(held.context.destination);
}

/** Over to Rust, as far as it can get before it stops being wanted. */
async function enter(): Promise<void> {
  await call('equaliser_run', { on: true });
  const feed = await feedFromRust();
  if (!wanted || !feed) return;

  const stream = await listenToTab();
  if (!stream) return;
  if (!wanted) {
    stopTracks(stream);
    return;
  }

  const held: Tap = {
    listening: stream,
    silencing: null,
    context: new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' }),
    worker: new Worker('/equaliser-tap-worker.js'),
    overInRust: false,
  };
  tap = held;
  await held.context.audioWorklet.addModule('/equaliser-tap-worklet.js');
  await held.context.resume();
  if (!wanted || tap !== held) return;
  send(held, feed, stream);

  held.overInRust = true;
  await call('equaliser_take_over');
  if (!wanted || tap !== held) return;

  const silencing = await captureTab(true);
  silencing.getVideoTracks().forEach((track) => track.stop());
  // Kept even if it stopped being wanted meanwhile: going back takes it off in order.
  held.silencing = silencing;
  silencing.getAudioTracks().forEach((track) => track.addEventListener('ended', () => lost(held, 'the capture ended')));
  if (!wanted || tap !== held) return;
  await call('equaliser_release_tab');
}

/** Back to the tab, from however far it got. */
async function leave(): Promise<void> {
  const held = tap;
  if (held?.overInRust) {
    await call('equaliser_hold_tab');
    if (held.silencing) {
      stopTracks(held.silencing);
      held.silencing = null;
    }
    // At once: the capture stumbles for a moment about 150 ms after the tab stops
    // being silenced, and Rust's fade should be over by then. Measured, waiting for
    // the tab's output to come back first left a dip in most of the switches.
    await call('equaliser_hand_back');
  }
  if (held && tap === held) {
    tap = null;
    close(held);
  }
  await call('equaliser_run', { on: false });
}

/** Until what is set up is what is wanted, one way or the other, one at a time. */
async function settle(): Promise<void> {
  if (settling) return;
  settling = true;
  while (wanted !== up) {
    try {
      if (wanted) {
        up = true;
        await enter();
      } else {
        await leave();
        up = false;
      }
    } catch (err) {
      log('warn', 'equaliser', 'could not move the sound', err);
      if (wanted) {
        wanted = false;
        tellLost();
      } else {
        // Not left in a state nobody will come back to. Rust gives the level back
        // as its run ends, whatever got this far.
        if (tap) close(tap);
        tap = null;
        up = false;
        void call('equaliser_run', { on: false }).catch(() => {});
      }
    }
  }
  settling = false;
}

/** Bring the sound through Rust, for as long as that is wanted. */
export function tapTab(onLost: () => void): void {
  tellLost = onLost;
  wanted = true;
  void settle();
}

/** Bring the sound back to the tab. */
export function letGoOfTab(): void {
  wanted = false;
  stopWaitingForPress?.();
  void settle();
}

/** Rust has given up and put the level back: all that is left is to stop capturing. */
export function dropTab(): void {
  wanted = false;
  stopWaitingForPress?.();
  if (tap) close(tap);
  tap = null;
  void settle();
}
