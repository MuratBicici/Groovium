import { libraryStoreDir } from '@/core/library';
import { isTauri } from '@/core/utils/env';
import { joinPath } from '@/core/utils/paths';
import { log } from '@/platform/log';

/**
 * The loudness of a song on this computer across its length, for the timing
 * strip to draw behind the lines.
 *
 * Moving lyrics by ear alone is slow: the listener has to play a stretch,
 * guess, and play it again. The shape of the sound shows where the singing
 * starts after an opening, where a break falls and where it ends — the places
 * the lines have to meet.
 *
 * Read from the library's own copy of the file, decoded in the webview, and
 * reduced at once to a few hundred peaks; the decoded sound is not kept. A
 * Spotify song has no file to read, and gets no shape.
 */

/** The fewest columns a shape has, for the shortest songs. */
export const ENVELOPE_COLUMNS = 600;
/** And the most, for the longest: under a hundred kilobytes kept a song. */
const MAX_COLUMNS = 24_000;

/** The last few songs' shapes, so reopening the strip draws at once. */
const KEEP = 8;
const kept = new Map<string, Promise<Float32Array | null>>();

/** The loudest moment of each column of the song, the loudest of all scaled to one. */
export function envelopeFrom(channels: Float32Array[], columns = ENVELOPE_COLUMNS): Float32Array {
  const length = channels[0]?.length ?? 0;
  const out = new Float32Array(columns);
  if (length === 0) return out;
  let loudest = 0;
  for (let c = 0; c < columns; c++) {
    const start = Math.floor((c * length) / columns);
    const end = Math.max(start + 1, Math.floor(((c + 1) * length) / columns));
    let peak = 0;
    for (const data of channels) {
      // Every sample would be millions a song; a few hundred a column draws
      // the same shape.
      const step = Math.max(1, Math.floor((end - start) / 256));
      for (let i = start; i < end; i += step) peak = Math.max(peak, Math.abs(data[i] ?? 0));
    }
    out[c] = peak;
    loudest = Math.max(loudest, peak);
  }
  if (loudest > 0) for (let c = 0; c < columns; c++) out[c] = (out[c] as number) / loudest;
  return out;
}

async function read(storedFile: string): Promise<Float32Array | null> {
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  const url = convertFileSrc(joinPath(await libraryStoreDir(), storedFile));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} for ${storedFile}`);
  const bytes = await response.arrayBuffer();
  const context = new OfflineAudioContext(1, 1, 44_100);
  const sound = await context.decodeAudioData(bytes);
  const channels = Array.from({ length: sound.numberOfChannels }, (_, i) => sound.getChannelData(i));
  // Fine enough for the strip at its narrowest — a few seconds across — to
  // still show the shape: forty columns a second.
  const columns = Math.round(Math.min(MAX_COLUMNS, Math.max(ENVELOPE_COLUMNS, sound.duration * 40)));
  return envelopeFrom(channels, columns);
}

/**
 * The shape of a library song's sound, by its stored file, or null when there
 * is none to read — outside the app, or a file the webview cannot decode.
 */
export function envelopeOf(storedFile: string): Promise<Float32Array | null> {
  if (!isTauri()) return Promise.resolve(null);
  const hit = kept.get(storedFile);
  if (hit) return hit;
  const shape = read(storedFile).catch((err: unknown) => {
    log('warn', 'lyrics', `no waveform for ${storedFile}`, err);
    return null;
  });
  kept.set(storedFile, shape);
  for (const key of [...kept.keys()].slice(0, Math.max(0, kept.size - KEEP))) kept.delete(key);
  return shape;
}
